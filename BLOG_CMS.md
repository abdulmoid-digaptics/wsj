# Journal & Blog CMS (2026-11-20)

## Where things live
| Part | Files |
|---|---|
| Public Journal index, category/tag archives, article page | `app/[...slug]/page.tsx`, `components/journal/*`, `app/journal.css` |
| Shared article renderer (public page + admin preview) | `components/article/article-body.tsx`, `article.css`, `article-enhancer.tsx`, `lib/article/render.ts`, `lib/article/chart.ts` |
| Article HTML policy (identical copies, test enforces) | `lib/article/sanitize.ts` = `backend/src/article-sanitize.ts` |
| Admin post list / editor / block editor | `app/admin/blog/BlogManager.tsx`, `BlogEditor.tsx`, `editor/*`, `blog-studio.css` |
| Private preview page | `app/journal-preview/page.tsx` |
| Backend API | `backend/src/blog-studio.ts` (`/api/admin/blog-studio/*`, `/api/public/blog-popular`, `/blog-redirects/resolve`, `/blog/:slug/view`, `/blog-preview/:id`) |
| Schema | migration `20261125000000_blog_cms` (ContentRevision, ContentRedirect, ContentView + baseline revision per existing post) |

## Model
Posts stay in `Content` (kind `blog`), so existing URLs and data are unchanged. Status: DRAFT = draft, ARCHIVED = archived, PUBLISHED + future `publishAt` = scheduled, PUBLISHED = published. Scheduled posts become public through the existing read-time filter, so no worker is needed and restarts cannot lose a schedule. Public caches may delay appearance by up to about a minute; they can never show a post early.
Content written by the editor is stored as `{html, doc, version: 2}`; imported posts (`{html}`) render through the legacy pipeline until they are saved in the editor.
Existing posts keep their URL pattern (most live at the site root, e.g. `/coworking-space-chicago/`); new posts live at `/blogs/<slug>/`. Changing a published slug stores a redirect from the old path.

## Editor
Tiptap 3.32 (ProseMirror). Blocks: headings H1–H6, paragraph styles, bold/italic/underline/strike/code/sub/sup, links, alignment, text colour, highlight, font size, bullet/numbered/nested/check lists, quote, callouts (6 styles), coloured sections, 2–4 columns, accordions, tables (merge/split, header row/column, cell colour, comparison style, column resize), code blocks, dividers, images (caption, alt, link, left/centre/right/wide/full, 50/75/100%), galleries, uploaded video (MP4/WebM), YouTube/Vimeo embeds (URL or iframe code, allowlisted), charts (bar, horizontal bar, line, pie, doughnut; SVG, accessible data table), diagrams (Mermaid, strict mode). Slash menu, bubble toolbar, block handle (drag, move, duplicate, delete), find & replace, full-screen mode, word count, paste/drop image upload, server autosave (drafts in place; live posts to history), local draft recovery, unsaved-change warning, edit-conflict detection, revision history with restore, desktop/mobile preview, signed 1-hour preview links.

## Word and documents
- Paste from Word/Google Docs keeps headings, bold/italic/underline, colours, highlights, font sizes, nested bullet and numbered lists, tables with shading and merged cells, and links. An import report lists what could not come across: images Word keeps on disk, SmartArt, charts and shapes.
- `.docx` import (mammoth) keeps headings, lists, tables, links, bold/italic and embedded images (uploaded to R2). It does not carry colours, highlights, font sizes or cell shading, and the import report says so. EMF/WMF images, SmartArt, charts and shapes are reported, not converted.
- PDF import is not implemented.

## Not done / limits
- The "Expert" option mentioned in the brief does not exist anywhere in this codebase, so there was nothing to retire.
- No responsive image variants are generated for R2 uploads (originals are served with lazy loading).
- Editing an imported legacy post converts its HTML to the editor schema on first save; unusual WordPress markup may be simplified. A baseline revision of every imported post exists for restore.
- Real-time co-editing is not supported (conflicts are detected and the user chooses to reload or overwrite).
