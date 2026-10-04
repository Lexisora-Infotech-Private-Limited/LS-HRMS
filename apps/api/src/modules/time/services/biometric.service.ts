import { Injectable, Logger } from '@nestjs/common';
import type { BiometricDevice } from '@prisma/client';
import type { BiometricDeviceInput, BiometricDeviceRow, BiometricSimulateInput, EnrollmentRow, RawLogRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { requireContext, runAsTenant } from '../../../core/context/request-context';
import { AppError, notFound } from '../../../core/http/errors';
import { directionFromStatus, localToInstant, parseAttLog } from '../lib/adms';
import { IST_OFFSET_MIN } from '../lib/time-utils';
import { AttendanceService } from './attendance.service';

export { directionFromStatus, localToInstant, parseAttLog, type AttLogLine } from '../lib/adms';

/** Biometric devices (ZKTeco ADMS push protocol) — spec-time I. */
@Injectable()
export class BiometricService {
  private readonly log = new Logger('Biometric');
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── admin ────────────────────────────────────────────────────────────────
  async devices(): Promise<BiometricDeviceRow[]> {
    const rows = await this.prisma.biometricDevice.findMany({ orderBy: { name: 'asc' } });
    const locs = new Map((await this.prisma.workLocation.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const out: BiometricDeviceRow[] = [];
    for (const d of rows) out.push(await this.toRow(d, locs));
    return out;
  }

  private async toRow(d: BiometricDevice, locs: Map<string, string>): Promise<BiometricDeviceRow> {
    const unprocessed = await this.prisma.biometricRawLog.count({ where: { deviceId: d.id, processed: false } });
    const online = !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 30 * 60_000;
    return {
      id: d.id,
      serialNumber: d.serialNumber,
      name: d.name,
      locationId: d.locationId,
      locationName: d.locationId ? (locs.get(d.locationId) ?? null) : null,
      model: d.model,
      firmware: d.firmware,
      directionMode: d.directionMode,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastSeen: d.lastSeenAt ? d.lastSeenAt.toISOString() : 'Never',
      status: d.status === 'DISABLED' ? 'Disabled' : online ? 'Online' : 'Offline',
      unprocessed,
    };
  }

  async createDevice(input: BiometricDeviceInput) {
    const sn = input.serialNumber.toUpperCase();
    const exists = await this.prisma.raw.biometricDevice.findUnique({ where: { serialNumber: sn } });
    if (exists) throw new AppError(409, 'DUPLICATE', 'A device with this serial number is already registered');
    const d = await this.prisma.biometricDevice.create({ data: { serialNumber: sn, name: input.name, locationId: input.locationId ?? null, model: input.model ?? null, directionMode: input.directionMode ?? 'FIRST_LAST', status: input.status ?? 'ACTIVE' } as any });
    await this.prisma.raw.unclaimedBiometricDevice.deleteMany({ where: { serialNumber: sn } });
    await this.audit.record({ action: 'biometric.device.created', entity: 'BiometricDevice', entityId: d.id, meta: { serialNumber: sn, name: d.name } });
    return d;
  }

  async updateDevice(id: string, input: Partial<BiometricDeviceInput>) {
    const d = await this.prisma.biometricDevice.findFirst({ where: { id } });
    if (!d) throw notFound('Device');
    const saved = await this.prisma.biometricDevice.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.directionMode ? { directionMode: input.directionMode } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    await this.audit.record({ action: 'biometric.device.updated', entity: 'BiometricDevice', entityId: id, meta: input as any });
    return saved;
  }

  async deleteDevice(id: string) {
    const d = await this.prisma.biometricDevice.findFirst({ where: { id } });
    if (!d) throw notFound('Device');
    const logs = await this.prisma.biometricRawLog.count({ where: { deviceId: id } });
    if (logs) await this.prisma.biometricDevice.update({ where: { id }, data: { status: 'DISABLED' } });
    else await this.prisma.biometricDevice.delete({ where: { id } });
    await this.audit.record({ action: 'biometric.device.removed', entity: 'BiometricDevice', entityId: id, meta: { serialNumber: d.serialNumber, disabledOnly: !!logs } });
    return { ok: true };
  }

  async unclaimed() {
    return this.prisma.raw.unclaimedBiometricDevice.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 20 });
  }

  async enrollments(): Promise<EnrollmentRow[]> {
    const [emps, rows] = await Promise.all([
      this.prisma.employee.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE_PERIOD', 'ONBOARDING'] } }, select: { id: true, fullName: true, empCode: true, workMode: true }, orderBy: { fullName: 'asc' } }),
      this.prisma.biometricEnrollment.findMany(),
    ]);
    const pins = new Map(rows.map((r) => [r.employeeId, r.pin]));
    return emps.map((e) => ({ employeeId: e.id, name: e.fullName, empCode: e.empCode, pin: pins.get(e.id) ?? null, workMode: e.workMode }));
  }

  async setEnrollment(employeeId: string, pin: string) {
    const clash = await this.prisma.biometricEnrollment.findFirst({ where: { pin, employeeId: { not: employeeId } } });
    if (clash) throw new AppError(409, 'PIN_IN_USE', 'This PIN is already enrolled for another employee');
    const existing = await this.prisma.biometricEnrollment.findFirst({ where: { employeeId } });
    if (existing) await this.prisma.biometricEnrollment.update({ where: { id: existing.id }, data: { pin } });
    else await this.prisma.biometricEnrollment.create({ data: { employeeId, pin } as any });
    await this.audit.record({ action: 'biometric.enrollment.set', entity: 'BiometricEnrollment', entityId: employeeId, meta: { pin } });
    // Re-process logs that were waiting for this PIN.
    const waiting = await this.prisma.biometricRawLog.findMany({ where: { pin, processed: false, error: 'UNKNOWN_PIN' }, orderBy: { punchedAt: 'asc' } });
    for (const w of waiting) {
      const d = await this.prisma.biometricDevice.findFirst({ where: { id: w.deviceId } });
      if (d) await this.processLog(d, w.id);
    }
    return { ok: true, reprocessed: waiting.length };
  }

  async logs(deviceId?: string): Promise<RawLogRow[]> {
    const rows = await this.prisma.biometricRawLog.findMany({ where: deviceId ? { deviceId } : {}, orderBy: { receivedAt: 'desc' }, take: 100 });
    const names = new Map((await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    return rows.map((r) => ({ id: r.id, pin: r.pin, employeeName: r.employeeId ? (names.get(r.employeeId) ?? null) : null, punchedAtLocal: r.punchedAtLocal, statusCode: r.statusCode, processed: r.processed, error: r.error, receivedAt: r.receivedAt.toISOString() }));
  }

  /** Retry raw logs that could not become punches (unknown PIN fixed by enrolling, period unlocked, …). */
  async reprocess(deviceId?: string) {
    const rows = await this.prisma.biometricRawLog.findMany({ where: { processed: false, ...(deviceId ? { deviceId } : {}) }, orderBy: { punchedAt: 'asc' }, take: 500 });
    const devices = new Map<string, BiometricDevice | null>();
    let accepted = 0;
    for (const r of rows) {
      if (!devices.has(r.deviceId)) devices.set(r.deviceId, await this.prisma.biometricDevice.findFirst({ where: { id: r.deviceId } }));
      const d = devices.get(r.deviceId);
      if (d && (await this.processLog(d, r.id))) accepted++;
    }
    const left = await this.prisma.biometricRawLog.count({ where: { processed: false, ...(deviceId ? { deviceId } : {}) } });
    await this.audit.record({ action: 'biometric.logs.reprocessed', entity: 'BiometricDevice', entityId: deviceId ?? 'all', meta: { total: rows.length, accepted, left } });
    return {
      ok: true,
      total: rows.length,
      accepted,
      left,
      message: rows.length ? `${accepted} of ${rows.length} logs turned into punches${left ? ` · ${left} still need attention` : ''}` : 'Nothing waiting to be processed',
    };
  }

  /** Device health (spec-time I6): during 06:00–22:00 IST alert HR once when a device is silent for 30+ min. */
  async offlineCheck(now = new Date()) {
    const minute = (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % 1440;
    if (minute < 6 * 60 || minute >= 22 * 60) return 0;
    const silent = await this.prisma.biometricDevice.findMany({ where: { status: 'ACTIVE', lastSeenAt: { not: null, lt: new Date(now.getTime() - 30 * 60_000) } } });
    let n = 0;
    for (const d of silent) {
      const link = `/attendance?view=devices&device=${d.id}`;
      const already = await this.prisma.notification.count({ where: { type: 'biometric.offline', link, createdAt: { gte: d.lastSeenAt! } } });
      if (already) continue;
      const since = new Date(d.lastSeenAt!.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
      await this.notifications.notify({
        userIds: await this.notifications.usersWithPermission('attendance.manage'),
        type: 'biometric.offline',
        title: `Biometric device ${d.name} offline since ${since}`,
        body: `Serial ${d.serialNumber}. Punches made on it will sync when it reconnects.`,
        link,
        from: 'Attendance',
        email: true,
      });
      n++;
    }
    return n;
  }

  /** HR simulator: push one ATTLOG line through the same pipeline as a real device. */
  async simulate(input: BiometricSimulateInput) {
    const ctx = requireContext();
    const d = await this.prisma.biometricDevice.findFirst({ where: { serialNumber: input.serialNumber.toUpperCase() } });
    if (!d) throw notFound('Device');
    const at = input.at ? (input.at.length === 16 ? `${input.at}:00` : input.at).replace('T', ' ') : istLocalNow();
    const line = [input.pin, at, input.status ?? '', 1, 0].join('\t');
    const res = await this.ingest(d, line);
    await this.audit.record({ action: 'biometric.simulated', entity: 'BiometricDevice', entityId: d.id, meta: { pin: input.pin, at, by: ctx.userName ?? null } });
    const last = (await this.logs(d.id))[0];
    return { ...res, log: last ?? null };
  }

  // ── ADMS protocol (public, device SN auth) ──────────────────────────────
  /** Resolve the device by serial number; unknown devices are recorded as unclaimed. */
  async deviceBySn(sn: string, ip?: string, touch = true): Promise<BiometricDevice | null> {
    const serial = (sn ?? '').trim().toUpperCase();
    if (!serial) return null;
    const d = await this.prisma.raw.biometricDevice.findUnique({ where: { serialNumber: serial } });
    if (!touch) return d && d.status !== 'DISABLED' ? d : null;
    if (!d) {
      await this.prisma.raw.unclaimedBiometricDevice.upsert({ where: { serialNumber: serial }, create: { serialNumber: serial, ip: ip ?? null }, update: { lastSeenAt: new Date(), ip: ip ?? null } }).catch(() => undefined);
      return null;
    }
    if (d.status === 'DISABLED') return null;
    await this.prisma.raw.biometricDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    return d;
  }

  handshake(d: BiometricDevice): string {
    return [
      `GET OPTION FROM: ${d.serialNumber}`,
      `ATTLOGStamp=${d.attLogStamp ?? 'None'}`,
      'OPERLOGStamp=9999',
      'ATTPHOTOStamp=None',
      'ErrorDelay=30',
      'Delay=10',
      'TransTimes=00:00;14:05',
      'TransInterval=1',
      'TransFlag=TransData AttLog',
      'TimeZone=330',
      'Realtime=1',
      'Encrypt=None',
    ].join('\n');
  }

  /** POST cdata?table=ATTLOG: store raw lines idempotently and turn them into punches. */
  async ingest(d: BiometricDevice, body: string, stamp?: string | null): Promise<{ received: number; accepted: number }> {
    return runAsTenant(d.tenantId, async () => {
      const lines = parseAttLog(body);
      let accepted = 0;
      for (const l of lines) {
        const existing = await this.prisma.biometricRawLog.findFirst({ where: { deviceId: d.id, pin: l.pin, punchedAtLocal: l.local } });
        if (existing) continue;
        const row = await this.prisma.biometricRawLog.create({
          data: { deviceId: d.id, pin: l.pin, punchedAtLocal: l.local, punchedAt: localToInstant(l.local), statusCode: l.status, verifyCode: l.verify, workCode: l.workCode, raw: l.raw } as any,
        });
        if (await this.processLog(d, row.id)) accepted++;
      }
      if (stamp) await this.prisma.biometricDevice.update({ where: { id: d.id }, data: { attLogStamp: stamp } });
      return { received: lines.length, accepted };
    });
  }

  private async processLog(d: BiometricDevice, rawId: string): Promise<boolean> {
    const r = await this.prisma.biometricRawLog.findFirst({ where: { id: rawId } });
    if (!r || r.processed) return false;
    const enr = await this.prisma.biometricEnrollment.findFirst({ where: { pin: r.pin } });
    if (!enr) {
      await this.prisma.biometricRawLog.update({ where: { id: r.id }, data: { error: 'UNKNOWN_PIN' } });
      return false;
    }
    if (r.punchedAt.getTime() > Date.now() + 10 * 60_000) {
      await this.prisma.biometricRawLog.update({ where: { id: r.id }, data: { error: 'DEVICE_CLOCK', employeeId: enr.employeeId } });
      return false;
    }
    try {
      const direction = d.directionMode === 'DEVICE_STATUS' ? directionFromStatus(r.statusCode) : undefined;
      const res = await this.attendance.punch({
        employeeId: enr.employeeId,
        direction,
        source: 'BIOMETRIC',
        at: r.punchedAt,
        biometricDeviceId: d.id,
        locationId: d.locationId,
        clientEventId: `${d.serialNumber}|${r.pin}|${r.punchedAtLocal}`,
        storeUnknownDirection: d.directionMode === 'FIRST_LAST',
      });
      await this.prisma.biometricRawLog.update({ where: { id: r.id }, data: { processed: true, punchId: res.punchId, employeeId: enr.employeeId, error: res.duplicate ? 'DUPLICATE' : null } });
      return !res.duplicate;
    } catch (e) {
      const code = (e as any)?.response?.code ?? 'ERROR';
      this.log.warn(`ATTLOG ${d.serialNumber} pin ${r.pin} @ ${r.punchedAtLocal}: ${code}`);
      await this.prisma.biometricRawLog.update({ where: { id: r.id }, data: { error: String(code).slice(0, 40), employeeId: enr.employeeId, processed: code !== 'PERIOD_LOCKED' ? true : false } });
      return false;
    }
  }
}

function istLocalNow(): string {
  const d = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

