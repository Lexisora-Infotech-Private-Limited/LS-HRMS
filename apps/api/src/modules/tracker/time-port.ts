import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AppError } from '../../core/http/errors';

export type PunchCall = {
  employeeId: string;
  direction: 'IN' | 'OUT';
  source: 'DESKTOP';
  at?: Date;
  deviceId?: string;
};

type AttendanceLike = { punch(input: PunchCall & Record<string, unknown>): Promise<unknown> };

/**
 * Thin port onto the time domain's exported AttendanceService.punch (ARCHITECTURE §5:
 * TrackerModule imports TimeModule). Resolved lazily through ModuleRef (non-strict) so the
 * tracker compiles and boots independently of the time module's internal file layout.
 */
@Injectable()
export class TimePort {
  private svc?: AttendanceLike | null;

  constructor(private readonly moduleRef: ModuleRef) {}

  private resolve(): AttendanceLike | null {
    if (this.svc !== undefined) return this.svc;
    try {
      // Walk the container for a provider named AttendanceService exposing punch().
      const container = (this.moduleRef as any).container;
      for (const mod of container?.getModules?.().values?.() ?? []) {
        for (const [token, wrapper] of mod.providers ?? []) {
          const name = typeof token === 'function' ? token.name : String(token);
          if (name === 'AttendanceService' && wrapper?.instance && typeof wrapper.instance.punch === 'function') {
            this.svc = wrapper.instance as AttendanceLike;
            return this.svc;
          }
        }
      }
    } catch {
      /* fall through */
    }
    this.svc = null;
    return null;
  }

  async punch(input: PunchCall): Promise<unknown> {
    const svc = this.resolve();
    if (!svc) throw new AppError(503, 'ATTENDANCE_UNAVAILABLE', 'Attendance service is not available. Try again shortly.');
    return svc.punch(input);
  }
}
