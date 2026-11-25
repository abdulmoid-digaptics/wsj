import {BUSINESS, SITE_URL} from './seo';
import {seoRuntime} from './seo-runtime';

const url = SITE_URL + '/';
const name = BUSINESS.name;
const citation = `${name} (${url})`;
const spec = 'https://www.ai-visibility.org.uk/specifications/';
const contactUrl = url + 'contact-us/';
export const discoveryLinks = [
  ['Business identity', 'identity.json'], ['AI usage guidance', 'ai.txt'],
  ['Machine-readable AI usage guidance', 'ai.json'], ['Crawler access', 'robots.txt'],
] as const;

export const discoveryIdentity = {
  $schema: spec + 'identity-json/identity-json.schema.json',
  name, url, type: 'LocalBusiness', language: 'en-US',
  description: 'Coworking, meeting rooms, creative studios, and business services in Oakbrook Terrace, Illinois.',
  location: {streetAddress: BUSINESS.street, addressLocality: BUSINESS.locality, addressRegion: BUSINESS.region, postalCode: BUSINESS.postalCode, addressCountry: BUSINESS.country},
  contactPoints: [{type: 'general', email: BUSINESS.email, telephone: BUSINESS.phone, url: contactUrl}],
  sameAs: BUSINESS.sameAs,
  areaServed: BUSINESS.areaServed,
};

export function discoveryPolicy({aiSearch, aiUser}: {aiSearch: boolean; aiUser: boolean}) {
  return {
    $schema: spec + 'ai-json/ai-json.schema.json',
    name, url, language: 'en-US',
    permissions: [
      {action: 'cite-public-pages', description: 'Cite published facts and link to the relevant canonical page.'},
      ...(aiSearch ? [{action: 'index-for-ai-search', description: 'Index public pages for AI search where robots.txt permits crawler access.'}] : []),
      ...(aiUser ? [{action: 'answer-factual-questions', description: 'Answer user questions from public pages where robots.txt permits retrieval.'}] : []),
    ],
    restrictions: [
      {action: 'represent-unverified-information-as-fact', reason: 'Do not invent prices, availability, reviews, guarantees, or additional locations.'},
      {action: 'access-non-public-content', reason: 'Do not access private accounts, administration, or unpublished material.'},
      {action: 'infer-training-permission', reason: 'This document grants no model-training license. Consult robots.txt for crawler access; Google-Extended is managed separately.'},
    ],
    attribution: {required: true, format: citation},
  };
}

export async function discoveryResponse(kind: 'identity' | 'policy' | 'text') {
  const {crawlers} = await seoRuntime();
  const headers = {'Cache-Control': 'public, max-age=60', 'X-Robots-Tag': 'noindex'};
  if (!crawlers.llmsTxt) return new Response('Not found', {status: 404, headers});
  if (kind === 'identity') return Response.json(discoveryIdentity, {headers});
  const policy = discoveryPolicy(crawlers);
  if (kind === 'policy') return Response.json(policy, {headers});
  return new Response([
    `# AI Usage Guidance for ${name}`, '', 'Lang: en-US', `Website: ${url}`, 'Last Updated: 2026-11-25', '',
    '## Permissions', ...policy.permissions.map(x => '- ' + x.description), '',
    '## Restrictions', ...policy.restrictions.map(x => '- ' + x.reason), '',
    '## Attribution Requirements', `- ${citation}. Link to the canonical source page when citing a specific service or article.`, '',
    '## Contact', `- ${contactUrl}`, '', '## Related Files',
    ...[...discoveryLinks, ['Business and service overview', 'llms.txt']].filter(([, p]) => p !== 'ai.txt').map(([label, p]) => `- [${label}](${url}${p})`), '',
  ].join('\n'), {headers: {...headers, 'Content-Type': 'text/plain; charset=utf-8'}});
}
