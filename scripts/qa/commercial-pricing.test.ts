import assert from 'node:assert/strict';
import test from 'node:test';
import {publicCheckoutPrice} from '../../lib/commercial-pricing';
import type {ServiceDetail} from '../../lib/catalog';

const row = {slug:'approved-llc-setup-csb-llc-basic-package', metadata:{service:'llc-setup',price:199,billingPeriod:'old'}};
const detail = {slug:'llc-setup',plans:[{slug:'llc-basic-package',unitAmountCents:20000,currency:'usd',unitLabel:'one-time'}]} as ServiceDetail;
test('stale LLC rate is replaced with checkout cents and state fee disclosure', () => {
  const result = publicCheckoutPrice(row, detail);
  assert.equal(result?.metadata.price,200);
  assert.equal(result?.metadata.billingPeriod,'plus state filing fee');
  assert.equal(row.metadata.price,199);
});
test('missing, wrong-service and unmatched checkout plans do not advertise the old price', () => {
  assert.equal(publicCheckoutPrice(row),null);
  assert.equal(publicCheckoutPrice(row,{...detail,slug:'unrelated'}),null);
  assert.equal(publicCheckoutPrice({...row,slug:'basic'},detail),null);
});
test('published inquiry rates are not replaced by a checkout price', () => {
  const rate = {metadata:{service:'events',price:120}};
  assert.equal(publicCheckoutPrice(rate),rate);
});
