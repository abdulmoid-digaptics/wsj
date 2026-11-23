import {BadRequestException, Controller, ForbiddenException, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Req, Res} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {Db} from './core';
import {CardService} from './account-cards';
import {BillingService} from './billing';
import {PaymentClient} from './payments';
import {frontendOrigins} from './origins';

type Request = {headers: Record<string, string | string[] | undefined>};

/** Call only under the customer operation lock. Shared entry point for account and guest cancellation. */
@Injectable()
export class UnpaidOrderCancellationService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(PaymentClient) private readonly payments: PaymentClient, @Inject(BillingService) private readonly billing: BillingService) {}

  async cancel(order: {id: string; customerId: string; status: string; paymentMethod: string; stripeCheckoutSessionId: string | null}, actorId?: string) {
    if (order.status !== 'PENDING' || order.paymentMethod !== 'STRIPE' || !order.stripeCheckoutSessionId) throw new BadRequestException('Checkout cannot be safely canceled automatically. Contact support.');
    const audit = (action: string, stripeRef?: string, data?: Record<string, unknown>) => this.billing.record({orderId: order.id, customerId: order.customerId, actorType: 'CUSTOMER', actorId, action, stripeRef, data});
    const stripe = this.payments.client();
    let session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (session.status === 'open' && session.payment_status === 'unpaid') {
      try { session = await stripe.checkout.sessions.expire(session.id); }
      catch { session = await stripe.checkout.sessions.retrieve(session.id); }
    }
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') {
      await audit('ORDER_CANCEL_PAYMENT_UNCERTAIN', session.id, {sessionStatus: session.status, paymentStatus: session.payment_status});
      throw new BadRequestException('Checkout has completed or payment is processing. Please wait for payment confirmation or contact support.');
    }
    const changed = await this.db.order.updateMany({where: {id: order.id, customerId: order.customerId, status: 'PENDING', stripeCheckoutSessionId: order.stripeCheckoutSessionId}, data: {status: 'CANCELLED'}});
    if (!changed.count) throw new BadRequestException('The order status changed. Please try again.');
    await audit('ORDER_CANCELLED_UNPAID', session.id);
    /* An unpaid hold also lapses at its expiry, so a deferred release never oversells. */
    await this.billing.releaseOrderReservations(order, ['CANCELLED']).catch(() => console.error('[inventory] hold release deferred for order ' + order.id));
    return {status: 'CANCELLED'};
  }
}

/** The receipt proof is a bearer credential, never accepted in a URL or response. */
@Controller()
export class GuestOrderCancellationController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CardService) private readonly cards: CardService, @Inject(UnpaidOrderCancellationService) private readonly unpaid: UnpaidOrderCancellationService, @Inject(BillingService) private readonly billing: BillingService) {}

  @Post('billing/orders/:id/cancel') @HttpCode(200) @Throttle({default: {limit: 5, ttl: 60000}})
  async cancel(@Param('id') id: string, @Req() req: Request, @Res({passthrough: true}) res: {setHeader(name: string, value: string): void}) {
    res.setHeader('Cache-Control', 'no-store, private');
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !frontendOrigins().includes(origin)) throw new ForbiddenException();
    if (!this.billing.receiptProofMatches(id, req.headers['x-order-proof'])) throw new NotFoundException();
    const first = await this.db.order.findUnique({where: {id}});
    if (!first) throw new NotFoundException();
    return this.cards.withLock(first.customerId, async () => {
      const order = await this.db.order.findUnique({where: {id}});
      if (!order || order.customerId !== first.customerId) throw new NotFoundException();
      return this.unpaid.cancel(order);
    });
  }
}
