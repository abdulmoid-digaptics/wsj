import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiUrl} from '../../lib/public-api.ts';

// trailingSlash:true redirects /api/x to /api/x/; requests made with redirect:'error' then fail.
test('browser API URLs always carry a trailing slash before the query string', () => {
  assert.equal(apiUrl('/billing/orders/abc/status', '/api'), '/api/billing/orders/abc/status/');
  assert.equal(apiUrl('/inquiries', '/api'), '/api/inquiries/');
  assert.equal(apiUrl('/public/popups/', '/api'), '/api/public/popups/');
  assert.equal(apiUrl('/admin/pages?limit=10&page=2', '/api'), '/api/admin/pages/?limit=10&page=2');
  assert.equal(apiUrl('/admin/pages/?limit=1', '/api'), '/api/admin/pages/?limit=1');
  assert.equal(apiUrl('/account/bookings/x/calendar#top', '/api'), '/api/account/bookings/x/calendar/#top');
  assert.equal(apiUrl('/health', 'https://api.example.com/api'), 'https://api.example.com/api/health/');
});
