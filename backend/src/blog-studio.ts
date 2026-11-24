/**
 * Blog CMS API (admin "Blog studio" and the public Journal helpers).
 *
 * Posts stay in the shared Content table (kind = 'blog'), so every existing post, URL and the
 * public eligibility rules keep working. This controller owns the blog write path because rich
 * article HTML needs its own sanitizer (article-sanitize.ts): the generic admin path strips styles,
 * tables attributes and embeds.
 *
 * Status model (no new enum): DRAFT = draft, ARCHIVED = archived, PUBLISHED + future publishAt =
 * scheduled, PUBLISHED otherwise = published. Scheduled posts become public by the existing read-time
 * filter (Content.publishAt <= now), so publication needs no worker and survives restarts.
 */
import {BadRequestException, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors, Body, HttpCode} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {FileInterceptor, FilesInterceptor} from '@nestjs/platform-express';
import {Throttle} from '@nestjs/throttler';
import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {AuthGuard, Db, Roles} from './core';
import {scheduleColumns} from './content-safety';
import {clearPublicCache} from './public';
import {notifySeoChange} from './seo';
import {R2StorageService, detectMimeType} from './storage';
import {articleText, readingMinutes, sanitizeArticleHtml, slugify} from './article-sanitize';

type Actor = {user: {id: string; email: string; name?: string; role: string}};
type Row = {id: string; kind: string; title: string; slug: string; status: string; excerpt: string | null; content: any; metadata: any; publishAt: Date | null; sortOrder: number; createdAt: Date; updatedAt: Date};
export type BlogState = 'draft' | 'scheduled' | 'published' | 'archived';
type Intent = 'draft' | 'publish' | 'schedule' | 'unpublish' | 'archive' | 'keep';

export const BLOG_BASE = '/blogs/';
/** Metadata is validated field by field (parseMeta) and always rendered as text, so it is stored as-is; only prototype keys are dropped. */
export function safeMeta(value: any): any {
  if (Array.isArray(value)) return value.map(safeMeta);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k)).map(([k, v]) => [k, safeMeta(v)]));
  return value;
}
const RESERVED = new Set(['page', 'category', 'tag', 'feed', 'rss', 'admin', 'api', 'new', 'edit', 'preview', 'search', 'author', 'blog', 'blogs']);
const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const bad = (m: string | string[]): never => { throw new BadRequestException(m); };

export function blogState(row: {status: string; publishAt: Date | null}, now = new Date()): BlogState {
  if (row.status === 'ARCHIVED') return 'archived';
  if (row.status === 'DRAFT') return 'draft';
  return row.publishAt && row.publishAt.getTime() > now.getTime() ? 'scheduled' : 'published';
}
export const pathFor = (slug: string) => BLOG_BASE + slug + '/';
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optUrl = (v: unknown, field: string) => {
  const s = str(v, 2000);
  if (s && !/^(https?:\/\/|\/)/i.test(s)) bad(field + ' must be a site path (/…) or an https URL');
  return s;
};

/** What the editor may set. Unknown keys are ignored; existing import metadata is preserved on save. */
export function parseMeta(input: any) {
  const m = input && typeof input === 'object' ? input : {};
  const ids = (v: unknown) => Array.isArray(v) ? [...new Set(v.map(x => String(x).trim()).filter(Boolean))].slice(0, 30) : [];
  const order = m.featuredOrder === '' || m.featuredOrder === null || m.featuredOrder === undefined ? null : Number(m.featuredOrder);
  if (order !== null && (!Number.isInteger(order) || order < 0 || order > 9999)) bad('Featured order must be a whole number from 0 to 9999');
  const seo = m.seo && typeof m.seo === 'object' ? m.seo : {};
  const og = m.og && typeof m.og === 'object' ? m.og : {};
  return {
    subtitle: str(m.subtitle, 240),
    featured: m.featured === true,
    featuredOrder: order,
    featuredImage: optUrl(m.featuredImage, 'Featured image'),
    featuredImageAlt: str(m.featuredImageAlt, 300),
    authorId: str(m.authorId, 80),
    author: str(m.author, 120),
    authorAvatar: optUrl(m.authorAvatar, 'Author avatar'),
    categories: ids(m.categories),
    tags: ids(m.tags),
    seo: {title: str(seo.title, 120), description: str(seo.description, 320), canonical: optUrl(seo.canonical, 'Canonical URL'), noindex: seo.noindex === true},
    og: {title: str(og.title, 120), description: str(og.description, 320), image: optUrl(og.image, 'Open Graph image')},
    internalNotes: str(m.internalNotes, 4000),
    /* Pinned posts lead the Journal list; the author bio shows under the article; the focus keyword drives the editor's SEO checks. */
    pinned: m.pinned === true,
    authorBio: str(m.authorBio, 600),
    focusKeyword: str(m.focusKeyword, 80),
    feedbackDisabled: m.feedbackDisabled === true,
  };
}

export function validSlug(slug: string): string | null {
  if (!slug) return 'Slug is required';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return 'Use lower-case letters, numbers and single hyphens (max 90 characters)';
  if (RESERVED.has(slug)) return '"' + slug + '" is reserved by the site. Choose another slug';
  return null;
}

