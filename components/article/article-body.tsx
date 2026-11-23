import {prepareArticle, type PreparedArticle} from '@/lib/article/render';
import {safeContent} from '@/lib/site';
import {ArticleEnhancer} from './article-enhancer';
import './article.css';

/**
 * The single article renderer. The public article page and the admin preview both use it, with the
 * same stylesheet (article.css), so what an editor previews is what readers get.
 */
export function prepare(content: unknown): PreparedArticle {
  return prepareArticle(content, html => safeContent(html));
}

export function ArticleBody({content, prepared, className = ''}: {content?: unknown; prepared?: PreparedArticle; className?: string}) {
  const article = prepared ?? prepare(content);
  return (
    <>
      <div className={'wj-article ' + className} dangerouslySetInnerHTML={{__html: article.html}} />
      <ArticleEnhancer />
    </>
  );
}
