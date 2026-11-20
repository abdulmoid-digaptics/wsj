import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {PublicLayout} from '@/components/public-layout';
import {ArticleBody, prepare} from '@/components/article/article-body';

/* Private preview of a draft or scheduled post. Only a valid, unexpired signed token returns the post,
   the page is never indexed, and nothing here is cached. */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Preview', robots: {index: false, follow: false, nocache: true}};

type Props = {searchParams: Promise<{id?: string; token?: string}>};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form CMS metadata
type PreviewPost = {title: string; excerpt: string | null; content: unknown; metadata: Record<string, any>; state: string};

export default async function JournalPreview({searchParams}: Props) {
  const {id, token} = await searchParams;
  if (!id || !token || !/^[\w-]{8,64}$/.test(id)) notFound();
  const base = process.env.API_URL || 'http://localhost:4000/api';
  const res = await fetch(base + '/public/blog-preview/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(token), {cache: 'no-store'}).catch(() => null);
  if (!res?.ok) notFound();
  const post = (await res.json()) as PreviewPost;
  const m = post.metadata || {};
  const prepared = prepare(post.content);
  return (
    <PublicLayout>
      <main id="main" data-art="journal" style={{background: '#F7F4ED', padding: 'clamp(28px,5vw,64px) 20px 80px'}}>
        <p role="status" style={{maxWidth: 760, margin: '0 auto 18px', padding: '10px 14px', borderRadius: 12, background: '#FBF0DC', color: '#6B4A10', fontSize: 14}}>
          Private preview · {post.state === 'scheduled' ? 'scheduled, not public yet' : post.state === 'draft' ? 'draft, not public' : post.state} · link expires within an hour
        </p>
        <article style={{maxWidth: 760, margin: '0 auto'}}>
          {m.featuredImage && <img src={m.featuredImage} alt={m.featuredImageAlt || ''} style={{width: '100%', aspectRatio: '2 / 1', objectFit: 'cover', borderRadius: 18, marginBottom: 24}} />}
          <h1 style={{font: '400 clamp(32px,4.4vw,52px)/1.1 var(--font-serif, Georgia, serif)', color: '#0E3421', margin: '0 0 10px'}}>{post.title}</h1>
          {m.subtitle && <p style={{fontSize: 21, color: '#59665F', margin: '0 0 10px'}}>{m.subtitle}</p>}
          <p style={{fontSize: 14, color: '#6B756F', margin: '0 0 28px'}}>{m.author || 'Workspace Junction'} · {m.readingMinutes || prepared.minutes} min read</p>
          <ArticleBody prepared={prepared} />
        </article>
      </main>
    </PublicLayout>
  );
}