/** HMAC preview tokens: short-lived, bound to one post id, useless for anything else. */
function previewSecret() { return (process.env.JWT_SECRET || '') + ':blog-preview'; }
export function previewToken(id: string, ttlMs = 60 * 60 * 1000, now = Date.now()) {
  const exp = now + ttlMs;
  const sig = createHmac('sha256', previewSecret()).update(id + '.' + exp).digest('base64url');
  return exp + '.' + sig;
}
export function previewTokenValid(id: string, token: string, now = Date.now()) {
  const [expRaw, sig] = String(token || '').split('.');
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp < now) return false;
  const want = createHmac('sha256', previewSecret()).update(id + '.' + exp).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

@ApiTags('Admin') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('admin/blog-studio')
export class BlogStudioController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(R2StorageService) private readonly storage: R2StorageService) {}

  private write(req: Actor) { if (req.user.role === 'VIEWER') throw new ForbiddenException(); }
  private audit(req: Actor, action: string, id: string) { return this.db.audit.create({data: {actorId: req.user.id, action, resource: 'blog', resourceId: id}}).catch(() => undefined); }
  private async row(id: string): Promise<Row> {
    const row = await this.db.content.findFirst({where: {id, kind: 'blog'}});
    if (!row) throw new NotFoundException('Post not found');
    return row as unknown as Row;
  }

  private view(row: Row, views = 0) {
    const m = row.metadata || {};
    const html = typeof row.content?.html === 'string' ? row.content.html : '';
    const seoIssues: string[] = [];
    const seoTitle = m.seo?.title || row.title;
    const desc = m.seo?.description || row.excerpt || '';
    if (seoTitle.length > 65) seoIssues.push('SEO title is longer than 65 characters');
    if (desc.length < 70) seoIssues.push('Meta description is shorter than 70 characters');
    if (desc.length > 170) seoIssues.push('Meta description is longer than 170 characters');
    if (!m.featuredImage) seoIssues.push('No featured image');
    else if (!m.featuredImageAlt) seoIssues.push('Featured image has no alt text');
    if (!/<h2[\s>]/i.test(html)) seoIssues.push('No H2 headings');
    return {
      id: row.id, title: row.title, slug: row.slug, path: m.path || pathFor(row.slug), status: row.status, state: blogState(row), excerpt: row.excerpt,
      content: row.content, metadata: m, publishAt: row.publishAt?.toISOString() ?? null, publishedAt: m.date || null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.content?.version === 2 ? 2 : 1,
      featured: m.featured === true, featuredOrder: m.featuredOrder ?? null, author: m.author || '', categories: m.categories || [], tags: m.tags || [],
      readingMinutes: m.readingMinutes || readingMinutes(html), seo: {ok: seoIssues.length === 0, issues: seoIssues}, views,
      pinned: m.pinned === true, feedback: {yes: Number(m.feedback?.yes) || 0, no: Number(m.feedback?.no) || 0},
    };
  }

  /** Every post as a spreadsheet (no article bodies). Declared before :id so "export" is not read as an id. */
  @Get('export')
  async exportCsv(@Res() res: any) {
    const rows = await this.db.content.findMany({where: {kind: 'blog'}, orderBy: {updatedAt: 'desc'}});
    const views = new Map((await this.db.contentView.findMany()).map(v => [v.contentId, v.views]));
    const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
    const head = ['Title', 'Slug', 'URL', 'State', 'Author', 'Categories', 'Tags', 'Featured', 'Pinned', 'Published', 'Scheduled for', 'Updated', 'Reading minutes', 'Views', 'Helpful yes', 'Helpful no', 'SEO title', 'Meta description', 'Focus keyword', 'Noindex'];
    const lines = rows.map(r => { const m = (r.metadata as any) || {}; return [r.title, r.slug, m.path || pathFor(r.slug), blogState(r as any), m.author || '', (m.categories || []).join(' '), (m.tags || []).join(' '), m.featured === true ? 'yes' : '', m.pinned === true ? 'yes' : '', m.date || '', r.publishAt && r.publishAt > new Date() ? r.publishAt.toISOString() : '', r.updatedAt.toISOString(), m.readingMinutes || '', views.get(r.id) ?? 0, Number(m.feedback?.yes) || 0, Number(m.feedback?.no) || 0, m.seo?.title || '', m.seo?.description || '', m.focusKeyword || '', m.seo?.noindex === true ? 'yes' : ''].map(cell).join(','); });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal-posts-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send('\uFEFF' + [head.join(','), ...lines].join('\r\n'));
  }

  /** Lists for the editor's selects: real staff authors, categories (by the id posts store), tags. */
  @Get('options')
  async options() {
    const [users, categories, tags] = await Promise.all([
      this.db.user.findMany({where: {active: true}, select: {id: true, name: true, email: true}, orderBy: {name: 'asc'}}),
      this.db.content.findMany({where: {kind: 'categories'}, select: {id: true, title: true, slug: true, metadata: true}, orderBy: {title: 'asc'}}),
      this.db.content.findMany({where: {kind: 'tags'}, select: {id: true, title: true, slug: true, metadata: true}, orderBy: {title: 'asc'}}),
    ]);
    const term = (c: {id: string; title: string; slug: string; metadata: any}) => ({id: String(c.metadata?.sourceId ?? c.metadata?.id ?? c.id), name: c.title, slug: c.slug, contentId: c.id});
    return {authors: users.map(u => ({id: u.id, name: u.name || u.email})), categories: categories.map(term), tags: tags.map(term), base: BLOG_BASE, siteUrl: process.env.SITE_URL || process.env.FRONTEND_URL?.split(',')[0] || ''};
  }

  @Get()
  async list(@Query() q: Record<string, string | undefined>) {
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1), limit = Math.min(100, Math.max(5, Math.trunc(Number(q.limit)) || 20));
    const now = new Date();
    const and: any[] = [{kind: 'blog'}];
    const search = str(q.q, 120);
    if (search) and.push({OR: [{title: {contains: search, mode: 'insensitive'}}, {slug: {contains: search, mode: 'insensitive'}}, {excerpt: {contains: search, mode: 'insensitive'}}]});
    if (q.state === 'draft') and.push({status: 'DRAFT'});
    else if (q.state === 'archived') and.push({status: 'ARCHIVED'});
    else if (q.state === 'scheduled') and.push({status: 'PUBLISHED', publishAt: {gt: now}});
    else if (q.state === 'published') and.push({status: 'PUBLISHED', OR: [{publishAt: null}, {publishAt: {lte: now}}]});
    if (q.featured === 'true') and.push({metadata: {path: ['featured'], equals: true}});
    if (q.category) and.push({OR: [{metadata: {path: ['categories'], array_contains: [String(q.category)]}}, ...(/^\d+$/.test(String(q.category)) ? [{metadata: {path: ['categories'], array_contains: [Number(q.category)]}}] : [])]});
    if (q.author) and.push({metadata: {path: ['authorId'], equals: String(q.author)}});
    const dir = q.dir === 'asc' ? 'asc' : 'desc';
    const orderBy = q.sort === 'title' ? [{title: dir}] : q.sort === 'created' ? [{createdAt: dir}] : q.sort === 'publish' ? [{publishAt: dir}, {createdAt: dir}] : [{updatedAt: dir}];
    const where = {AND: and};
    const [rows, total, counts] = await Promise.all([
      this.db.content.findMany({where, orderBy: orderBy as any, skip: (page - 1) * limit, take: limit}),
      this.db.content.count({where}),
      this.db.$queryRaw<Array<{state: string; n: bigint}>>`SELECT CASE WHEN status='ARCHIVED' THEN 'archived' WHEN status='DRAFT' THEN 'draft' WHEN "publishAt" > now() THEN 'scheduled' ELSE 'published' END AS state, count(*) n FROM "Content" WHERE kind='blog' GROUP BY 1`,
    ]);
    const views = await this.db.contentView.findMany({where: {contentId: {in: rows.map(r => r.id)}}});
    const byId = new Map(views.map(v => [v.contentId, v.views]));
    /* The list never ships full article bodies. */
    const items = rows.map(r => { const v = this.view(r as unknown as Row, byId.get(r.id) ?? 0); return {...v, content: undefined}; });
    return {items, total, page, limit, counts: Object.fromEntries(counts.map(c => [c.state, Number(c.n)]))};
  }

  @Get('slug-check')
  async slugCheck(@Query('slug') raw: string, @Query('id') id?: string) {
    const slug = slugify(raw || '');
    const problem = validSlug(slug);
    const taken = slug ? await this.db.content.findFirst({where: {kind: 'blog', slug, ...(id ? {id: {not: id}} : {})}, select: {id: true}}) : null;
    let suggestion = slug;
    for (let n = 2; taken && n < 50; n++) {
      const candidate = slug + '-' + n;
      if (!(await this.db.content.findFirst({where: {kind: 'blog', slug: candidate}, select: {id: true}}))) { suggestion = candidate; break; }
    }
    return {slug, path: pathFor(slug), available: !problem && !taken, problem: problem || (taken ? 'Another post already uses this slug' : null), suggestion};
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const row = await this.row(id);
    const v = await this.db.contentView.findUnique({where: {contentId: id}});
    const redirects = await this.db.contentRedirect.findMany({where: {contentId: id}, orderBy: {createdAt: 'desc'}});
    const autosave = await this.db.contentRevision.findFirst({where: {contentId: id, reason: 'autosave', createdAt: {gt: row.updatedAt}}, orderBy: {createdAt: 'desc'}});
    return {...this.view(row, v?.views ?? 0), redirects: redirects.map(r => r.fromPath), pendingAutosave: autosave ? {id: autosave.id, at: autosave.createdAt.toISOString()} : null};
  }

  @Post()
  async create(@Body() body: any, @Req() req: Actor) {
    this.write(req);
    const title = str(body?.title, 200) || 'Untitled post';
    let slug = slugify(body?.slug || title) || 'post';
    if (validSlug(slug)) slug = 'post-' + slug;
    for (let n = 2; await this.db.content.findFirst({where: {kind: 'blog', slug}, select: {id: true}}); n++) slug = slugify(body?.slug || title) + '-' + n;
    const meta = parseMeta(body?.meta);
    const html = sanitizeArticleHtml(body?.content?.html || '');
    const metadata = {...meta, path: pathFor(slug), type: 'post', readingMinutes: readingMinutes(html), modified: new Date().toISOString(), author: meta.author || req.user.name || ''};
    const row = await this.db.content.create({data: {kind: 'blog', title, slug, status: 'DRAFT', excerpt: str(body?.excerpt, 600) || null, content: {html, doc: body?.content?.doc ?? null, version: 2}, metadata, ...scheduleColumns(metadata)}});
    await this.revision(row as unknown as Row, 'create', req);
    await this.audit(req, 'CREATE', row.id);
    return this.view(row as unknown as Row);
  }

  /** Full save. The intent decides the publication state; expectedUpdatedAt prevents overwriting a newer edit. */
  @Put(':id')
  async save(@Param('id') id: string, @Body() body: any, @Req() req: Actor) {
    this.write(req);
    const current = await this.row(id);
    if (body?.expectedUpdatedAt && body.expectedUpdatedAt !== current.updatedAt.toISOString()) {
      throw new ConflictException({message: 'This post was changed by someone else (or in another tab) since you opened it. Reload to see their version, or save again to overwrite it.', currentUpdatedAt: current.updatedAt.toISOString(), code: 'EDIT_CONFLICT'});
    }
    const title = str(body?.title, 200);
    if (!title) bad('Title is required');
    const slug = slugify(body?.slug ?? current.slug);
    const slugProblem = validSlug(slug);
    if (slugProblem) bad(slugProblem);
    if (slug !== current.slug && await this.db.content.findFirst({where: {kind: 'blog', slug, id: {not: id}}, select: {id: true}})) throw new ConflictException('Another post already uses the slug "' + slug + '"');
    const intent: Intent = ['draft', 'publish', 'schedule', 'unpublish', 'archive', 'keep'].includes(body?.intent) ? body.intent : 'keep';
    const now = new Date();
    let publishAt: string | null = null;
    if (intent === 'schedule') {
      if (typeof body?.publishAt !== 'string' || !ISO_TZ.test(body.publishAt) || !Number.isFinite(Date.parse(body.publishAt))) bad('Choose a publication date and time');
      if (Date.parse(body.publishAt) <= now.getTime() + 30000) bad('The scheduled time must be in the future. Use Publish now instead');
      publishAt = new Date(body.publishAt).toISOString();
    }
    const html = sanitizeArticleHtml(typeof body?.content?.html === 'string' ? body.content.html : (current.content?.html || ''));
    const meta = parseMeta(body?.meta);
    const before = blogState(current, now);
    const status = intent === 'draft' || intent === 'unpublish' ? 'DRAFT' : intent === 'archive' ? 'ARCHIVED' : intent === 'publish' || intent === 'schedule' ? 'PUBLISHED' : current.status;
    const old = current.metadata || {};
    /* Existing posts keep their published URL pattern (imported posts live at the site root, e.g. /coworking-space-chicago/);
       only the last segment follows a slug change. New posts live under /blogs/. */
    const oldPath = old.path || pathFor(current.slug);
    const newPath = slug === current.slug ? oldPath : old.path ? old.path.replace(/[^/]+\/?$/, slug + '/') : pathFor(slug);
    const keepSchedule = intent === 'keep' && before === 'scheduled' ? old.publishAt : undefined;
    const firstPublish = status === 'PUBLISHED' && !old.date;
    const {publishAt: _drop, ...oldRest} = old;
    const metadata = safeMeta({
      ...oldRest,
      ...meta,
      path: newPath,
      type: 'post',
      readingMinutes: readingMinutes(html),
      modified: now.toISOString(),
      ...(publishAt ? {publishAt, date: publishAt} : keepSchedule ? {publishAt: keepSchedule} : {}),
      ...(firstPublish && !publishAt ? {date: now.toISOString()} : {}),
    });
    /* Plain-text fields from cleanContent are fine; the article HTML is stored with the article policy. */
    const excerpt = str(body?.excerpt, 600) || articleText(html).slice(0, 220) || null;

    const updated = await this.db.$transaction(async tx => {
      const row = await tx.content.update({where: {id}, data: {title, slug, status: status as any, excerpt, content: {html, doc: body?.content?.doc ?? current.content?.doc ?? null, version: 2}, metadata, ...scheduleColumns(metadata)}});
      /* A published URL that changes keeps working: old path answers with a permanent redirect. */
      if (oldPath !== newPath && old.date) {
        await tx.contentRedirect.upsert({where: {fromPath: oldPath}, create: {fromPath: oldPath, toPath: newPath, contentId: id}, update: {toPath: newPath, contentId: id}});
        await tx.contentRedirect.updateMany({where: {contentId: id, toPath: oldPath}, data: {toPath: newPath}});
      }
      await tx.contentRedirect.deleteMany({where: {fromPath: newPath}});
      return row;
    });
    await this.revision(updated as unknown as Row, intent === 'keep' ? 'save' : intent, req);
    clearPublicCache();
    const after = blogState(updated as unknown as Row);
    /* Search engines: a live post that changed (or went live, or moved, or was withdrawn) is announced through IndexNow. */
    if (after === 'published' || before === 'published') notifySeoChange([newPath, ...(oldPath !== newPath ? [oldPath] : [])], 'blog-' + (before === after ? 'update' : after));
    await this.audit(req, before === after ? 'UPDATE' : ({published: 'PUBLISH', scheduled: 'SCHEDULE', draft: before === 'scheduled' ? 'UNSCHEDULE' : 'UNPUBLISH', archived: 'ARCHIVE'} as const)[after], id);
    return this.view(updated as unknown as Row);
  }

  /** Drafts autosave in place. A live post autosaves to its history only, so readers never see half-finished edits. */
  @Post(':id/autosave') @HttpCode(200) @Throttle({default: {limit: 40, ttl: 60000}})
  async autosave(@Param('id') id: string, @Body() body: any, @Req() req: Actor) {
    this.write(req);
    const current = await this.row(id);
    if (body?.expectedUpdatedAt && body.expectedUpdatedAt !== current.updatedAt.toISOString()) throw new ConflictException({message: 'This post changed elsewhere. Autosave paused to avoid overwriting it.', code: 'EDIT_CONFLICT'});
    const html = sanitizeArticleHtml(body?.content?.html || '');
    const snapshot = {title: str(body?.title, 200) || current.title, slug: current.slug, status: current.status, excerpt: str(body?.excerpt, 600) || current.excerpt, content: {html, doc: body?.content?.doc ?? null, version: 2}, metadata: {...(current.metadata || {}), ...parseMeta(body?.meta)}};
    if (current.status === 'DRAFT') {
      const row = await this.db.content.update({where: {id}, data: {title: snapshot.title, excerpt: snapshot.excerpt, content: snapshot.content, metadata: safeMeta({...snapshot.metadata, readingMinutes: readingMinutes(html), modified: new Date().toISOString()})}});
      await this.coalesceAutosave(row as unknown as Row, req);
      return {saved: 'draft', updatedAt: row.updatedAt.toISOString()};
    }
    const recent = await this.db.contentRevision.findFirst({where: {contentId: id, reason: 'autosave', createdAt: {gt: new Date(Date.now() - 10 * 60000)}}, orderBy: {createdAt: 'desc'}});
    const data = {title: snapshot.title, slug: snapshot.slug, status: snapshot.status, excerpt: snapshot.excerpt, content: snapshot.content, metadata: safeMeta(snapshot.metadata), actorId: req.user.id, actorName: req.user.name || req.user.email};
    if (recent) await this.db.contentRevision.update({where: {id: recent.id}, data: {...data, createdAt: new Date()}});
    else await this.db.contentRevision.create({data: {...data, contentId: id, reason: 'autosave'}});
    return {saved: 'history', updatedAt: current.updatedAt.toISOString()};
  }

  private async coalesceAutosave(row: Row, req: Actor) {
    const recent = await this.db.contentRevision.findFirst({where: {contentId: row.id, reason: 'autosave', createdAt: {gt: new Date(Date.now() - 10 * 60000)}}, orderBy: {createdAt: 'desc'}});
    if (recent) await this.db.contentRevision.update({where: {id: recent.id}, data: {title: row.title, excerpt: row.excerpt, content: row.content, metadata: row.metadata, createdAt: new Date()}});
    else await this.revision(row, 'autosave', req);
  }

  private revision(row: Row, reason: string, req: Actor) {
    return this.db.contentRevision.create({data: {contentId: row.id, title: row.title, slug: row.slug, status: row.status, excerpt: row.excerpt, content: row.content ?? {}, metadata: row.metadata ?? {}, reason, actorId: req.user.id, actorName: req.user.name || req.user.email}});
  }

  @Get(':id/revisions')
  async revisions(@Param('id') id: string) {
    await this.row(id);
    const list = await this.db.contentRevision.findMany({where: {contentId: id}, orderBy: {createdAt: 'desc'}, take: 100, select: {id: true, title: true, status: true, reason: true, actorName: true, createdAt: true, content: true}});
    return list.map(r => ({id: r.id, title: r.title, status: r.status, reason: r.reason, actorName: r.actorName, createdAt: r.createdAt.toISOString(), words: articleText((r.content as any)?.html || '').split(' ').filter(Boolean).length}));
  }

  @Get(':id/revisions/:rid')
  async revision1(@Param('id') id: string, @Param('rid') rid: string) {
    const r = await this.db.contentRevision.findFirst({where: {id: rid, contentId: id}});
    if (!r) throw new NotFoundException('Revision not found');
    return {...r, createdAt: r.createdAt.toISOString()};
  }

  /** Restores title, excerpt, body and editorial metadata. Publication state and URL are left as they are. */
  @Post(':id/revisions/:rid/restore') @HttpCode(200)
  async restore(@Param('id') id: string, @Param('rid') rid: string, @Req() req: Actor) {
    this.write(req);
    const current = await this.row(id);
    const r = await this.db.contentRevision.findFirst({where: {id: rid, contentId: id}});
    if (!r) throw new NotFoundException('Revision not found');
    await this.revision(current, 'before-restore', req);
    const rm: any = r.metadata || {};
    const cm: any = current.metadata || {};
    const metadata = {...cm, ...parseMeta(rm), path: cm.path, publishAt: cm.publishAt, date: cm.date, modified: new Date().toISOString()};
    const html = sanitizeArticleHtml((r.content as any)?.html || '');
    const row = await this.db.content.update({where: {id}, data: {title: r.title, excerpt: r.excerpt, content: {html, doc: (r.content as any)?.doc ?? null, version: 2}, metadata: safeMeta({...metadata, readingMinutes: readingMinutes(html)}), ...scheduleColumns(metadata)}});
    await this.revision(row as unknown as Row, 'restore', req);
    clearPublicCache();
    await this.audit(req, 'RESTORE', id);
    return this.view(row as unknown as Row);
  }

  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string, @Req() req: Actor) {
    this.write(req);
    const src = await this.row(id);
    let slug = slugify(src.slug + '-copy');
    for (let n = 2; await this.db.content.findFirst({where: {kind: 'blog', slug}, select: {id: true}}); n++) slug = slugify(src.slug + '-copy-' + n);
    const {date: _d, publishAt: _p, sourceId: _s, sourceUrl: _u, aliases: _a, canonicalUrl: _c, originalSlug: _o, ...meta} = src.metadata || {};
    const metadata = {...meta, path: pathFor(slug), featured: false, modified: new Date().toISOString()};
    const row = await this.db.content.create({data: {kind: 'blog', title: src.title + ' (copy)', slug, status: 'DRAFT', excerpt: src.excerpt, content: src.content ?? {}, metadata, ...scheduleColumns(metadata)}});
    await this.revision(row as unknown as Row, 'duplicate', req);
    await this.audit(req, 'DUPLICATE', row.id);
    return this.view(row as unknown as Row);
  }

  @Post('bulk') @HttpCode(200)
  async bulk(@Body() body: any, @Req() req: Actor) {
    this.write(req);
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [];
    const action = String(body?.action || '');
    if (!ids.length) bad('Select at least one post');
    if (!['publish', 'unpublish', 'archive', 'delete', 'feature', 'unfeature'].includes(action)) bad('Unknown bulk action');
    if (action === 'delete' && req.user.role !== 'ADMIN') throw new ForbiddenException('Only admins can delete posts');
    let changed = 0;
    for (const id of ids) {
      const row = await this.db.content.findFirst({where: {id, kind: 'blog'}}) as unknown as Row | null;
      if (!row) continue;
      const m = row.metadata || {};
      if (action === 'delete') {
        await this.db.$transaction([this.db.contentRevision.deleteMany({where: {contentId: id}}), this.db.contentRedirect.deleteMany({where: {contentId: id}}), this.db.contentView.deleteMany({where: {contentId: id}}), this.db.content.delete({where: {id}})]);
      } else if (action === 'feature' || action === 'unfeature') {
        await this.db.content.update({where: {id}, data: {metadata: {...m, featured: action === 'feature'}}});
      } else {
        const status = action === 'publish' ? 'PUBLISHED' : action === 'archive' ? 'ARCHIVED' : 'DRAFT';
        const {publishAt: _p, ...rest} = m;
        const metadata = action === 'publish' ? {...rest, date: m.date || new Date().toISOString()} : rest;
        const updated = await this.db.content.update({where: {id}, data: {status: status as any, metadata, ...scheduleColumns(metadata)}});
        await this.revision(updated as unknown as Row, action, req);
      }
      await this.audit(req, 'BULK_' + action.toUpperCase(), id);
      changed++;
    }
    clearPublicCache();
    return {changed};
  }

  @Delete(':id') @Roles('ADMIN')
  async remove(@Param('id') id: string, @Req() req: Actor) {
    await this.row(id);
    await this.db.$transaction([this.db.contentRevision.deleteMany({where: {contentId: id}}), this.db.contentRedirect.deleteMany({where: {contentId: id}}), this.db.contentView.deleteMany({where: {contentId: id}}), this.db.content.delete({where: {id}})]);
    clearPublicCache();
    await this.audit(req, 'DELETE', id);
    return {deleted: true};
  }

  /** Signed, one-hour preview link for a draft or scheduled post. */
  @Post(':id/preview-link') @HttpCode(200)
  async previewLink(@Param('id') id: string) {
    const row = await this.row(id);
    return {url: '/journal-preview/?id=' + encodeURIComponent(row.id) + '&token=' + encodeURIComponent(previewToken(row.id)), expiresInMinutes: 60};
  }

  /** Images and videos for articles, stored in Cloudflare R2. Several files per request. */
  @Post('media') @Roles('ADMIN', 'EDITOR') @Throttle({default: {limit: 60, ttl: 60000}})
  @UseInterceptors(FilesInterceptor('files', 20, {limits: {fileSize: 100 * 1024 * 1024, files: 20}}))
  async media(@UploadedFiles() files: Express.Multer.File[], @Body() body: any, @Req() req: Actor) {
    if (!files?.length) bad('Choose at least one file');
    const results: any[] = [];
    for (const file of files) {
      try { results.push({ok: true, item: await this.store(file.buffer, file.originalname, file.mimetype, String(body?.alt || ''), req)}); }
      catch (e: any) { results.push({ok: false, name: path.basename(file.originalname).slice(0, 120), error: e?.response?.message || e?.message || 'Upload failed'}); }
    }
    return {results};
  }

  async store(buffer: Buffer, originalName: string, declared: string, alt: string, req: Actor) {
    const mime = detectMimeType(buffer);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm'];
    if (!mime || !allowed.includes(mime)) bad('Only JPEG, PNG, WebP, GIF, AVIF, MP4 and WebM files can be added to articles');
    const video = mime!.startsWith('video/');
    if (!video && buffer.length > 15 * 1024 * 1024) bad('Images must be 15 MB or smaller');
    if (!this.storage.isConfigured()) throw new BadRequestException('Media storage (Cloudflare R2) is not configured');
    const stored = await this.storage.uploadFile({category: video ? 'videos' : 'blogs', buffer, originalName, contentType: mime!});
    const item = await this.db.media.create({data: {filename: stored.key, originalName: path.basename(originalName).slice(0, 255), mimeType: mime!, size: buffer.length, alt: alt.slice(0, 300), url: stored.url}});
    await this.db.audit.create({data: {actorId: req.user.id, action: 'CREATE', resource: 'media', resourceId: item.id}}).catch(() => undefined);
    return item;
  }

  /** Word (.docx) import: headings, lists, tables, links, bold/italic and embedded images (uploaded to R2). */
  @Post('import/docx') @Roles('ADMIN', 'EDITOR') @Throttle({default: {limit: 10, ttl: 60000}})
  @UseInterceptors(FileInterceptor('file', {limits: {fileSize: 40 * 1024 * 1024, files: 1}}))
  async importDocx(@UploadedFile() file: Express.Multer.File, @Req() req: Actor) {
    if (!file) bad('Choose a .docx file');
    const b = file.buffer;
    if (!(b.length > 4 && b[0] === 0x50 && b[1] === 0x4b) || !/\.docx$/i.test(file.originalname)) bad('Only Word .docx files can be imported (save .doc files as .docx first)');
    const mod: any = await import('mammoth');
    const mammoth = mod.default ?? mod;
    let images = 0, imageFailures = 0;
    const result = await mammoth.convertToHtml({buffer: b}, {
      styleMap: ['p[style-name=\'Title\'] => h1:fresh', 'p[style-name=\'Subtitle\'] => p.lead:fresh', 'p[style-name=\'Quote\'] => blockquote:fresh', 'p[style-name=\'Intense Quote\'] => blockquote:fresh', 'r[style-name=\'Strong\'] => strong', 'p[style-name=\'Caption\'] => p.caption:fresh'],
      convertImage: mammoth.images.imgElement(async (image: any) => {
        try {
          const data = Buffer.from(await image.read('base64'), 'base64');
          const item = await this.store(data, 'word-image.' + String(image.contentType || 'image/png').split('/')[1], image.contentType || 'image/png', '', req);
          images++;
          return {src: item.url, alt: image.altText || ''};
        } catch { imageFailures++; return {src: '', alt: image.altText || ''}; }
      }),
    } as any);
    const html = sanitizeArticleHtml(result.value.replace(/<img src=""[^>]*>/g, ''));
    /* Look inside the document for objects mammoth cannot convert (pictures are fine). */
    let complex = '';
    try {
      const zipMod: any = await import('jszip');
      const zip = await (zipMod.default ?? zipMod).loadAsync(b);
      const xml: string = (await zip.file('word/document.xml')?.async('string')) || '';
      const found = [/<dgm:|drawingml\/2006\/diagram/.test(xml) && 'SmartArt', /drawingml\/2006\/chart|<c:chart\b/.test(xml) && 'charts', /<wps:wsp\b|<v:shape\b(?![^>]*o:ole)/.test(xml) && 'shapes or text boxes', Object.keys(zip.files).some((n: string) => /\.(emf|wmf)$/i.test(n)) && 'EMF/WMF pictures'].filter(Boolean);
      complex = found.join(', ');
    } catch { /* report what mammoth reported */ }
    /* Style warnings are folded into one readable note; anything else is passed through. */
    const raw = [...new Set((result.messages || []).map((m: any) => String(m.message || '')).filter(Boolean))] as string[];
    const styles = [...new Set(raw.map(m => /style (?:with ID |name )?'?([\w -]+?)'?(?: was| \(|$)/i.exec(m)?.[1] || (/Unrecognised paragraph style: '([^']+)'/i.exec(m)?.[1])).filter((s): s is string => !!s && s !== 'null'))];
    const warnings = [...(styles.length ? ['Some Word styles were not recognized and came in as normal text: ' + styles.slice(0, 8).join(', ') + '. Re-apply headings or lists in the editor if needed.'] : []), ...raw.filter(m => !/style/i.test(m)).slice(0, 10)];
    const notes = [
      'Text colors, highlights, font sizes and cell shading are not carried by .docx import. To keep them, copy from Word and paste instead.',
      ...(images ? [images + ' image(s) were uploaded to the media library.'] : []),
      ...(imageFailures ? [imageFailures + ' image(s) could not be imported (unsupported format such as EMF/WMF). Export them from Word as PNG and add them manually.'] : []),
      ...(complex ? ['The document contains ' + complex + '. These cannot be converted to editable blocks; take a screenshot and insert it as an image, or rebuild them with the Chart or Diagram block.'] : []),
    ];
    return {html, title: /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() || path.basename(file.originalname, '.docx'), warnings, notes};
  }
}

/** Public helpers for the Journal: popular posts, old-URL redirects, preview and view counting. */
@ApiTags('Public') @Controller('public')
export class PublicJournalController {
  private static seen = new Map<string, number>();
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get('blog-popular') @Throttle({default: {limit: 120, ttl: 60000}})
  async popular(@Query('limit') limitRaw?: string) {
    const limit = Math.min(10, Math.max(1, Math.trunc(Number(limitRaw)) || 5));
    const rows = await this.db.$queryRaw<Array<{slug: string; title: string; path: string | null; views: number}>>`
      SELECT c.slug, c.title, c.metadata->>'path' AS path, v.views FROM "ContentView" v JOIN "Content" c ON c.id = v."contentId"
      WHERE c.kind = 'blog' AND c.status = 'PUBLISHED' AND c.enabled AND (c."publishAt" IS NULL OR c."publishAt" <= now()) AND v.views > 0
      ORDER BY v.views DESC, c."updatedAt" DESC LIMIT ${limit}`;
    return {items: rows.map(r => ({slug: r.slug, title: r.title, path: r.path || pathFor(r.slug), views: r.views}))};
  }

  @Get('blog-redirects/resolve') @Throttle({default: {limit: 240, ttl: 60000}})
  async resolve(@Query('path') raw: string) {
    const p = '/' + String(raw || '').split('?')[0].replace(/^\/+|\/+$/g, '') + '/';
    const hit = await this.db.contentRedirect.findUnique({where: {fromPath: p}});
    if (!hit) throw new NotFoundException();
    return {to: hit.toPath};
  }

  @Post('blog/:slug/view') @HttpCode(204) @Throttle({default: {limit: 30, ttl: 60000}})
  async view(@Param('slug') slug: string, @Req() req: any) {
    /* One count per visitor IP and post per 30 minutes; the IP is kept only in memory. */
    const key = String(req.ip || '') + '|' + slug, now = Date.now();
    if ((PublicJournalController.seen.get(key) ?? 0) > now) return;
    PublicJournalController.seen.set(key, now + 30 * 60000);
    if (PublicJournalController.seen.size > 50000) PublicJournalController.seen.clear();
    const post = await this.db.content.findFirst({where: {kind: 'blog', slug: String(slug).slice(0, 120), status: 'PUBLISHED', enabled: true, OR: [{publishAt: null}, {publishAt: {lte: new Date()}}]}, select: {id: true}});
    if (!post) return;
    await this.db.contentView.upsert({where: {contentId: post.id}, create: {contentId: post.id, views: 1}, update: {views: {increment: 1}}});
  }

  /** "Was this article helpful?" One vote per visitor IP and post per day (IP kept in memory only); counts live on the post. */
  private static voted = new Map<string, number>();
  @Post('blog/:slug/feedback') @HttpCode(200) @Throttle({default: {limit: 10, ttl: 60000}})
  async feedback(@Param('slug') slug: string, @Body() body: any, @Req() req: any) {
    if (typeof body?.helpful !== 'boolean') bad('helpful must be true or false');
    const key = String(req.ip || '') + '|' + slug, now = Date.now();
    if ((PublicJournalController.voted.get(key) ?? 0) > now) return {ok: true, counted: false};
    const post = await this.db.content.findFirst({where: {kind: 'blog', slug: String(slug).slice(0, 120), status: 'PUBLISHED', enabled: true, OR: [{publishAt: null}, {publishAt: {lte: new Date()}}]}, select: {id: true, metadata: true}});
    if (!post || (post.metadata as any)?.feedbackDisabled === true) throw new NotFoundException();
    PublicJournalController.voted.set(key, now + 86400000);
    if (PublicJournalController.voted.size > 50000) PublicJournalController.voted.clear();
    const field = body.helpful ? 'yes' : 'no';
    /* Atomic increment inside the JSON, so concurrent votes never overwrite each other. */
    await this.db.$executeRaw`UPDATE "Content" SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), ARRAY['feedback', ${field}]::text[], to_jsonb(COALESCE((metadata->'feedback'->>${field})::int, 0) + 1), true) WHERE id = ${post.id} AND jsonb_typeof(COALESCE(metadata->'feedback', '{}'::jsonb)) = 'object'`;
    await this.db.$executeRaw`UPDATE "Content" SET metadata = jsonb_set(metadata, '{feedback}', jsonb_build_object(${field}::text, 1), true) WHERE id = ${post.id} AND (metadata->'feedback') IS NULL`;
    return {ok: true, counted: true};
  }

  /** Draft/scheduled post for a signed preview link only. Never cached. */
  @Get('blog-preview/:id') @Throttle({default: {limit: 60, ttl: 60000}})
  async preview(@Param('id') id: string, @Query('token') token: string) {
    if (!previewTokenValid(id, token)) throw new NotFoundException();
    const row = await this.db.content.findFirst({where: {id, kind: 'blog'}});
    if (!row) throw new NotFoundException();
    const {internalNotes: _n, ...metadata} = (row.metadata as any) || {};
    return {id: row.id, title: row.title, slug: row.slug, excerpt: row.excerpt, content: row.content, metadata, state: blogState(row as any)};
  }
}

export const _test = {randomUUID};
