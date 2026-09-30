import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PeriodLockService } from '../../time/services/period-lock.service';

type LockLike = {
  lock(month: string, upTo?: Date | string, payrollRunId?: string): Promise<unknown>;
  unlock(month: string, reason: string): Promise<unknown>;
  isLocked(date: Date | string): Promise<boolean>;
};

/**
 * Port onto time's exported PeriodLockService (ARCHITECTURE §5: LeavepayModule imports TimeModule).
 * Resolved lazily and non-strictly so payroll keeps working while the time module is still being
 * wired; if the service is missing the lock is skipped with a warning (the run records it).
 */
@Injectable()
export class PeriodLockPort {
  private readonly log = new Logger('PayrollPeriodLock');
  private svc?: LockLike | null;

  constructor(private readonly moduleRef: ModuleRef) {}

  private resolve(): LockLike | null {
    if (this.svc) return this.svc;
    try {
      const s = this.moduleRef.get(PeriodLockService, { strict: false }) as unknown as LockLike | undefined;
      if (s && typeof s.lock === 'function') return (this.svc = s);
    } catch {
      /* not provided (yet) */
    }
    return null;
  }

  /** Returns a warning string when the lock could not be applied. */
  async lock(month: string, upTo: string, runId: string): Promise<string | null> {
    const s = this.resolve();
    if (!s) {
      this.log.warn('PeriodLockService is not available; attendance was not locked');
      return 'Attendance lock service unavailable; attendance was not locked';
    }
    try {
      await s.lock(month, upTo, runId);
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      this.log.warn(`Lock failed: ${msg}`);
      return `Attendance lock failed: ${msg}`;
    }
  }

  async unlock(month: string, reason: string): Promise<void> {
    const s = this.resolve();
    if (!s) return;
    try {
      await s.unlock(month, reason);
    } catch (e) {
      this.log.warn(`Unlock failed: ${(e as Error).message}`);
    }
  }
}
