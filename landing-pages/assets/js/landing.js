/* Workspace Junction landing pages - shared behaviour (no dependencies). */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var CONTACT = {
    email: 'grow@workspacejunction.com',
    phone: '(773) 986-1908',
    phoneHref: '+17739861908'
  };

  /* ---------- Icon sprite (Lucide-style, inlined so it works from file:// too) ---------- */
  var ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    audio: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
    sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/>',
    armchair: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    tv: '<rect width="20" height="15" x="2" y="5" rx="2"/><path d="m17 2-5 3-5-3"/>',
    parking: '<circle cx="12" cy="12" r="10"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
    cast: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a9 9 0 0 1 8 8"/><path d="M2 16a5 5 0 0 1 4 4"/><path d="M2 20h.01"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    desk: '<path d="M3 10h18"/><path d="M5 10v10"/><path d="M19 10v10"/><path d="M14 10v6h5"/><rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v2"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
    pen: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    mapPin: '<path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0"/><circle cx="12" cy="8" r="2"/><path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    filePen: '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
    sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    flower: '<path d="M12 22c4.97 0 9-2.69 9-6-2.5 0-5.5 1-9 6Z"/><path d="M12 22c-4.97 0-9-2.69-9-6 2.5 0 5.5 1 9 6Z"/><path d="M12 22c-2-3-3-6.5-3-9.5C9 8 12 5 12 5s3 3 3 7.5c0 3-1 6.5-3 9.5Z"/>',
    building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    skyline: ''
  };
  var sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">';
  Object.keys(ICONS).forEach(function (k) {
    if (ICONS[k]) sprite += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + '</symbol>';
  });
  sprite += '</svg>';
  document.body.insertAdjacentHTML('afterbegin', sprite);

  /* ---------- Header: scrolled state + mobile menu ---------- */
  var header = document.querySelector('.site-header');
  var nav = document.querySelector('.main-nav');
  var toggle = document.querySelector('.nav-toggle');
  function onScroll() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
    var mcta = document.querySelector('.mobile-cta');
    if (mcta) {
      var hero = document.querySelector('.hero');
      var limit = hero ? hero.offsetTop + hero.offsetHeight - 80 : 400;
      var nearEnd = window.innerHeight + window.scrollY > document.body.scrollHeight - 260;
      mcta.classList.toggle('is-visible', window.scrollY > limit && !nearEnd);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.querySelector('use').setAttribute('href', '#i-menu');
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) closeNav(); });
  }

  /* ---------- FAQ: one open at a time inside each list ---------- */
  document.querySelectorAll('[data-faq]').forEach(function (list) {
    list.addEventListener('toggle', function (e) {
      if (!e.target.open) return;
      list.querySelectorAll('details[open]').forEach(function (d) { if (d !== e.target) d.open = false; });
    }, true);
  });

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- API (same origin; relative so it works at / or under /offers/) ---------- */
  var API_CANDIDATES = (function () {
    var list = [];
    var s = document.currentScript || document.querySelector('script[src*="landing.js"]');
    if (location.protocol !== 'file:') { try { list.push(new URL('../../api/', s.src).href); } catch (e) { list.push('api/'); } }
    /* Opened as a file or from another local server (e.g. VS Code Live Server): use the local checkout server. */
    var local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local && location.port !== '4310') list.push('http://localhost:4310/api/');
    return list;
  })();
  var API_BASE = API_CANDIDATES[0] || 'http://localhost:4310/api/';
  var config = null;           // { publishableKey, paymentsEnabled, enquiriesEnabled, catalog, promos }
  var catalogById = {};
  function tryConfig(i) {
    if (i >= API_CANDIDATES.length) return Promise.reject(new Error('API unavailable'));
    return fetch(API_CANDIDATES[i] + 'config', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
      .then(function (c) { API_BASE = API_CANDIDATES[i]; return c; })
      .catch(function () { return tryConfig(i + 1); });
  }
  var configReady = tryConfig(0)
    .then(function (c) {
      config = c;
      (c.catalog || []).forEach(function (p) { catalogById[p.id] = p; });
      applyPromos();
      return c;
    })
    .catch(function () {
      config = null; applyPromos();
      if (window.console) console.warn('[Workspace Junction] Checkout server not reachable. Start it with: cd landing-pages/server && node server.mjs, then open http://localhost:4310');
      return null;
    });

  function money(cents, currency) {
    var whole = cents % 100 === 0;
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }

  /* ---------- Promo counters (data-promo="mailbox", data-promo-remaining="dedicated-desk") ---------- */
  function animateBar(bar, pct) {
    var fill = bar.querySelector('.progress-fill');
    if (!fill) return;
    if ('IntersectionObserver' in window) {
      var pio = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { fill.style.width = pct + '%'; pio.disconnect(); } });
      pio.observe(bar);
    } else { fill.style.width = pct + '%'; }
  }
  function applyPromos() {
    document.querySelectorAll('[data-progress]').forEach(function (bar) {
      var id = bar.getAttribute('data-promo');
      var st = config && config.promos && id ? config.promos[id] : null;
      var label = bar.querySelector('.progress-label');
      if (st) {
        bar.setAttribute('aria-label', st.claimed + ' of ' + st.limit + ' claimed');
        if (label) label.textContent = st.claimed + ' of ' + st.limit + ' Claimed';
        animateBar(bar, Math.min(100, (st.claimed / st.limit) * 100));
      } else {
        animateBar(bar, Math.max(0, Math.min(100, (Number(bar.dataset.progress) / Number(bar.dataset.total || 100)) * 100)));
      }
    });
    document.querySelectorAll('[data-promo-remaining]').forEach(function (el) {
      var st = config && config.promos ? config.promos[el.getAttribute('data-promo-remaining')] : null;
      if (!st) return;
      el.hidden = false;
      el.textContent = st.remaining > 0
        ? 'Only ' + st.remaining + ' of ' + st.limit + ' left at this price.'
        : 'All promotional spots are taken right now. Call (773) 986-1908 to join the waitlist.';
    });
  }

  /* ---------- Stripe.js (loaded only when someone pays) ---------- */
  var stripeJs = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (!stripeJs) {
      stripeJs = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.async = true;
        s.onload = function () { window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe unavailable')); };
        s.onerror = function () { stripeJs = null; reject(new Error('The secure payment form could not be loaded. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return stripeJs;
  }

  /* ---------- Booking / checkout modal ---------- */
  var modal = document.getElementById('book-modal');
  var lastFocus = null;
  var embedded = null;
  var busy = false;

  function $(sel) { return modal ? modal.querySelector(sel) : null; }
  function showStep(name) {
    modal.querySelectorAll('[data-step]').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== name; });
    modal.classList.toggle('is-paying', name === 'pay');
    var dlg = $('.modal-dialog'); if (dlg) dlg.scrollTop = 0;
  }
  function destroyEmbedded() {
    if (embedded) { try { embedded.destroy(); } catch (e) {} embedded = null; }
    var mount = $('#checkout-mount');
    if (mount) mount.innerHTML = '<p class="checkout-loading">Loading secure payment form\u2026</p>';
  }
  function setError(msg) {
    var el = $('.form-error');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function currentPlan() {
    var sel = $('select[name="package"]');
    var id = sel ? sel.value : '';
    return config && config.paymentsEnabled && catalogById[id] ? catalogById[id] : null;
  }
  function refreshForm() {
    if (!modal) return;
    var plan = currentPlan();
    var qtyField = $('[data-qty-field]');
    var qty = $('input[name="quantity"]');
    var terms = $('[data-terms]');
    var summary = $('[data-summary]');
    var submit = $('[data-submit]');
    var dateLabel = $('label[for="f-date"]');
    if (qtyField) qtyField.hidden = !(plan && plan.maxQuantity > 1);
    if (plan && qty) {
      qty.min = plan.minQuantity; qty.max = plan.maxQuantity;
      /* A different plan starts from its own default (3 hours for the studio, 1 package for rooms). */
      if (qty.getAttribute('data-plan') !== plan.id) { qty.value = plan.defaultQuantity; qty.setAttribute('data-plan', plan.id); }
      var q = parseInt(qty.value, 10);
      if (!(q >= plan.minQuantity)) q = plan.minQuantity;
      if (q > plan.maxQuantity) q = plan.maxQuantity;
      qty.value = q;
      var ql = $('label[for="f-qty"]'); if (ql) ql.textContent = plan.unitLabel === 'hour' ? 'Hours' : 'Packages';
      var hint = $('[data-qty-hint]'); if (hint) hint.textContent = plan.unitLabel === 'hour' ? plan.minQuantity + '-hour minimum, up to ' + plan.maxQuantity + ' hours' : 'Each package is 5 prepaid hours';
    }
    if (terms) {
      var needs = Boolean(plan && plan.commitmentMonths);
      terms.hidden = !needs;
      var tt = $('[data-terms-text]');
      if (needs && tt) tt.textContent = 'I understand this offer requires a ' + plan.commitmentMonths + '-month commitment at ' + money(plan.unitAmount, plan.currency) + '/' + plan.interval + ', billed monthly.';
    }
    if (summary) {
      if (plan) {
        var n = qty && qtyField && !qtyField.hidden ? parseInt(qty.value, 10) : 1;
        summary.hidden = false;
        summary.innerHTML = plan.mode === 'subscription'
          ? '<span>Due today</span><strong>' + money(plan.unitAmount, plan.currency) + '</strong><small>Then ' + money(plan.unitAmount, plan.currency) + '/' + plan.interval + ' for the ' + plan.commitmentMonths + '-month term</small>'
          : '<span>Total due today</span><strong>' + money(plan.unitAmount * n, plan.currency) + '</strong><small>' + (n > 1 ? n + ' x ' + money(plan.unitAmount, plan.currency) + (plan.unitLabel === 'hour' ? ' per hour' : ' per package') : 'One-time payment') + '</small>';
      } else { summary.hidden = true; summary.innerHTML = ''; }
    }
    if (submit && !busy) submit.innerHTML = plan
      ? 'Continue to secure payment <svg class="icon" aria-hidden="true"><use href="#i-lock"/></svg>'
      : 'Send my request <svg class="icon" aria-hidden="true"><use href="#i-send"/></svg>';
    if (dateLabel) dateLabel.textContent = plan && plan.mode === 'subscription' ? 'Preferred start date' : 'Preferred date';
    var note = $('[data-pay-note]');
    if (note) note.hidden = !plan;
  }

  function openModal(trigger) {
    if (!modal) return;
    lastFocus = trigger || document.activeElement;
    destroyEmbedded();
    setError('');
    showStep('details');
    var pkg = trigger && trigger.getAttribute('data-package');
    var select = $('select[name="package"]');
    var qtyReset = $('input[name="quantity"]'); if (qtyReset) qtyReset.removeAttribute('data-plan');
    if (select) {
      select.selectedIndex = 0;
      if (pkg) Array.prototype.forEach.call(select.options, function (o) { if (o.value === pkg) select.value = pkg; });
    }
    refreshForm();
    configReady.then(refreshForm);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var first = modal.querySelector('select, input');
    setTimeout(function () { if (first) first.focus(); }, 60);
  }
  function closeModal() {
    if (!modal) return;
    destroyEmbedded();
    modal.classList.remove('is-open', 'is-paying');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function sentMessage(viaServer, isTour) {
    var t = $('[data-sent-title]'), m = $('[data-sent-message]');
    if (viaServer) {
      if (t) t.textContent = isTour ? 'Tour request sent' : 'Message sent';
      if (m) m.innerHTML = 'Thanks! Our team will get back to you within one business day. Need us sooner? Call <a href="tel:+17739861908">(773) 986-1908</a>.';
    } else {
      if (t) t.textContent = 'Almost done';
      if (m) m.innerHTML = 'Your email app should open with your request filled in. Send it and our team will get back to you. If nothing opened, email <a href="mailto:grow@workspacejunction.com">grow@workspacejunction.com</a> or call <a href="tel:+17739861908">(773) 986-1908</a>.';
    }
  }
  function mailtoEnquiry(form, label, offer) {
    var data = new FormData(form);
    var lines = ['Offer: ' + offer, 'Request: ' + label, 'Name: ' + data.get('name'), 'Email: ' + data.get('email'),
      'Phone: ' + (data.get('phone') || '-'), 'Preferred date: ' + (data.get('preferredDate') || '-'), '', (data.get('notes') || '')];
    window.location.href = 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent(offer + ' - ' + data.get('name')) + '&body=' + encodeURIComponent(lines.join('\n'));
    sentMessage(false);
    showStep('sent');
  }
  function sendEnquiry(form) {
    var data = new FormData(form);
    var sel = form.querySelector('select[name="package"]');
    var label = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '-';
    var value = sel ? sel.value : '';
    var offer = form.getAttribute('data-offer') || 'Workspace Junction offer';
    var isTour = value === 'tour' || /tour/i.test(label);
    if (!config || !config.enquiriesEnabled) { mailtoEnquiry(form, label, offer); return; }
    busy = true;
    var submit = $('[data-submit]');
    if (submit) { submit.disabled = true; submit.textContent = 'Sending\u2026'; }
    fetch(API_BASE + 'enquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type: isTour ? 'tour' : 'enquiry', offer: offer, request: label, name: data.get('name'), email: data.get('email'),
        phone: data.get('phone') || '', preferredDate: data.get('preferredDate') || '', notes: data.get('notes') || '', website: data.get('website') || '' })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'send failed'); return j; }); })
      .then(function () { sentMessage(true, isTour); showStep('sent'); form.reset(); })
      .catch(function (err) {
        if (err && /valid|name|email|phone|date|Too many/i.test(err.message)) setError(err.message);
        else mailtoEnquiry(form, label, offer);
      })
      .then(function () { busy = false; if (submit) submit.disabled = false; refreshForm(); });
  }

  function startCheckout(form, plan) {
    var data = new FormData(form);
    var qtyField = $('[data-qty-field]');
    var termsBox = form.querySelector('input[name="acceptTerms"]');
    var payload = {
      planId: plan.id,
      quantity: qtyField && !qtyField.hidden ? parseInt(data.get('quantity'), 10) : 1,
      name: data.get('name'), email: data.get('email'), phone: data.get('phone') || '',
      preferredDate: data.get('preferredDate') || '', notes: data.get('notes') || '',
      acceptTerms: Boolean(termsBox && termsBox.checked)
    };
    busy = true;
    var submit = $('[data-submit]');
    if (submit) { submit.disabled = true; submit.textContent = 'Preparing secure payment\u2026'; }
    fetch(API_BASE + 'checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'We could not start checkout. Please try again.');
          return j;
        });
      })
      .then(function (pay) {
        var paySummary = $('[data-pay-summary]');
        if (paySummary) paySummary.textContent = plan.name + (payload.quantity > 1 ? ' x ' + payload.quantity : '') + '. Your card details go directly to Stripe.';
        showStep('pay');
        return loadStripeJs().then(function (StripeFactory) {
          return StripeFactory(pay.publishableKey).initEmbeddedCheckout({ clientSecret: pay.clientSecret });
        }).then(function (instance) {
          if (!modal.classList.contains('is-open') || modal.querySelector('[data-step="pay"]').hidden) { instance.destroy(); return; }
          var mount = $('#checkout-mount');
          mount.innerHTML = '';
          instance.mount(mount);
          embedded = instance;
        });
      })
      .catch(function (err) {
        showStep('details');
        destroyEmbedded();
        setError(err && err.message ? err.message : 'Something went wrong. Please try again.');
      })
      .then(function () {
        busy = false;
        if (submit) submit.disabled = false;
        refreshForm();
      });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-book]');
    if (t) { e.preventDefault(); closeNav(); openModal(t); return; }
    if (e.target.closest('[data-close]')) { e.preventDefault(); closeModal(); return; }
    if (e.target.closest('[data-back]')) { e.preventDefault(); destroyEmbedded(); showStep('details'); return; }
    var step = e.target.closest('[data-qty]');
    if (step && modal && modal.contains(step)) {
      var q = $('input[name="quantity"]');
      var v = (parseInt(q.value, 10) || 0) + Number(step.getAttribute('data-qty'));
      q.value = Math.max(Number(q.min) || 1, Math.min(Number(q.max) || 99, v));
      refreshForm();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!modal || !modal.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      var f = modal.querySelectorAll('button, [href], input, select, textarea, iframe');
      var vis = Array.prototype.filter.call(f, function (el) { return el.offsetParent !== null && !el.disabled; });
      if (!vis.length) return;
      var first = vis[0], last = vis[vis.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  if (modal) {
    var form = modal.querySelector('form');
    form.addEventListener('change', refreshForm);
    form.addEventListener('input', function (e) { if (e.target.name === 'quantity') refreshForm(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      setError('');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var plan = currentPlan();
      if (!plan) { sendEnquiry(form); return; }
      var terms = form.querySelector('input[name="acceptTerms"]');
      if (plan.commitmentMonths && terms && !terms.checked) { setError('Please confirm the ' + plan.commitmentMonths + '-month commitment.'); terms.focus(); return; }
      startCheckout(form, plan);
    });
    var dateInput = modal.querySelector('input[type="date"]');
    if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
