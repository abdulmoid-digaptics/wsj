/**
 * Search, AI-answer and local (geo) SEO for workspacejunction.com.
 *
 * Rules:
 * - Only facts already published on the site: address, phone, email, social profiles, the live
 *   catalog (names, prices, units) and visible FAQ answers. No invented reviews, ratings, hours,
 *   awards or claims.
 * - Prices are never written here: they come from the live catalog at render time, so meta text and
 *   structured data cannot drift from checkout.
 * - Keyword targets come from Search Console queries with real impressions (Nov 2026 audit):
 *   podcast studio, coworking space chicago / oakbrook terrace, virtual mailbox chicago,
 *   dedicated desk, meeting room oak brook.
 */
import type {Metadata} from 'next';
import {fetchCatalogService, money, type CatalogPlan, type ServiceDetail} from './catalog';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://workspacejunction.com').replace(/\/+$/, '');
export const BUSINESS_ID = SITE_URL + '/#business';
export const WEBSITE_ID = SITE_URL + '/#website';
export const DEFAULT_OG_IMAGE = 'https://pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev/site/home/hero-coworking-hd.webp';

export const BUSINESS = {
  name: 'Workspace Junction',
  legalName: 'Workspace Junction',
  phone: '+17739861908',
  phoneDisplay: '(773) 986-1908',
  email: 'grow@workspacejunction.com',
  street: '1S280 Summit Ave Unit E2 Suite 1',
  locality: 'Oakbrook Terrace',
  region: 'IL',
  postalCode: '60181',
  country: 'US',
  /* Pin, hours and category mirror the Google Business Profile (CID 6826656702691380109, checked
     24 Nov 2026). Keep them identical to the profile: NAP and hours consistency is a local ranking factor. */
  googleCid: '6826656702691380109',
  geo: {latitude: 41.8553838, longitude: -87.9748885},
  mapUrl: 'https://maps.google.com/?cid=6826656702691380109',
  /* Opens the Business Profile, where the Write a review button is. */
  reviewUrl: 'https://maps.google.com/?cid=6826656702691380109',
  embedUrl: 'https://maps.google.com/maps?q=Workspace%20Junction%2C%201S280%20Summit%20Ave%2C%20Oakbrook%20Terrace%2C%20IL%2060181&z=15&output=embed',
  hours: [
    {days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], label: 'Monday to Friday', opens: '06:00', closes: '21:00', display: '6 am – 9 pm'},
    {days: ['Saturday', 'Sunday'], label: 'Saturday and Sunday', opens: '09:00', closes: '17:00', display: '9 am – 5 pm'},
  ],
  category: 'Coworking space',
  sameAs: ['https://maps.google.com/?cid=6826656702691380109', 'https://www.linkedin.com/company/workspace-junction', 'https://www.facebook.com/people/Workspace-Junction/61577329376091/', 'https://www.instagram.com/workspace.junction', 'https://www.yelp.com/biz/workspace-junction-oakbrook-terrace'],
  /* Communities the site already writes for (journal and service pages). */
  areaServed: ['Oakbrook Terrace', 'Oak Brook', 'Lombard', 'Villa Park', 'Elmhurst', 'Downers Grove', 'Chicago'],
};

type PageSeo = {
  /** Absolute title. `{from}` is replaced by the live "from" price when the catalog has one. */
  title: string;
  description: string;
  /** Catalog service slug whose plans become schema.org Offers. */
  service?: string;
  /** schema.org serviceType label. */
  serviceType?: string;
  name?: string;
};

