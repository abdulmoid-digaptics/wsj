import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderCancellationQuery} from '../../lib/order-support-query.ts';

test('cancellation query carries the exact order reference and a trimmed customer message', () => {
  assert.deepEqual(orderCancellationQuery('order-123', '  Please review my order.  '), {
    type: 'SUPPORT', subject: 'Help with order cancellation', message: 'Please review my order.', reference: 'order-123',
  });
});
