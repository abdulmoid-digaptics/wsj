import Image from '@/components/consistent-image';
import Link from 'next/link';
import {notFound,permanentRedirect} from 'next/navigation';
import type {Metadata} from 'next';
import {ArrowUpRight} from 'lucide-react';
import {site,text,safeContent,routeFor,address,Entry,loadSite,jsonLd} from '@/lib/site';
import {PublicLayout} from '@/components/public-layout';
import {Pricing} from '@/components/pricing';
import {InnerHero,Highlights,SourceContent,ServiceExplore,pagePhoto,isServicePage,ServiceNav,ServiceOverview,ServiceDetails,InformationalContent} from '@/components/service-page';
import {organizeServiceContent} from '@/lib/service-content';
import {LiveSections,liveSectionsFor} from '@/components/live-sections';
import {fetchCommunityPlans} from '../../lib/community-pricing';
import {fetchCatalogService} from '../../lib/catalog';
import {MembershipsPageView} from '../../components/memberships-page-view';
// Client views rendered on few routes are code-split (see components/lazy-client.tsx).
import {InquiryForm,VenueGallery,ServicePricingSection,VisitPagesView} from '../../components/lazy-client';
import {ContactView} from '../../components/contact-view';
import {TestimonialsSection} from '../../components/testimonials-section';
import {FigmaPageView} from '../../components/figma-page/figma-page-view';
import {JournalIndex} from '../../components/journal/journal-index';
import {JournalArticle} from '../../components/journal/journal-article';
import {absoluteUrl,authorName,metaObject,excerptOf,JOURNAL_PATH,resolveRedirect} from '../../components/journal/journal-data';
import {figmaPageFor,FIGMA_ONLY_PATHS} from '../../lib/figma-pages';
import {withPageSeo,collectionGraph,articleGraph,cleanTitle} from '../../lib/seo';
import {RouteStructuredData} from '../../components/route-structured-data';
import '../legacy-routes.css'; // legacy-template styles (route-scoped; not on the homepage)
export const revalidate=60;
type Props={params:Promise<{slug:string[]}>;searchParams?:Promise<{q?:string;page?:string;category?:string;sort?:string;featured?:string}>};
function pathOf(slug:string[]){return '/'+slug.join('/')+'/'}
async function matching(slug:string[]){const s=await loadSite(),p=pathOf(slug).replace(/\/$/,'');return [...s.pages,...s.posts].find(e=>e.path.replace(/\/$/,'')===p)}
/* searchParams is a request-time API: awaiting it renders the path on every request. Only the journal
   index/archive views read it (search, sort, featured), so every other page stays prerendered and is
   revalidated (ISR) instead of being server-rendered per visit. */