export const PAGE_SEO: Record<string, PageSeo> = {
  '/': {title: 'Coworking Space & Podcast Studio in Oakbrook Terrace, IL | Workspace Junction', description: 'Coworking, dedicated desks, meeting rooms, a podcast studio, virtual offices and mailboxes at 1S280 Summit Ave, Oakbrook Terrace, IL, in the western Chicago suburbs. Book online.'},
  '/coworking/': {title: 'Coworking Space in Oakbrook Terrace, IL (Chicago Suburbs) | Workspace Junction', description: 'Flexible coworking in Oakbrook Terrace{from}: high-speed Wi-Fi, sit/stand desks, printing, coffee and meeting room access. Monthly plans you can book online.', service: 'coworking', serviceType: 'Coworking space', name: 'Coworking'},
  '/dedicated/': {title: 'Dedicated Desk Rental in Oakbrook Terrace, IL | Workspace Junction', description: 'Your own dedicated desk in Oakbrook Terrace{from}, set up the way you left it, with Wi-Fi, printing and meeting room access. Book a dedicated desk online.', service: 'dedicated', serviceType: 'Dedicated desk rental', name: 'Dedicated Desk'},
  '/meeting-rooms/': {title: 'Meeting & Conference Room Rental in Oakbrook Terrace | Workspace Junction', description: 'Book a huddle room, collaboration room, conference room or boardroom by the hour{from} near Oak Brook, IL. Screens, video conferencing and whiteboards included.', service: 'meeting-rooms', serviceType: 'Meeting room rental', name: 'Meeting Rooms'},
  '/podcast-studio/': {title: 'Podcast Studio Rental near Chicago – Oakbrook Terrace | Workspace Junction', description: 'Record in a professional podcast studio in Oakbrook Terrace, IL{from}: solo, interview, panel and video podcast setups with microphones, cameras and lighting.', service: 'podcast-studio', serviceType: 'Podcast studio rental', name: 'Podcast Studio'},
  '/virtual-office/': {title: 'Virtual Office in Oakbrook Terrace, IL (Chicago Suburbs) | Workspace Junction', description: 'A professional business address with mail handling in Oakbrook Terrace{from}. Virtual office plans for remote businesses across the Chicago area.', service: 'virtual-office', serviceType: 'Virtual office', name: 'Virtual Office'},
  '/business-address/': {title: 'Virtual Business Address in Oakbrook Terrace, IL | Workspace Junction', description: 'Use a real commercial street address in Oakbrook Terrace, IL for your business{from}. Suitable for registration, licensing and your website.', service: 'business-address', serviceType: 'Business address service', name: 'Business Address'},
  '/mail-box/': {title: 'Mailbox Rental & Virtual Mailbox near Chicago | Workspace Junction', description: 'Private, secure mailbox rental in Oakbrook Terrace, IL{from}. Receive business mail and packages at a commercial address near Chicago.', service: 'virtual-mailbox', serviceType: 'Mailbox rental', name: 'Mailbox Rental'},
  '/virtual-mailbox/': {title: 'Virtual Mailbox Service near Chicago | Workspace Junction', description: 'Virtual mailbox service at a commercial address in Oakbrook Terrace, IL{from}, for businesses across Oak Brook, Lombard and the Chicago suburbs.', service: 'virtual-mailbox', serviceType: 'Virtual mailbox', name: 'Virtual Mailbox'},
  '/photo-studio/': {title: 'Photo Studio Rental in Oakbrook Terrace, IL | Workspace Junction', description: 'Rent a photo studio by the hour, half day or full day in Oakbrook Terrace, IL, near Chicago. Book online at Workspace Junction.', serviceType: 'Photo studio rental', name: 'Photo Studio'},
  '/llc-setup/': {title: 'LLC Formation & Setup Services in Illinois | Workspace Junction', description: 'LLC setup packages{from} from Workspace Junction in Oakbrook Terrace, IL: formation support for new Illinois businesses, with an optional business address.', service: 'llc-setup', serviceType: 'LLC formation service', name: 'LLC Setup'},
  '/events/': {title: 'Event Space Rental in Oakbrook Terrace, IL | Workspace Junction', description: 'Host workshops, launches and networking events in the Workspace Junction event space in Oakbrook Terrace, IL, near Oak Brook and Chicago.', serviceType: 'Event space rental', name: 'Event Space'},
  '/workshops/': {title: 'Workshop Space & Workshops in Oakbrook Terrace | Workspace Junction', description: 'Run or attend workshops at Workspace Junction in Oakbrook Terrace, IL. Room setup, screens and space for teams, trainers and community groups.', serviceType: 'Workshop venue', name: 'Workshops'},
  '/webinars/': {title: 'Webinar Studio & Hybrid Webinars near Chicago | Workspace Junction', description: 'Produce virtual and hybrid webinars from Workspace Junction in Oakbrook Terrace, IL, with studio space and equipment near Chicago.', serviceType: 'Webinar production', name: 'Webinars'},
  '/memberships/': {title: 'Coworking Memberships in Oakbrook Terrace | Workspace Junction', description: 'Compare Workspace Junction memberships in Oakbrook Terrace, IL: coworking days, community access and business services for founders and teams.', name: 'Memberships'},
  '/membership-plans/': {title: 'Membership Plans & Pricing | Workspace Junction Oakbrook Terrace', description: 'Workspace Junction membership plans and pricing in Oakbrook Terrace, IL: coworking, community access and business services.'},
  '/notary-public/': {title: 'Notary Public in Oakbrook Terrace, IL | Workspace Junction', description: 'Notary public services at Workspace Junction, 1S280 Summit Ave, Oakbrook Terrace, IL. Contact the team to arrange a notarization.', serviceType: 'Notary public', name: 'Notary Public'},
  '/about-us/': {title: 'About Workspace Junction | Coworking in Oakbrook Terrace, IL', description: 'Workspace Junction is a coworking and business services space in Oakbrook Terrace, IL, for founders, freelancers, creators and growing teams in the Chicago area.'},
  '/contact-us/': {title: 'Contact Workspace Junction | Oakbrook Terrace, IL', description: 'Contact Workspace Junction at 1S280 Summit Ave Unit E2 Suite 1, Oakbrook Terrace, IL 60181. Call (773) 986-1908 or email grow@workspacejunction.com.'},
  '/gallery/': {title: 'Photo Gallery of Our Coworking Space | Workspace Junction', description: 'See the Workspace Junction coworking floor, boardroom, meeting rooms, podcast studio and event space in Oakbrook Terrace, IL.'},
  '/services/': {title: 'Workspace & Business Services in Oakbrook Terrace | Workspace Junction', description: 'All Workspace Junction services in one place: coworking, desks, meeting rooms, studios, virtual offices, mailboxes, LLC setup, notary and digital services.'},
  '/areas-we-serve/': {title: 'Coworking near Oak Brook, Lombard, Elmhurst & Chicago | Workspace Junction', description: 'Workspace Junction in Oakbrook Terrace serves Oak Brook, Lombard, Villa Park, Elmhurst, Downers Grove and Chicago. Directions, hours and local guides.'},
  '/use-cases/': {title: 'Who Uses Workspace Junction | Startups, Freelancers & Teams', description: 'How freelancers, startups, consultants, law firms, creators and e-commerce teams use Workspace Junction in Oakbrook Terrace, IL.'},
};

