"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get GitService () {
        return GitService;
    },
    get sha256 () {
        return sha256;
    }
});
const _common = require("@nestjs/common");
const _nodecrypto = require("node:crypto");
const _env = require("../../../config/env");
const _prismaservice = require("../../../core/prisma/prisma.service");
const _cryptoservice = require("../../../core/crypto/crypto.service");
const _sequenceservice = require("../../../core/registry/sequence.service");
const _auditservice = require("../../../core/audit/audit.service");
const _notificationsservice = require("../../../core/notifications/notifications.service");
const _requestcontext = require("../../../core/context/request-context");
const _errors = require("../../../core/http/errors");
const _gitlabrestadapter = require("../adapters/gitlab-rest.adapter");
const _gitstubadapter = require("../adapters/git-stub.adapter");
const _workrules = require("../work.rules");
const _workeventsservice = require("../work-events.service");
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
const DEFAULTS = {
    baseUrl: 'https://gitlab.com',
    defaultTargetBranch: 'develop',
    branchPattern: 'feature/{key}',
    mrTitlePattern: '{KEY}: {title}'
};
const sha256 = (s)=>(0, _nodecrypto.createHash)('sha256').update(s).digest('hex');
let GitService = class GitService {
    prisma;
    crypto;
    seq;
    audit;
    notifications;
    events;
    log = new _common.Logger('WorkGit');
    stubs = new Map();
    constructor(prisma, crypto, seq, audit, notifications, events){
        this.prisma = prisma;
        this.crypto = crypto;
        this.seq = seq;
        this.audit = audit;
        this.notifications = notifications;
        this.events = events;
    }
    // ── Integration settings ────────────────────────────────────────────────
    async integration() {
        return this.prisma.gitIntegration.findFirst({
            where: {
                provider: 'GITLAB'
            }
        });
    }
    async settings() {
        const i = await this.integration();
        return {
            baseUrl: i?.baseUrl ?? _env.env.GITLAB_URL ?? DEFAULTS.baseUrl,
            defaultTargetBranch: i?.defaultTargetBranch ?? DEFAULTS.defaultTargetBranch,
            branchPattern: i?.branchPattern ?? DEFAULTS.branchPattern,
            mrTitlePattern: i?.mrTitlePattern ?? DEFAULTS.mrTitlePattern
        };
    }
    /** Real GitLab adapter when a token is configured (tenant integration or env), otherwise the stub. */ async adapter() {
        const i = await this.integration();
        const token = (i?.tokenEnc ? this.crypto.decrypt(i.tokenEnc) : null) ?? _env.env.GITLAB_TOKEN ?? null;
        if (token) return new _gitlabrestadapter.GitLabRestAdapter(i?.baseUrl ?? _env.env.GITLAB_URL ?? DEFAULTS.baseUrl, token);
        const tenantId = (0, _requestcontext.currentTenantId)();
        let stub = this.stubs.get(tenantId);
        if (!stub) {
            stub = new _gitstubadapter.StubGitAdapter((repoKey)=>this.seq.nextValue(`work.git.mr.${sha256(repoKey).slice(0, 16)}`, {
                    start: 1,
                    tenantId
                }));
            this.stubs.set(tenantId, stub);
        }
        return stub;
    }
    webhookUrl() {
        return `${_env.env.WEB_ORIGIN.replace(/\/+$/, '')}/api/v1/git/webhook`;
    }
    async view(secret) {
        const i = await this.integration();
        const s = await this.settings();
        const mode = i?.tokenEnc || _env.env.GITLAB_TOKEN ? 'gitlab' : 'stub';
        return {
            configured: !!i,
            mode,
            ...s,
            tokenLast4: i?.tokenLast4 ?? (_env.env.GITLAB_TOKEN ? _env.env.GITLAB_TOKEN.slice(-4) : null),
            status: i?.status ?? 'ACTIVE',
            lastCheckedAt: i?.lastCheckedAt?.toISOString() ?? null,
            webhookUrl: this.webhookUrl(),
            ...secret ? {
                webhookSecret: secret
            } : {}
        };
    }
    async save(input) {
        const existing = await this.integration();
        const data = {
            baseUrl: input.baseUrl,
            defaultTargetBranch: input.defaultTargetBranch,
            branchPattern: input.branchPattern,
            mrTitlePattern: input.mrTitlePattern,
            status: 'ACTIVE',
            ...input.token ? {
                tokenEnc: this.crypto.encrypt(input.token),
                tokenLast4: input.token.slice(-4)
            } : {}
        };
        let secret;
        if (existing) await this.prisma.gitIntegration.update({
            where: {
                id: existing.id
            },
            data
        });
        else {
            secret = (0, _nodecrypto.randomBytes)(24).toString('hex');
            await this.prisma.gitIntegration.create({
                data: {
                    ...data,
                    provider: 'GITLAB',
                    webhookSecretHash: sha256(secret)
                }
            });
        }
        await this.audit.record({
            action: 'gitlab.integration.updated',
            entity: 'GitIntegration',
            meta: {
                baseUrl: input.baseUrl,
                tokenChanged: !!input.token
            }
        });
        return this.view(secret);
    }
    async rotateSecret() {
        const secret = (0, _nodecrypto.randomBytes)(24).toString('hex');
        const existing = await this.integration();
        if (existing) await this.prisma.gitIntegration.update({
            where: {
                id: existing.id
            },
            data: {
                webhookSecretHash: sha256(secret)
            }
        });
        else await this.prisma.gitIntegration.create({
            data: {
                provider: 'GITLAB',
                webhookSecretHash: sha256(secret),
                baseUrl: _env.env.GITLAB_URL ?? DEFAULTS.baseUrl
            }
        });
        await this.audit.record({
            action: 'gitlab.webhook_secret.rotated',
            entity: 'GitIntegration'
        });
        return this.view(secret);
    }
    async test() {
        const a = await this.adapter();
        const r = await a.testConnection();
        const i = await this.integration();
        if (i) await this.prisma.gitIntegration.update({
            where: {
                id: i.id
            },
            data: {
                lastCheckedAt: new Date(),
                status: r.ok ? 'ACTIVE' : 'AUTH_ERROR'
            }
        });
        return {
            ...r,
            mode: a.mode
        };
    }
    // ── Project link ────────────────────────────────────────────────────────
    async linkProject(projectId) {
        const p = await this.prisma.project.findFirstOrThrow({
            where: {
                id: projectId
            }
        });
        if (!p.gitRepoUrl) {
            await this.prisma.project.update({
                where: {
                    id: p.id
                },
                data: {
                    gitLinkStatus: 'UNLINKED',
                    gitLinkError: null,
                    gitProjectId: null
                }
            });
            return {
                status: 'UNLINKED',
                error: null
            };
        }
        try {
            const a = await this.adapter();
            const r = await a.resolveProject(p.gitRepoUrl);
            await this.prisma.project.update({
                where: {
                    id: p.id
                },
                data: {
                    gitProjectId: r.projectId,
                    gitLinkStatus: 'LINKED',
                    gitLinkError: null
                }
            });
            return {
                status: 'LINKED',
                error: null,
                mode: a.mode,
                defaultBranch: r.defaultBranch
            };
        } catch (e) {
            const msg = e.message.slice(0, 300);
            await this.prisma.project.update({
                where: {
                    id: p.id
                },
                data: {
                    gitLinkStatus: 'ERROR',
                    gitLinkError: msg
                }
            });
            return {
                status: 'ERROR',
                error: msg
            };
        }
    }
    // ── Task side effects ───────────────────────────────────────────────────
    /**
   * Run the git side effect of a move. Never throws: failures mark the task FAILED, notify the
   * assignee and board lead, and are retried from the card ("Retry sync").
   */ async syncTask(taskId, action) {
        const task = await this.prisma.task.findFirstOrThrow({
            where: {
                id: taskId
            },
            include: {
                project: true
            }
        });
        const p = task.project;
        const s = await this.settings();
        const target = p.gitTargetBranch || s.defaultTargetBranch;
        if (!p.gitRepoUrl) {
            await this.prisma.task.update({
                where: {
                    id: task.id
                },
                data: {
                    gitSyncStatus: 'SKIPPED',
                    gitSyncError: null
                }
            });
            return {
                action,
                status: 'SKIPPED'
            };
        }
        const name = task.gitBranch ?? (0, _workrules.branchName)(task.key, s.branchPattern);
        try {
            const a = await this.adapter();
            const repo = {
                repoUrl: p.gitRepoUrl,
                projectId: p.gitProjectId
            };
            const br = await a.ensureBranch(repo, name, target);
            const data = {
                gitBranch: br.name,
                gitBranchUrl: br.url || task.gitBranchUrl,
                gitSyncStatus: 'SYNCED',
                gitSyncError: null
            };
            const notes = [];
            if (br.created) notes.push(`Branch ${br.name} created from ${br.ref}`);
            let mrUrl = task.gitMrUrl;
            if (action === 'mr') {
                if (task.gitMrIid && task.gitMrUrl && task.gitMrState === 'opened') {
                    notes.push(`MR !${task.gitMrIid} already open`);
                } else {
                    const mr = await a.ensureMr(repo, {
                        source: br.name,
                        target,
                        title: (0, _workrules.mrTitle)(task.key, task.title, s.mrTitlePattern),
                        description: `${task.description ?? ''}\n\nLexisora task ${task.key}`.trim(),
                        labels: [
                            p.key
                        ]
                    });
                    Object.assign(data, {
                        gitMrIid: mr.iid,
                        gitMrUrl: mr.url,
                        gitMrState: mr.state
                    });
                    mrUrl = mr.url;
                    notes.push(mr.created ? `MR !${mr.iid} opened → ${target}` : `MR !${mr.iid} reused`);
                    if (mr.created) await this.audit.record({
                        action: 'gitlab.mr.created',
                        entity: 'Task',
                        entityId: task.id,
                        meta: {
                            iid: mr.iid,
                            url: mr.url
                        }
                    });
                }
            }
            await this.prisma.task.update({
                where: {
                    id: task.id
                },
                data
            });
            if (notes.length) {
                await this.prisma.taskTransition.create({
                    data: {
                        tenantId: (0, _requestcontext.currentTenantId)(),
                        taskId: task.id,
                        kind: 'GIT',
                        note: notes.join(' · '),
                        byName: 'GitLab'
                    }
                });
            }
            if (br.created) await this.audit.record({
                action: 'gitlab.branch.created',
                entity: 'Task',
                entityId: task.id,
                meta: {
                    branch: br.name,
                    ref: br.ref
                }
            });
            this.events.boardChanged(p.id, task.departmentId, task.id);
            return {
                action,
                status: 'SYNCED',
                branch: br.name,
                mrUrl,
                targetBranch: target
            };
        } catch (e) {
            const msg = e.message.slice(0, 300);
            this.log.warn(`${task.key} git ${action} failed: ${msg}`);
            await this.prisma.task.update({
                where: {
                    id: task.id
                },
                data: {
                    gitSyncStatus: 'FAILED',
                    gitSyncError: msg,
                    gitBranch: task.gitBranch ?? name
                }
            });
            await this.prisma.taskTransition.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    taskId: task.id,
                    kind: 'GIT',
                    note: `GitLab sync failed: ${msg}`,
                    byName: 'GitLab'
                }
            });
            await this.audit.record({
                action: 'gitlab.sync.failed',
                entity: 'Task',
                entityId: task.id,
                meta: {
                    error: msg
                }
            });
            const lead = task.departmentId ? await this.prisma.department.findFirst({
                where: {
                    id: task.departmentId
                },
                select: {
                    leadEmployeeId: true
                }
            }) : null;
            await this.notifications.notify({
                userIds: await this.notifications.usersForEmployees([
                    task.assigneeEmployeeId,
                    lead?.leadEmployeeId
                ]),
                type: 'task.git_failed',
                title: `GitLab sync failed for ${task.key}`,
                body: msg,
                link: `/board?project=${p.id}&task=${task.id}`,
                from: 'GitLab'
            });
            if (e instanceof Error && /GitLab 40[13]/.test(e.message)) {
                const i = await this.integration();
                if (i) await this.prisma.gitIntegration.update({
                    where: {
                        id: i.id
                    },
                    data: {
                        status: 'AUTH_ERROR'
                    }
                });
            }
            this.events.boardChanged(p.id, task.departmentId, task.id);
            return {
                action,
                status: 'FAILED',
                branch: name,
                error: msg,
                targetBranch: target
            };
        }
    }
    // ── Webhooks ────────────────────────────────────────────────────────────
    /** Verify X-Gitlab-Token (constant time) → tenant; dedupe on the event UUID; apply the event. */ async receiveWebhook(headers, payload) {
        if (!headers.token) throw new _errors.AppError(401, 'BAD_TOKEN', 'Missing X-Gitlab-Token');
        const hash = sha256(headers.token);
        const integ = await this.prisma.raw.gitIntegration.findUnique({
            where: {
                webhookSecretHash: hash
            }
        });
        if (!integ || !(0, _nodecrypto.timingSafeEqual)(Buffer.from(integ.webhookSecretHash), Buffer.from(hash))) {
            this.log.warn('Rejected GitLab webhook with an unknown token');
            throw new _errors.AppError(401, 'BAD_TOKEN', 'Invalid webhook token');
        }
        return (0, _requestcontext.runAsTenant)(integ.tenantId, async ()=>{
            const eventType = headers.event ?? String(payload?.object_kind ?? 'unknown');
            const eventUuid = headers.uuid ?? sha256(JSON.stringify(payload ?? {}));
            try {
                await this.prisma.gitWebhookDelivery.create({
                    data: {
                        tenantId: integ.tenantId,
                        eventUuid,
                        eventType,
                        payload: payload ?? {}
                    }
                });
            } catch (e) {
                if (e?.code === 'P2002') return {
                    status: 'duplicate'
                };
                throw e;
            }
            let error = null;
            let handled = false;
            try {
                handled = await this.apply(eventType, payload ?? {});
            } catch (e) {
                error = e.message.slice(0, 500);
            }
            await this.prisma.gitWebhookDelivery.updateMany({
                where: {
                    eventUuid
                },
                data: {
                    processedAt: new Date(),
                    error
                }
            });
            return {
                status: handled ? 'processed' : 'ignored'
            };
        });
    }
    async apply(eventType, p) {
        const kind = String(p.object_kind ?? eventType).toLowerCase();
        if (kind.includes('merge_request') || kind.includes('merge request')) {
            const a = p.object_attributes ?? {};
            const src = a.source_branch;
            if (!src) return false;
            const keys = (0, _workrules.taskKeysIn)(src);
            const task = await this.prisma.task.findFirst({
                where: {
                    OR: [
                        {
                            gitBranch: src
                        },
                        ...keys.length ? [
                            {
                                key: {
                                    in: keys
                                }
                            }
                        ] : []
                    ]
                }
            });
            if (!task) return false;
            const state = a.state === 'merged' ? 'merged' : a.state === 'closed' ? 'closed' : 'opened';
            await this.prisma.task.update({
                where: {
                    id: task.id
                },
                data: {
                    gitMrState: state,
                    gitMrIid: a.iid ?? task.gitMrIid,
                    gitMrUrl: a.url ?? task.gitMrUrl,
                    gitBranch: task.gitBranch ?? src,
                    gitSyncStatus: 'SYNCED',
                    gitSyncError: null
                }
            });
            await this.prisma.taskTransition.create({
                data: {
                    tenantId: (0, _requestcontext.currentTenantId)(),
                    taskId: task.id,
                    kind: 'GIT',
                    note: `MR !${a.iid ?? task.gitMrIid ?? '?'} ${state}`,
                    byName: 'GitLab'
                }
            });
            this.events.boardChanged(task.projectId, task.departmentId, task.id);
            return true;
        }
        if (kind === 'push' || kind.includes('push')) {
            const ref = p.ref ?? '';
            const branch = ref.replace(/^refs\/heads\//, '');
            let any = false;
            for (const c of p.commits ?? []){
                const keys = new Set([
                    ...(0, _workrules.taskKeysIn)(String(c.message ?? '')),
                    ...(0, _workrules.taskKeysIn)(branch)
                ]);
                if (!keys.size) continue;
                const tasks = await this.prisma.task.findMany({
                    where: {
                        key: {
                            in: [
                                ...keys
                            ]
                        }
                    },
                    select: {
                        id: true,
                        projectId: true,
                        departmentId: true
                    }
                });
                for (const t of tasks){
                    await this.prisma.gitCommitLink.upsert({
                        where: {
                            taskId_sha: {
                                taskId: t.id,
                                sha: String(c.id)
                            }
                        },
                        create: {
                            tenantId: (0, _requestcontext.currentTenantId)(),
                            taskId: t.id,
                            sha: String(c.id),
                            message: String(c.message ?? '').slice(0, 1000),
                            authorName: c.author?.name ?? null,
                            committedAt: c.timestamp ? new Date(c.timestamp) : new Date(),
                            url: c.url ?? null
                        },
                        update: {}
                    });
                    this.events.boardChanged(t.projectId, t.departmentId, t.id);
                    any = true;
                }
            }
            return any;
        }
        if (kind === 'pipeline' || kind.includes('pipeline')) {
            const a = p.object_attributes ?? {};
            if (!a.ref) return false;
            const r = await this.prisma.task.updateMany({
                where: {
                    gitBranch: String(a.ref)
                },
                data: {
                    pipelineStatus: String(a.status ?? 'unknown')
                }
            });
            return r.count > 0;
        }
        return false;
    }
};
GitService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _prismaservice.PrismaService === "undefined" ? Object : _prismaservice.PrismaService,
        typeof _cryptoservice.CryptoService === "undefined" ? Object : _cryptoservice.CryptoService,
        typeof _sequenceservice.SequenceService === "undefined" ? Object : _sequenceservice.SequenceService,
        typeof _auditservice.AuditService === "undefined" ? Object : _auditservice.AuditService,
        typeof _notificationsservice.NotificationsService === "undefined" ? Object : _notificationsservice.NotificationsService,
        typeof _workeventsservice.WorkEvents === "undefined" ? Object : _workeventsservice.WorkEvents
    ])
], GitService);

//# sourceMappingURL=git.service.js.map