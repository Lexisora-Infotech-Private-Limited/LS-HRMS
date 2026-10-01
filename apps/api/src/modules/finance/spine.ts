import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Read-only access to other domains' spine models (docs/ARCHITECTURE.md §4): work `Client`,
 * `Project`, `Task`; time `Timesheet`, `TimesheetLine`, `TimesheetCell`. Typed locally with
 * only the fields finance needs so this module doesn't break while those schemas evolve.
 * Finance never writes these tables — billed cells are locked via `InvoiceTimeEntry`.
 */
export type SpineClient = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  isInternal: boolean;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode: string | null;
  billingEmails: string[];
  defaultRatePerHourPaise: number | null;
  paymentTermsDays: number;
  status: string;
};
export type SpineProject = { id: string; key: string; name: string; clientId: string | null; isInternal: boolean; billable: boolean; ratePerHourPaise: number | null; status: string };
export type SpineTimesheet = { id: string; employeeId: string; status: string; weekStart: Date };
export type SpineLine = { id: string; timesheetId: string; projectId: string | null; taskId: string | null; label: string; billable: boolean };
export type SpineCell = { id: string; lineId: string; date: Date; finalMinutes: number };
export type SpineTask = { id: string; key: string; title: string };

type Finder<T> = { findMany(args?: unknown): Promise<T[]>; findFirst(args?: unknown): Promise<T | null> };
type SpineDb = {
  client?: Finder<SpineClient>;
  project?: Finder<SpineProject>;
  task?: Finder<SpineTask>;
  timesheet?: Finder<SpineTimesheet>;
  timesheetLine?: Finder<SpineLine>;
  timesheetCell?: Finder<SpineCell>;
};

/** Timesheet statuses whose billable hours can be invoiced (L1 Project-Lead approval reached). */
export const BILLABLE_SHEET_STATUSES = ['PENDING_RM', 'APPROVED', 'LOCKED'];
export const PENDING_SHEET_STATUSES = ['SUBMITTED'];

@Injectable()
export class SpineReader {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): SpineDb {
    return this.prisma as unknown as SpineDb;
  }

  async clients(where: Record<string, unknown> = {}): Promise<SpineClient[]> {
    return (await this.db.client?.findMany({ where, orderBy: { name: 'asc' } })) ?? [];
  }
  async client(id: string): Promise<SpineClient | null> {
    return (await this.db.client?.findFirst({ where: { id } })) ?? null;
  }
  async clientByName(name: string): Promise<SpineClient | null> {
    return (await this.db.client?.findFirst({ where: { name } })) ?? null;
  }
  async projects(where: Record<string, unknown> = {}): Promise<SpineProject[]> {
    return (await this.db.project?.findMany({ where, orderBy: { name: 'asc' } })) ?? [];
  }
  async project(id: string): Promise<SpineProject | null> {
    return (await this.db.project?.findFirst({ where: { id } })) ?? null;
  }
  async tasks(ids: string[]): Promise<SpineTask[]> {
    if (!ids.length) return [];
    return (await this.db.task?.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, title: true } })) ?? [];
  }

  /**
   * Billable timesheet cells for a project in [start, end], split into invoiceable
   * (L1-approved sheets) and pending (submitted, not yet approved).
   */
  async billableCells(projectId: string, start: Date, end: Date) {
    if (!this.db.timesheetLine || !this.db.timesheet || !this.db.timesheetCell) return { approved: [], pending: [], sheets: new Map<string, SpineTimesheet>(), lines: new Map<string, SpineLine>() };
    const lines = await this.db.timesheetLine.findMany({ where: { projectId, billable: true }, select: { id: true, timesheetId: true, projectId: true, taskId: true, label: true, billable: true } });
    if (!lines.length) return { approved: [], pending: [], sheets: new Map<string, SpineTimesheet>(), lines: new Map<string, SpineLine>() };
    const sheets = await this.db.timesheet.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.timesheetId))] } }, select: { id: true, employeeId: true, status: true, weekStart: true } });
    const sheetById = new Map(sheets.map((s) => [s.id, s]));
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const cells = await this.db.timesheetCell.findMany({
      where: { lineId: { in: lines.map((l) => l.id) }, date: { gte: start, lte: end }, finalMinutes: { gt: 0 } },
      select: { id: true, lineId: true, date: true, finalMinutes: true },
    });
    const approved: SpineCell[] = [];
    const pending: SpineCell[] = [];
    for (const c of cells) {
      const st = sheetById.get(lineById.get(c.lineId)?.timesheetId ?? '')?.status ?? '';
      if (BILLABLE_SHEET_STATUSES.includes(st)) approved.push(c);
      else if (PENDING_SHEET_STATUSES.includes(st)) pending.push(c);
    }
    return { approved, pending, sheets: sheetById, lines: lineById };
  }

  /** Cell id → timesheet status, only for cells whose sheet is still invoiceable (L1+ approved). */
  async cellSheetStatus(cellIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!cellIds.length || !this.db.timesheetCell || !this.db.timesheetLine || !this.db.timesheet) return out;
    const cells = await this.db.timesheetCell.findMany({ where: { id: { in: cellIds } }, select: { id: true, lineId: true } });
    const lines = await this.db.timesheetLine.findMany({ where: { id: { in: [...new Set(cells.map((c) => c.lineId))] } }, select: { id: true, timesheetId: true } });
    const sheets = await this.db.timesheet.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.timesheetId))] } }, select: { id: true, status: true } });
    const lineSheet = new Map(lines.map((l) => [l.id, l.timesheetId]));
    const status = new Map(sheets.map((s) => [s.id, s.status]));
    for (const c of cells) {
      const st = status.get(lineSheet.get(c.lineId) ?? '') ?? '';
      if (BILLABLE_SHEET_STATUSES.includes(st)) out.set(c.id, st);
    }
    return out;
  }
}
