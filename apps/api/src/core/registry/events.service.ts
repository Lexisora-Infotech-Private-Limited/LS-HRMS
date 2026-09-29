import { Injectable, Logger } from '@nestjs/common';
import { getContext, runWithContext } from '../context/request-context';

type Handler = (payload: any) => Promise<void> | void;

/**
 * In-process domain event bus. Producers emit after their transaction commits; consumers
 * in other modules subscribe in onModuleInit. Handlers run after the response path
 * (setImmediate) inside the same tenant context; failures are logged, never thrown.
 *
 * Canonical events (see docs/ARCHITECTURE.md §Events):
 *   attendance.punched, attendance.dayComputed, tracker.segmentsIngested, idle.claimDecided,
 *   timesheet.submitted, timesheet.approved, timesheet.returned, leave.requested, leave.decided,
 *   payroll.finalized, invoice.issued, invoice.paid, purchase.recorded, employee.created,
 *   employee.statusChanged, onboarding.completed, task.statusChanged, kudos.given, eotm.announced …
 */
@Injectable()
export class EventsService {
  private readonly log = new Logger('Events');
  private readonly handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, payload: Record<string, unknown>) {
    const ctx = getContext();
    const list = this.handlers.get(event) ?? [];
    for (const h of list) {
      setImmediate(() => {
        const run = async () => {
          try {
            await h(payload);
          } catch (e) {
            this.log.error(`${event} handler failed: ${(e as Error).stack ?? e}`);
          }
        };
        void (ctx ? runWithContext(ctx, run) : run());
      });
    }
  }

  /** Await all handlers (use when the caller needs the side effects done, e.g. seeds/tests). */
  async emitAndWait(event: string, payload: Record<string, unknown>) {
    for (const h of this.handlers.get(event) ?? []) await h(payload);
  }
}