export const normPath = (p: string) => ('/' + p.replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/$/, '/');

const fromLabel = (svc: ServiceDetail | null) => {
  const cents = svc?.priceFromCents;
  return typeof cents === 'number' && cents >= 100 ? ', from ' + money(cents, svc?.currency || 'usd') : '';
};

/** Merge registry metadata over a page's computed metadata. */
export async function withPageSeo(path: string, base: Metadata): Promise<Metadata> {
  const seo = PAGE_SEO[normPath(path)];
  if (!seo) {
    /* Pages outside the registry keep their own metadata; only a missing share image is filled in. */
    const og = (base.openGraph || {}) as NonNullable<Metadata['openGraph']> & {images?: unknown};
    const hasImage = Array.isArray(og.images) ? og.images.length > 0 : Boolean(og.images);
    return hasImage ? base : {...base, openGraph: {...og, images: [DEFAULT_OG_IMAGE]}};
  }
  const svc = seo.service ? await fetchCatalogService(seo.service).catch(() => null) : null;
  const description = seo.description.replace('{from}', fromLabel(svc));
  const url = SITE_URL + normPath(path);
  return {
    ...base,
    title: {absolute: seo.title},
    description,
    alternates: {canonical: normPath(path)},
    openGraph: {type: 'website', siteName: 'Workspace Junction', locale: 'en_US', url, title: seo.title, description, images: [DEFAULT_OG_IMAGE]},
    twitter: {card: 'summary_large_image', title: seo.title, description, images: [DEFAULT_OG_IMAGE]},
  };
}

/* ───────────────────────────── Structured data ───────────────────────────── */

export const postalAddress = {'@type': 'PostalAddress', streetAddress: BUSINESS.street, addressLocality: BUSINESS.locality, addressRegion: BUSINESS.region, postalCode: BUSINESS.postalCode, addressCountry: BUSINESS.country};

