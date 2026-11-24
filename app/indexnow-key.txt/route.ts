import {seoRuntime} from '@/lib/seo-runtime';
export const revalidate = 300;
/** IndexNow key verification file (keyLocation). The key is public by design; it only proves site ownership to IndexNow engines. */
export async function GET() {
  const {indexNowKey} = await seoRuntime();
  if (!indexNowKey) return new Response('Not found', {status: 404});
  return new Response(indexNowKey, {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300'}});
}