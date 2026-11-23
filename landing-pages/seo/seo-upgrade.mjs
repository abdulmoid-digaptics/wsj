#!/usr/bin/env node
/**
 * SEO upgrade for the Workspace Junction Thanksgiving landing pages (idempotent; safe to re-run).
 * Keyword targets come from workspacejunction.com Google Search Console queries (Nov 2026):
 *   podcast studio chicago / chicago podcast studio / podcast studio rental / cheap podcast near chicago,
 *   meeting room oak brook / meeting space oak brook il / conference room rental,
 *   coworking oakbrook terrace / oakbrook coworking / dedicated desk / rent a desk,
 *   virtual mailbox chicago / mailbox rental chicago / business address chicago.
 * Copy uses only facts already on the pages / FAQ PDF (address, prices, amenities, service area).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sitemapPath = path.join(root, 'sitemap.xml');
const BASE = fs.readFileSync(sitemapPath, 'utf8').match(/<loc>(https:\/\/[^<]+?\/)<\/loc>/)[1];
const TODAY = new Date().toISOString().slice(0, 10);
const ADDRESS = '1S280 Summit Ave Unit E2, Suite 1, Oakbrook Terrace, IL 60181';
const GEO = { lat: 41.84251, lng: -87.957298 };
const MAP = 'https://www.google.com/maps/search/?api=1&query=41.842510,-87.957298';
const SAME_AS = ['https://www.instagram.com/workspace.junction', 'https://www.linkedin.com/company/workspace-junction', 'https://www.facebook.com/people/Workspace-Junction/61577329376091/'];
const AREA = ['Oakbrook Terrace', 'Oak Brook', 'Lombard', 'Villa Park', 'Elmhurst', 'Chicago'];
const MAIN = 'https://workspacejunction.com/';

const P = {
  'index.html': {
    slug: '', name: 'Thanksgiving & Black Friday Offers', crumb: 'Thanksgiving Offers',
    title: 'Coworking Deals Oakbrook Terrace, IL | Workspace Junction',
    desc: 'Thanksgiving & Black Friday deals at Workspace Junction, Oakbrook Terrace IL: podcast studio, meeting rooms, boardroom, dedicated desks & business mailboxes.',
    kw: 'coworking oakbrook terrace, oakbrook coworking, coworking deals chicago suburbs, black friday coworking, thanksgiving office deals, meeting room oak brook, podcast studio chicago',
    og: 'og-thanksgiving-offers.jpg', ogFrom: 'reception.webp', ogTitle: 'Thanksgiving & Black Friday Offers', ogSub: 'Studio · Meeting rooms · Desks · Mailboxes',
    h2: 'Coworking Deals in Oakbrook Terrace, Near Chicago',
    body: [
      `Workspace Junction at ${ADDRESS} is running Thanksgiving and Black Friday offers on its most popular services, serving Oak Brook, Lombard, Villa Park and the surrounding Chicago suburbs.`,
      'Book the professional podcast studio from $120 per hour, a 6-person conference room for $25 per hour, or the executive boardroom for $50 per hour. Members can claim a dedicated desk for $250 per month or a business mailbox with a real street address for $25.00 per month while promotional spots last.'
    ],
    main: [['Coworking at Workspace Junction', MAIN + 'coworking/'], ['Workspace Junction home', MAIN]]
  },
  'podcast-studio.html': {
    slug: 'podcast-studio', name: 'Podcast Studio Rental', crumb: 'Podcast Studio',
    title: 'Podcast Studio Rental Chicago, $120/hr | Workspace Junction',
    desc: 'Rent a professional audio & video podcast studio near Chicago in Oakbrook Terrace, IL. Thanksgiving rates from $120/hr, 3-hour minimum. Book online.',
    kw: 'podcast studio chicago, chicago podcast studio, podcast studio rental, podcast studio near me, podcast recording studio chicago, video podcast studio, podcast room for rent, cheap podcast studio near chicago',
    og: 'og-podcast-studio-rental-chicago.jpg', ogFrom: 'podcast-hero.webp', ogTitle: 'Podcast Studio Rental Near Chicago', ogSub: 'Thanksgiving Special from $120/hr',
    hero: ['podcast-hero.webp', 'podcast-studio-rental-oakbrook-terrace-chicago.webp'],
    h2: 'Podcast Studio Rental Near Chicago, in Oakbrook Terrace',
    body: [
      `The Workspace Junction podcast studio at ${ADDRESS} is a professional audio and video recording space for creators, businesses and organizations across the Chicagoland area, including Oak Brook, Lombard and Villa Park.`,
      'The studio has professional microphones, multi-camera video, studio lighting, sound treatment, high-speed Wi-Fi and comfortable seating, with free parking on site. Record solo shows, guest interviews, panel discussions and video podcasts. Thanksgiving packages start at $120 per hour (Starter), $150 per hour (Standard) and $199 per hour (Premium), each with a 3-hour minimum.'
    ],
    alts: {
      'podcast-hero.webp': 'Hosts recording a video podcast in the Workspace Junction podcast studio, Oakbrook Terrace near Chicago',
      'podcast-studio-rental-oakbrook-terrace-chicago.webp': 'Hosts recording a video podcast in the Workspace Junction podcast studio, Oakbrook Terrace near Chicago',
      'podcast-solo.webp': 'Professional podcast microphones set up for a solo recording at the Oakbrook Terrace studio',
      'podcast-guests.webp': 'Podcast host interviewing two guests at the round table in the Workspace Junction studio',
      'podcast-wide.webp': 'Four-person panel discussion recorded in the podcast studio near Chicago'
    },
    main: [['Podcast Studio at Workspace Junction', MAIN + 'podcast-studio/']]
  },
  'conference-room.html': {
    slug: 'conference-room', name: 'Conference Room Rental', crumb: 'Conference Room',
    title: 'Meeting Room Rental Oak Brook, $25/hr | Workspace Junction',
    desc: 'Book a 6-person conference room in Oakbrook Terrace near Oak Brook, IL. 50% off: $25/hour, 5 hours for $125, with TV, Logitech Rally Bar and free parking.',
    kw: 'meeting room oak brook, meeting space oak brook il, conference room rental oak brook, meeting room oakbrook terrace, conference room rental chicago suburbs, rent conference room near me, meeting room near me',
    og: 'og-conference-room-rental-oak-brook.jpg', ogFrom: 'conference-hero.webp', ogTitle: 'Conference Room Rental, Oak Brook Area', ogSub: '50% OFF · $25/hour · 5 hours for $125',
    hero: ['conference-hero.webp', 'conference-room-rental-oakbrook-terrace.webp'],
    h2: 'Conference Room Rental in Oakbrook Terrace, Near Oak Brook',
    body: [
      `A private conference room for up to 6 people at ${ADDRESS}, serving Oak Brook, Lombard, Villa Park and the surrounding Chicago suburbs. It includes a TV with HDMI and screen sharing, video conferencing with a Logitech Rally Bar and Tap, high-speed Wi-Fi and free on-site parking.`,
      'During the Thanksgiving promotion the room is 50% off: $25 per hour instead of $50. Buy a 5-hour package for $125 and book 1-, 2- or 3-hour meetings later, subject to available slots. No membership required.'
    ],
    alts: {
      'conference-hero.webp': 'Conference room for 6 with TV and video conferencing at Workspace Junction, Oakbrook Terrace',
      'conference-room-rental-oakbrook-terrace.webp': 'Conference room for 6 with TV and video conferencing at Workspace Junction, Oakbrook Terrace',
      'conference-table.webp': 'Meeting room table and mesh chairs available to rent near Oak Brook, IL'
    },
    main: [['Meeting Rooms at Workspace Junction', MAIN + 'meeting-rooms/']]
  },
  'boardroom.html': {
    slug: 'boardroom', name: 'Boardroom Rental', crumb: 'Boardroom',
    title: 'Boardroom Rental Oak Brook, IL $50/hr | Workspace Junction',
    desc: 'Executive boardroom rental in Oakbrook Terrace near Oak Brook, IL with 65-inch TV video conferencing. Thanksgiving special: $50/hour, 5 prepaid hours for $250.',
    kw: 'boardroom rental oak brook, executive boardroom rental, boardroom oakbrook terrace, meeting space oak brook il, boardroom with video conferencing, boardroom rental chicago suburbs',
    og: 'og-boardroom-rental-oak-brook.jpg', ogFrom: 'boardroom-video-call.webp', ogTitle: 'Executive Boardroom Rental, Oak Brook Area', ogSub: '$50/hour · 5 prepaid hours for $250',
    hero: ['boardroom-video-call.webp', 'boardroom-rental-oak-brook-video-conferencing.webp'],
    h2: 'Boardroom Rental in Oakbrook Terrace, Near Oak Brook',
    body: [
      `An executive boardroom at ${ADDRESS} for client meetings, team sessions and presentations. It has video conferencing on a 65-inch TV with a Logitech Rally Bar, HDMI and screen sharing, comfortable executive seating, high-speed Wi-Fi and free parking.`,
      'Thanksgiving special: $50 per hour instead of the regular $70. Buy 5 prepaid hours for $250, save $100, and schedule individual 1-, 2- or 3-hour meetings later, subject to available slots.'
    ],
    alts: {
      'boardroom-video-call.webp': 'Executive boardroom with 65-inch TV video call at Workspace Junction near Oak Brook, IL',
      'boardroom-rental-oak-brook-video-conferencing.webp': 'Executive boardroom with 65-inch TV video call at Workspace Junction near Oak Brook, IL',
      'boardroom-seating.webp': 'Executive leather seating in the Workspace Junction boardroom, Oakbrook Terrace'
    },
    main: [['Meeting Rooms at Workspace Junction', MAIN + 'meeting-rooms/']]
  },
  'dedicated-desk.html': {
    slug: 'dedicated-desk', name: 'Dedicated Desk Coworking', crumb: 'Dedicated Desk',
    title: 'Dedicated Desk Oakbrook Terrace $250/mo | Workspace Junction',
    desc: 'Get your own dedicated desk at Workspace Junction in Oakbrook Terrace, IL. Black Friday rate $250/month (save $125), 24/7 access. First 10 members only.',
    kw: 'dedicated desk oakbrook terrace, coworking oakbrook terrace, oakbrook coworking, coworking in oak brook, rent a desk, desk space near me, dedicated desk chicago suburbs, black friday coworking deal',
    og: 'og-dedicated-desk-oakbrook-terrace.jpg', ogFrom: 'desk-hero.webp', ogTitle: 'Dedicated Desk Coworking, Oakbrook Terrace', ogSub: 'Black Friday · $250/month · First 10 only',
    hero: ['desk-hero.webp', 'dedicated-desk-coworking-oakbrook-terrace.webp'],
    h2: 'Dedicated Desk Coworking in Oakbrook Terrace',
    body: [
      `A dedicated desk at Workspace Junction gives you a workstation reserved just for you, 24/7 workspace access, high-speed business Wi-Fi, meeting room credits, focus pods and wellness space, and a networking and business community, at ${ADDRESS}, near Oak Brook.`,
      'Black Friday offer: $250 per month instead of $375, saving $125 every month, on a 12-month membership. Only 10 promotional memberships are available. Ideal for founders and entrepreneurs, remote professionals, freelancers and creatives, and small teams.'
    ],
    alts: {
      'desk-hero.webp': 'Members working at dedicated desks in the Workspace Junction coworking space, Oakbrook Terrace',
      'dedicated-desk-coworking-oakbrook-terrace.webp': 'Members working at dedicated desks in the Workspace Junction coworking space, Oakbrook Terrace',
      'desk-workstation.webp': 'Dedicated workstation with monitor reserved for a coworking member near Oak Brook, IL'
    },
    main: [['Dedicated Desks at Workspace Junction', MAIN + 'dedicated/'], ['Coworking at Workspace Junction', MAIN + 'coworking/']]
  },
  'mailbox.html': {
    slug: 'mailbox', name: 'Business Mailbox', crumb: 'Business Mailbox',
    title: 'Business Mailbox Near Chicago $25/mo | Workspace Junction',
    desc: 'Professional business mailbox with a real street address in Oakbrook Terrace near Chicago. Black Friday price $25/month, package acceptance. First 50 only.',
    kw: 'virtual mailbox chicago, mailbox rental chicago, business address chicago, virtual business address chicago, secure mailbox for business, business mailbox oakbrook terrace, real street address not po box',
    og: 'og-business-mailbox-chicago.jpg', ogFrom: 'mailbox-hero.webp', ogTitle: 'Business Mailbox & Street Address', ogSub: 'Black Friday · $25/month · First 50 only',
    hero: ['mailbox-hero.webp', 'business-mailbox-rental-chicago-oakbrook-terrace.webp'],
    h2: 'Business Mailbox and Street Address Near Chicago',
    body: [
      `Get a real street address for your business at ${ADDRESS}, not a PO box. Use it for registrations and client communications, keep your home address private, and receive packages from UPS, FedEx, USPS, DHL and more, with secure mail and package handling.`,
      'Black Friday price: $25.00 per month instead of $35, on a 12-month contract. Ideal for home-based business owners, startups, freelancers, consultants and small businesses. Only the first 50 mailboxes get this rate.'
    ],
    alts: {
      'mailbox-hero.webp': 'Private business mailboxes at Workspace Junction, Oakbrook Terrace near Chicago',
      'business-mailbox-rental-chicago-oakbrook-terrace.webp': 'Private business mailboxes at Workspace Junction, Oakbrook Terrace near Chicago',
      'mailbox-lounge.webp': 'Bright lounge and work area inside Workspace Junction, Oakbrook Terrace',
      'building-exterior.webp': 'Workspace Junction building at 1S280 Summit Ave, Oakbrook Terrace, IL'
    },
    main: [['Mailbox Rental at Workspace Junction', MAIN + 'mail-box/'], ['Business Address at Workspace Junction', MAIN + 'business-address/']]
  }
};

const OFFERS = [
  ['podcast-studio.html', 'Podcast Studio', 'From $120/hr'],
  ['conference-room.html', 'Conference Room', '$25/hr · 5 hrs $125'],
  ['boardroom.html', 'Boardroom', '$50/hr · 5 hrs $250'],
  ['dedicated-desk.html', 'Dedicated Desk', '$250/month'],
  ['mailbox.html', 'Business Mailbox', '$25.00/month']
];
const PRICES = {
  'podcast-studio.html': [['Podcast Studio - Starter (per hour, 3-hour minimum)', '120.00'], ['Podcast Studio - Standard (per hour, 3-hour minimum)', '150.00'], ['Podcast Studio - Premium (per hour, 3-hour minimum)', '199.00']],
  'conference-room.html': [['Conference Room 5-Hour Package ($25/hour)', '125.00']],
  'boardroom.html': [['Boardroom 5-Hour Package ($50/hour)', '250.00']],
  'dedicated-desk.html': [['Dedicated Desk (per month, 12-month membership)', '250.00']],
  'mailbox.html': [['Business Mailbox (per month, 12-month contract)', '25.00']]
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = f => BASE + (f === 'index.html' ? '' : f);
const ICON = n => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;

const report = [];
for (const [file, c] of Object.entries(P)) {
  const p = path.join(root, file);
  let t = fs.readFileSync(p, 'utf8');
  const url = urlOf(file);

  /* 1. title / description / keywords (all copies: meta, og, twitter, JSON-LD regenerated below) */
  const oldTitle = t.match(/<title>([^<]*)<\/title>/)[1];
  const oldDesc = t.match(/<meta name="description" content="([^"]*)"/)[1];
  t = t.split(`<title>${oldTitle}</title>`).join(`<title>${esc(c.title)}</title>`);
  t = t.split(`content="${oldTitle}"`).join(`content="${esc(c.title)}"`);
  t = t.split(`content="${oldDesc}"`).join(`content="${esc(c.desc)}"`);
  t = t.replace(/<meta name="keywords" content="[^"]*">/, `<meta name="keywords" content="${esc(c.kw)}">`);

  /* 2. Open Graph / Twitter image -> 1200x630 JPG, plus geo + hreflang */
  const og = `${BASE}assets/img/${c.og}`;
  t = t.replace(/\n<meta property="og:image:(?:width|height|type)"[^\n]*/g, '');
  t = t.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${og}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:type" content="image/jpeg">`);
  t = t.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${og}">`);
  if (!t.includes('name="geo.position"')) {
    t = t.replace('<meta name="geo.placename" content="Oakbrook Terrace">', `<meta name="geo.placename" content="Oakbrook Terrace">\n<meta name="geo.position" content="${GEO.lat};${GEO.lng}">\n<meta name="ICBM" content="${GEO.lat}, ${GEO.lng}">`);
  }
  if (!t.includes('hreflang="en-us"')) {
    t = t.replace(/(<link rel="canonical" href="[^"]+">)/, `$1\n<link rel="alternate" hreflang="en-us" href="${url}">\n<link rel="alternate" hreflang="x-default" href="${url}">`);
  }

  /* 3. hero image -> keyword file name; descriptive alt text everywhere */
  if (c.hero) t = t.split(`assets/img/${c.hero[0]}`).join(`assets/img/${c.hero[1]}`);
  for (const [img, alt] of Object.entries(c.alts || {})) {
    t = t.replace(new RegExp(`(<img src="assets/img/${img.replace(/\./g, '\\.')}" alt=")[^"]*(")`, 'g'), `$1${esc(alt)}$2`);
  }

  /* 4. visible SEO section: breadcrumb, keyword H2 + factual copy, internal links (offers + evergreen pages) */
  const others = OFFERS.filter(o => o[0] !== file);
  const block = `<!-- seo-block:start -->
<section class="section section--sage seo-block" aria-labelledby="seo-h">
  <div class="container seo-grid">
    <div>
      <nav class="crumbs" aria-label="Breadcrumb"><ol>
        <li><a href="${MAIN}">Workspace Junction</a></li>
        <li>${file === 'index.html' ? '<span aria-current="page">Thanksgiving Offers</span>' : '<a href="index.html">Thanksgiving Offers</a>'}</li>
        ${file === 'index.html' ? '' : `<li><span aria-current="page">${esc(c.crumb)}</span></li>`}
      </ol></nav>
      <h2 id="seo-h" class="seo-title">${esc(c.h2)}</h2>
      ${c.body.map(b => `<p>${esc(b)}</p>`).join('\n      ')}
      <p class="seo-nap">${ICON('pin')}<a href="${MAP}" target="_blank" rel="noopener">${esc(ADDRESS)}</a> · <a href="tel:+17739861908">(773) 986-1908</a></p>
    </div>
    <aside class="seo-links">
      <h3>${file === 'index.html' ? 'All Thanksgiving offers' : 'More Thanksgiving offers'}</h3>
      <ul>${(file === 'index.html' ? OFFERS : others).map(o => `<li><a href="${o[0]}">${esc(o[1])}<span>${esc(o[2])}</span></a></li>`).join('')}</ul>
      <h3>Explore Workspace Junction</h3>
      <ul>${c.main.map(m => `<li><a href="${m[1]}">${esc(m[0])}</a></li>`).join('')}</ul>
    </aside>
  </div>
</section>
<!-- seo-block:end -->`;
  if (t.includes('<!-- seo-block:start -->')) t = t.replace(/<!-- seo-block:start -->[\s\S]*?<!-- seo-block:end -->/, block);
  else t = t.replace('\n</main>', `\n${block}\n</main>`);

  /* 5. structured data (JSON-LD @graph) rebuilt from scratch */
  const faqs = [...t.matchAll(/<summary><span class="faq-label">([\s\S]*?)<\/span><svg[\s\S]*?<\/summary><div class="faq-answer">([\s\S]*?)<\/div><\/details>/g)]
    .map(m => ({ '@type': 'Question', name: strip(m[1]), acceptedAnswer: { '@type': 'Answer', text: strip(m[2]) } }));
  const biz = {
    '@type': 'LocalBusiness', '@id': MAIN + '#business', name: 'Workspace Junction', url: MAIN,
    logo: BASE + 'assets/img/logo.webp', image: [og, BASE + 'assets/img/reception.webp'],
    description: 'Coworking space, podcast studio, meeting rooms, dedicated desks and business mailboxes in Oakbrook Terrace, IL, near Chicago.',
    telephone: '+1-773-986-1908', email: 'grow@workspacejunction.com', priceRange: '$$',
    address: { '@type': 'PostalAddress', streetAddress: '1S280 Summit Ave Unit E2, Suite 1', addressLocality: 'Oakbrook Terrace', addressRegion: 'IL', postalCode: '60181', addressCountry: 'US' },
    geo: { '@type': 'GeoCoordinates', latitude: GEO.lat, longitude: GEO.lng }, hasMap: MAP,
    areaServed: AREA.map(n => ({ '@type': 'City', name: n })), sameAs: SAME_AS,
    amenityFeature: ['Free parking', 'High-speed Wi-Fi', 'Podcast studio', 'Meeting rooms', 'Video conferencing'].map(n => ({ '@type': 'LocationFeatureSpecification', name: n, value: true }))
  };
  const crumbs = [{ '@type': 'ListItem', position: 1, name: 'Workspace Junction', item: MAIN }, { '@type': 'ListItem', position: 2, name: 'Thanksgiving Offers', item: BASE }];
  if (file !== 'index.html') crumbs.push({ '@type': 'ListItem', position: 3, name: c.crumb, item: url });
  const graph = [
    biz,
    { '@type': 'WebSite', '@id': MAIN + '#website', name: 'Workspace Junction', url: MAIN, publisher: { '@id': MAIN + '#business' }, inLanguage: 'en-US' },
    { '@type': 'WebPage', '@id': url + '#webpage', url, name: c.title, description: c.desc, inLanguage: 'en-US', isPartOf: { '@id': MAIN + '#website' },
      about: { '@id': MAIN + '#business' }, breadcrumb: { '@id': url + '#breadcrumb' }, primaryImageOfPage: { '@type': 'ImageObject', url: og, width: 1200, height: 630 }, dateModified: TODAY },
    { '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: crumbs }
  ];
  if (PRICES[file]) {
    graph.push({ '@type': 'Service', '@id': url + '#service', name: c.name, serviceType: c.name, provider: { '@id': MAIN + '#business' },
      areaServed: AREA.map(n => ({ '@type': 'City', name: n })), url, image: og, description: c.desc,
      offers: PRICES[file].map(([n, pr]) => ({ '@type': 'Offer', name: n, price: pr, priceCurrency: 'USD', availability: 'https://schema.org/LimitedAvailability', url, seller: { '@id': MAIN + '#business' } })) });
    graph.push({ '@type': 'Product', '@id': url + '#product', name: `${c.name} - Workspace Junction Oakbrook Terrace`, description: c.desc, image: [og],
      brand: { '@type': 'Brand', name: 'Workspace Junction' }, category: c.name,
      offers: PRICES[file].length > 1
        ? { '@type': 'AggregateOffer', lowPrice: PRICES[file][0][1], highPrice: PRICES[file][PRICES[file].length - 1][1], offerCount: PRICES[file].length, priceCurrency: 'USD', availability: 'https://schema.org/LimitedAvailability', url }
        : { '@type': 'Offer', price: PRICES[file][0][1], priceCurrency: 'USD', availability: 'https://schema.org/LimitedAvailability', url, seller: { '@id': MAIN + '#business' } } });
  } else {
    graph.push({ '@type': 'ItemList', name: 'Thanksgiving & Black Friday offers', itemListElement: OFFERS.map((o, i) => ({ '@type': 'ListItem', position: i + 1, name: o[1], url: urlOf(o[0]) })) });
  }
  if (faqs.length) graph.push({ '@type': 'FAQPage', '@id': url + '#faq', mainEntity: faqs });
  t = t.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}\n</script>`);

  fs.writeFileSync(p, t);
  const title = t.match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, '&');
  report.push(`${file.padEnd(22)} title ${title.length}ch | desc ${c.desc.length}ch | faqs ${faqs.length} | h1 ${(t.match(/<h1/g) || []).length} | imgs w/o alt ${(t.match(/<img(?![^>]*alt=)[^>]*>/g) || []).length}`);
}

/* 6. keyword-named copies of hero images (old names kept: Stripe product images use them) */
for (const c of Object.values(P)) if (c.hero) {
  const a = path.join(root, 'assets', 'img', c.hero[0]), b = path.join(root, 'assets', 'img', c.hero[1]);
  if (!fs.existsSync(b)) fs.copyFileSync(a, b);
}

/* 7. sitemap with lastmod + page and OG images */
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${Object.entries(P).map(([f, c]) => `  <url>
    <loc>${urlOf(f)}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${f === 'index.html' ? '1.0' : '0.9'}</priority>
    <image:image><image:loc>${BASE}assets/img/${c.og}</image:loc></image:image>${c.hero ? `\n    <image:image><image:loc>${BASE}assets/img/${c.hero[1]}</image:loc></image:image>` : ''}
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(sitemapPath, sm);
fs.writeFileSync(path.join(root, 'seo', 'og-plan.json'), JSON.stringify(Object.values(P).map(c => ({ out: c.og, from: c.ogFrom, title: c.ogTitle, sub: c.ogSub })), null, 2));
console.log(report.join('\n'));

function strip(s) {
  return s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span class="faq-q">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
