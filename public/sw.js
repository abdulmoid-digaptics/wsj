/* Only exact, public, credential-free shell files are ever added to the offline cache. */
const scope = new URL(self.registration.scope);
const asset = name => new URL(name, scope).href;
const fallback = asset('account/');
const legacyMetadataCache = 'wsj-push-device-v1';
const audiences = ['customer', 'staff'];
const shellPrefix = `wsj-public-shell:${scope.pathname}:`;
const shellCache = `${shellPrefix}v1`;
const offline = asset('offline.html');
const shellFiles = new Map([
  [offline, 'text/html'],
  ...['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'badge-72.png', 'apple-touch-icon-180.png', 'apple-touch-icon-152.png', 'apple-touch-icon-167.png']
    .map(name => [asset(`icons/${name}`), 'image/png']),
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    await Promise.all(Array.from(shellFiles, async ([url, type]) => {
      const response = await fetch(url, {credentials: 'omit', cache: 'no-store', redirect: 'error'});
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith(type)) throw new Error(`Invalid shell asset: ${url}`);
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key === legacyMetadataCache || (key.startsWith(shellPrefix) && key !== shellCache)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (shellFiles.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(shellCache);
      return (await cache.match(url.href)) ?? fetch(request, {credentials: 'omit', cache: 'no-store'});
    })());
    return;
  }
  const protectedPath = /^(?:account|admin|api|login|activate|forgot-password|reset-password|booking-confirmation|[^/]*checkout|membership-confirmation)(?:\/|$)/.test(url.pathname.slice(scope.pathname.length));
  if (request.mode === 'navigate') {
    // A network failure may show the same generic page. Never save the actual response.
    event.respondWith(fetch(request, {cache: 'no-store'}).catch(async () => {
      const cache = await caches.open(shellCache);
      return (await cache.match(offline)) ?? new Response('You are offline. Reconnect and try again.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
    }));
  } else if (protectedPath) {
    event.respondWith(fetch(request, {cache: 'no-store'}));
  }
});

async function appBadge(count) {
  try {
    if (count === undefined) await self.navigator?.setAppBadge?.();
    else if (count > 0) await self.navigator?.setAppBadge?.(count);
    else await self.navigator?.clearAppBadge?.();
  } catch { /* The OS/browser may not expose an app badge. */ }
}

function destination(value) {
  try {
    const path = typeof value === 'string' ? value : fallback;
    const url = new URL(scope.pathname !== '/' && /^\/(?:account|admin)(?:\/|\?|#|$)/.test(path) && !path.startsWith(scope.pathname) ? path.slice(1) : path, scope);
    return url.origin === scope.origin && url.pathname.startsWith(scope.pathname) ? url.href : fallback;
  } catch { return fallback; }
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* malformed push */ }
  if (typeof data !== 'object') data = {};
  const url = destination(data.url);
  const actions = Array.isArray(data.actions) ? data.actions.filter(action => action && typeof action.action === 'string' && typeof action.title === 'string').slice(0, 2) : [];
  const actionUrls = Object.fromEntries(actions.map(action => [action.action, destination(action.url || url)]));
  event.waitUntil(Promise.all([
    self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Workspace Junction', {
      body: typeof data.body === 'string' ? data.body : '',
      icon: asset('icons/icon-192.png'),
      badge: asset('icons/badge-72.png'),
      tag: typeof data.tag === 'string' ? data.tag : typeof data.id === 'string' ? data.id : undefined,
      actions: actions.map(({action, title}) => ({action, title})),
      data: {url, actionUrls},
    }),
    Number.isSafeInteger(data.count) && data.count >= 0 ? appBadge(data.count)
      : typeof data.id === 'string' || typeof data.title === 'string' ? appBadge() : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const actions = event.notification.data?.actionUrls ?? {};
  const url = destination((Object.hasOwn(actions, event.action) ? actions[event.action] : null) ?? event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const target = new URL(url);
    const section = target.pathname.slice(scope.pathname.length).split('/')[0];
    const client = windows.find(item => item.url === url) ?? windows.find(item => {
      const current = new URL(item.url);
      const root = `${scope.pathname}${section}`;
      return current.origin === target.origin && (current.pathname === root || current.pathname.startsWith(`${root}/`));
    });
    if (client) {
      try {
        const focused = await client.focus();
        if (focused.url === url || await focused.navigate(url)) { await appBadge(0); return; }
      } catch { /* fall back to opening a new window */ }
    }
    if (await self.clients.openWindow(url)) await appBadge(0);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    if (!old?.endpoint) return;
    // Ask the authenticated endpoint which session owns the old endpoint. No device binding is stored in Cache Storage.
    for (const audience of audiences) {
      const headers = {'Content-Type': 'application/json', 'X-WSJ-CSRF': '1', 'X-WSJ-Audience': audience};
      const status = await fetch(asset('api/notifications/push-status/'), {method: 'POST', headers, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({endpoint: old.endpoint})});
      if (!status.ok || !(await status.json()).active) continue;
      const key = old.options?.applicationServerKey;
      const subscription = event.newSubscription || (key && await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key}));
      if (!subscription) return;
      await fetch(asset('api/notifications/push-subscribe/'), {
        method: 'POST', headers, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({...subscription.toJSON(), previousEndpoint: old.endpoint}),
      });
      return;
    }
  })().catch(() => { /* unsupported/offline renewal: reconnect from notification settings */ }));
});
