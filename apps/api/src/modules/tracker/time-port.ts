import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AppError } from '../../core/http/errors';
import { AttendanceService } from '../time/services/attendance.service';

export type PunchCall = {
  employeeId: string;
  direction: 'IN' | 'OUT';
  source: 'DESKTOP';
  at?: Date;
  deviceId?: string;
  clientEventId?: string | null;
};

type AttendanceLike = { punch(input: PunchCall & Record<string, unknown>): Promise<unknown> };

/**
 * Port onto the time domain's exported AttendanceService.punch (ARCHITECTURE §5: TrackerModule
 * imports TimeModule). Resolved lazily (non-strict) so the tracker boots even while the time
 * module is still wiring its providers; a missing service surfaces as a 503 on punch only.
 */
@Injectable()
export class TimePort {
  private readonly log = new Logger('TrackerTimePort');
  private svc?: AttendanceLike | null;

  constructor(private readonly moduleRef: ModuleRef) {}

  private resolve(): AttendanceLike | null {
    if (this.svc) return this.svc;
    try {
      const s = this.moduleRef.get(AttendanceService, { strict: false }) as unknown as AttendanceLike | undefined;
      if (s && typeof s.punch === 'function') return (this.svc = s);
    } catch {
      /* not registered (yet) */
    }
    try {
      // fallback: look the provider up by name (e.g. if the class was re-exported elsewhere)
      const container = (this.moduleRef as any).container;
      for (const mod of container?.getModules?.().values?.() ?? []) {
        for (const [token, wrapper] of mod.providers ?? []) {
          const name = typeof token === 'function' ? token.name : String(token);
          if (name === 'AttendanceService' && wrapper?.instance && typeof wrapper.instance.punch === 'function') {
            return (this.svc = wrapper.instance as AttendanceLike);
          }
        }
      }
    } catch (e) {
      this.log.warn(`AttendanceService lookup failed: ${(e as Error).message}`);
    }
    return null;
  }

  async punch(input: PunchCall): Promise<unknown> {
    const svc = this.resolve();
    if (!svc) throw new AppError(503, 'ATTENDANCE_UNAVAILABLE', 'Attendance service is not available. Try again shortly.');
    return svc.punch(input);
  }
}
