'use strict';
// Imported ONLY by the separate QA entry point, never by backend/src.
const {createHash}=require('node:crypto');
function localOrigin(raw){const u=new URL(raw);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Local fixture origin required');return u.origin;}
function createLocalPaymentFixture(origin){
 origin=localOrigin(origin);const calls=[];
 const id=(prefix,value)=>prefix+createHash('sha256').update(value).digest('hex').slice(0,24);
 return {calls,client(){return {
  promotionCodes:{list:async input=>{calls.push({kind:'coupon'});return {data:input.code==='QA_LOCAL_VALID'?[{id:'promo_local_fixture'}]:[]};}},
  checkout:{sessions:{create:async input=>{calls.push({kind:'checkout',input});const booking=input.metadata.bookingId;return {id:id('cs_local_',booking),url:origin+'/booking-confirmation/?booking='+encodeURIComponent(booking)};}}},
  refunds:{create:async input=>{calls.push({kind:'refund',input});if(!input.payment_intent.startsWith('pi_local_'))throw new Error('Local fixture payment intent required');return {id:id('re_local_',input.payment_intent)};}},
  webhooks:{constructEvent:(...args)=>{const Stripe=require('../../backend/node_modules/stripe');return new Stripe('sk_test_signature_only_local').webhooks.constructEvent(...args);}},
 };}};
}
module.exports={createLocalPaymentFixture,localOrigin};
