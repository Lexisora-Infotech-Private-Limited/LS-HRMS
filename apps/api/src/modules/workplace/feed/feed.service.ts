import { Injectable, Logger } from '@nestjs/common';
import type { Post, Prisma } from '@prisma/client';
import {
  FEED_KIND_LABEL,
  initialsOf,
  type FeedComment,
  type FeedDraftRow,
  type FeedListResponse,
  type FeedPostView,
  type FeedSidebar,
  type PostUpsertInput,
} from '@lexisora/shared';
import { z } from 'zod';
import { feedListQuery } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../../core/http/errors';
import { AudienceService } from '../common/audience';
import { excerptOf, htmlToText, imageFileIds, sanitizeHtml } from '../common/html';
import { addDaysKey, istInstant, monthLabel, todayKey } from '../common/dates';
import { ALERT_BATCH_MS, canEditPost, MAX_PINNED, postMeta, resolveMentions, threadParent } from './feed.rules';
import { shortName } from '../kudos/kudos.rules';

type ListQuery = z.infer<typeof feedListQuery>;
type Viewer = { me: string | null; publisher: boolean; userId: string | null };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Company feed (spec §3): HR/Admin (`feed.publish`) write Blog / Milestone / Update posts in a
 * small rich-text composer (sanitised server-side), save drafts and publish; everyone with
 * `feed.view` likes and comments (one level of replies, @mentions). EOTM and KUDOS posts are
 * created by the system (§4). Pinned posts first (max 3), then newest.
 */
@Injectable()
export class FeedService {
  private readonly log = new Logger('Feed');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private viewer(): Viewer {
    const ctx = requireContext();
    return { me: ctx.employeeId ?? null, publisher: hasPerm(ctx, 'feed.publish'), userId: ctx.userId ?? null };
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async list(q: ListQuery): Promise<FeedListResponse> {
    const v = this.viewer();
    const where: Prisma.PostWhereInput = { status: 'PUBLISHED', deletedAt: null, ...(q.kind ? { kind: q.kind } : {}) };
    const [rows, total, drafts] = await Promise.all([
      this.prisma.post.findMany({ where, orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.post.count({ where }),
      v.publisher && v.me ? this.prisma.post.count({ where: { status: 'DRAFT', deletedAt: null, authorEmployeeId: v.me } }) : Promise.resolve(0),
    ]);
    return { items: await this.views(rows, v), total, page: q.page, pageSize: q.pageSize, canPublish: v.publisher, drafts };
  }

  async get(id: string): Promise<FeedPostView> {
    const v = this.viewer();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Post');
    const mineDraft = p.status === 'DRAFT' && !!v.me && p.authorEmployeeId === v.me;
    if (p.status !== 'PUBLISHED' && !mineDraft && !(v.publisher && p.status === 'ARCHIVED')) throw notFound('Post');
    return (await this.views([p], v))[0]!;
  }

  async drafts(): Promise<FeedDraftRow[]> {
    const v = this.viewer();
    if (!v.me) return [];
    const rows = await this.prisma.post.findMany({ where: { status: 'DRAFT', deletedAt: null, authorEmployeeId: v.me }, orderBy: { updatedAt: 'desc' }, take: 20 });
    return rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind, updatedAt: r.updatedAt.toISOString(), excerpt: r.excerpt }));
  }

