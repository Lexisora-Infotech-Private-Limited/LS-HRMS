import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Camera } from '@prisma/client';
import type { CameraRow, CctvListResponse, CctvSessionRow, CctvView } from '@lexisora/shared';
import { z } from 'zod';
import type { cameraUpdateSchema, cameraUpsertSchema } from '@lexisora/shared';
import { env } from '../../../config/env';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CryptoService } from '../../../core/crypto/crypto.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { hasPerm } from '../../../core/auth/decorators';
import { currentTenantId, requireContext } from '../../../core/context/request-context';
import { AppError, conflict, forbidden, notFound } from '../../../core/http/errors';
import { dayMonth, hhmm } from '../common/dates';
import { gatewayFromEnv, type StreamGateway } from './adapters/gateway';
import { cameraTile, maskRtsp, nextHealth, RECONNECT_COOLDOWN_MS, SESSION_IDLE_MS, signViewToken, verifyViewToken, VIEW_TOKEN_TTL_MS } from './cctv.rules';

type CameraInput = z.infer<typeof cameraUpsertSchema>;

/**
 * CCTV (spec §11): cameras with an encrypted RTSP URL (never sent to the browser), HLS through
 * the MediaMTX gateway when CCTV_GATEWAY_URL is set (placeholder tiles otherwise), audited
 * viewing sessions with heartbeats, reconnects and a health poll that alerts on offline cameras.
 */
@Injectable()
export class CctvService {
  private readonly log = new Logger('Cctv');
  readonly gateway: StreamGateway = gatewayFromEnv();
  private readonly failures = new Map<string, number>();
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private canManage() {
    return hasPerm(requireContext(), 'cctv.manage');
  }

  private row(c: Camera, manage: boolean): CameraRow {
    const lastSeen = c.lastSeenAt ? hhmm(c.lastSeenAt) : null;
    const t = cameraTile({ status: c.status, enabled: c.enabled, location: c.location, lastSeen });
    return { id: c.id, name: c.name, location: c.location, status: c.enabled ? c.status : 'DISABLED', lastSeen: c.lastSeenAt ? `${dayMonth(c.lastSeenAt)} ${lastSeen}` : null, enabled: c.enabled, rtspMasked: manage ? c.rtspMasked : null, hlsUrl: null, sortOrder: c.sortOrder, ...t };
  }

