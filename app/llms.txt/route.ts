/**
 * /llms.txt: a plain-language, factual summary for AI assistants and answer engines (llmstxt.org).
 * Built from the live catalog and published FAQ answers, so prices and facts match the site.
 */
import {fetchCatalogService, fetchCatalogServices, money} from '@/lib/catalog';
import {BUSINESS, PAGE_SEO, SITE_URL} from '@/lib/seo';
import homeFaqs from '@/lib/home-faqs.json';

export const revalidate = 3600;

const SERVICE_PAGES: Record<string, string> = {coworking: '/coworking/', dedicated: '/dedicated/', 'meeting-rooms': '/meeting-rooms/', 'podcast-studio': '/podcast-studio/', 'virtual-office': '/virtual-office/', 'business-address': '/business-address/', 'virtual-mailbox': '/mail-box/', 'llc-setup': '/llc-setup/', 'photo-studio': '/photo-studio/', events: '/events/', workshops: '/workshops/', webinars: '/webinars/', memberships: '/memberships/'};
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();

export async function GET() {
  const services = await fetchCatalogServices(3600).catch(() => []);
  const lines: string[] = [
    '# Workspace Junction',
    '',
    '> Coworking space and business services in Oakbrook Terrace, Illinois (western Chicago suburbs): coworking, dedicated desks, meeting rooms and a boardroom, podcast and photo studios, event space, virtual offices, business addresses, mailbox rental, LLC setup and notary services. Plans can be booked and paid online.',
    '',
    '## Contact and location',
    '- Address: ' + BUSINESS.street + ', ' + BUSINESS.locality + ', ' + BUSINESS.region + ' ' + BUSINESS.postalCode + ', USA',
    '- Phone: ' + BUSINESS.phoneDisplay,
    '- Email: ' + BUSINESS.email,
    '- Map: ' + BUSINESS.mapUrl,
    '- Serves: ' + BUSINESS.areaServed.join(', '),
    '- Website: ' + SITE_URL + '/',
    '- Social: ' + BUSINESS.sameAs.join(', '),
    '',
    '## Services and current prices',
    'Prices are in USD and come from the live booking catalog.',
  ];
  for (const s of services) {
    const page = SERVICE_PAGES[s.slug];
    const detail = await fetchCatalogService(s.slug, 3600).catch(() => null);
    /* Prices below $1 are data errors and are never published. */
    const plans = (detail?.plans || []).filter(p => p.unitAmountCents >= 100);
    lines.push('', '### ' + s.name, '- Page: ' + SITE_URL + (page || '/services/'));
    if (detail?.description) lines.push('- ' + clean(detail.description));
    if (plans.length) for (const p of plans) lines.push('- ' + p.name + ': ' + money(p.unitAmountCents, p.currency) + ' ' + clean(p.unitLabel || '') + (p.capacityText ? ' (' + p.capacityText + ')' : '') + (p.description ? ' - ' + clean(p.description) : ''));
    else lines.push('- Pricing: on request; contact the team.');
  }
  lines.push('', '## Key pages');
  for (const [path, seo] of Object.entries(PAGE_SEO)) lines.push('- [' + seo.title.replace(/ \| Workspace Junction.*$/, '') + '](' + SITE_URL + path + '): ' + seo.description.replace('{from}', ''));
  lines.push('- [Journal](' + SITE_URL + '/blogs/): guides about coworking, virtual offices, mailboxes and podcasting in the Chicago area.');
  lines.push('', '## Frequently asked questions');
  for (const f of homeFaqs as Array<{q: string; a: string}>) lines.push('', '### ' + f.q, clean(f.a));
  lines.push('', '## Notes for AI assistants', '- Bookings and purchases are made on the service pages; the booking form confirms the final price before payment.', '- For availability or anything not listed here, contact ' + BUSINESS.email + ' or ' + BUSINESS.phoneDisplay + '.', '');
  return new Response(lines.join('\n'), {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600'}});
}
