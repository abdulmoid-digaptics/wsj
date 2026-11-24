import {jsonLd} from '@/lib/site';
import {pageGraph, type Faq} from '@/lib/seo';

/** Server component: one JSON-LD graph per page (business, website, breadcrumb, service + live offers, FAQ). */
export async function RouteStructuredData({path, title, faqs}: {path: string; title?: string; faqs?: Faq[]}) {
  const graph = await pageGraph(path, {title, faqs});
  return <script type="application/ld+json" dangerouslySetInnerHTML={{__html: jsonLd(graph)}} />;
}
