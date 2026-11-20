import Link from 'next/link';
import {ArrowUpRight, Search, SlidersHorizontal, X} from 'lucide-react';
import {loadSite, text, type Category, type Entry} from '@/lib/site';
import {PublicLayout} from '@/components/public-layout';
import {PostCard} from './journal-cards';
import {AutoSubmitForm} from './journal-client';
import {NewsletterForm} from '@/components/forms';
import {featuredPosts, formatDate, isFeatured, isPinned, JOURNAL_PATH, newestFirst, PAGE_SIZE, popularSlugs, postTime, termName, visibleCategories} from './journal-data';
import '../../app/journal.css';

export type JournalQuery = {q?: string; page?: string; sort?: string; featured?: string};

/** Journal index and category/tag archives. All filtering runs on the server from CMS records. */
export async function JournalIndex({category, isTag = false, query}: {category?: Category; isTag?: boolean; query: JournalQuery}) {
  const s = await loadSite();
  const categories = visibleCategories(s.categories);
  const q = (query.q || '').trim().slice(0, 100);
  const sort = query.sort === 'oldest' ? 'oldest' : 'newest';
  const onlyFeatured = query.featured === '1';
  const base = category ? (isTag ? '/tag/' : '/category/') + category.slug + '/' : JOURNAL_PATH;
  const all = newestFirst(s.posts);
  const inScope = (p: Entry) => !category || (isTag ? p.tags : p.categories)?.some(id => String(id) === String(category.id));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (p: Entry) => !words.length || words.every(w => (text(p.title) + ' ' + text(p.excerpt || '') + ' ' + text(p.content)).toLowerCase().includes(w));
  let filtered = all.filter(p => inScope(p) && matches(p) && (!onlyFeatured || isFeatured(p)));
  if (sort === 'oldest') filtered = [...filtered].sort((a, b) => postTime(a) - postTime(b));
  /* Pinned posts lead the latest stories (when sorted newest first). */
  else filtered = [...filtered.filter(isPinned), ...filtered.filter(p => !isPinned(p))];
  const filtering = Boolean(q || onlyFeatured || sort !== 'newest');

  /* Front page only: a lead story and featured stories, then the grid without repeats. */
  const showcase = !category && !filtering;
  const featured = featuredPosts(s.posts);
  const lead = showcase ? (featured[0] || all.find(p => p.featuredImage) || all[0]) : undefined;
  const picks = showcase ? (featured.length > 1 ? featured.slice(1, 4) : all.filter(p => p !== lead).slice(0, 3)) : [];
  const picksAreFeatured = featured.length > 1;
  const shown = new Set([lead, ...picks].filter(Boolean).map(p => p!.path));
  const gridPosts = showcase ? filtered.filter(p => !shown.has(p.path)) : filtered;
  const total = Math.max(1, Math.ceil(gridPosts.length / PAGE_SIZE));
  const page = Math.min(total, Math.max(1, Math.floor(Number(query.page)) || 1));
  const items = gridPosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const firstPage = page === 1;

  const qs = (over: Partial<Record<'q' | 'sort' | 'featured', string>> = {}) => {
    const params = new URLSearchParams();
    const v = {q, sort: sort === 'newest' ? '' : sort, featured: onlyFeatured ? '1' : '', ...over};
    for (const [k, val] of Object.entries(v)) if (val) params.set(k, val);
    return params.size ? '?' + params.toString() : '';
  };
  const pageUrl = (n: number) => (n <= 1 ? base : base + 'page/' + n + '/') + qs();
  const windowed = [...new Set([1, page - 1, page, page + 1, total])].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);

  const count = (c: Category) => s.posts.filter(p => p.categories?.some(id => String(id) === String(c.id))).length;
  const popular = await popularSlugs(5);
  const popularPosts = popular.map(slug => s.posts.find(p => p.slug === slug)).filter((p): p is Entry => Boolean(p));
  const recent = all.slice(0, 5);
  const heading = category ? termName(category.name) : 'The Junction Journal';

  return (
    <PublicLayout>
      <main id="main" className="jr-page" data-art="journal">
        <header className="jr-head jr-wrap">
          <nav className="jr-crumbs" aria-label="Breadcrumb"><Link prefetch={false} href="/">Home</Link><span aria-hidden="true">/</span>{category ? <><Link prefetch={false} href={JOURNAL_PATH}>Journal</Link><span aria-hidden="true">/</span><span aria-current="page">{heading}</span></> : <span aria-current="page">Journal</span>}</nav>
          <div className="jr-head-row">
            <div>
              <p className="jr-eyebrow">{category ? (isTag ? 'Tag' : 'Category') : 'Journal'}</p>
              <h1 className="jr-title">{category ? heading : <>Ideas for the way <em>you work.</em></>}</h1>
            </div>
            <p className="jr-intro">{category ? `Every ${heading.toLowerCase()} story from Workspace Junction, newest first.` : 'Practical guides, founder stories and workspace thinking from the team at Workspace Junction in Oakbrook Terrace.'}</p>
          </div>
        </header>

        {lead && firstPage && (
          <section className="jr-lead jr-wrap" aria-labelledby="jr-lead-title">
            <h2 id="jr-lead-title" className="sr-only">{isFeatured(lead) ? 'Featured story' : 'Latest story'}</h2>
            <PostCard p={lead} categories={categories} variant="lead" priority headingLevel={3} />
          </section>
        )}

        {picks.length > 0 && firstPage && (
          <section className="jr-picks jr-wrap" aria-labelledby="jr-picks-title">
            <div className="jr-section-head"><h2 id="jr-picks-title">{picksAreFeatured ? 'Featured stories' : 'Fresh from the Journal'}</h2>{picksAreFeatured && <Link prefetch={false} className="jr-textlink" href={JOURNAL_PATH + '?featured=1'}>All featured <ArrowUpRight size={16} aria-hidden="true" /></Link>}</div>
            <div className="jr-picks-grid">{picks.map(p => <PostCard key={p.path} p={p} categories={categories} />)}</div>
          </section>
        )}

        <div className="jr-body jr-wrap">
          <div className="jr-main">
            <div className="jr-toolbar">
              <nav className="jr-chips" aria-label="Categories">
                <Link prefetch={false} href={JOURNAL_PATH + qs()} className={!category ? 'is-on' : ''} aria-current={!category ? 'page' : undefined}>All stories</Link>
                {categories.filter(c => count(c) > 0).map(c => <Link prefetch={false} key={String(c.id)} href={'/category/' + c.slug + '/' + qs()} className={category && !isTag && String(category.id) === String(c.id) ? 'is-on' : ''} aria-current={category && String(category.id) === String(c.id) ? 'page' : undefined}>{termName(c.name)}</Link>)}
              </nav>
              <AutoSubmitForm action={base} className="jr-filters" label="Search and sort the Journal">
                <label className="jr-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search articles</span><input name="q" type="search" defaultValue={q} placeholder="Search articles" maxLength={100} /></label>
                <label className="jr-select"><SlidersHorizontal size={15} aria-hidden="true" /><span className="sr-only">Sort</span>
                  <select name="sort" defaultValue={sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
                </label>
                <label className="jr-toggle"><input type="checkbox" name="featured" value="1" defaultChecked={onlyFeatured} /><span>Featured only</span></label>
                <button type="submit" className="jr-search-btn">Search</button>
              </AutoSubmitForm>
            </div>

            <div className="jr-results-head">
              <h2>{q ? <>Results for “{q}”</> : onlyFeatured ? 'Featured stories' : category ? 'All stories' : 'Latest stories'}</h2>
              <p role="status">{gridPosts.length} {gridPosts.length === 1 ? 'article' : 'articles'}{total > 1 ? ` · page ${page} of ${total}` : ''}</p>
              {filtering && <Link prefetch={false} href={base} className="jr-clear"><X size={14} aria-hidden="true" /> Clear filters</Link>}
            </div>

            {items.length ? (
              <div className="jr-grid">
                {items.map((p, i) => <PostCard key={p.path} p={p} categories={categories} variant={i === 0 && firstPage ? 'wide' : i === 5 ? 'wide' : 'standard'} />)}
              </div>
            ) : (
              <div className="jr-empty" role="status">
                <p className="jr-eyebrow">Nothing here yet</p>
                <h3>{q ? <>No articles match “{q}”{category ? <> in {heading}</> : null}.</> : onlyFeatured ? 'No featured stories right now.' : category ? `No ${heading} stories have been published yet.` : 'No stories have been published yet.'}</h3>
                <p>Try a different word, another category, or browse everything we have written.</p>
                <Link prefetch={false} href={JOURNAL_PATH} className="jr-cta">Browse all stories <ArrowUpRight size={17} aria-hidden="true" /></Link>
              </div>
            )}

            {total > 1 && (
              <nav className="jr-pagination" aria-label="Pagination">
                {page > 1 ? <Link prefetch={false} rel="prev" href={pageUrl(page - 1)} className="jr-page-step">← Previous</Link> : <span className="jr-page-step is-disabled" aria-hidden="true">← Previous</span>}
                <span className="jr-page-list">{windowed.map((n, i) => <span key={n} className="jr-page-item">{i > 0 && n - windowed[i - 1] > 1 && <span className="jr-gap" aria-hidden="true">…</span>}<Link prefetch={false} href={pageUrl(n)} aria-label={'Page ' + n} aria-current={n === page ? 'page' : undefined} className={n === page ? 'is-on' : ''}>{n}</Link></span>)}</span>
                {page < total ? <Link prefetch={false} rel="next" href={pageUrl(page + 1)} className="jr-page-step">Next →</Link> : <span className="jr-page-step is-disabled" aria-hidden="true">Next →</span>}
              </nav>
            )}
          </div>

          <aside className="jr-side" aria-label="Journal sidebar">
            <section className="jr-side-card">
              <h2 className="jr-side-title">Topics</h2>
              <ul className="jr-topic-list">{categories.filter(c => count(c) > 0).map(c => <li key={String(c.id)}><Link prefetch={false} href={'/category/' + c.slug + '/'}><span>{termName(c.name)}</span><span className="jr-count">{count(c)}</span></Link></li>)}</ul>
            </section>
            <section className="jr-side-card">
              <h2 className="jr-side-title">{popularPosts.length ? 'Most read' : 'Recently published'}</h2>
              <ol className="jr-rank">{(popularPosts.length ? popularPosts : recent).map((p, i) => <li key={p.path}><span className="jr-rank-n">{String(i + 1).padStart(2, '0')}</span><span><Link prefetch={false} href={p.path}>{text(p.title)}</Link><small>{formatDate(p.date, 'short')}</small></span></li>)}</ol>
            </section>
            {popularPosts.length > 0 && (
              <section className="jr-side-card">
                <h2 className="jr-side-title">Recently published</h2>
                <ul className="jr-recent">{recent.slice(0, 4).map(p => <li key={p.path}><Link prefetch={false} href={p.path}>{text(p.title)}</Link><small>{formatDate(p.date, 'short')}</small></li>)}</ul>
              </section>
            )}
            <section className="jr-side-card jr-side-news" aria-labelledby="jr-news-title">
              <h2 id="jr-news-title" className="jr-side-title">The Junction letter</h2>
              <p className="jr-side-news-lead">New stories, events and member offers. About twice a month; unsubscribe any time.</p>
              <NewsletterForm source="journal" compact />
            </section>
            <section className="jr-side-cta">
              <p className="jr-eyebrow">Visit the Junction</p>
              <h2>See the space in person.</h2>
              <p>Coworking, private offices, studios and meeting rooms in Oakbrook Terrace.</p>
              <div className="jr-side-actions">
                <Link prefetch={false} href="/contact-us/" className="jr-btn">Book a tour <ArrowUpRight size={16} aria-hidden="true" /></Link>
                <a href="tel:+17739861908" className="jr-btn-ghost">(773) 986-1908</a>
              </div>
            </section>
          </aside>
        </div>
        <link rel="alternate" type="application/rss+xml" title="Workspace Junction Journal" href="/feed/" />
      </main>
    </PublicLayout>
  );
}