/* Registry titles/descriptions (lib/seo.ts) are merged over the computed metadata. */
export async function generateMetadata(props:Props):Promise<Metadata>{const {slug}=await props.params;return withPageSeo(pathOf(slug),await baseMetadata(props))}
async function baseMetadata({params,searchParams}:Props):Promise<Metadata>{const {slug}=await params;
 const isIndex=['blogs','blog'].includes(slug[0])&&(slug.length===1||slug.length===3&&slug[1]==='page');
 if(isIndex){const sp=(await searchParams)||{};const n=slug[2];const title='Journal'+(n?' – Page '+n:'')+' | Workspace Junction';const description='Practical guides, founder stories and workspace ideas from Workspace Junction in Oakbrook Terrace, Illinois.';const canonical=n?JOURNAL_PATH+'page/'+n+'/':JOURNAL_PATH;return {title:{absolute:title},description,alternates:{canonical},robots:sp.q||sp.featured||sp.sort?{index:false,follow:true}:undefined,openGraph:{title,description,url:absoluteUrl(canonical),type:'website'}}}
 {const site0=await loadSite();const post=site0.posts.find(e=>e.path.replace(/\/$/,'')===pathOf(slug).replace(/\/$/,''));if(post){const seo=metaObject(post,'seo'),og=metaObject(post,'og');const t=text(String(seo.title||post.title));const d=text(String(seo.description||''))||excerptOf(post,160);const canonical=String(seo.canonical||post.path);const ogImage=String(og.image||post.featuredImage||'');const author=authorName(post);return {title:{absolute:t.includes('Workspace Junction')?t:t+' | Workspace Junction'},description:d,alternates:{canonical},robots:seo.noindex===true?{index:false,follow:true}:undefined,authors:author?[{name:author}]:undefined,openGraph:{type:'article',title:text(String(og.title||t)),description:text(String(og.description||d)),url:absoluteUrl(post.path),images:ogImage?[{url:absoluteUrl(ogImage)}]:[],publishedTime:post.date||undefined,modifiedTime:post.modified||post.date||undefined,authors:author?[author]:undefined},twitter:{card:'summary_large_image',title:text(String(og.title||t)),description:text(String(og.description||d)),images:ogImage?[absoluteUrl(ogImage)]:undefined}}}}
const blogPage=['blogs','blog'].includes(slug[0])&&slug.length===3&&slug[1]==='page'?slug[2]:null;const p=await matching(blogPage?[slug[0]]:slug);const category=(slug[0]==='tag'?(await loadSite()).tags||[]:(await loadSite()).categories).find(c=>['category','tag'].includes(slug[0])&&c.slug===slug[1]);if(!p&&!category){const fx=figmaPageFor(pathOf(slug));if(fx)return {title:{absolute:fx.title.includes('Workspace Junction')?fx.title:fx.title+' | Workspace Junction'},description:fx.description,alternates:{canonical:pathOf(slug)},openGraph:{title:fx.title,description:fx.description,type:'website'}};return {title:'Page not found',robots:{index:false}}}const rawTitle=text(p?.seo?.title||p?.title||category?.name||'Journal').replace(/^\s*[a-z]/,m=>m.toUpperCase());const title=blogPage?rawTitle+' – Page '+blogPage:rawTitle;return {title:{absolute:title.includes('Workspace')?title:title+' | Workspace Junction'},description:text(p?.seo?.description||p?.excerpt||p?.content||'').slice(0,160)||('Explore '+title+' at Workspace Junction in Oakbrook Terrace.'),alternates:{canonical:blogPage?pathOf(slug):p?.path||pathOf(slug)},openGraph:{title,description:text(p?.seo?.description||p?.excerpt||'').slice(0,160)||('Explore '+title+' at Workspace Junction in Oakbrook Terrace.'),images:p?.featuredImage?[p.featuredImage]:[],type:p?.type==='post'?'article':'website'}}}
export function generateStaticParams(){const d=site(),paths=new Set([...d.pages,...d.posts].filter(p=>p.path!=='/').map(p=>p.path));
 /* archive pagination uses /…/page/N/ paths (static-export friendly, matches canonicals), so pre-render every page of every archive */
 const pagesFor=(base:string,count:number)=>{for(let n=2;n<=Math.ceil(count/ARCHIVE_PAGE_SIZE);n++)paths.add(base+'page/'+n+'/')};
 pagesFor('/blogs/',d.posts.length);
 for(const c of d.categories){const count=d.posts.filter(p=>p.categories?.some(id=>String(id)===String(c.id))).length;if(count){paths.add('/category/'+c.slug+'/');pagesFor('/category/'+c.slug+'/',count)}}
 for(const path of FIGMA_ONLY_PATHS)paths.add(path);
 return [...paths].map(path=>({slug:path.split('/').filter(Boolean)}))}
const ARCHIVE_PAGE_SIZE=9;
/** Category/tag display name: fixes the migrated "bussiness" slug typo and title-cases each word. */
function termName(name:string){return text(name).replace(/\bbuss?iness\b/gi,'Business').replace(/(^|[\s/-])([a-z])/g,(_,a:string,b:string)=>a+b.toUpperCase())}
/** Related stories: same category first, then newest; never the current post and never a repeated cover image. */
function relatedPosts(posts:Entry[],current:Entry,limit=3){
 const shared=(v:Entry)=>v.categories?.filter(id=>current.categories?.some(c=>String(c)===String(id))&&String(id)!=='1').length||0;
 const ranked=posts.filter(v=>v.path!==current.path&&v.id!==current.id).sort((a,b)=>shared(b)-shared(a)||Date.parse(b.date||'')-Date.parse(a.date||''));
 const seen=new Set<string>(current.featuredImage?[current.featuredImage]:[]),picked:Entry[]=[];
 for(const v of ranked){const key=v.featuredImage||'';if(key&&seen.has(key))continue;if(key)seen.add(key);picked.push(v);if(picked.length===limit)break}
 return picked}
