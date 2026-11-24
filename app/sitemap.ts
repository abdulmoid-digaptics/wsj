import type {MetadataRoute} from 'next';
import {loadSite} from '@/lib/site';
import redirects from '@/data/redirects.json';
import {FIGMA_ONLY_PATHS} from '@/lib/figma-pages';
import {indexable} from '@/lib/seo';
import {seoRuntime} from '@/lib/seo-runtime';
export const revalidate=60;

const norm=(path:string)=>('/'+path.replace(/^\/+|\/+$/g,'')+'/').replace(/^\/\/$/,'/');
/* Paths that 301 elsewhere must not be advertised (they would be "page with redirect" in Search Console). */
const redirected=new Set((redirects as Array<{source:string}>).map(r=>norm(r.source)));
const hidden=/^\/(membership-(checkout|confirmation)|face-linkup|scrolling-cards|menu-page|shop)(\/|$)|\/page\/\d+\/?$/;
const abs=(base:string,v?:string)=>!v?undefined:/^https?:\/\//.test(v)?v:base+(v.startsWith('/')?v:'/'+v);

/**
 * Only canonical, indexable, published URLs: no redirect sources (code or dashboard rules), no noindex pages
 * (legacy package records, admin overrides), no pages whose canonical points elsewhere, no empty archives.
 * Articles carry their featured image (image sitemap extension) and their real last-modified date.
 */
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 const [s,rt]=await Promise.all([loadSite(),seoRuntime()]);
 const base=process.env.NEXT_PUBLIC_SITE_URL||'https://workspacejunction.com';
 const ruleSources=new Set(rt.redirects.map(r=>norm(r.from)));
 const postCount=(id:string|number,key:'categories'|'tags')=>s.posts.filter(p=>(p as unknown as Record<string,Array<string|number>|undefined>)[key]?.some(v=>String(v)===String(id))).length;
 const emptyArchive=new Set<string>();
 const records:MetadataRoute.Sitemap=[...s.pages,...s.posts].filter(p=>!hidden.test(p.path)).map(p=>({url:base+p.path,lastModified:p.modified||p.date||undefined,changeFrequency:p.type==='post'?'monthly' as const:'weekly' as const,priority:p.path==='/'?1:p.type==='post'?.6:.8,...(p.type==='post'&&p.featuredImage?{images:[abs(base,p.featuredImage)!]}:{})}));
 /* Redesigned pages with no migrated WordPress record are prerendered by [...slug] from the same list. */
 for(const path of FIGMA_ONLY_PATHS)records.push({url:base+path,lastModified:undefined,changeFrequency:'weekly',priority:.8});
 for(const [kind,items,key] of [['category',s.categories,'categories'],['tag',s.tags||[],'tags']] as const)for(const c of items){
  const path='/'+kind+'/'+c.slug+'/';
  if(!postCount(c.id,key)){emptyArchive.add(path);continue}
  records.push({url:base+path,lastModified:undefined,changeFrequency:'weekly',priority:.4});
 }
 const keep=records.filter(r=>{
  const path=norm(r.url.slice(base.length)||'/');
  const ov=rt.pages[path];
  if(redirected.has(path)||ruleSources.has(path)||[...emptyArchive].some(a=>path.startsWith(a)))return false;
  if(!indexable(path,rt)||ov?.sitemap===false)return false;
  if(ov?.canonical&&norm(ov.canonical.replace(/^https?:\/\/[^/]+/,''))!==path)return false;
  return true;
 });
 return [...new Map(keep.map(r=>[r.url,r])).values()];
}