  async list(location?: string): Promise<CctvListResponse> {
    const manage = this.canManage();
    const all = await this.prisma.camera.findMany({ where: manage ? {} : { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const locations = [...new Set(all.map((c) => c.location))].sort();
    const items = all.filter((c) => !location || c.location === location).map((c) => this.row(c, manage));
    let gatewayDown = false;
    if (this.gateway.mode === 'gateway' && all.length) {
      const p = await this.gateway.probe(all[0]!.gatewayPath, !!all[0]!.rtspUrlEnc);
      gatewayDown = !!p.error?.startsWith('Gateway unreachable');
    }
    return { items, locations, mode: this.gateway.mode, canManage: manage, gatewayDown };
  }

  private async camera(id: string): Promise<Camera> {
    const c = await this.prisma.camera.findFirst({ where: { id } });
    if (!c) throw notFound('Camera');
    return c;
  }

  private async probeAndStore(c: Camera): Promise<Camera> {
    const p = await this.gateway.probe(c.gatewayPath, !!c.rtspUrlEnc && c.enabled);
    const now = new Date();
    const updated = await this.prisma.camera.update({ where: { id: c.id }, data: p.ready ? { status: 'ONLINE', lastSeenAt: now, lastError: null } : { status: 'OFFLINE', lastError: p.error } });
    this.failures.set(c.id, p.ready ? 0 : 2);
    await this.broadcast(updated);
    return updated;
  }

  private async broadcast(c: Camera) {
    const users = await this.notifications.usersWithPermission('cctv.view');
    this.realtime.toUsers(users, 'cctv:status', { cameraId: c.id, status: c.enabled ? c.status : 'DISABLED', lastSeenAt: c.lastSeenAt?.toISOString() ?? null });
  }

  async create(dto: CameraInput): Promise<CameraRow> {
    if (!this.canManage()) throw forbidden();
    if (await this.prisma.camera.findFirst({ where: { name: dto.name } })) throw conflict(`A camera named ${dto.name} already exists`, 'CAMERA_EXISTS');
    const gatewayPath = `t_${currentTenantId().slice(-6)}_${randomBytes(4).toString('hex')}`;
    const c = await this.prisma.camera.create({
      data: { tenantId: currentTenantId(), name: dto.name, location: dto.location, branchId: dto.branchId ?? null, rtspUrlEnc: this.crypto.encrypt(dto.rtspUrl ?? null), rtspMasked: maskRtsp(dto.rtspUrl), gatewayPath, enabled: dto.enabled, sortOrder: dto.sortOrder, status: dto.enabled ? 'UNKNOWN' : 'DISABLED' },
    });
    if (dto.rtspUrl) await this.gateway.upsertPath(gatewayPath, dto.rtspUrl).catch((e) => this.log.warn(`gateway upsert: ${(e as Error).message}`));
    await this.audit.record({ action: 'cctv.camera.create', entity: 'Camera', entityId: c.id, meta: { name: c.name, location: c.location } });
    const probed = dto.enabled && dto.rtspUrl ? await this.probeAndStore(c) : c;
    return this.row(probed, true);
  }

  async update(id: string, dto: z.infer<typeof cameraUpdateSchema>): Promise<CameraRow> {
    if (!this.canManage()) throw forbidden();
    const c = await this.camera(id);
    if (dto.name && dto.name !== c.name && (await this.prisma.camera.findFirst({ where: { name: dto.name, id: { not: id } } }))) throw conflict(`A camera named ${dto.name} already exists`, 'CAMERA_EXISTS');
    const rtspChanged = dto.rtspUrl !== undefined && dto.rtspUrl !== null && dto.rtspUrl !== '';
    const enabled = dto.enabled ?? c.enabled;
    const updated = await this.prisma.camera.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.location ? { location: dto.location } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(rtspChanged ? { rtspUrlEnc: this.crypto.encrypt(dto.rtspUrl!), rtspMasked: maskRtsp(dto.rtspUrl) } : {}),
        enabled,
        ...(enabled ? (c.status === 'DISABLED' ? { status: 'UNKNOWN' as const } : {}) : { status: 'DISABLED' as const }),
      },
    });
    if (rtspChanged) await this.gateway.upsertPath(c.gatewayPath, dto.rtspUrl!).catch((e) => this.log.warn(`gateway upsert: ${(e as Error).message}`));
    if (!enabled) await this.gateway.removePath(c.gatewayPath);
    await this.audit.record({ action: 'cctv.camera.update', entity: 'Camera', entityId: id, meta: { name: updated.name, rtspChanged, enabled } });
    const final = enabled && (rtspChanged || c.status === 'DISABLED') ? await this.probeAndStore(updated) : updated;
    await this.broadcast(final);
    return this.row(final, true);
  }

  async remove(id: string): Promise<{ ok: true }> {
    if (!this.canManage()) throw forbidden();
    const c = await this.camera(id);
    await this.gateway.removePath(c.gatewayPath);
    await this.prisma.cameraViewSession.updateMany({ where: { cameraId: id, endedAt: null }, data: { endedAt: new Date() } });
    await this.prisma.camera.delete({ where: { id } });
    await this.audit.record({ action: 'cctv.camera.delete', entity: 'Camera', entityId: id, meta: { name: c.name } });
    return { ok: true };
  }

  async test(id: string): Promise<CameraRow & { message: string }> {
    if (!this.canManage()) throw forbidden();
    const c = await this.probeAndStore(await this.camera(id));
    await this.audit.record({ action: 'cctv.camera.test', entity: 'Camera', entityId: id, meta: { status: c.status } });
    return { ...this.row(c, true), message: c.status === 'ONLINE' ? `${c.name} is streaming` : `${c.name}: ${c.lastError ?? 'no video'}` };
  }

