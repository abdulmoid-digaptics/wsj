import {Injectable,InternalServerErrorException} from '@nestjs/common';
import Stripe from 'stripe';
/** Production provider. No environment flag can select a fake transport. */
@Injectable()
export class PaymentClient {
 private cached?:{key:string;client:Stripe};
 client():Stripe {
  const key=process.env.STRIPE_SECRET_KEY?.trim();
  if(!key)throw new InternalServerErrorException('Payments are not configured');
  /* One client per key with a bounded timeout. The SDK retries network failures with the same
     idempotency key, so a retried POST cannot create a second charge. */
  if(this.cached?.key!==key)this.cached={key,client:new Stripe(key,{timeout:20000,maxNetworkRetries:2})};
  return this.cached.client;
 }
}
