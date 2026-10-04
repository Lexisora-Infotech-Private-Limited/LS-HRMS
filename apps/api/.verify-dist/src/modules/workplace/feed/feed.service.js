"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FeedService", {
    enumerable: true,
    get: function() {
        return FeedService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _eventsservice = require("../../../core/registry/events.service");
const _realtimegateway = require("../../../core/realtime/realtime.gateway");
const _decorators = require("../../../core/auth/decorators");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _html = require("../common/html");
const _dates = require("../common/dates");
const _feedrules = require("./feed.rules");
const _kudosrules = require("../kudos/kudos.rules");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(metadataKey, metadataValue) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") {
        return Reflect.metadata(metadataKey, metadataValue);
    }
}
const iso = (d)=>d ? d.toISOString() : null;
let FeedService = class FeedService {
    prisma;
    audience;
    notifications;
    audit;
    events;
    realtime;
    log = new _common.Logger('Feed');
    constructor(prisma, audience, notifications, audit, events, realtime){
        this.prisma = prisma;
        this.audience = audience;
        this.notifications = notifications;
        this.audit = audit;
        this.events = events;
        this.realtime = realtime;
    }
    viewer() {
        const ctx = (0, _requestcontext.requireContext)();
        return {
            me: ctx.employeeId ?? null,
            publisher: (0, _decorators.hasPerm)(ctx, 'feed.publish'),
            userId: ctx.userId ?? null
        };
    }
    // ── Read ─────────────────────────────────────────────────────────────────
    async list(q) {
        const v = this.viewer();
        const where = {
            status: 'PUBLISHED',
            deletedAt: null,
            ...q.kind ? {
                kind: q.kind
            } : {}
        };
        const [rows, total, drafts] = await Promise.all([
            this.prisma.post.findMany({
                where,
                orderBy: [
                    {
                        pinned: 'desc'
                    },
                    {
                        publishedAt: 'desc'
                    }
                ],
                skip: (q.page - 1) * q.pageSize,
                take: q.pageSize
            }),
            this.prisma.post.count({
                where
            }),
            v.publisher && v.me ? this.prisma.post.count({
                where: {
                    status: 'DRAFT',
                    deletedAt: null,
                    authorEmployeeId: v.me
                }
            }) : Promise.resolve(0)
        ]);
        return {
            items: await this.views(rows, v),
            total,
            page: q.page,
            pageSize: q.pageSize,
            canPublish: v.publisher,
            drafts
        };
    }
    async get(id) {
        const v = this.viewer();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        const mineDraft = p.status === 'DRAFT' && !!v.me && p.authorEmployeeId === v.me;
        if (p.status !== 'PUBLISHED' && !mineDraft && !(v.publisher && p.status === 'ARCHIVED')) throw (0, _errors.notFound)('Post');
        return (await this.views([
            p
        ], v))[0];
    }
    async drafts() {
        const v = this.viewer();
        if (!v.me) return [];
        const rows = await this.prisma.post.findMany({
            where: {
                status: 'DRAFT',
                deletedAt: null,
                authorEmployeeId: v.me
            },
            orderBy: {
                updatedAt: 'desc'
            },
            take: 20
        });
        return rows.map((r)=>({
                id: r.id,
                title: r.title,
                kind: r.kind,
                updatedAt: r.updatedAt.toISOString(),
                excerpt: r.excerpt
            }));
    }
    async views(rows, v) {
        if (!rows.length) return [];
        const ids = rows.map((r)=>r.id);
        const [authors, liked, awards, kudos] = await Promise.all([
            this.audience.briefs(rows.map((r)=>r.authorEmployeeId)),
            v.me ? this.prisma.postLike.findMany({
                where: {
                    postId: {
                        in: ids
                    },
                    employeeId: v.me
                },
                select: {
                    postId: true
                }
            }) : Promise.resolve([]),
            this.prisma.eotmAward.findMany({
                where: {
                    id: {
                        in: rows.map((r)=>r.eotmAwardId).filter((x)=>!!x)
                    }
                }
            }),
            this.prisma.kudos.findMany({
                where: {
                    id: {
                        in: rows.map((r)=>r.kudosId).filter((x)=>!!x)
                    }
                },
                include: {
                    badge: true
                }
            })
        ]);
        const recipients = await this.audience.briefs(kudos.map((k)=>k.recipientEmployeeId));
        const likedSet = new Set(liked.map((l)=>l.postId));
        return rows.map((p)=>{
            const a = authors.get(p.authorEmployeeId);
            const award = p.eotmAwardId ? awards.find((x)=>x.id === p.eotmAwardId) : undefined;
            const k = p.kudosId ? kudos.find((x)=>x.id === p.kudosId) : undefined;
            const isMine = !!v.me && p.authorEmployeeId === v.me;
            return {
                id: p.id,
                kind: p.kind,
                kindLabel: _shared.FEED_KIND_LABEL[p.kind],
                status: p.status,
                title: p.title,
                bodyHtml: p.bodyHtml,
                excerpt: p.excerpt,
                coverFileId: p.coverFileId,
                author: {
                    employeeId: p.authorEmployeeId,
                    name: a?.name ?? 'Former employee',
                    initials: a?.initials ?? '—',
                    meta: (0, _feedrules.postMeta)(a?.designation ?? null, p.publishedAt, !a || a.status === 'EXITED')
                },
                publishedAt: iso(p.publishedAt),
                editedAt: iso(p.editedAt),
                pinned: p.pinned,
                likeCount: p.likeCount,
                liked: likedSet.has(p.id),
                commentCount: p.commentCount,
                certificateId: award && !award.revokedAt ? award.certificateId : null,
                canModerate: v.publisher,
                canEdit: (0, _feedrules.canEditPost)(p, v.me, v.publisher),
                canComment: p.status === 'PUBLISHED',
                isMine,
                kudos: k ? {
                    badge: k.badge.name,
                    recipient: recipients.get(k.recipientEmployeeId)?.name ?? '—',
                    recipientEmployeeId: k.recipientEmployeeId
                } : null
            };
        });
    }
    // ── Write (feed.publish) ─────────────────────────────────────────────────
    clean(dto, publishing) {
        const bodyHtml = (0, _html.sanitizeHtml)(dto.bodyHtml ?? '');
        if (publishing && (0, _html.htmlToText)(bodyHtml).length < 3 && !(0, _html.imageFileIds)(bodyHtml).length) throw (0, _errors.badRequest)('Write something before publishing', 'FEED_EMPTY');
        return {
            bodyHtml,
            excerpt: (0, _html.excerptOf)(bodyHtml, 300)
        };
    }
    async checkImages(bodyHtml, coverFileId) {
        const ids = [
            ...new Set([
                ...(0, _html.imageFileIds)(bodyHtml),
                ...coverFileId ? [
                    coverFileId
                ] : []
            ])
        ];
        if (!ids.length) return;
        const files = await this.prisma.fileObject.findMany({
            where: {
                id: {
                    in: ids
                }
            },
            select: {
                id: true,
                mime: true,
                size: true
            }
        });
        if (files.length !== ids.length) throw (0, _errors.badRequest)('One of the images could not be found — upload it again', 'FEED_IMAGE');
        for (const f of files){
            if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.mime)) throw (0, _errors.badRequest)('Images must be PNG, JPG or WebP', 'FEED_IMAGE_TYPE');
            if (f.size > 5 * 1024 * 1024) throw (0, _errors.badRequest)('Images can be up to 5 MB', 'FEED_IMAGE_SIZE');
        }
    }
    async create(dto) {
        const v = this.viewer();
        if (!v.publisher || !v.me) throw (0, _errors.forbidden)('Only HR and Admin can post on the company feed');
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
                publishedByEmployeeId: publishing ? v.me : null
            }
        });
        if (publishing) await this.afterPublish(p);
        return this.get(p.id);
    }
    async update(id, dto) {
        const v = this.viewer();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        if (!(0, _feedrules.canEditPost)(p, v.me, v.publisher)) throw (0, _errors.forbidden)('You cannot edit this post');
        const publishing = p.status === 'PUBLISHED' || dto.action !== 'draft';
        const body = this.clean(dto, publishing);
        await this.checkImages(body.bodyHtml, dto.coverFileId);
        const now = new Date();
        const goingLive = p.status === 'DRAFT' && dto.action !== 'draft';
        const updated = await this.prisma.post.update({
            where: {
                id
            },
            data: {
                title: dto.title,
                kind: dto.kind,
                ...body,
                coverFileId: dto.coverFileId ?? null,
                ...p.status === 'PUBLISHED' ? {
                    editedAt: now
                } : {},
                ...goingLive ? {
                    status: 'PUBLISHED',
                    publishedAt: now,
                    publishedByEmployeeId: v.me
                } : {}
            }
        });
        if (goingLive) await this.afterPublish(updated);
        else if (p.status === 'PUBLISHED') await this.audit.record({
            action: 'feed.post.edit',
            entity: 'Post',
            entityId: id,
            meta: {
                title: dto.title
            }
        });
        return this.get(id);
    }
    async publish(id) {
        const v = this.viewer();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        if (p.status === 'PUBLISHED') return this.get(id);
        if (p.status !== 'DRAFT' && p.status !== 'PENDING_REVIEW') throw (0, _errors.conflict)('Archived posts cannot be published again', 'FEED_ARCHIVED');
        if (!v.publisher) throw (0, _errors.forbidden)();
        this.clean(p, true);
        const updated = await this.prisma.post.update({
            where: {
                id
            },
            data: {
                status: 'PUBLISHED',
                publishedAt: new Date(),
                publishedByEmployeeId: v.me
            }
        });
        await this.afterPublish(updated);
        return this.get(id);
    }
    /** In-app alert (batched: one per 15 minutes), realtime feed:new, audit. */ async afterPublish(p, opts = {}) {
        await this.audit.record({
            action: 'feed.post.publish',
            entity: 'Post',
            entityId: p.id,
            meta: {
                kind: p.kind,
                title: p.title
            }
        });
        this.realtime.toTenant((0, _requestcontext.currentTenantId)(), 'feed:new', {
            postId: p.id
        });
        this.events.emit('feed.postPublished', {
            postId: p.id,
            kind: p.kind
        });
        if (opts.notify === false || p.kind === 'KUDOS' || p.kind === 'EOTM') return;
        const recent = await this.prisma.post.count({
            where: {
                id: {
                    not: p.id
                },
                status: 'PUBLISHED',
                kind: {
                    in: [
                        'BLOG',
                        'MILESTONE',
                        'UPDATE'
                    ]
                },
                publishedAt: {
                    gte: new Date(Date.now() - _feedrules.ALERT_BATCH_MS)
                }
            }
        });
        if (recent) return; // an alert for the feed went out in the last 15 minutes
        const users = await this.prisma.user.findMany({
            where: {
                status: 'ACTIVE',
                employee: {
                    isNot: null
                }
            },
            select: {
                id: true
            }
        }).catch(()=>[]);
        const author = (await this.audience.briefs([
            p.authorEmployeeId
        ])).get(p.authorEmployeeId);
        const ids = users.map((u)=>u.id).filter((id)=>id !== author?.userId);
        await this.notifications.notify({
            userIds: ids,
            type: 'feed.post.published',
            title: `${author?.name ?? 'HR'} posted: ${p.title}`,
            body: p.excerpt.slice(0, 160),
            link: `/feed?post=${p.id}`,
            from: author?.name ?? 'Company feed'
        });
    }
    async archive(id) {
        const v = this.viewer();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        if (!v.publisher) throw (0, _errors.forbidden)();
        await this.prisma.post.update({
            where: {
                id
            },
            data: {
                status: 'ARCHIVED',
                pinned: false
            }
        });
        await this.audit.record({
            action: 'feed.post.archive',
            entity: 'Post',
            entityId: id,
            meta: {
                title: p.title
            }
        });
        this.realtime.toTenant((0, _requestcontext.currentTenantId)(), 'feed:new', {
            postId: id
        });
        return {
            ok: true
        };
    }
    async removeDraft(id) {
        const v = this.viewer();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        if (p.status !== 'DRAFT' || p.authorEmployeeId !== v.me) throw (0, _errors.forbidden)('Only your own drafts can be deleted');
        await this.prisma.post.update({
            where: {
                id
            },
            data: {
                deletedAt: new Date()
            }
        });
        return {
            ok: true
        };
    }
    async setPinned(id, pinned) {
        const v = this.viewer();
        if (!v.publisher) throw (0, _errors.forbidden)();
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null,
                status: 'PUBLISHED'
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        if (pinned && !p.pinned) {
            const n = await this.prisma.post.count({
                where: {
                    pinned: true,
                    status: 'PUBLISHED',
                    deletedAt: null
                }
            });
            if (n >= _feedrules.MAX_PINNED) throw (0, _errors.conflict)(`Up to ${_feedrules.MAX_PINNED} posts can be pinned — unpin one first`, 'FEED_PIN_LIMIT');
        }
        await this.prisma.post.update({
            where: {
                id
            },
            data: {
                pinned
            }
        });
        await this.audit.record({
            action: 'feed.post.pin',
            entity: 'Post',
            entityId: id,
            meta: {
                pinned
            }
        });
        this.realtime.toTenant((0, _requestcontext.currentTenantId)(), 'feed:new', {
            postId: id
        });
        return {
            ok: true,
            pinned
        };
    }
    // ── Likes ────────────────────────────────────────────────────────────────
    async like(id, on) {
        const v = this.viewer();
        if (!v.me) throw (0, _errors.forbidden)('Only employees can like posts');
        const me = v.me;
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null,
                status: 'PUBLISHED'
            },
            select: {
                id: true
            }
        });
        if (!p) throw (0, _errors.notFound)('Post');
        const tenantId = (0, _requestcontext.currentTenantId)();
        const likeCount = await this.prisma.$transaction(async (tx)=>{
            if (on) {
                const r = await tx.postLike.createMany({
                    data: [
                        {
                            tenantId,
                            postId: id,
                            employeeId: me
                        }
                    ],
                    skipDuplicates: true
                });
                if (r.count) return (await tx.post.update({
                    where: {
                        id
                    },
                    data: {
                        likeCount: {
                            increment: 1
                        }
                    },
                    select: {
                        likeCount: true
                    }
                })).likeCount;
            } else {
                const r = await tx.postLike.deleteMany({
                    where: {
                        postId: id,
                        employeeId: me
                    }
                });
                if (r.count) return (await tx.post.update({
                    where: {
                        id
                    },
                    data: {
                        likeCount: {
                            decrement: 1
                        }
                    },
                    select: {
                        likeCount: true
                    }
                })).likeCount;
            }
            return (await tx.post.findUniqueOrThrow({
                where: {
                    id
                },
                select: {
                    likeCount: true
                }
            })).likeCount;
        });
        this.realtime.toTenant(tenantId, 'feed:like', {
            postId: id,
            likeCount
        });
        return {
            liked: on,
            likeCount: Math.max(0, likeCount)
        };
    }
    // ── Comments ─────────────────────────────────────────────────────────────
    async comments(id) {
        const v = this.viewer();
        await this.get(id);
        const rows = await this.prisma.postComment.findMany({
            where: {
                postId: id
            },
            orderBy: {
                createdAt: 'asc'
            },
            take: 500
        });
        const people = await this.audience.briefs(rows.map((r)=>r.authorEmployeeId));
        // Deleted comments stay as a placeholder only when they have replies.
        const hasReplies = new Set(rows.filter((r)=>r.parentId && !r.deletedAt).map((r)=>r.parentId));
        return rows.filter((r)=>!r.deletedAt || hasReplies.has(r.id)).map((r)=>{
            const a = people.get(r.authorEmployeeId);
            return {
                id: r.id,
                parentId: r.parentId,
                body: r.deletedAt ? 'Comment deleted' : r.body,
                authorName: a?.name ?? 'Former employee',
                initials: a?.initials ?? (0, _shared.initialsOf)(a?.name ?? '?'),
                createdAt: r.createdAt.toISOString(),
                canDelete: !r.deletedAt && (v.publisher || !!v.me && r.authorEmployeeId === v.me),
                deleted: !!r.deletedAt
            };
        });
    }
    async addComment(id, body, parentId) {
        const v = this.viewer();
        if (!v.me) throw (0, _errors.forbidden)('Only employees can comment');
        const p = await this.prisma.post.findFirst({
            where: {
                id,
                deletedAt: null
            }
        });
        if (!p || p.status !== 'PUBLISHED' && p.status !== 'ARCHIVED') throw (0, _errors.notFound)('Post');
        if (p.status === 'ARCHIVED') throw (0, _errors.conflict)('This post is archived — comments are closed', 'FEED_ARCHIVED');
        const parent = parentId ? await this.prisma.postComment.findFirst({
            where: {
                id: parentId,
                postId: id
            }
        }) : null;
        if (parentId && !parent) throw (0, _errors.badRequest)('The comment you replied to was removed', 'FEED_PARENT');
        const people = await this.prisma.employee.findMany({
            where: {
                status: {
                    in: [
                        'ACTIVE',
                        'NOTICE_PERIOD'
                    ]
                }
            },
            select: {
                id: true,
                fullName: true,
                firstName: true
            }
        });
        const mentions = (0, _feedrules.resolveMentions)(body, people).filter((x)=>x !== v.me);
        const tenantId = (0, _requestcontext.currentTenantId)();
        const me = v.me;
        const commentCount = await this.prisma.$transaction(async (tx)=>{
            await tx.postComment.create({
                data: {
                    tenantId,
                    postId: id,
                    authorEmployeeId: me,
                    parentId: (0, _feedrules.threadParent)(parent),
                    body,
                    mentions
                }
            });
            return (await tx.post.update({
                where: {
                    id
                },
                data: {
                    commentCount: {
                        increment: 1
                    }
                },
                select: {
                    commentCount: true
                }
            })).commentCount;
        });
        this.realtime.toTenant(tenantId, 'feed:comment', {
            postId: id,
            commentCount
        });
        const author = (await this.audience.briefs([
            me
        ])).get(me);
        if (mentions.length) {
            await this.notifications.notify({
                userIds: await this.audience.userIds(mentions),
                type: 'feed.comment.mention',
                title: `${author?.name ?? 'Someone'} mentioned you on “${p.title}”`,
                body: body.slice(0, 160),
                link: `/feed?post=${id}`,
                from: author?.name ?? 'Company feed'
            });
        }
        const notifyAuthor = p.authorEmployeeId !== me && !mentions.includes(p.authorEmployeeId);
        const notifyParent = parent && parent.authorEmployeeId !== me && parent.authorEmployeeId !== p.authorEmployeeId && !mentions.includes(parent.authorEmployeeId) ? parent.authorEmployeeId : null;
        const targets = [
            notifyAuthor ? p.authorEmployeeId : null,
            notifyParent
        ].filter((x)=>!!x);
        if (targets.length) {
            await this.notifications.notify({
                userIds: await this.audience.userIds(targets),
                type: 'feed.comment.onMyPost',
                title: `${author?.name ?? 'Someone'} commented on “${p.title}”`,
                body: body.slice(0, 160),
                link: `/feed?post=${id}`,
                from: author?.name ?? 'Company feed'
            });
        }
        return this.comments(id);
    }
    async deleteComment(commentId) {
        const v = this.viewer();
        const c = await this.prisma.postComment.findFirst({
            where: {
                id: commentId,
                deletedAt: null
            }
        });
        if (!c) throw (0, _errors.notFound)('Comment');
        const mine = !!v.me && c.authorEmployeeId === v.me;
        if (!mine && !v.publisher) throw (0, _errors.forbidden)('Only the author or HR can delete this comment');
        const commentCount = await this.prisma.$transaction(async (tx)=>{
            await tx.postComment.update({
                where: {
                    id: commentId
                },
                data: {
                    deletedAt: new Date()
                }
            });
            return (await tx.post.update({
                where: {
                    id: c.postId
                },
                data: {
                    commentCount: {
                        decrement: 1
                    }
                },
                select: {
                    commentCount: true
                }
            })).commentCount;
        });
        if (!mine) await this.audit.record({
            action: 'feed.comment.delete',
            entity: 'PostComment',
            entityId: commentId,
            meta: {
                postId: c.postId
            }
        });
        this.realtime.toTenant((0, _requestcontext.currentTenantId)(), 'feed:comment', {
            postId: c.postId,
            commentCount
        });
        return {
            ok: true,
            commentCount: Math.max(0, commentCount)
        };
    }
    // ── Sidebar ──────────────────────────────────────────────────────────────
    async sidebar() {
        const today = (0, _dates.todayKey)();
        const month = today.slice(0, 7);
        const awards = await this.prisma.eotmAward.findMany({
            where: {
                revokedAt: null,
                month: {
                    lte: month
                }
            },
            orderBy: {
                month: 'desc'
            },
            take: 1
        });
        const award = awards[0] ?? null;
        const since = (0, _dates.istInstant)((0, _dates.addDaysKey)(today, -7), '00:00');
        const kudos = await this.prisma.kudos.findMany({
            where: {
                revokedAt: null,
                createdAt: {
                    gte: since
                },
                badge: {
                    system: false
                }
            },
            include: {
                badge: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 5
        });
        const people = await this.audience.briefs([
            award?.employeeId,
            ...kudos.map((k)=>k.recipientEmployeeId)
        ]);
        return {
            eotm: award ? {
                month: (0, _dates.monthLabel)(award.month),
                name: people.get(award.employeeId)?.name ?? '—',
                citation: award.citation,
                certificateId: award.certificateId
            } : null,
            kudosThisWeek: kudos.map((k)=>({
                    id: k.id,
                    text: `${k.badge.name} → ${(0, _kudosrules.shortName)(people.get(k.recipientEmployeeId)?.name ?? '—')}`
                }))
        };
    }
    // ── Registry hooks ───────────────────────────────────────────────────────
    /** Images and covers of published posts are visible to everyone in the tenant. */ async canOpenFile(fileId) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!(0, _decorators.hasPerm)(ctx, 'feed.view')) return false;
        const n = await this.prisma.post.count({
            where: {
                deletedAt: null,
                OR: [
                    {
                        status: 'PUBLISHED'
                    },
                    {
                        authorEmployeeId: ctx.employeeId ?? '__none__'
                    }
                ],
                AND: [
                    {
                        OR: [
                            {
                                coverFileId: fileId
                            },
                            {
                                bodyHtml: {
                                    contains: `/files/${fileId}`
                                }
                            }
                        ]
                    }
                ]
            }
        });
        return n > 0;
    }
    async search(q) {
        const rows = await this.prisma.post.findMany({
            where: {
                status: 'PUBLISHED',
                deletedAt: null,
                OR: [
                    {
                        title: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    },
                    {
                        excerpt: {
                            contains: q,
                            mode: 'insensitive'
                        }
                    }
                ]
            },
            orderBy: {
                publishedAt: 'desc'
            },
            take: 6
        });
        return rows.map((p)=>({
                type: 'Feed',
                id: p.id,
                title: p.title,
                subtitle: _shared.FEED_KIND_LABEL[p.kind],
                link: `/feed?post=${p.id}`
            }));
    }
};
FeedService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService,
        typeof _realtimegateway.RealtimeGateway === "undefined" ? Object : _realtimegateway.RealtimeGateway
    ])
], FeedService);

//# sourceMappingURL=feed.service.js.map