  /** Reconnect (cctv.view): restart the gateway path, then re-probe; at most once per 30 s per camera. */
  async reconnect(id: string): Promise<CameraRow & { message: string }> {
    const c = await this.camera(id);
    if (!c.enabled) throw conflict('This camera is disabled', 'CAMERA_DISABLED');
    if (c.lastReconnect && Date.now() - c.lastReconnect.getTime() < RECONNECT_COOLDOWN_MS) throw new AppError(429, 'CCTV_RECONNECT_COOLDOWN', 'Reconnect was just tried — give it a few seconds');
    const marked = await this.prisma.camera.update({ where: { id }, data: { lastReconnect: new Date(), status: 'UNKNOWN' } });
    await this.broadcast(marked);
    const source = this.crypto.decrypt(c.rtspUrlEnc);
    await this.gateway.restartPath(c.gatewayPath, source).catch((e) => this.log.warn(`restart ${c.gatewayPath}: ${(e as Error).message}`));
    await this.audit.record({ action: 'cctv.camera.reconnect', entity: 'Camera', entityId: id, meta: { name: c.name } });
    if (this.gateway.mode === 'gateway') await new Promise((r) => setTimeout(r, 2500));
    const probed = await this.probeAndStore(marked);
    return { ...this.row(probed, this.canManage()), message: probed.status === 'ONLINE' ? `${c.name} is back online` : `${c.name} is still offline` };
  }

  // ── Viewing sessions (always audited) ───────────────────────────────────

  private secret() {
    return `${env.JWT_ACCESS_SECRET}:cctv`;
  }

  async view(cameraId: string): Promise<CctvView> {
    const ctx = requireContext();
    const c = await this.camera(cameraId);
    if (!c.enabled) throw conflict('This camera is disabled', 'CAMERA_DISABLED');
    const s = await this.prisma.cameraViewSession.create({ data: { tenantId: ctx.tenantId, cameraId, userId: ctx.userId! } });
    await this.audit.record({ action: 'cctv.view.start', entity: 'Camera', entityId: cameraId, meta: { sessionId: s.id, camera: c.name } });
    const exp = Date.now() + VIEW_TOKEN_TTL_MS;
    return { sessionId: s.id, hlsUrl: this.gateway.hlsUrl(c.gatewayPath, signViewToken(this.secret(), { sid: s.id, path: c.gatewayPath, exp })), mode: this.gateway.mode, expiresAt: new Date(exp).toISOString() };
  }

  async heartbeat(sessionId: string): Promise<CctvView> {
    const ctx = requireContext();
    const s = await this.prisma.cameraViewSession.findFirst({ where: { id: sessionId, userId: ctx.userId! } });
    if (!s || s.endedAt) throw notFound('Viewing session');
    const c = await this.camera(s.cameraId);
    await this.prisma.cameraViewSession.update({ where: { id: s.id }, data: { lastBeatAt: new Date() } });
    const exp = Date.now() + VIEW_TOKEN_TTL_MS;
    return { sessionId: s.id, hlsUrl: this.gateway.hlsUrl(c.gatewayPath, signViewToken(this.secret(), { sid: s.id, path: c.gatewayPath, exp })), mode: this.gateway.mode, expiresAt: new Date(exp).toISOString() };
  }

  async endView(sessionId: string): Promise<{ ok: true }> {
    const ctx = requireContext();
    const s = await this.prisma.cameraViewSession.findFirst({ where: { id: sessionId, userId: ctx.userId! } });
    if (!s || s.endedAt) return { ok: true };
    const endedAt = new Date();
    await this.prisma.cameraViewSession.update({ where: { id: s.id }, data: { endedAt } });
    await this.audit.record({ action: 'cctv.view.end', entity: 'Camera', entityId: s.cameraId, meta: { sessionId: s.id, minutes: Math.max(1, Math.round((endedAt.getTime() - s.startedAt.getTime()) / 60_000)) } });
    return { ok: true };
  }

