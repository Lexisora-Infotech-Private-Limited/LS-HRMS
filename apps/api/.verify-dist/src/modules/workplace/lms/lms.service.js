"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "LmsService", {
    enumerable: true,
    get: function() {
        return LmsService;
    }
});
const _common = require("@nestjs/common");
const _shared = require("@lexisora/shared");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _auditservice = require("../../../core/audit/audit.service");
const _eventsservice = require("../../../core/registry/events.service");
const _requestcontext = require("../../../core/context/request-context");
const _decorators = require("../../../core/auth/decorators");
const _errors = require("../../../core/http/errors");
const _audience = require("../common/audience");
const _certificatesservice = require("../common/certificates.service");
const _dates = require("../common/dates");
const _lmsrules = require("./lms.rules");
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
let LmsService = class LmsService {
    prisma;
    audience;
    certs;
    notifications;
    audit;
    events;
    log = new _common.Logger('Learning');
    constructor(prisma, audience, certs, notifications, audit, events){
        this.prisma = prisma;
        this.audience = audience;
        this.certs = certs;
        this.notifications = notifications;
        this.audit = audit;
        this.events = events;
    }
    canManage() {
        return (0, _decorators.hasPerm)((0, _requestcontext.requireContext)(), 'lms.manage');
    }
    meEmployee() {
        const id = (0, _requestcontext.requireContext)().employeeId;
        if (!id) throw (0, _errors.forbidden)('Learning needs an employee profile');
        return id;
    }
    tileFor(c, e) {
        const lessons = [
            ...c.lessons
        ].sort((a, b)=>a.order - b.order);
        return (0, _lmsrules.courseTile)({
            courseId: c.id,
            title: c.title,
            description: c.description,
            category: c.category,
            totalDurationSec: c.totalDurationSec,
            certificateOnCompletion: c.certificateOnCompletion,
            firstLessonType: lessons[0]?.type ?? null,
            lessonsTotal: lessons.length,
            enrollment: e ? {
                id: e.id,
                status: e.status,
                lessonsDone: e.lessonsDone,
                progressPct: e.progressPct,
                dueAt: e.dueAt,
                required: e.required,
                certificateId: e.certificateId,
                certificateDownloadedAt: e.certificateDownloadedAt
            } : null
        });
    }
    // ── Learner ─────────────────────────────────────────────────────────────
    async tiles(tab) {
        const ctx = (0, _requestcontext.requireContext)();
        const me = ctx.employeeId;
        const [mine, published] = await Promise.all([
            me ? this.prisma.enrollment.findMany({
                where: {
                    employeeId: me,
                    course: {
                        status: {
                            in: [
                                'PUBLISHED',
                                'ARCHIVED'
                            ]
                        }
                    }
                },
                include: {
                    course: {
                        include: {
                            lessons: true
                        }
                    }
                }
            }) : Promise.resolve([]),
            this.prisma.course.findMany({
                where: {
                    status: 'PUBLISHED'
                },
                include: {
                    lessons: true
                },
                orderBy: [
                    {
                        publishedAt: 'desc'
                    }
                ]
            })
        ]);
        const enrolledIds = new Set(mine.map((e)=>e.courseId));
        const catalogue = published.filter((c)=>!enrolledIds.has(c.id));
        const certified = mine.filter((e)=>e.certificateId);
        const counts = {
            my: mine.length,
            catalogue: catalogue.length,
            certificates: certified.length
        };
        const order = (t)=>t.overdue ? 0 : t.status === 'IN_PROGRESS' ? 1 : t.status === 'NOT_STARTED' ? 2 : 3;
        let items;
        if (tab === 'catalogue') items = catalogue.map((c)=>this.tileFor(c, null));
        else if (tab === 'certificates') items = certified.map((e)=>this.tileFor(e.course, e));
        else items = mine.map((e)=>this.tileFor(e.course, e)).sort((a, b)=>order(a) - order(b) || (a.required === b.required ? 0 : a.required ? -1 : 1));
        return {
            items,
            counts,
            canManage: (0, _decorators.hasPerm)(ctx, 'lms.manage')
        };
    }
    lessonRow(l, p) {
        return {
            id: l.id,
            order: l.order,
            title: l.title,
            type: l.type === 'DOCUMENT' ? 'DOCUMENT' : 'VIDEO',
            fileId: l.fileId,
            durationSec: l.durationSec,
            durationLabel: (0, _shared.courseDurationLabel)(l.durationSec),
            content: l.content,
            done: !!p?.completedAt,
            positionSec: p?.positionSec ?? 0,
            watchedPct: p?.completedAt ? 100 : l.type === 'VIDEO' && p ? Math.round((0, _lmsrules.videoWatchedShare)(p.watchedBuckets, l.durationSec) * 100) : 0
        };
    }
    async detail(courseId) {
        const ctx = (0, _requestcontext.requireContext)();
        const course = await this.prisma.course.findFirst({
            where: {
                id: courseId
            },
            include: {
                lessons: {
                    orderBy: {
                        order: 'asc'
                    }
                },
                assignments: {
                    orderBy: {
                        createdAt: 'asc'
                    }
                }
            }
        });
        if (!course) throw (0, _errors.notFound)('Course');
        const manage = (0, _decorators.hasPerm)(ctx, 'lms.manage');
        const enr = ctx.employeeId ? await this.prisma.enrollment.findFirst({
            where: {
                courseId,
                employeeId: ctx.employeeId
            },
            include: {
                progress: true
            }
        }) : null;
        if (!enr && !manage && course.status !== 'PUBLISHED') throw (0, _errors.forbidden)('This course is not available');
        const byLesson = new Map((enr?.progress ?? []).map((p)=>[
                p.lessonId,
                p
            ]));
        const lessons = course.lessons.map((l)=>this.lessonRow(l, byLesson.get(l.id)));
        const next = enr?.lastLessonId && lessons.find((l)=>l.id === enr.lastLessonId && !l.done) || lessons.find((l)=>!l.done) || lessons[0] || null;
        const counts = manage && course.assignments.length ? await this.prisma.enrollment.groupBy({
            by: [
                'assignmentId'
            ],
            where: {
                courseId
            },
            _count: {
                _all: true
            }
        }) : [];
        const countBy = new Map(counts.map((c)=>[
                c.assignmentId,
                c._count._all
            ]));
        const due = (0, _lmsrules.dueInfo)(enr?.dueAt, enr?.status === 'COMPLETED');
        return {
            id: course.id,
            title: course.title,
            description: course.description,
            category: course.category,
            kicker: `${_shared.WP_COURSE_CATEGORY_LABEL[course.category]} · ${(0, _shared.courseDurationLabel)(course.totalDurationSec)}`,
            status: course.status,
            certificateOnCompletion: course.certificateOnCompletion,
            durationLabel: (0, _shared.courseDurationLabel)(course.totalDurationSec),
            lessons,
            enrollment: enr ? {
                id: enr.id,
                status: enr.status,
                progressPct: enr.progressPct,
                lessonsDone: enr.lessonsDone,
                dueLabel: enr.status === 'COMPLETED' ? null : due.label,
                overdue: due.overdue,
                certificateId: enr.certificateId,
                completedAt: enr.completedAt?.toISOString() ?? null,
                required: enr.required
            } : null,
            nextLessonId: next?.id ?? null,
            canManage: manage,
            canEnroll: !enr && course.status === 'PUBLISHED' && !!ctx.employeeId,
            assignments: manage ? course.assignments.map((a)=>({
                    id: a.id,
                    audienceType: a.audienceType,
                    label: (0, _lmsrules.assignmentLabel)(a),
                    required: a.required,
                    dueInDays: a.dueInDays,
                    enrolled: countBy.get(a.id) ?? 0
                })) : []
        };
    }
    async enroll(courseId) {
        const me = this.meEmployee();
        const course = await this.prisma.course.findFirst({
            where: {
                id: courseId,
                status: 'PUBLISHED'
            }
        });
        if (!course) throw (0, _errors.notFound)('Course');
        await this.prisma.enrollment.createMany({
            data: [
                {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    courseId,
                    employeeId: me,
                    source: 'SELF',
                    required: false
                }
            ],
            skipDuplicates: true
        });
        await this.audit.record({
            action: 'lms.enroll',
            entity: 'Course',
            entityId: courseId
        });
        return this.detail(courseId);
    }
    async lessonContext(lessonId) {
        const me = this.meEmployee();
        const lesson = await this.prisma.lesson.findFirst({
            where: {
                id: lessonId
            },
            include: {
                course: {
                    include: {
                        lessons: true
                    }
                }
            }
        });
        if (!lesson) throw (0, _errors.notFound)('Lesson');
        let enr = await this.prisma.enrollment.findFirst({
            where: {
                courseId: lesson.courseId,
                employeeId: me
            }
        });
        if (!enr) {
            if (lesson.course.status !== 'PUBLISHED') throw (0, _errors.forbidden)('Enroll in this course first');
            enr = await this.prisma.enrollment.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    courseId: lesson.courseId,
                    employeeId: me,
                    source: 'SELF',
                    required: false
                }
            });
        }
        return {
            lesson,
            course: lesson.course,
            enr
        };
    }
    /** Player heartbeat (every 15 s): credits watched buckets; completes the lesson at 90 %. */ async heartbeat(lessonId, dto) {
        const { lesson, course, enr } = await this.lessonContext(lessonId);
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const prev = await this.prisma.lessonProgress.findFirst({
            where: {
                enrollmentId: enr.id,
                lessonId
            }
        });
        const pos = Math.min(Math.max(0, Math.round(dto.positionSec)), Math.max(lesson.durationSec, 0) + 5);
        let done = !!prev?.completedAt;
        let buckets = prev?.watchedBuckets ?? [];
        if (lesson.type === 'VIDEO' && !done) {
            buckets = (0, _lmsrules.creditBuckets)(buckets, prev?.positionSec ?? 0, pos, dto.playbackRate, lesson.durationSec).buckets;
            done = (0, _lmsrules.isVideoComplete)(buckets, lesson.durationSec);
        }
        if (prev) await this.prisma.lessonProgress.update({
            where: {
                id: prev.id
            },
            data: {
                positionSec: pos,
                watchedBuckets: buckets,
                ...done && !prev.completedAt ? {
                    completedAt: new Date()
                } : {}
            }
        });
        else await this.prisma.lessonProgress.create({
            data: {
                tenantId,
                enrollmentId: enr.id,
                lessonId,
                positionSec: pos,
                watchedBuckets: buckets,
                completedAt: done ? new Date() : null
            }
        });
        return this.recompute(enr.id, course, lessonId);
    }
    /** Documents (and video lessons without a file) complete on "Mark as read". */ async completeLesson(lessonId) {
        const { lesson, course, enr } = await this.lessonContext(lessonId);
        if (lesson.type === 'VIDEO' && lesson.fileId) throw new _errors.AppError(409, 'LMS_WATCH_REQUIRED', 'Watch the video to complete this lesson');
        const tenantId = (0, _requestcontext.requireContext)().tenantId;
        const prev = await this.prisma.lessonProgress.findFirst({
            where: {
                enrollmentId: enr.id,
                lessonId
            }
        });
        if (prev) {
            if (!prev.completedAt) await this.prisma.lessonProgress.update({
                where: {
                    id: prev.id
                },
                data: {
                    completedAt: new Date()
                }
            });
        } else await this.prisma.lessonProgress.create({
            data: {
                tenantId,
                enrollmentId: enr.id,
                lessonId,
                positionSec: 0,
                watchedBuckets: [],
                completedAt: new Date()
            }
        });
        return this.recompute(enr.id, course, lessonId);
    }
    /** Recompute lessonsDone / progressPct / status; issue the certificate on completion. */ async recompute(enrollmentId, course, lastLessonId) {
        const enr = await this.prisma.enrollment.findFirst({
            where: {
                id: enrollmentId
            },
            include: {
                progress: true
            }
        });
        const lessons = [
            ...course.lessons
        ].sort((a, b)=>a.order - b.order);
        const byLesson = new Map(enr.progress.map((p)=>[
                p.lessonId,
                p
            ]));
        const fractions = lessons.map((l)=>(0, _lmsrules.lessonFraction)(l, byLesson.get(l.id)));
        const lessonsDone = lessons.filter((l)=>byLesson.get(l.id)?.completedAt).length;
        const allDone = lessons.length > 0 && lessonsDone === lessons.length;
        const progressPct = allDone ? 100 : (0, _lmsrules.courseProgressPct)(fractions);
        const wasCompleted = enr.status === 'COMPLETED';
        const status = allDone || wasCompleted ? 'COMPLETED' : 'IN_PROGRESS';
        let certificateId = enr.certificateId;
        const now = new Date();
        await this.prisma.enrollment.update({
            where: {
                id: enr.id
            },
            data: {
                lessonsDone,
                progressPct: wasCompleted ? 100 : progressPct,
                status,
                startedAt: enr.startedAt ?? now,
                ...status === 'COMPLETED' && !wasCompleted ? {
                    completedAt: now
                } : {},
                ...lastLessonId ? {
                    lastLessonId
                } : {}
            }
        });
        if (status === 'COMPLETED' && !wasCompleted) {
            if (course.certificateOnCompletion && !certificateId) {
                const cert = await this.certs.issue({
                    type: 'COURSE',
                    recipientEmployeeId: enr.employeeId,
                    title: course.title,
                    subtitle: `Completed on ${(0, _dates.longDate)(now).split(', ')[1]}`,
                    sourceType: 'COURSE_ENROLLMENT',
                    sourceId: enr.id,
                    metadata: {
                        courseId: course.id
                    }
                });
                certificateId = cert.id;
                await this.prisma.enrollment.update({
                    where: {
                        id: enr.id
                    },
                    data: {
                        certificateId
                    }
                });
            }
            const userId = (await this.prisma.employee.findFirst({
                where: {
                    id: enr.employeeId
                },
                select: {
                    userId: true
                }
            }))?.userId;
            if (userId) {
                await this.notifications.notify({
                    userIds: [
                        userId
                    ],
                    type: 'course.completed',
                    title: `Course completed: ${course.title}`,
                    body: certificateId ? 'Your certificate is ready to download.' : undefined,
                    link: '/learning'
                });
            }
            await this.audit.record({
                action: 'lms.course.complete',
                entity: 'Enrollment',
                entityId: enr.id,
                meta: {
                    courseId: course.id
                }
            });
            this.events.emit('course.completed', {
                courseId: course.id,
                employeeId: enr.employeeId,
                enrollmentId: enr.id,
                certificateId
            });
        }
        const last = lastLessonId ? byLesson.get(lastLessonId) : undefined;
        const lastLesson = lastLessonId ? lessons.find((l)=>l.id === lastLessonId) : undefined;
        return {
            lessonId: lastLessonId ?? '',
            done: !!last?.completedAt,
            watchedPct: last?.completedAt ? 100 : lastLesson && last ? Math.round((0, _lmsrules.videoWatchedShare)(last.watchedBuckets, lastLesson.durationSec) * 100) : 0,
            progressPct: status === 'COMPLETED' ? 100 : progressPct,
            lessonsDone,
            courseCompleted: status === 'COMPLETED',
            certificateId
        };
    }
    /** Certificate download from a tile: marks it downloaded ("certificate ready" → "Completed"). */ async certificateFor(enrollmentId) {
        const ctx = (0, _requestcontext.requireContext)();
        const enr = await this.prisma.enrollment.findFirst({
            where: {
                id: enrollmentId
            }
        });
        if (!enr || !enr.certificateId) throw (0, _errors.notFound)('Certificate');
        const mine = enr.employeeId === ctx.employeeId;
        if (!mine && !(0, _decorators.hasPerm)(ctx, 'lms.manage')) throw (0, _errors.forbidden)('Only the learner can download this certificate');
        if (mine && !enr.certificateDownloadedAt) await this.prisma.enrollment.update({
            where: {
                id: enr.id
            },
            data: {
                certificateDownloadedAt: new Date()
            }
        });
        return enr.certificateId;
    }
    // ── Manage ──────────────────────────────────────────────────────────────
    async manageList() {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const courses = await this.prisma.course.findMany({
            where: {
                status: {
                    not: 'ARCHIVED'
                }
            },
            include: {
                lessons: true,
                assignments: true,
                enrollments: {
                    select: {
                        status: true,
                        dueAt: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const archived = await this.prisma.course.findMany({
            where: {
                status: 'ARCHIVED'
            },
            include: {
                lessons: true,
                assignments: true,
                enrollments: {
                    select: {
                        status: true,
                        dueAt: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const now = Date.now();
        return [
            ...courses,
            ...archived
        ].map((c)=>{
            const enrolled = c.enrollments.length;
            const completed = c.enrollments.filter((e)=>e.status === 'COMPLETED').length;
            return {
                id: c.id,
                title: c.title,
                category: c.category,
                categoryLabel: _shared.WP_COURSE_CATEGORY_LABEL[c.category],
                lessons: c.lessons.length,
                durationLabel: (0, _shared.courseDurationLabel)(c.totalDurationSec),
                assignedTo: c.assignments.length ? c.assignments.map(_lmsrules.assignmentLabel).join(' · ') : 'Self-enrol',
                enrolled,
                completedPct: enrolled ? Math.round(completed / enrolled * 100) : 0,
                overdue: c.enrollments.filter((e)=>e.status !== 'COMPLETED' && e.dueAt && e.dueAt.getTime() < now).length,
                status: c.status
            };
        });
    }
    async assertManage(courseId) {
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const c = await this.prisma.course.findFirst({
            where: {
                id: courseId
            },
            include: {
                lessons: true
            }
        });
        if (!c) throw (0, _errors.notFound)('Course');
        return c;
    }
    async refreshDuration(courseId) {
        const lessons = await this.prisma.lesson.findMany({
            where: {
                courseId
            },
            select: {
                durationSec: true
            }
        });
        await this.prisma.course.update({
            where: {
                id: courseId
            },
            data: {
                totalDurationSec: lessons.reduce((a, l)=>a + l.durationSec, 0)
            }
        });
    }
    /** "Upload course" form: title, first video, certificate yes/no, assign to → publish. */ async create(dto) {
        const ctx = (0, _requestcontext.requireContext)();
        if (!this.canManage()) throw (0, _errors.forbidden)();
        const course = await this.prisma.course.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                title: dto.title,
                description: dto.description ?? null,
                category: dto.category,
                certificateOnCompletion: dto.certificateOnCompletion,
                createdByEmployeeId: ctx.employeeId ?? null,
                status: 'DRAFT'
            }
        });
        if (dto.videoFileId || dto.lessonTitle) {
            const file = dto.videoFileId ? await this.prisma.fileObject.findFirst({
                where: {
                    id: dto.videoFileId
                },
                select: {
                    mime: true,
                    filename: true
                }
            }) : null;
            if (dto.videoFileId && !file) throw (0, _errors.badRequest)('Upload the video again');
            const isDoc = file?.mime === 'application/pdf';
            await this.prisma.lesson.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    courseId: course.id,
                    order: 1,
                    title: dto.lessonTitle ?? (file ? file.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : 'Lesson 1'),
                    type: isDoc ? 'DOCUMENT' : 'VIDEO',
                    fileId: dto.videoFileId ?? null,
                    durationSec: dto.durationMin * 60
                }
            });
            await this.refreshDuration(course.id);
        }
        await this.audit.record({
            action: 'lms.course.create',
            entity: 'Course',
            entityId: course.id,
            meta: {
                title: dto.title
            }
        });
        if (dto.assignTo) await this.addAssignment(course.id, {
            audienceType: dto.assignTo.type,
            refId: dto.assignTo.refId ?? null,
            label: dto.assignTo.label ?? null,
            required: dto.category !== 'OPTIONAL',
            dueInDays: dto.dueInDays ?? (dto.category === 'ONBOARDING' ? 14 : null)
        }, false);
        if (dto.publish && (dto.videoFileId || dto.lessonTitle)) await this.publish(course.id);
        return this.detail(course.id);
    }
    async update(courseId, dto) {
        await this.assertManage(courseId);
        await this.prisma.course.update({
            where: {
                id: courseId
            },
            data: {
                ...dto.title ? {
                    title: dto.title
                } : {},
                ...dto.description !== undefined ? {
                    description: dto.description
                } : {},
                ...dto.category ? {
                    category: dto.category
                } : {},
                ...dto.certificateOnCompletion !== undefined ? {
                    certificateOnCompletion: dto.certificateOnCompletion
                } : {}
            }
        });
        await this.audit.record({
            action: 'lms.course.update',
            entity: 'Course',
            entityId: courseId
        });
        return this.detail(courseId);
    }
    async addLesson(courseId, dto) {
        const c = await this.assertManage(courseId);
        if (dto.type === 'VIDEO' && !dto.fileId && !dto.content) throw (0, _errors.badRequest)('Upload a video or add the lesson notes');
        const order = (c.lessons.reduce((m, l)=>Math.max(m, l.order), 0) || 0) + 1;
        await this.prisma.lesson.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                courseId,
                order,
                title: dto.title,
                type: dto.type,
                fileId: dto.fileId ?? null,
                durationSec: dto.durationMin * 60,
                content: dto.content ?? null
            }
        });
        await this.refreshDuration(courseId);
        // In-progress learners see the new lesson; their percentage is recomputed on the next heartbeat.
        await this.audit.record({
            action: 'lms.lesson.add',
            entity: 'Course',
            entityId: courseId,
            meta: {
                title: dto.title
            }
        });
        return this.detail(courseId);
    }
    async updateLesson(lessonId, dto) {
        const l = await this.prisma.lesson.findFirst({
            where: {
                id: lessonId
            }
        });
        if (!l) throw (0, _errors.notFound)('Lesson');
        await this.assertManage(l.courseId);
        await this.prisma.lesson.update({
            where: {
                id: lessonId
            },
            data: {
                ...dto.title ? {
                    title: dto.title
                } : {},
                ...dto.content !== undefined ? {
                    content: dto.content
                } : {},
                ...dto.durationMin ? {
                    durationSec: dto.durationMin * 60
                } : {}
            }
        });
        await this.refreshDuration(l.courseId);
        return this.detail(l.courseId);
    }
    async deleteLesson(lessonId) {
        const l = await this.prisma.lesson.findFirst({
            where: {
                id: lessonId
            }
        });
        if (!l) throw (0, _errors.notFound)('Lesson');
        const c = await this.assertManage(l.courseId);
        if (c.status === 'PUBLISHED' && c.lessons.length <= 1) throw (0, _errors.badRequest)('A published course needs at least one lesson');
        await this.prisma.lessonProgress.deleteMany({
            where: {
                lessonId
            }
        });
        await this.prisma.lesson.delete({
            where: {
                id: lessonId
            }
        });
        await this.reorder(l.courseId, (await this.prisma.lesson.findMany({
            where: {
                courseId: l.courseId
            },
            orderBy: {
                order: 'asc'
            }
        })).map((x)=>x.id));
        await this.refreshDuration(l.courseId);
        return this.detail(l.courseId);
    }
    async reorder(courseId, lessonIds) {
        const c = await this.assertManage(courseId);
        const ids = new Set(c.lessons.map((l)=>l.id));
        if (lessonIds.length !== ids.size || lessonIds.some((id)=>!ids.has(id))) throw (0, _errors.badRequest)('Send every lesson of the course once');
        // Two passes avoid the (courseId, order) unique constraint while swapping.
        await this.prisma.$transaction(async (tx)=>{
            for (const [i, id] of lessonIds.entries())await tx.lesson.update({
                where: {
                    id
                },
                data: {
                    order: 1000 + i
                }
            });
            for (const [i, id] of lessonIds.entries())await tx.lesson.update({
                where: {
                    id
                },
                data: {
                    order: i + 1
                }
            });
        });
        return this.detail(courseId);
    }
    async publish(courseId) {
        const c = await this.assertManage(courseId);
        if (!c.lessons.length) throw new _errors.AppError(409, 'LMS_NO_LESSONS', 'Add at least one lesson before publishing');
        await this.prisma.course.update({
            where: {
                id: courseId
            },
            data: {
                status: 'PUBLISHED',
                publishedAt: c.publishedAt ?? new Date()
            }
        });
        await this.audit.record({
            action: 'lms.course.publish',
            entity: 'Course',
            entityId: courseId
        });
        const assignments = await this.prisma.courseAssignment.findMany({
            where: {
                courseId
            }
        });
        for (const a of assignments)await this.materialize(a, true);
        return this.detail(courseId);
    }
    async archive(courseId) {
        await this.assertManage(courseId);
        await this.prisma.course.update({
            where: {
                id: courseId
            },
            data: {
                status: 'ARCHIVED'
            }
        });
        await this.audit.record({
            action: 'lms.course.archive',
            entity: 'Course',
            entityId: courseId
        });
        return this.detail(courseId);
    }
    async addAssignment(courseId, dto, record = true) {
        const c = await this.assertManage(courseId);
        const [rule] = await this.audience.withLabels([
            {
                type: dto.audienceType === 'NEW_JOINERS' ? 'ALL' : dto.audienceType,
                refId: dto.refId ?? null,
                label: dto.label ?? null
            }
        ]);
        const label = dto.audienceType === 'NEW_JOINERS' ? 'New joiners' : dto.audienceType === 'ALL' ? 'All employees' : dto.audienceType === 'EMPLOYMENT_TYPE' ? dto.label ?? (dto.refId === 'INTERN' ? 'Interns' : dto.refId ?? 'Employment type') : rule?.label ?? dto.label ?? null;
        const a = await this.prisma.courseAssignment.create({
            data: {
                tenantId: (0, _requestcontext.currentTenantId)(),
                courseId,
                audienceType: dto.audienceType,
                refId: dto.refId ?? null,
                label,
                required: dto.required,
                dueInDays: dto.dueInDays ?? null
            }
        });
        if (record) await this.audit.record({
            action: 'lms.assignment.create',
            entity: 'Course',
            entityId: courseId,
            meta: {
                audienceType: dto.audienceType,
                label
            }
        });
        if (c.status === 'PUBLISHED') await this.materialize(a, true);
        return this.detail(courseId);
    }
    async deleteAssignment(id) {
        const a = await this.prisma.courseAssignment.findFirst({
            where: {
                id
            }
        });
        if (!a) throw (0, _errors.notFound)('Assignment');
        await this.assertManage(a.courseId);
        await this.prisma.enrollment.deleteMany({
            where: {
                assignmentId: id,
                status: 'NOT_STARTED'
            }
        });
        await this.prisma.enrollment.updateMany({
            where: {
                assignmentId: id
            },
            data: {
                assignmentId: null,
                required: false
            }
        });
        await this.prisma.courseAssignment.delete({
            where: {
                id
            }
        });
        await this.audit.record({
            action: 'lms.assignment.delete',
            entity: 'Course',
            entityId: a.courseId
        });
        return this.detail(a.courseId);
    }
    /** Assignment → enrollments for everyone in its audience (SELF ones are upgraded to ASSIGNED). */ async materialize(a, notify) {
        const course = await this.prisma.course.findFirst({
            where: {
                id: a.courseId
            }
        });
        if (!course || course.status !== 'PUBLISHED') return 0;
        let employeeIds;
        if (a.audienceType === 'NEW_JOINERS') {
            const since = new Date(Date.now() - 30 * 86_400_000);
            employeeIds = (await this.prisma.employee.findMany({
                where: {
                    OR: [
                        {
                            status: 'ONBOARDING'
                        },
                        {
                            status: 'ACTIVE',
                            joiningDate: {
                                gte: since
                            }
                        }
                    ]
                },
                select: {
                    id: true
                }
            })).map((e)=>e.id);
        } else employeeIds = await this.audience.resolve([
            {
                type: a.audienceType,
                refId: a.refId,
                label: a.label
            }
        ]);
        if (!employeeIds.length) return 0;
        const joins = a.audienceType === 'NEW_JOINERS' ? new Map((await this.prisma.employee.findMany({
            where: {
                id: {
                    in: employeeIds
                }
            },
            select: {
                id: true,
                joiningDate: true
            }
        })).map((e)=>[
                e.id,
                e.joiningDate
            ])) : new Map();
        const existing = await this.prisma.enrollment.findMany({
            where: {
                courseId: a.courseId,
                employeeId: {
                    in: employeeIds
                }
            }
        });
        const have = new Map(existing.map((e)=>[
                e.employeeId,
                e
            ]));
        const now = new Date();
        const fresh = [];
        for (const empId of employeeIds){
            const days = a.dueInDays ?? (course.category === 'ONBOARDING' ? 14 : null);
            const base = a.audienceType === 'NEW_JOINERS' ? joins.get(empId) ?? now : now;
            const dueAt = days ? (0, _lmsrules.dueAtFor)(base, days) : null;
            const e = have.get(empId);
            if (!e) {
                await this.prisma.enrollment.create({
                    data: {
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        courseId: a.courseId,
                        employeeId: empId,
                        source: 'ASSIGNED',
                        required: a.required,
                        dueAt,
                        assignmentId: a.id
                    }
                }).catch(()=>undefined);
                fresh.push(empId);
            } else if (e.source === 'SELF' && e.status !== 'COMPLETED') {
                await this.prisma.enrollment.update({
                    where: {
                        id: e.id
                    },
                    data: {
                        source: 'ASSIGNED',
                        required: a.required || e.required,
                        dueAt: e.dueAt ?? dueAt,
                        assignmentId: a.id
                    }
                });
            }
        }
        if (notify && fresh.length) {
            const users = await this.audience.userIds(fresh);
            await this.notifications.notify({
                userIds: users,
                type: 'course.assigned',
                title: `New course assigned: ${course.title}`,
                body: a.dueInDays ? `Complete it within ${a.dueInDays} days.` : undefined,
                link: '/learning'
            });
        }
        return fresh.length;
    }
    /** employee.created → matching assignments (incl. "New joiners") enroll the new person. */ async enrollNewEmployee(employeeId) {
        const emp = await this.prisma.employee.findFirst({
            where: {
                id: employeeId
            },
            select: {
                id: true,
                joiningDate: true
            }
        });
        if (!emp) return 0;
        const assignments = await this.prisma.courseAssignment.findMany({
            where: {
                course: {
                    status: 'PUBLISHED'
                }
            },
            include: {
                course: true
            }
        });
        let n = 0;
        for (const a of assignments){
            const match = a.audienceType === 'NEW_JOINERS' || await this.audience.matches(employeeId, [
                {
                    type: a.audienceType,
                    refId: a.refId,
                    label: a.label
                }
            ]);
            if (!match) continue;
            const days = a.dueInDays ?? (a.course.category === 'ONBOARDING' ? 14 : null);
            const dueAt = days ? (0, _lmsrules.dueAtFor)(a.audienceType === 'NEW_JOINERS' ? emp.joiningDate ?? new Date() : new Date(), days) : null;
            const r = await this.prisma.enrollment.createMany({
                data: [
                    {
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        courseId: a.courseId,
                        employeeId,
                        source: 'ASSIGNED',
                        required: a.required,
                        dueAt,
                        assignmentId: a.id
                    }
                ],
                skipDuplicates: true
            });
            n += r.count;
        }
        return n;
    }
    async report(courseId) {
        const c = await this.assertManage(courseId);
        const rows = await this.prisma.enrollment.findMany({
            where: {
                courseId
            },
            orderBy: [
                {
                    status: 'asc'
                },
                {
                    assignedAt: 'asc'
                }
            ]
        });
        const briefs = await this.audience.briefs(rows.map((r)=>r.employeeId));
        return rows.map((r)=>{
            const b = briefs.get(r.employeeId);
            const due = (0, _lmsrules.dueInfo)(r.dueAt, r.status === 'COMPLETED');
            return {
                enrollmentId: r.id,
                employeeId: r.employeeId,
                name: b?.name ?? 'Former employee',
                initials: b?.initials ?? '?',
                department: b?.department ?? null,
                status: due.overdue ? 'OVERDUE' : r.status,
                progressPct: r.progressPct,
                lessonsDone: r.lessonsDone,
                lessonsTotal: c.lessons.length,
                dueLabel: due.label,
                overdue: due.overdue,
                completedAt: r.completedAt?.toISOString() ?? null,
                required: r.required,
                source: r.source
            };
        });
    }
    /** CSV export of the course report. */ async reportCsv(courseId) {
        const c = await this.assertManage(courseId);
        const rows = await this.report(courseId);
        const esc = (v)=>`"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [
            [
                'Employee',
                'Department',
                'Status',
                'Progress %',
                'Lessons done',
                'Required',
                'Due',
                'Completed at'
            ].map(esc).join(',')
        ];
        for (const r of rows)lines.push([
            r.name,
            r.department,
            r.status,
            r.progressPct,
            `${r.lessonsDone}/${r.lessonsTotal}`,
            r.required ? 'Yes' : 'No',
            r.dueLabel ?? '',
            r.completedAt ?? ''
        ].map(esc).join(','));
        return {
            filename: `${c.title.replace(/[^\w]+/g, '-')}-report.csv`,
            csv: lines.join('\n')
        };
    }
    /** File access hook: lesson media of published courses (or courses I'm enrolled in / manage). */ async canOpenFile(fileId) {
        const ctx = (0, _requestcontext.getContext)();
        if (!ctx) return false;
        const lesson = await this.prisma.lesson.findFirst({
            where: {
                fileId
            },
            include: {
                course: true
            }
        });
        if (!lesson) return false;
        if ((0, _decorators.hasPerm)(ctx, 'lms.manage') || lesson.course.status === 'PUBLISHED') return (0, _decorators.hasPerm)(ctx, 'lms.view') || (0, _decorators.hasPerm)(ctx, 'lms.manage');
        if (!ctx.employeeId) return false;
        return await this.prisma.enrollment.count({
            where: {
                courseId: lesson.courseId,
                employeeId: ctx.employeeId
            }
        }) > 0;
    }
    /** 09:00 IST: due in 3 days / due today / overdue (every 3 days) reminders. */ async dueReminders(now = new Date()) {
        const rows = await this.prisma.enrollment.findMany({
            where: {
                status: {
                    not: 'COMPLETED'
                },
                dueAt: {
                    not: null,
                    lte: new Date(now.getTime() + 4 * 86_400_000)
                }
            },
            include: {
                course: true
            }
        });
        let sent = 0;
        for (const e of rows){
            if (e.course.status !== 'PUBLISHED') continue;
            const days = Math.floor((e.dueAt.getTime() - now.getTime()) / 86_400_000);
            const overdueDays = Math.floor((now.getTime() - e.dueAt.getTime()) / 86_400_000);
            const label = (0, _lmsrules.dueInfo)(e.dueAt, false, now).label;
            let title = null;
            if (days === 3) title = `Course due in 3 days: ${e.course.title}`;
            else if (days === 0 && e.dueAt.getTime() > now.getTime()) title = `Course due today: ${e.course.title}`;
            else if (overdueDays >= 0 && e.dueAt.getTime() < now.getTime() && overdueDays % 3 === 0) title = `Overdue course: ${e.course.title} (${label})`;
            if (!title) continue;
            const users = await this.audience.userIds([
                e.employeeId
            ]);
            if (!users.length) continue;
            await this.notifications.notify({
                userIds: users,
                type: e.dueAt.getTime() < now.getTime() ? 'course.overdue' : 'course.dueSoon',
                title,
                link: '/learning'
            });
            sent++;
        }
        return sent;
    }
    /** People search: courses by title. */ async search(q) {
        const rows = await this.prisma.course.findMany({
            where: {
                status: 'PUBLISHED',
                title: {
                    contains: q,
                    mode: 'insensitive'
                }
            },
            take: 5
        });
        return rows.map((c)=>({
                type: 'Courses',
                id: c.id,
                title: c.title,
                subtitle: `${_shared.WP_COURSE_CATEGORY_LABEL[c.category]} course`,
                link: `/learning?course=${c.id}`
            }));
    }
};
LmsService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _audience.AudienceService === "undefined" ? Object : _audience.AudienceService,
        typeof _certificatesservice.CertificatesService === "undefined" ? Object : _certificatesservice.CertificatesService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _eventsservice.EventsService === "undefined" ? Object : _eventsservice.EventsService
    ])
], LmsService);

//# sourceMappingURL=lms.service.js.map