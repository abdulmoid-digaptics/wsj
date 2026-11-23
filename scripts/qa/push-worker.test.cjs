const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8');
const origin = 'https://workspace.example';

const shell = 'wsj-public-shell:/:v1';
const fallback = 'Generic offline page';
const fakeAsset = url => new Response(fallback, {headers: {'Content-Type': url.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'}});

function worker({client, fetch = async url => fakeAsset(url), path = '/', keys = [], badges = true} = {}) {
  const handlers = new Map();
  const calls = [];
  const store = new Map(keys.map(key => [key, new Map()]));
  vm.runInNewContext(source, {URL, Response, fetch, caches: {
    open: async key => {
      if (!store.has(key)) store.set(key, new Map());
      const entries = store.get(key);
      return {match: async url => entries.get(url)?.clone(), put: async (url, value) => entries.set(url, value.clone())};
    }, keys: async () => [...store.keys()], delete: async key => store.delete(key),
  }, self: {
    registration: {scope: origin + path, showNotification: async (...args) => calls.push(['notify', ...args])},
    navigator: badges ? {setAppBadge: async count => calls.push(['badge', count]), clearAppBadge: async () => calls.push(['clear'])} : {},
    skipWaiting: async () => calls.push(['skip']),
    clients: {claim: async () => calls.push(['claim']), matchAll: async () => client ? [client] : [], openWindow: async url => {calls.push(['open', url]); return {url};}},
    addEventListener: (event, handler) => handlers.set(event, handler),
  }});
  return {calls, store, async emit(type, event = {}) {
    const pending = [];
    let response;
    handlers.get(type)({...event, waitUntil: promise => pending.push(promise), respondWith: promise => {response = promise;}});
    await Promise.all(pending);
    return response;
  }, request(path, mode = 'navigate', method = 'GET') {
    return this.emit('fetch', {request: {url: new URL(path, origin).href, method, mode}});
  }};
}

test('the shell only caches an exact credential-free public allowlist, and activation clears legacy device metadata', async () => {
  const requests = [];
  const keys = ['wsj-public-shell:/:v0', 'wsj-public-shell:/preview/:v0', 'wsj-push-device-v1', 'unrelated'];
  const app = worker({keys, fetch: async (url, init) => {requests.push([url, init]); return fakeAsset(url);}});
  await app.emit('install');
  await app.emit('activate');
  assert.equal(requests.length, 8);
  for (const [url, init] of requests) {
    assert.match(url, /\/(offline\.html|icons\/[\w-]+\.png)$/);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
  }
  assert.equal(app.store.get(shell).size, 8);
  assert.deepEqual([...app.store.keys()].sort(), [shell, keys[1], keys[3]].sort());
  assert.deepEqual(app.calls, [['skip'], ['claim']]);
});

test('account, booking, checkout and API always use the network; no private responses are cached', async () => {
  let offline = false;
  const requests = [];
  const app = worker({fetch: async (request, init) => {
    requests.push(init);
    if (offline) throw new TypeError('offline');
    if (typeof request === 'string') return fakeAsset(request);
    return new Response('Private network data');
  }});
  await app.emit('install');
  const initial = [...app.store.get(shell).keys()].sort();
  const routes = ['/account/bookings/booking-test/', '/admin/?view=inquiries', '/membership-checkout/?secret=test', '/booking-confirmation/', '/api/account/bookings/'];
  for (const route of routes) {
    assert.equal(await (await app.request(route)).text(), 'Private network data');
    assert.equal(requests.at(-1).cache, 'no-store');
  }
  assert.equal(await (await app.request('/api/account/bookings/', 'cors')).text(), 'Private network data');
  offline = true;
  for (const route of routes) assert.equal(await (await app.request(route)).text(), fallback);
  await assert.rejects(app.request('/api/account/bookings/', 'cors'), /offline/);
  assert.equal(await app.request('/api/notifications/push-subscribe/', 'cors', 'POST'), undefined);
  assert.equal(await app.request('https://other.example/icon.png', 'cors'), undefined);
  assert.equal(await app.request('/icons/icon-192.png?unexpected=1', 'cors'), undefined);
  assert.equal(await (await app.request('/icons/icon-192.png', 'no-cors')).text(), fallback);
  assert.deepEqual([...app.store.get(shell).keys()].sort(), initial);
});

test('the worker refuses to activate a shell with an unexpected content type', async () => {
  const app = worker({fetch: async () => new Response('wrong response', {headers: {'Content-Type': 'application/json'}})});
  await assert.rejects(app.emit('install'), /Invalid shell asset/);
  assert.equal(app.store.get(shell).size, 0);
  assert.deepEqual(app.calls, []);
});

test('push displays configured copy, badges and dedupe tags and rejects off-origin links', async () => {
  const app = worker();
  await app.emit('push', {data: {json: () => ({id: 'booking-1', count: 7, title: 'Booking confirmed', body: 'See details', url: 'https://other.example', icon: '/api/private/', actions: [{action: 'booking', title: 'View', url: '/account/bookings/'}]})}});
  const [, title, options] = app.calls[0];
  assert.equal(title, 'Booking confirmed');
  assert.equal(options.data.url, `${origin}/account/`);
  assert.equal(options.data.actionUrls.booking, `${origin}/account/bookings/`);
  assert.equal(options.icon, `${origin}/icons/icon-192.png`);
  assert.equal(options.badge, `${origin}/icons/badge-72.png`);
  assert.equal(options.tag, 'booking-1');
  assert.deepEqual(app.calls[1], ['badge', 7]);
});

test('valid alerts still get a generic badge if the unread count is unavailable', async () => {
  const app = worker();
  await app.emit('push', {data: {json: () => ({id: 'alert', title: 'New alert'})}});
  assert.deepEqual(app.calls[1], ['badge', undefined]);
});

test('malformed push payloads still display without badge support', async () => {
  const app = worker({badges: false});
  await app.emit('push', {data: {json() { throw new Error('bad JSON'); }}});
  assert.equal(app.calls[0][1], 'Workspace Junction');
  assert.equal(app.calls.length, 1);
});

test('notification click opens a new window when the account portal is closed', async () => {
  let closed = false;
  const app = worker({client: {url: `${origin}/membership-checkout/`}});
  await app.emit('notificationclick', {notification: {data: {url: '/account/bookings/'}, close() {closed = true;}}});
  assert.equal(closed, true);
  assert.deepEqual(app.calls, [['open', `${origin}/account/bookings/`], ['clear']]);
});

test('notification click focuses and navigates an open portal', async () => {
  const visited = [];
  const client = {url: `${origin}/preview/admin/`, focus: async () => client, navigate: async url => {visited.push(url); return client;}};
  const app = worker({client, path: '/preview/'});
  await app.emit('notificationclick', {action: 'constructor', notification: {data: {url: '/admin/?view=inquiries#inquiries', actionUrls: {}}, close() {}}});
  assert.deepEqual(visited, [`${origin}/preview/admin/?view=inquiries#inquiries`]);
  assert.deepEqual(app.calls, [['clear']]);
});

test('renewal rotates only within an authenticated owner and without caching device binding metadata', async () => {
  const requests = [];
  const app = worker({fetch: async (url, init) => {
    requests.push([url, init]);
    return Response.json({active: init.headers['X-WSJ-Audience'] === 'staff'});
  }});
  await app.emit('pushsubscriptionchange', {oldSubscription: {endpoint: 'old'}, newSubscription: {endpoint: 'new', toJSON: () => ({endpoint: 'new'})}});
  assert.equal(requests[0][1].headers['X-WSJ-Audience'], 'customer');
  assert.equal(requests[1][1].headers['X-WSJ-Audience'], 'staff');
  assert.equal(requests[1][0], `${origin}/api/notifications/push-status/`);
  assert.equal(requests[2][0], `${origin}/api/notifications/push-subscribe/`);
  assert.deepEqual(JSON.parse(requests[2][1].body), {endpoint: 'new', previousEndpoint: 'old'});
  assert.equal(requests[2][1].cache, 'no-store');
  assert.equal(app.store.size, 0);
});

test('renewal cannot rotate when neither authenticated audience owns the endpoint', async () => {
  const paths = [];
  const app = worker({fetch: async url => {paths.push(url); return new Response(null, {status: 401});}});
  await app.emit('pushsubscriptionchange', {oldSubscription: {endpoint: 'old'}, newSubscription: {endpoint: 'new'}});
  assert.deepEqual(paths, [`${origin}/api/notifications/push-status/`, `${origin}/api/notifications/push-status/`]);
});
