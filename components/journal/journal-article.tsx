import Link from 'next/link';
import Image from '@/components/consistent-image';
import {ArrowLeft, ArrowRight, ArrowUpRight, Clock} from 'lucide-react';
import {jsonLd, text, type Entry, type Site} from '@/lib/site';
import {PublicLayout} from '@/components/public-layout';
import {ArticleBody, prepare} from '@/components/article/article-body';
import {PostCard} from './journal-cards';
import {BackToTop, CopyLink, HelpfulVote, NativeShare, TableOfContents, ViewBeacon} from './journal-client';
import {absoluteUrl, authorAvatar, authorName, categoryOf, formatDate, imageAlt, JOURNAL_PATH, metaObject, metaString, newestFirst, relatedPosts, subtitle, termName, visibleCategories, excerptOf} from './journal-data';
import '../../app/journal.css';

/** Long-form article page. Body HTML comes from the shared renderer used by the admin preview. */
export function JournalArticle({p, site}: {p: Entry; site: Site}) {
  const prepared = prepare(p.body ?? p.content);
  const categories = visibleCategories(site.categories);
  const cat = categoryOf(p, categories);
  const title = text(p.title);
  const sub = subtitle(p);
  const author = authorName(p);
  const avatar = authorAvatar(p);
  const minutes = Number((p.meta || {}).readingMinutes) > 0 ? Math.round(Number((p.meta || {}).readingMinutes)) : prepared.minutes;
  const published = formatDate(p.date);
  const updated = p.modified && formatDate(p.modified) !== published && Date.parse(p.modified) > Date.parse(p.date || '') ? formatDate(p.modified) : '';
  const url = absoluteUrl(p.path);
  const seo = metaObject(p, 'seo');
  const description = String(seo.description || '') || excerptOf(p, 160);
  const ordered = newestFirst(site.posts);
  const at = ordered.findIndex(v => v.path === p.path);
  const newer = at > 0 ? ordered[at - 1] : undefined;
  const older = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : undefined;
  const related = relatedPosts(site.posts, p);
  const toc = prepared.headings.length >= 3 ? prepared.headings : [];
  const share = [
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)],
    ['X', 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(title)],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    ['WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(title + ' ' + url)],
    ['Email', 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(url)],
  ] as const;
  const authorBio = metaString(p, 'authorBio');
  const askFeedback = (p.meta as Record<string, unknown> | undefined)?.feedbackDisabled !== true;
  /* Accordions (details/summary) become FAQ rich results. */
  const faqs = [...prepared.html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)]
    .map(m => ({q: text(m[1]).trim(), a: text(m[2]).trim()})).filter(f => f.q && f.a).slice(0, 20);
  const image = p.featuredImage ? absoluteUrl(p.featuredImage) : undefined;
  const structured = [
    {'@context': 'https://schema.org', '@type': 'BlogPosting', headline: title, description, ...(image ? {image: [image]} : {}), datePublished: p.date || undefined, dateModified: p.modified || p.date || undefined,
      author: author ? {'@type': 'Person', name: author} : {'@type': 'Organization', name: 'Workspace Junction'},
      publisher: {'@type': 'Organization', name: 'Workspace Junction', url: absoluteUrl('/')}, mainEntityOfPage: {'@type': 'WebPage', '@id': url}, ...(cat ? {articleSection: termName(cat.name)} : {}), wordCount: prepared.text.split(' ').filter(Boolean).length},
    {'@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      {'@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/')},
      {'@type': 'ListItem', position: 2, name: 'Journal', item: absoluteUrl(JOURNAL_PATH)},
      ...(cat ? [{'@type': 'ListItem', position: 3, name: termName(cat.name), item: absoluteUrl('/category/' + cat.slug + '/')}] : []),
      {'@type': 'ListItem', position: cat ? 4 : 3, name: title, item: url},
    ]},
    ...(faqs.length ? [{'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({'@type': 'Question', name: f.q, acceptedAnswer: {'@type': 'Answer', text: f.a}}))}] : []),
  ];

  return (
    <PublicLayout>
      <main id="main" className="jr-page jr-article-page" data-art="journal">
        <article>
          <header className="jr-article-head jr-wrap">
            <nav className="jr-crumbs" aria-label="Breadcrumb">
              <Link prefetch={false} href="/">Home</Link><span aria-hidden="true">/</span>
              <Link prefetch={false} href={JOURNAL_PATH}>Journal</Link>
              {cat && <><span aria-hidden="true">/</span><Link prefetch={false} href={'/category/' + cat.slug + '/'}>{termName(cat.name)}</Link></>}
            </nav>
            {cat && <Link prefetch={false} className="jr-cat" href={'/category/' + cat.slug + '/'}>{termName(cat.name)}</Link>}
            <h1 className="jr-article-title">{title}</h1>
            {sub && <p className="jr-subtitle">{sub}</p>}
            <div className="jr-byline">
              {(author || avatar) && <span className="jr-author">{avatar ? <Image src={avatar} alt="" width={40} height={40} className="jr-avatar" /> : <span className="jr-avatar jr-avatar-initial" aria-hidden="true">{(author || 'W').slice(0, 1)}</span>}<span>By <strong>{author || 'Workspace Junction'}</strong></span></span>}
              {published && <span>Published <time dateTime={p.date}>{published}</time></span>}
              {updated && <span>Updated <time dateTime={p.modified}>{updated}</time></span>}
              <span><Clock size={15} aria-hidden="true" /> {minutes} min read</span>
            </div>
          </header>

          {p.featuredImage && (
            <figure className="jr-hero-figure jr-wrap">
              <span className="jr-hero-img"><Image src={p.featuredImage} alt={imageAlt(p)} fill preload sizes="(max-width: 1200px) 100vw, 1180px" /></span>
            </figure>
          )}

          <div className={'jr-article-layout jr-wrap' + (toc.length ? ' has-toc' : '')}>
            {toc.length > 0 && <aside className="jr-article-aside"><TableOfContents headings={toc} /></aside>}
            <div className="jr-article-main">
              <ArticleBody prepared={prepared} />
              <footer className="jr-article-foot">
                {p.tags?.length ? <div className="jr-tags">{(site.tags || []).filter(t => p.tags?.some(id => String(id) === String(t.id))).map(t => <Link prefetch={false} key={String(t.id)} href={'/tag/' + t.slug + '/'}>#{termName(t.name)}</Link>)}</div> : null}
                {askFeedback && <HelpfulVote slug={p.slug} />}
                {authorBio && (
                  <aside className="jr-author-box" aria-label="About the author">
                    {avatar ? <Image src={avatar} alt="" width={64} height={64} className="jr-author-box-img" /> : <span className="jr-author-box-img jr-avatar-initial" aria-hidden="true">{(author || 'W').slice(0, 1)}</span>}
                    <div><p className="jr-side-title">About the author</p><strong>{author || 'Workspace Junction'}</strong><p>{authorBio}</p></div>
                  </aside>
                )}
                <div className="jr-share">
                  <span className="jr-side-title">Share this article</span>
                  <div className="jr-share-row">
                    {share.map(([label, href]) => <a key={label} className="jr-share-btn" href={href} target={label === 'Email' ? undefined : '_blank'} rel="noopener noreferrer">{label}</a>)}
                    <CopyLink url={url} />
                    <NativeShare url={url} title={title} />
                  </div>
                </div>
                <Link prefetch={false} href={JOURNAL_PATH} className="jr-back"><ArrowLeft size={16} aria-hidden="true" /> Back to the Journal</Link>
              </footer>
            </div>
          </div>
        </article>

        {(newer || older) && (
          <nav className="jr-prevnext jr-wrap" aria-label="More articles">
            {older ? <Link prefetch={false} href={older.path} className="jr-pn jr-pn-prev"><span><ArrowLeft size={15} aria-hidden="true" /> Previous article</span><strong>{text(older.title)}</strong></Link> : <span />}
            {newer ? <Link prefetch={false} href={newer.path} className="jr-pn jr-pn-next"><span>Next article <ArrowRight size={15} aria-hidden="true" /></span><strong>{text(newer.title)}</strong></Link> : <span />}
          </nav>
        )}

        {related.items.length > 0 && (
          <section className="jr-related jr-wrap" aria-labelledby="jr-related-title">
            <div className="jr-section-head"><h2 id="jr-related-title">{related.related ? 'Related articles' : 'Latest from the Journal'}</h2><Link prefetch={false} className="jr-textlink" href={JOURNAL_PATH}>All stories <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
            <div className="jr-picks-grid">{related.items.map(v => <PostCard key={v.path} p={v} categories={categories} />)}</div>
          </section>
        )}
        <ViewBeacon slug={p.slug} />
        <BackToTop />
        <link rel="alternate" type="application/rss+xml" title="Workspace Junction Journal" href="/feed/" />
      </main>
      {structured.map((s, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html: jsonLd(s)}} />)}
    </PublicLayout>
  );
}