export default async function Page({params,searchParams}:Props){
 const {slug}=await params,s=await loadSite();
 const isTag=slug[0]==='tag';const category=(isTag?s.tags||[]:s.categories).find(c=>['category','tag'].includes(slug[0])&&c.slug===slug[1]);
 let source=await matching(slug);
 const isBlogIndex=['blogs','blog'].includes(slug[0])&&(slug.length===1||slug.length===3&&slug[1]==='page');
 if(category||isBlogIndex){const sp=(await searchParams)||{};const listed=category?s.posts.filter(post=>(isTag?post.tags:post.categories)?.some(id=>String(id)===String(category.id))):s.posts;const ld=collectionGraph(category?'/'+(isTag?'tag':'category')+'/'+category.slug+'/':'/blogs/',category?termName(category.name):'Journal',listed.map(post=>({path:post.path,title:text(post.title)})));return <><JournalIndex category={category} isTag={isTag} query={{q:sp.q,sort:sp.sort,featured:sp.featured,page:category?(slug[2]==='page'?slug[3]:undefined):(slug[1]==='page'?slug[2]:undefined)}}/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/></>;}
 /* Pages redesigned in Figma ("REDESIGN / … — Homepage Style") render from lib/figma-pages. */
 const figma=figmaPageFor(pathOf(slug));
 // Figma pages win over the old bespoke views (community-network, workshops, library, ...).
 // Those views were unreachable yet their stylesheets loaded on every page, so they were removed.
 const cmsPost=source&&s.posts.some(post=>post.path===source!.path);
 if(figma&&!cmsPost)return <PublicLayout><FigmaPageView page={figma} path={pathOf(slug)}/><RouteStructuredData path={pathOf(slug)} title={figma.title} faqs={figma.sections.flatMap(sec=>sec.kind==='faq'?sec.items:[])}/></PublicLayout>;
 /* Articles keep their original (often root-level) WordPress paths, so any unmatched path may be a renamed article. */
 if(!source){const to=await resolveRedirect(pathOf(slug));if(to)permanentRedirect(to);}
 if(!source)notFound();source={...source,content:safeContent(source.content)};
 if(source.slug==='memberships') {
   /* Pass prices come from the coworking service in the dynamic catalog. */
   const [communityPlans,coworking] = await Promise.all([fetchCommunityPlans(),fetchCatalogService('coworking')]);
   return <PublicLayout><MembershipsPageView communityPlans={communityPlans} coworking={coworking}/><RouteStructuredData path={source.path} title="Memberships"/></PublicLayout>;
 }
 if(source.slug==='contact-us')return <PublicLayout><ContactView/><RouteStructuredData path={source.path} title="Contact"/></PublicLayout>;
 if(source.slug==='gallery')return <PublicLayout><VisitPagesView slug={source.slug}/><RouteStructuredData path={source.path} title="Gallery"/></PublicLayout>;
 const p=source,title=text(p.title),isPost=p.type==='post'||s.posts.some(post=>post.path===p.path),isContact=/contact/.test(p.slug),isWorkflow=/membership-checkout|membership-confirmation|book-an-appointment|schedule-a-tour|face-linkup|^shop$/.test(p.slug),isDirectory=/^(services|use-cases|our-partners|partners|community)$/.test(p.slug),legal=/terms|privacy/.test(p.slug),image=pagePhoto(p,isPost);
 if(isPost)return <JournalArticle p={p} site={s}/>;
 const structured=!isPost&&!legal&&!isContact&&!isWorkflow&&!isDirectory&&isServicePage(p);const organized=!isPost&&!legal?organizeServiceContent(p.content,{informational:!structured}):null;
 const live=!isPost&&!legal&&!isWorkflow?liveSectionsFor(p.path):null;
 /* render the plans wrapper only when the reviewed catalog actually has plans for this page */
 const pricing=!live&&!isPost&&!legal&&!isContact&&!isWorkflow?await Pricing({service:p.slug}):null;
 const hasLivePlans = /^(coworking|events|llc-setup|dedicated|workshops)$/.test(p.slug);
 if(live)return <PublicLayout><main id="main" className="ip-page lx-main">
 <nav className="ip-wrap lx-crumbs" aria-label="Breadcrumb"><Link prefetch={false} href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
 <LiveSections sections={live} title={title} service={title}/>
 {/* The live capture of /gallery/ only holds its heading (the source gallery is a JS widget), so keep the venue gallery the non-live template renders. */}
 {p.slug==='gallery'&&<VenueGallery images={p.images}/>}
 <TestimonialsSection slug={p.slug}/>
 {!hasLivePlans&&!isDirectory&&<ServicePricingSection service={p.slug} serviceTitle={title}/>}
 {!isDirectory&&<ServiceExplore pages={s.pages} current={p}/>}
 </main><RouteStructuredData path={p.path} title={title}/></PublicLayout>;
 return <PublicLayout><main id="main" className={'ip-page '+(isPost?'ip-post-page':legal?'ip-legal-page':'')}>
 <InnerHero p={p} isPost={isPost} isContact={isContact} isWorkflow={isWorkflow} legal={legal}/>
 {!isPost&&!isContact&&!isWorkflow&&!legal&&!isDirectory&&<Highlights p={p}/>}
 {p.slug==='gallery'&&<VenueGallery images={p.images}/>}
 {isWorkflow?<section className="ip-wrap ip-form-section" id="ip-details"><div><p className="ip-eyebrow">An inquiry, not a reservation</p><h2>Let’s plan your next step.</h2><p>Tell us what you need and our team will confirm current plans, availability and next steps.</p><div className="ip-notice">This review site does not process payments, create memberships or confirm reservations. Submitting an inquiry is not a confirmed booking.</div></div><InquiryForm service={title}/></section>:isContact?<section className="ip-wrap ip-form-section" id="ip-details"><div><p className="ip-eyebrow">Visit the Junction</p><h2>We’d love to hear from you.</h2><address className="ip-contact-address">{s.business?.address||address}</address><dl className="ip-contact-list"><div><dt>Call us</dt><dd><a href={'tel:'+(s.business?.phoneHref||'+17739861908')}>{s.business?.phone||'(773) 986-1908'}</a></dd></div><div><dt>Email us</dt><dd><a href={'mailto:'+(s.business?.email||'grow@workspacejunction.com')}>{s.business?.email||'grow@workspacejunction.com'}</a></dd></div></dl></div><InquiryForm/></section>:null}
 {isDirectory&&/^(services|use-cases)$/.test(p.slug)&&<ServiceExplore pages={s.pages} current={p} directory industry={p.slug==='use-cases'}/>}
 {structured&&organized?<><ServiceNav/><ServiceOverview p={p} content={organized}/><section className="ip-product-plans" id="ip-plans" aria-label="Reviewed plans and availability">{pricing&&<div className="ip-pricing">{pricing}</div>}<p className="ip-wrap ip-plans-note">Our team confirms current availability, inclusions and next steps. An inquiry does not create a paid membership or confirmed reservation.</p></section><ServiceDetails content={organized}/></>:!isPost&&!legal&&organized?<InformationalContent p={p} content={organized} detailsId={!isContact&&!isWorkflow}/>:<section className={'ip-wrap ip-reading-section '+(isPost?'ip-article-body':'')} id={!isContact&&!isWorkflow?'ip-details':undefined} aria-label={isPost?'Article':'Service information'}>
 {!isPost&&!legal&&<div className="ip-section-heading"><div><p className="ip-eyebrow">{isContact?'Get in touch':isWorkflow?'Helpful information':'The details'}</p><h2>{isDirectory?'Discover the Junction':/about|community|partner/.test(p.slug)?'People, purpose and possibility.':'A closer look at '+title+'.'}</h2></div></div>}
 <SourceContent p={p}/>
 {isPost&&<><div className="post-taxonomy ip-taxonomy">{[...s.categories.filter(c=>p.categories?.some(id=>String(id)===String(c.id))).map(c=>({...c,base:'category'})),...(s.tags||[]).filter(c=>p.tags?.some(id=>String(id)===String(c.id))).map(c=>({...c,base:'tag'}))].map(c=><Link prefetch={false} key={c.base+c.id} href={'/'+c.base+'/'+c.slug+'/'}>{termName(c.name)}</Link>)}</div><div className="share-row ip-share"><span>Share this story</span><a target="_blank" rel="noreferrer" href={'https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent('https://workspacejunction.com'+p.path)}>LinkedIn <ArrowUpRight size={14}/></a><a href={'mailto:?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent('https://workspacejunction.com'+p.path)}>Email <ArrowUpRight size={14}/></a></div></>}
 </section>}
 {!structured&&!isPost&&!legal&&!isContact&&!isWorkflow&&pricing&&<div className="ip-pricing">{pricing}</div>}
 {!isPost&&!legal&&<TestimonialsSection slug={p.slug}/>}
 {!isPost&&!legal&&!isContact&&!isWorkflow&&!isDirectory&&<ServiceExplore pages={s.pages} current={p}/>}

 {isPost&&<section className="ip-related ip-wrap"><div className="ip-section-heading"><div><p className="ip-eyebrow">Keep exploring</p><h2>More from the Junction.</h2></div><Link prefetch={false} href={routeFor('blogs','/blogs/')} className="ip-text-link">All stories <ArrowUpRight size={17}/></Link></div><div className="journal-grid">{relatedPosts(s.posts,p).map(v=><PostCard key={v.path} p={v}/>)}</div></section>}
 </main>{isPost&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(articleGraph({path:p.path,title:cleanTitle(title,''),date:p.date,modified:p.modified||p.date,image,author:p.author,description:text(p.seo?.description||p.excerpt||'').slice(0,300)||undefined}))}}/>}{!isPost&&<RouteStructuredData path={p.path} title={title}/>}</PublicLayout>
}
function PostCard({p}:{p:Entry}){return <Link prefetch={false} href={p.path} className="journal-card ip-journal-card"><div className="journal-image">{p.featuredImage&&<Image src={p.featuredImage} alt={text(p.title)} fill sizes="(max-width:650px) 100vw,33vw" className="cover"/>}</div><p className="eyebrow">{p.date?new Date(p.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'THE JUNCTION JOURNAL'}</p><h3>{text(p.title)}</h3><p className="journal-excerpt">{text(p.excerpt||p.content).slice(0,145)}…</p><span className="text-link">Read the story <ArrowUpRight size={15}/></span></Link>}