/** The single business entity every page references by @id (entity consistency for search and AI answers). */
export function businessEntity() {
  return {
    '@type': ['LocalBusiness', 'ProfessionalService'],
    '@id': BUSINESS_ID,
    name: BUSINESS.name,
    url: SITE_URL + '/',
    logo: SITE_URL + '/icons/apple-touch-icon-180.png',
    image: DEFAULT_OG_IMAGE,
    telephone: BUSINESS.phone,
    email: BUSINESS.email,
    address: postalAddress,
    geo: {'@type': 'GeoCoordinates', ...BUSINESS.geo},
    hasMap: BUSINESS.mapUrl,
    openingHoursSpecification: BUSINESS.hours.map(h => ({'@type': 'OpeningHoursSpecification', dayOfWeek: h.days.map(d => 'https://schema.org/' + d), opens: h.opens, closes: h.closes})),
    knowsAbout: ['Coworking', 'Dedicated desks', 'Meeting room rental', 'Podcast studio rental', 'Photo studio rental', 'Virtual office', 'Virtual mailbox', 'Business address', 'LLC formation', 'Notary public'],
    areaServed: BUSINESS.areaServed.map(name => ({'@type': 'City', name})),
    sameAs: BUSINESS.sameAs,
    priceRange: '$$',
    description: 'Coworking space, dedicated desks, meeting rooms, podcast and photo studios, virtual offices, business addresses and mailboxes in Oakbrook Terrace, Illinois.',
  };
}

export function websiteEntity() {
  return {'@type': 'WebSite', '@id': WEBSITE_ID, url: SITE_URL + '/', name: BUSINESS.name, publisher: {'@id': BUSINESS_ID}, inLanguage: 'en-US'};
}

const UNIT: Record<string, string> = {PER_HOUR: 'HUR', PER_DAY: 'DAY', PER_MONTH: 'MON', PER_YEAR: 'ANN'};
function offerFor(plan: CatalogPlan, url: string) {
  const price = (plan.unitAmountCents / 100).toFixed(2);
  const unit = UNIT[plan.billingUnit];
  return {
    '@type': 'Offer', name: plan.name, url, priceCurrency: (plan.currency || 'usd').toUpperCase(), price,
    availability: 'https://schema.org/InStock', seller: {'@id': BUSINESS_ID},
    ...(unit ? {priceSpecification: {'@type': 'UnitPriceSpecification', price, priceCurrency: (plan.currency || 'usd').toUpperCase(), unitCode: unit, referenceQuantity: {'@type': 'QuantitativeValue', value: 1, unitCode: unit}}} : {}),
  };
}

export type Faq = {q: string; a?: string};

/** Graph for one page: business, website, breadcrumb, service + live offers, FAQ (visible answers only). */
export async function pageGraph(path: string, opts: {title?: string; faqs?: Faq[]} = {}) {
  const p = normPath(path);
  const seo = PAGE_SEO[p];
  const url = SITE_URL + p;
  const name = seo?.name || opts.title || '';
  const graph: Record<string, unknown>[] = [businessEntity(), websiteEntity()];
  if (p !== '/') graph.push({'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: [{'@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/'}, {'@type': 'ListItem', position: 2, name: name || p.replace(/\//g, ' ').trim(), item: url}]});
  graph.push({'@type': 'WebPage', '@id': url + '#webpage', url, name: seo?.title || name, ...(seo ? {description: seo.description.replace('{from}', '')} : {}), isPartOf: {'@id': WEBSITE_ID}, about: {'@id': BUSINESS_ID}, inLanguage: 'en-US', ...(p !== '/' ? {breadcrumb: {'@id': url + '#breadcrumb'}} : {})});
  if (seo?.serviceType) {
    const svc = seo.service ? await fetchCatalogService(seo.service).catch(() => null) : null;
    /* Plans below $1 are treated as data errors and never published as offers. */
    const plans = (svc?.plans || []).filter(pl => pl.unitAmountCents >= 100);
    graph.push({
      '@type': 'Service', '@id': url + '#service', name: seo.name || name, serviceType: seo.serviceType, url,
      provider: {'@id': BUSINESS_ID}, areaServed: BUSINESS.areaServed.map(n => ({'@type': 'City', name: n})),
      ...(svc?.description ? {description: svc.description} : {}),
      ...(plans.length ? {hasOfferCatalog: {'@type': 'OfferCatalog', name: (seo.name || name) + ' plans', itemListElement: plans.map(pl => offerFor(pl, url))}} : {}),
    });
  }
  const faqs = (opts.faqs || []).filter(f => f.q && f.a && f.a.trim().length > 20);
  if (faqs.length) graph.push({'@type': 'FAQPage', '@id': url + '#faq', mainEntity: faqs.map(f => ({'@type': 'Question', name: f.q, acceptedAnswer: {'@type': 'Answer', text: f.a}}))});
  return {'@context': 'https://schema.org', '@graph': graph};
}
