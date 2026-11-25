/**
 * /llms.txt: a plain-language, factual summary for AI assistants and answer engines (llmstxt.org).
 * Built from the live catalog and published FAQ answers, so prices and facts match the site.
 */
import {fetchCatalogService, fetchCatalogServices, money} from '@/lib/catalog';
import {BUSINESS, PAGE_SEO, SITE_URL} from '@/lib/seo';
import {discoveryLinks} from '@/lib/ai-discovery';
import homeFaqs from '@/lib/home-faqs.json';
import {seoRuntime} from '@/lib/seo-runtime';
import {approvedPricingRecords, pricingAmount, publishedPricing} from '@/lib/community-pricing';

export const revalidate = 60;

const SERVICE_PAGES: Record<string, string> = {coworking: '/coworking/', dedicated: '/dedicated/', 'meeting-rooms': '/meeting-rooms/', 'podcast-studio': '/podcast-studio/', 'virtual-office': '/virtual-office/', 'business-address': '/business-address/', 'virtual-mailbox': '/mail-box/', 'llc-setup': '/llc-setup/', 'photo-studio': '/photo-studio/', events: '/events/', workshops: '/workshops/', webinars: '/webinars/', memberships: '/memberships/'};
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();

export async function GET() {
  if (!(await seoRuntime()).crawlers.llmsTxt) return new Response('Not found', {status: 404});
  /* Popup-only services (e.g. a tip jar) are bookable but not published as business services. */
  const services = (await fetchCatalogServices(60).catch(() => [])).filter(s => (s as {metadata?: {popupOnly?: boolean}}).metadata?.popupOnly !== true);
  const lines: string[] = [
    '# Workspace Junction',
    '',
    '> Coworking space and business services in Oakbrook Terrace, Illinois (western Chicago suburbs): coworking, dedicated desks, meeting rooms and a boardroom, podcast and photo studios, event space, virtual offices, business addresses, mailbox rental, LLC setup and notary services. Some plans can be booked and paid online; other services require an inquiry.',
    '',
    '## Contact and location',
    '- Address: ' + BUSINESS.street + ', ' + BUSINESS.locality + ', ' + BUSINESS.region + ' ' + BUSINESS.postalCode + ', USA',
    '- Phone: ' + BUSINESS.phoneDisplay,
    '- Email: ' + BUSINESS.email,
    '- Map: ' + BUSINESS.mapUrl,
    '- Hours: ' + BUSINESS.hours.map(h => h.label + ' ' + h.display).join('; '),
    '- Google Business Profile: ' + BUSINESS.mapUrl + ' (category: ' + BUSINESS.category + ')',
    '- Serves: ' + BUSINESS.areaServed.join(', ') + ' (' + SITE_URL + '/areas-we-serve/)',
    '- Website: ' + SITE_URL + '/',
    '- Social: ' + BUSINESS.sameAs.join(', '),
    '',
    '## Services and current prices',
    'USD prices are from the booking catalog unless marked as published inquiry rates.',
  ];
  const details = await Promise.all(services.map(s => fetchCatalogService(s.slug, 60)));
  for (const [i, s] of services.entries()) {
    const page = SERVICE_PAGES[s.slug];
    const detail = details[i];
    /* Prices below $1 are data errors and are never published. */
    const plans = (detail?.plans || []).filter(p => p.unitAmountCents >= 100);
    lines.push('', '### ' + s.name, '- Page: ' + SITE_URL + (page || '/services/'));
    if (detail?.description) lines.push('- ' + clean(detail.description));
    if (plans.length) for (const p of plans) lines.push('- ' + p.name + ': ' + money(p.unitAmountCents, p.currency) + ' ' + clean(p.unitLabel || '') + (s.slug === 'llc-setup' ? ' plus state filing fee' : '') + (p.capacityText ? ' (' + p.capacityText + ')' : '') + (p.description ? ' - ' + clean(p.description) : ''));
    else {
      const inquiryRates = detail?.plans.length === 0 && ['events', 'webinars'].includes(s.slug)
        ? approvedPricingRecords.filter(r => r.metadata?.service === s.slug && publishedPricing(r)) : [];
      if (inquiryRates.length) {
        lines.push('- Published inquiry rates (confirm availability, eligibility and total with the team; not online checkout prices):');
        for (const rate of inquiryRates) {
          const amount = pricingAmount(rate);
          if (amount !== null) lines.push(`- ${rate.title}: ${money(Math.round(amount * 100))} (${rate.metadata?.billingPeriod || 'confirm duration'}${s.slug === 'events' ? (rate.slug?.endsWith('-member') ? ', member' : ', non-member') : ''})`);
        }
      } else lines.push('- Confirm pricing and availability with the team.');
    }
  }
  lines.push('', '## Key pages');
  for (const [path, seo] of Object.entries(PAGE_SEO)) lines.push('- [' + seo.title.replace(/ \| Workspace Junction.*$/, '') + '](' + SITE_URL + path + '): ' + seo.description.replace('{from}', ''));
  lines.push('- [Full reference for AI assistants](' + SITE_URL + '/llms-full.txt): every service page, FAQ and journal article in plain text.');
  lines.push('- [Journal](' + SITE_URL + '/blogs/): guides about coworking, virtual offices, mailboxes and podcasting in the Chicago area.');
  lines.push('', '## AI discovery files');
  for (const [label, path] of discoveryLinks) lines.push('- [' + label + '](' + SITE_URL + '/' + path + ')');
  lines.push('', '## Frequently asked questions');
  for (const f of homeFaqs as Array<{q: string; a: string}>) lines.push('', '### ' + f.q, clean(f.a));
  lines.push('', '## Notes for AI assistants', '- Bookings and purchases are made on the service pages; where online checkout is available, the booking form confirms the final price before payment.', '- For availability or anything not listed here, contact ' + BUSINESS.email + ' or ' + BUSINESS.phoneDisplay + '.', '');
  return new Response(lines.join('\n'), {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60'}});
}