  private async views(rows: Post[], v: Viewer): Promise<FeedPostView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [authors, liked, awards, kudos] = await Promise.all([
      this.audience.briefs(rows.map((r) => r.authorEmployeeId)),
      v.me ? this.prisma.postLike.findMany({ where: { postId: { in: ids }, employeeId: v.me }, select: { postId: true } }) : Promise.resolve([] as { postId: string }[]),
      this.prisma.eotmAward.findMany({ where: { id: { in: rows.map((r) => r.eotmAwardId).filter((x): x is string => !!x) } } }),
      this.prisma.kudos.findMany({ where: { id: { in: rows.map((r) => r.kudosId).filter((x): x is string => !!x) } }, include: { badge: true } }),
    ]);
    const recipients = await this.audience.briefs(kudos.map((k) => k.recipientEmployeeId));
    const likedSet = new Set(liked.map((l) => l.postId));
    return rows.map((p) => {
      const a = authors.get(p.authorEmployeeId);
      const award = p.eotmAwardId ? awards.find((x) => x.id === p.eotmAwardId) : undefined;
      const k = p.kudosId ? kudos.find((x) => x.id === p.kudosId) : undefined;
      const isMine = !!v.me && p.authorEmployeeId === v.me;
      return {
        id: p.id,
        kind: p.kind,
        kindLabel: FEED_KIND_LABEL[p.kind],
        status: p.status,
        title: p.title,
        bodyHtml: p.bodyHtml,
        excerpt: p.excerpt,
        coverFileId: p.coverFileId,
        author: { employeeId: p.authorEmployeeId, name: a?.name ?? 'Former employee', initials: a?.initials ?? '—', meta: postMeta(a?.designation ?? null, p.publishedAt, !a || a.status === 'EXITED') },
        publishedAt: iso(p.publishedAt),
        editedAt: iso(p.editedAt),
        pinned: p.pinned,
        likeCount: p.likeCount,
        liked: likedSet.has(p.id),
        commentCount: p.commentCount,
        certificateId: award && !award.revokedAt ? award.certificateId : null,
        canModerate: v.publisher,
        canEdit: canEditPost(p, v.me, v.publisher),
        canComment: p.status === 'PUBLISHED',
        isMine,
        kudos: k ? { badge: k.badge.name, recipient: recipients.get(k.recipientEmployeeId)?.name ?? '—', recipientEmployeeId: k.recipientEmployeeId } : null,
      };
    });
  }

  // ── Write (feed.publish) ─────────────────────────────────────────────────

  private clean(dto: Pick<PostUpsertInput, 'bodyHtml' | 'title'>, publishing: boolean) {
    const bodyHtml = sanitizeHtml(dto.bodyHtml ?? '');
    if (publishing && htmlToText(bodyHtml).length < 3 && !imageFileIds(bodyHtml).length) throw badRequest('Write something before publishing', 'FEED_EMPTY');
    return { bodyHtml, excerpt: excerptOf(bodyHtml, 300) };
  }

  private async checkImages(bodyHtml: string, coverFileId: string | null | undefined) {
    const ids = [...new Set([...imageFileIds(bodyHtml), ...(coverFileId ? [coverFileId] : [])])];
    if (!ids.length) return;
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: ids } }, select: { id: true, mime: true, size: true } });
    if (files.length !== ids.length) throw badRequest('One of the images could not be found — upload it again', 'FEED_IMAGE');
    for (const f of files) {
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.mime)) throw badRequest('Images must be PNG, JPG or WebP', 'FEED_IMAGE_TYPE');
      if (f.size > 5 * 1024 * 1024) throw badRequest('Images can be up to 5 MB', 'FEED_IMAGE_SIZE');
    }
  }

  async create(dto: PostUpsertInput): Promise<FeedPostView> {
    const v = this.viewer();
    if (!v.publisher || !v.me) throw forbidden('Only HR and Admin can post on the company feed');
    const publishing = dto.action !== 'draft';
    const body = this.clean(dto, publishing);
    await this.checkImages(body.bodyHtml, dto.coverFileId);
    const now = new Date();
    const p = await this.prisma.post.create({
      data: {
        kind: dto.kind,
        status: publishing ? 'PUBLISHED' : 'DRAFT',
        title: dto.title,
        ...body,
        coverFileId: dto.coverFileId ?? null,
        authorEmployeeId: v.me,
        publishedAt: publishing ? now : null,
        publishedByEmployeeId: publishing ? v.me : null,
      } as Prisma.PostUncheckedCreateInput,
    });
    if (publishing) await this.afterPublish(p);
    return this.get(p.id);
  }

  async update(id: string, dto: PostUpsertInput): Promise<FeedPostView> {
    const v = this.viewer();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Post');
    if (!canEditPost(p, v.me, v.publisher)) throw forbidden('You cannot edit this post');
    const publishing = p.status === 'PUBLISHED' || dto.action !== 'draft';
    const body = this.clean(dto, publishing);
    await this.checkImages(body.bodyHtml, dto.coverFileId);
    const now = new Date();
    const goingLive = p.status === 'DRAFT' && dto.action !== 'draft';
    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title,
        kind: dto.kind,
        ...body,
        coverFileId: dto.coverFileId ?? null,
        ...(p.status === 'PUBLISHED' ? { editedAt: now } : {}),
        ...(goingLive ? { status: 'PUBLISHED', publishedAt: now, publishedByEmployeeId: v.me } : {}),
      },
    });
    if (goingLive) await this.afterPublish(updated);
    else if (p.status === 'PUBLISHED') await this.audit.record({ action: 'feed.post.edit', entity: 'Post', entityId: id, meta: { title: dto.title } });
    return this.get(id);
  }

  async publish(id: string): Promise<FeedPostView> {
    const v = this.viewer();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Post');
    if (p.status === 'PUBLISHED') return this.get(id);
    if (p.status !== 'DRAFT' && p.status !== 'PENDING_REVIEW') throw conflict('Archived posts cannot be published again', 'FEED_ARCHIVED');
    if (!v.publisher) throw forbidden();
    this.clean(p, true);
    const updated = await this.prisma.post.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByEmployeeId: v.me } });
    await this.afterPublish(updated);
    return this.get(id);
  }

  /** In-app alert (batched: one per 15 minutes), realtime feed:new, audit. */
  async afterPublish(p: Post, opts: { notify?: boolean } = {}) {
    await this.audit.record({ action: 'feed.post.publish', entity: 'Post', entityId: p.id, meta: { kind: p.kind, title: p.title } });
    this.realtime.toTenant(currentTenantId(), 'feed:new', { postId: p.id });
    this.events.emit('feed.postPublished', { postId: p.id, kind: p.kind });
    if (opts.notify === false || p.kind === 'KUDOS' || p.kind === 'EOTM') return;
    const recent = await this.prisma.post.count({ where: { id: { not: p.id }, status: 'PUBLISHED', kind: { in: ['BLOG', 'MILESTONE', 'UPDATE'] }, publishedAt: { gte: new Date(Date.now() - ALERT_BATCH_MS) } } });
    if (recent) return; // an alert for the feed went out in the last 15 minutes
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE', employee: { isNot: null } }, select: { id: true } }).catch(() => [] as { id: string }[]);
    const author = (await this.audience.briefs([p.authorEmployeeId])).get(p.authorEmployeeId);
    const ids = users.map((u) => u.id).filter((id) => id !== author?.userId);
    await this.notifications.notify({ userIds: ids, type: 'feed.post.published', title: `${author?.name ?? 'HR'} posted: ${p.title}`, body: p.excerpt.slice(0, 160), link: `/feed?post=${p.id}`, from: author?.name ?? 'Company feed' });
  }

  async archive(id: string) {
    const v = this.viewer();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Post');
    if (!v.publisher) throw forbidden();
    await this.prisma.post.update({ where: { id }, data: { status: 'ARCHIVED', pinned: false } });
    await this.audit.record({ action: 'feed.post.archive', entity: 'Post', entityId: id, meta: { title: p.title } });
    this.realtime.toTenant(currentTenantId(), 'feed:new', { postId: id });
    return { ok: true as const };
  }

  async removeDraft(id: string) {
    const v = this.viewer();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Post');
    if (p.status !== 'DRAFT' || p.authorEmployeeId !== v.me) throw forbidden('Only your own drafts can be deleted');
    await this.prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true as const };
  }

  async setPinned(id: string, pinned: boolean) {
    const v = this.viewer();
    if (!v.publisher) throw forbidden();
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null, status: 'PUBLISHED' } });
    if (!p) throw notFound('Post');
    if (pinned && !p.pinned) {
      const n = await this.prisma.post.count({ where: { pinned: true, status: 'PUBLISHED', deletedAt: null } });
      if (n >= MAX_PINNED) throw conflict(`Up to ${MAX_PINNED} posts can be pinned — unpin one first`, 'FEED_PIN_LIMIT');
    }
    await this.prisma.post.update({ where: { id }, data: { pinned } });
    await this.audit.record({ action: 'feed.post.pin', entity: 'Post', entityId: id, meta: { pinned } });
    this.realtime.toTenant(currentTenantId(), 'feed:new', { postId: id });
    return { ok: true as const, pinned };
  }

  // ── Likes ────────────────────────────────────────────────────────────────

  async like(id: string, on: boolean): Promise<{ liked: boolean; likeCount: number }> {
    const v = this.viewer();
    if (!v.me) throw forbidden('Only employees can like posts');
    const me = v.me;
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null, status: 'PUBLISHED' }, select: { id: true } });
    if (!p) throw notFound('Post');
    const tenantId = currentTenantId();
    const likeCount = await this.prisma.$transaction(async (tx) => {
      if (on) {
        const r = await tx.postLike.createMany({ data: [{ tenantId, postId: id, employeeId: me }], skipDuplicates: true });
        if (r.count) return (await tx.post.update({ where: { id }, data: { likeCount: { increment: 1 } }, select: { likeCount: true } })).likeCount;
      } else {
        const r = await tx.postLike.deleteMany({ where: { postId: id, employeeId: me } });
        if (r.count) return (await tx.post.update({ where: { id }, data: { likeCount: { decrement: 1 } }, select: { likeCount: true } })).likeCount;
      }
      return (await tx.post.findUniqueOrThrow({ where: { id }, select: { likeCount: true } })).likeCount;
    });
    this.realtime.toTenant(tenantId, 'feed:like', { postId: id, likeCount });
    return { liked: on, likeCount: Math.max(0, likeCount) };
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  async comments(id: string): Promise<FeedComment[]> {
    const v = this.viewer();
    await this.get(id);
    const rows = await this.prisma.postComment.findMany({ where: { postId: id }, orderBy: { createdAt: 'asc' }, take: 500 });
    const people = await this.audience.briefs(rows.map((r) => r.authorEmployeeId));
    // Deleted comments stay as a placeholder only when they have replies.
    const hasReplies = new Set(rows.filter((r) => r.parentId && !r.deletedAt).map((r) => r.parentId!));
    return rows
      .filter((r) => !r.deletedAt || hasReplies.has(r.id))
      .map((r) => {
        const a = people.get(r.authorEmployeeId);
        return {
          id: r.id,
          parentId: r.parentId,
          body: r.deletedAt ? 'Comment deleted' : r.body,
          authorName: a?.name ?? 'Former employee',
          initials: a?.initials ?? initialsOf(a?.name ?? '?'),
          createdAt: r.createdAt.toISOString(),
          canDelete: !r.deletedAt && (v.publisher || (!!v.me && r.authorEmployeeId === v.me)),
          deleted: !!r.deletedAt,
        };
      });
  }

  async addComment(id: string, body: string, parentId: string | null | undefined): Promise<FeedComment[]> {
    const v = this.viewer();
    if (!v.me) throw forbidden('Only employees can comment');
    const p = await this.prisma.post.findFirst({ where: { id, deletedAt: null } });
    if (!p || (p.status !== 'PUBLISHED' && p.status !== 'ARCHIVED')) throw notFound('Post');
    if (p.status === 'ARCHIVED') throw conflict('This post is archived — comments are closed', 'FEED_ARCHIVED');
    const parent = parentId ? await this.prisma.postComment.findFirst({ where: { id: parentId, postId: id } }) : null;
    if (parentId && !parent) throw badRequest('The comment you replied to was removed', 'FEED_PARENT');
    const people = await this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } }, select: { id: true, fullName: true, firstName: true } });
    const mentions = resolveMentions(body, people).filter((x) => x !== v.me);
    const tenantId = currentTenantId();
    const me = v.me;
    const commentCount = await this.prisma.$transaction(async (tx) => {
      await tx.postComment.create({ data: { tenantId, postId: id, authorEmployeeId: me, parentId: threadParent(parent), body, mentions } });
      return (await tx.post.update({ where: { id }, data: { commentCount: { increment: 1 } }, select: { commentCount: true } })).commentCount;
    });
    this.realtime.toTenant(tenantId, 'feed:comment', { postId: id, commentCount });
    const author = (await this.audience.briefs([me])).get(me);
    if (mentions.length) {
      await this.notifications.notify({ userIds: await this.audience.userIds(mentions), type: 'feed.comment.mention', title: `${author?.name ?? 'Someone'} mentioned you on “${p.title}”`, body: body.slice(0, 160), link: `/feed?post=${id}`, from: author?.name ?? 'Company feed' });
    }
    const notifyAuthor = p.authorEmployeeId !== me && !mentions.includes(p.authorEmployeeId);
    const notifyParent = parent && parent.authorEmployeeId !== me && parent.authorEmployeeId !== p.authorEmployeeId && !mentions.includes(parent.authorEmployeeId) ? parent.authorEmployeeId : null;
    const targets = [notifyAuthor ? p.authorEmployeeId : null, notifyParent].filter((x): x is string => !!x);
    if (targets.length) {
      await this.notifications.notify({ userIds: await this.audience.userIds(targets), type: 'feed.comment.onMyPost', title: `${author?.name ?? 'Someone'} commented on “${p.title}”`, body: body.slice(0, 160), link: `/feed?post=${id}`, from: author?.name ?? 'Company feed' });
    }
    return this.comments(id);
  }

  async deleteComment(commentId: string): Promise<{ ok: true; commentCount: number }> {
    const v = this.viewer();
    const c = await this.prisma.postComment.findFirst({ where: { id: commentId, deletedAt: null } });
    if (!c) throw notFound('Comment');
    const mine = !!v.me && c.authorEmployeeId === v.me;
    if (!mine && !v.publisher) throw forbidden('Only the author or HR can delete this comment');
    const commentCount = await this.prisma.$transaction(async (tx) => {
      await tx.postComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
      return (await tx.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } }, select: { commentCount: true } })).commentCount;
    });
    if (!mine) await this.audit.record({ action: 'feed.comment.delete', entity: 'PostComment', entityId: commentId, meta: { postId: c.postId } });
    this.realtime.toTenant(currentTenantId(), 'feed:comment', { postId: c.postId, commentCount });
    return { ok: true, commentCount: Math.max(0, commentCount) };
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────

  async sidebar(): Promise<FeedSidebar> {
    const today = todayKey();
    const month = today.slice(0, 7);
    const awards = await this.prisma.eotmAward.findMany({ where: { revokedAt: null, month: { lte: month } }, orderBy: { month: 'desc' }, take: 1 });
    const award = awards[0] ?? null;
    const since = istInstant(addDaysKey(today, -7), '00:00');
    const kudos = await this.prisma.kudos.findMany({ where: { revokedAt: null, createdAt: { gte: since }, badge: { system: false } }, include: { badge: true }, orderBy: { createdAt: 'desc' }, take: 5 });
    const people = await this.audience.briefs([award?.employeeId, ...kudos.map((k) => k.recipientEmployeeId)]);
    return {
      eotm: award ? { month: monthLabel(award.month), name: people.get(award.employeeId)?.name ?? '—', citation: award.citation, certificateId: award.certificateId } : null,
      kudosThisWeek: kudos.map((k) => ({ id: k.id, text: `${k.badge.name} → ${shortName(people.get(k.recipientEmployeeId)?.name ?? '—')}` })),
    };
  }

  // ── Registry hooks ───────────────────────────────────────────────────────

  /** Images and covers of published posts are visible to everyone in the tenant. */
  async canOpenFile(fileId: string): Promise<boolean> {
    const ctx = requireContext();
    if (!hasPerm(ctx, 'feed.view')) return false;
    const n = await this.prisma.post.count({ where: { deletedAt: null, OR: [{ status: 'PUBLISHED' }, { authorEmployeeId: ctx.employeeId ?? '__none__' }], AND: [{ OR: [{ coverFileId: fileId }, { bodyHtml: { contains: `/files/${fileId}` } }] }] } });
    return n > 0;
  }

  async search(q: string) {
    const rows = await this.prisma.post.findMany({ where: { status: 'PUBLISHED', deletedAt: null, OR: [{ title: { contains: q, mode: 'insensitive' } }, { excerpt: { contains: q, mode: 'insensitive' } }] }, orderBy: { publishedAt: 'desc' }, take: 6 });
    return rows.map((p) => ({ type: 'Feed', id: p.id, title: p.title, subtitle: FEED_KIND_LABEL[p.kind], link: `/feed?post=${p.id}` }));
  }
}