  async sessions(cameraId?: string): Promise<CctvSessionRow[]> {
    if (!this.canManage()) throw forbidden();
    const rows = await this.prisma.cameraViewSession.findMany({ where: cameraId ? { cameraId } : {}, orderBy: { startedAt: 'desc' }, take: 100 });
    const [cams, users] = await Promise.all([
      this.prisma.camera.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.cameraId))] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, employee: { select: { fullName: true } } } }),
    ]);
    const cam = new Map(cams.map((c) => [c.id, c.name]));
    const usr = new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.name]));
    return rows.map((r) => {
      const end = r.endedAt ?? r.lastBeatAt;
      return { id: r.id, camera: cam.get(r.cameraId) ?? 'Deleted camera', user: usr.get(r.userId) ?? 'Former user', startedAt: `${dayMonth(r.startedAt)} ${hhmm(r.startedAt)}`, endedAt: r.endedAt ? hhmm(r.endedAt) : null, minutes: Math.max(1, Math.round((end.getTime() - r.startedAt.getTime()) / 60_000)) };
    });
  }

  /** Gateway auth hook (MediaMTX `authHTTPAddress`): token must match the path and an open session. */
  async authorize(body: { path?: string; query?: string; action?: string }): Promise<boolean> {
    if (body.action && body.action !== 'read' && body.action !== 'playback') return false;
    const token = new URLSearchParams(body.query ?? '').get('token');
    if (!token || !body.path) return false;
    const t = verifyViewToken(this.secret(), token);
    if (!t || t.path !== body.path.replace(/^\//, '').split('/')[0]) return false;
    const s = await this.prisma.raw.cameraViewSession.findUnique({ where: { id: t.sid } });
    return !!s && !s.endedAt;
  }

  // ── Jobs ────────────────────────────────────────────────────────────────

  /** Gateway health poll (gateway mode only): two failed probes → OFFLINE + alert (1/camera/hour). */
  async healthPoll(): Promise<number> {
    if (this.gateway.mode !== 'gateway') return 0;
    const cams = await this.prisma.camera.findMany({ where: { enabled: true } });
    let changed = 0;
    for (const c of cams) {
      const p = await this.gateway.probe(c.gatewayPath, !!c.rtspUrlEnc);
      const h = nextHealth({ status: c.status, failures: this.failures.get(c.id) ?? 0 }, p.ready);
      this.failures.set(c.id, h.failures);
      if (h.status === c.status && !p.ready) continue;
      const updated = await this.prisma.camera.update({ where: { id: c.id }, data: p.ready ? { status: 'ONLINE', lastSeenAt: new Date(), lastError: null } : { status: h.status, lastError: p.error } });
      if (h.status !== c.status) {
        changed++;
        await this.broadcast(updated);
      }
      if (h.wentOffline && Date.now() - (this.alerted.get(c.id) ?? 0) > 3_600_000) {
        this.alerted.set(c.id, Date.now());
        const users = await this.notifications.usersWithPermission('cctv.manage');
        await this.notifications.notify({ userIds: users, type: 'cctv.offline', title: `Camera offline: ${c.name}`, body: `${c.location}${p.error ? ` · ${p.error}` : ''}`, link: '/cctv' });
      }
    }
    return changed;
  }

  /** Sessions without a heartbeat for 3 minutes are closed. */
  async reapSessions(now = Date.now()): Promise<number> {
    const stale = await this.prisma.cameraViewSession.findMany({ where: { endedAt: null, lastBeatAt: { lt: new Date(now - SESSION_IDLE_MS) } } });
    for (const s of stale) {
      await this.prisma.cameraViewSession.update({ where: { id: s.id }, data: { endedAt: s.lastBeatAt } });
      await this.audit.record({ action: 'cctv.view.end', entity: 'Camera', entityId: s.cameraId, meta: { sessionId: s.id, reaped: true } }).catch(() => undefined);
    }
    return stale.length;
  }
}
