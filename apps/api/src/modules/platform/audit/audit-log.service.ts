import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { auditResultOf, type AuditFacets, type AuditQuery, type AuditRowDto, type Paginated } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { pageArgs, paginated } from '../../../core/http/paginate';
import { istEnd, istStart } from '../platform.util';

/** Tabs → action filters. */
export function tabWhere(tab: AuditQuery['tab']): Prisma.AuditLogWhereInput {
  switch (tab) {
    case 'security':
      return { OR: [{ action: { startsWith: 'auth.' } }, { action: { startsWith: 'security.' } }, { action: 'rbac.denied' }, { action: { startsWith: 'privacy.' } }] };
    case 'access':
      return { action: { startsWith: 'rbac.' } };
    case 'platform':
      return { action: { startsWith: 'platform.' } };
    default:
      return {};
  }
}

/** Result filter → action patterns (mirrors `auditResultOf` in the shared contract). */
export function resultWhere(result: AuditQuery['result']): Prisma.AuditLogWhereInput {
  const denied: Prisma.AuditLogWhereInput = {
    OR: [
      { action: { endsWith: '.denied', mode: 'insensitive' } },
      { action: { endsWith: '.blocked', mode: 'insensitive' } },
      { action: { endsWith: '.forbidden', mode: 'insensitive' } },
      { action: { in: ['punch.rejected', 'tracker.sync.rejected'] } },
    ],
  };
  const failure: Prisma.AuditLogWhereInput = { OR: [{ action: { contains: 'fail', mode: 'insensitive' } }, { action: { contains: 'error', mode: 'insensitive' } }] };
  switch (result) {
    case 'denied':
      return denied;
    case 'failure':
      return { AND: [failure, { NOT: denied }] };
    case 'success':
      return { NOT: { OR: [denied, failure] } };
    default:
      return {};
  }
}

/** Short human summary: the producer's `meta.summary`, else a readable fallback. */
export function summarize(action: string, entity: string, entityId: string | null, meta: unknown): string {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  if (typeof m.summary === 'string') return m.summary;
  const verb = action.split('.').slice(1).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const extra = Object.entries(m)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
  return [`${entity}${entityId ? ` ${entityId.slice(-6)}` : ''} ${verb}`.trim(), extra].filter(Boolean).join(' — ');
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [tabWhere(q.tab)];
    if (q.actor === 'system') and.push({ actorUserId: null });
    else if (q.actor) and.push({ actorUserId: q.actor });
    if (q.action) and.push({ action: { contains: q.action, mode: 'insensitive' } });
    if (q.module) and.push({ OR: [{ action: { startsWith: `${q.module}.` } }, { action: q.module }] });
    if (q.result) and.push(resultWhere(q.result));
    if (q.entity) and.push({ entity: q.entity });
    if (q.entityId) and.push({ entityId: { contains: q.entityId } });
    if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { gte: istStart(q.from) } : {}), ...(q.to ? { lte: istEnd(q.to) } : {}) } });
    if (q.q) and.push({ OR: [{ actorName: { contains: q.q, mode: 'insensitive' } }, { action: { contains: q.q, mode: 'insensitive' } }, { entity: { contains: q.q, mode: 'insensitive' } }] });
    return { AND: and };
  }

  private row(r: { id: string; createdAt: Date; actorUserId: string | null; actorName: string | null; action: string; entity: string; entityId: string | null; meta: Prisma.JsonValue; ip: string | null }): AuditRowDto {
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorName: r.actorName ?? 'System',
      action: r.action,
      module: r.action.split('.')[0] ?? r.action,
      entity: r.entity,
      entityId: r.entityId,
      summary: summarize(r.action, r.entity, r.entityId, r.meta),
      ip: r.ip,
      meta: r.meta,
      platform: r.action.startsWith('platform.'),
      result: auditResultOf(r.action),
    };
  }

  async list(q: AuditQuery): Promise<Paginated<AuditRowDto> & { counts: Record<string, number> }> {
    const where = this.where(q);
    const base = this.where({ ...q, tab: 'all' });
    const [rows, total, ...counts] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
      ...(['all', 'security', 'access', 'platform'] as const).map((t) => this.prisma.auditLog.count({ where: { AND: [base, tabWhere(t)] } })),
    ]);
    return {
      ...paginated(rows.map((r) => this.row(r)), total, q),
      counts: { all: counts[0]!, security: counts[1]!, access: counts[2]!, platform: counts[3]! },
    };
  }

  async get(id: string): Promise<AuditRowDto | null> {
    const r = await this.prisma.auditLog.findUnique({ where: { id } });
    return r ? this.row(r) : null;
  }

  async facets(): Promise<AuditFacets> {
    const [actors, entities, actions] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { actorUserId: { not: null } }, distinct: ['actorUserId'], select: { actorUserId: true, actorName: true }, take: 200 }),
      this.prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, take: 200 }),
      this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, take: 500 }),
    ]);
    return {
      actors: [{ value: 'system', label: 'System' }, ...actors.map((a) => ({ value: a.actorUserId!, label: a.actorName ?? 'Unknown' })).sort((a, b) => a.label.localeCompare(b.label))],
      entities: entities.map((e) => e.entity).sort(),
      modules: [...new Set(actions.map((a) => a.action.split('.')[0]!))].sort(),
    };
  }

  /** CSV export of the current filter (max 5,000 rows). */
  async csv(q: AuditQuery): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({ where: this.where(q), orderBy: { createdAt: 'desc' }, take: 5000 });
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['When (UTC)', 'Actor', 'Action', 'Module', 'Entity', 'Entity id', 'Summary', 'IP', 'Result'].join(',')];
    for (const r of rows) {
      const d = this.row(r);
      lines.push([d.createdAt, d.actorName, d.action, d.module, d.entity, d.entityId, d.summary, d.ip, d.result].map(esc).join(','));
    }
    return lines.join('\n');
  }
}
