import {Injectable,InternalServerErrorException} from '@nestjs/common';
import Stripe from 'stripe';
/** Production provider. No environment flag can select a fake transport. */
@Injectable()
export class PaymentClient {
 client():Stripe {
  const key=process.env.STRIPE_SECRET_KEY?.trim();
  if(!key)throw new InternalServerErrorException('Payments are not configured');
  return new Stripe(key);
 }
}
