import Link from 'next/link';
import Image from '@/components/consistent-image';
import {ArrowUpRight} from 'lucide-react';
import {text, type Entry, type Category} from '@/lib/site';
import {authorName, categoryOf, excerptOf, formatDate, imageAlt, readingTime, termName} from './journal-data';

export function PostMeta({p, withAuthor = true}: {p: Entry; withAuthor?: boolean}) {
  const author = withAuthor ? authorName(p) : undefined;
  const date = formatDate(p.date, 'short');
  return (
    <p className="jr-meta">
      {author && <span>{author}</span>}
      {date && <time dateTime={p.date}>{date}</time>}
      <span>{readingTime(p)} min read</span>
    </p>
  );
}

function Cover({p, sizes, priority = false}: {p: Entry; sizes: string; priority?: boolean}) {
  return (
    <span className="jr-cover">
      {p.featuredImage
        ? <Image src={p.featuredImage} alt={imageAlt(p)} fill sizes={sizes} preload={priority} className="jr-cover-img" />
        : <span className="jr-cover-fallback" aria-hidden="true">{text(p.title).slice(0, 1)}</span>}
    </span>
  );
}

/** Editorial card. `wide` lays image and text side by side; `compact` is a text-led list row. */
export function PostCard({p, categories, variant = 'standard', priority = false, headingLevel = 3}: {p: Entry; categories: Category[]; variant?: 'standard' | 'wide' | 'compact' | 'lead'; priority?: boolean; headingLevel?: 2 | 3}) {
  const cat = categoryOf(p, categories);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const sizes = variant === 'lead' ? '(max-width: 900px) 100vw, 60vw' : variant === 'wide' ? '(max-width: 760px) 100vw, 40vw' : variant === 'compact' ? '120px' : '(max-width: 760px) 100vw, (max-width: 1200px) 45vw, 30vw';
  return (
    <article className={'jr-card jr-card-' + variant}>
      <Link prefetch={false} href={p.path} className="jr-card-link" aria-label={text(p.title)}>
        <Cover p={p} sizes={sizes} priority={priority} />
      </Link>
      <div className="jr-card-body">
        {cat && <Link prefetch={false} className="jr-cat" href={'/category/' + cat.slug + '/'}>{termName(cat.name)}</Link>}
        <H className="jr-card-title"><Link prefetch={false} href={p.path}>{text(p.title)}</Link></H>
        {variant !== 'compact' && <p className="jr-excerpt">{excerptOf(p, variant === 'lead' ? 220 : 150)}</p>}
        <PostMeta p={p} withAuthor={variant !== 'compact'} />
        {variant === 'lead' && <Link prefetch={false} href={p.path} className="jr-cta">Read the story <ArrowUpRight size={17} aria-hidden="true" /></Link>}
      </div>
    </article>
  );
}
