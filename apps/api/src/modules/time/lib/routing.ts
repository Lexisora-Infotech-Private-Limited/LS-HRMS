/**
 * Timesheet approval routing (spec-time K3 + audit G3), pure.
 *
 *  L1: one step per project that has minutes on the sheet, approver = project lead.
 *      - internal projects (INT stand-ups, training) have no L1 — the RM reviews them at L2
 *      - a project without a lead has no L1 (falls to L2)
 *      - when the lead is the employee: SKIPPED_SELF
 *  L2: approver = employee.managerId → fallback approver → any admin.
 *      - skipDuplicateApprover: when the RM already approved an L1 step this cycle → SKIPPED_DUPLICATE
 */

export type RouteLine = { projectId: string | null; minutes: number };
export type ProjectInfo = { id: string; name: string; isInternal: boolean; leadEmployeeId: string | null };
export type L1Plan = { projectId: string; projectName: string; approverEmployeeId: string; status: 'PENDING' | 'SKIPPED_SELF' };

export function planL1(employeeId: string, lines: RouteLine[], projects: Map<string, ProjectInfo>): L1Plan[] {
  const minutesByProject = new Map<string, number>();
  for (const l of lines) {
    if (!l.projectId || l.minutes <= 0) continue;
    minutesByProject.set(l.projectId, (minutesByProject.get(l.projectId) ?? 0) + l.minutes);
  }
  const out: L1Plan[] = [];
  for (const projectId of minutesByProject.keys()) {
    const p = projects.get(projectId);
    if (!p || p.isInternal || !p.leadEmployeeId) continue;
    out.push({
      projectId,
      projectName: p.name,
      approverEmployeeId: p.leadEmployeeId,
      status: p.leadEmployeeId === employeeId ? 'SKIPPED_SELF' : 'PENDING',
    });
  }
  return out.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export type L2Plan = { approverEmployeeId: string; status: 'PENDING' | 'SKIPPED_DUPLICATE' } | null;

export function planL2(p: {
  employeeId: string;
  managerId: string | null;
  fallbackApproverId?: string | null;
  adminEmployeeIds?: string[];
  l1ApprovedBy: string[];
  skipDuplicateApprover: boolean;
}): L2Plan {
  const candidates = [p.managerId, p.fallbackApproverId, ...(p.adminEmployeeIds ?? [])].filter((x): x is string => !!x && x !== p.employeeId);
  const approver = candidates[0];
  if (!approver) return null;
  if (p.skipDuplicateApprover && p.l1ApprovedBy.includes(approver)) return { approverEmployeeId: approver, status: 'SKIPPED_DUPLICATE' };
  return { approverEmployeeId: approver, status: 'PENDING' };
}

/** Status after submit / after an L1 decision, given the L1 step states. */
export function statusAfterL1(l1Statuses: string[]): 'SUBMITTED' | 'L2' {
  return l1Statuses.some((s) => s === 'PENDING') ? 'SUBMITTED' : 'L2';
}

/** Submit toast (J1): one PL → "Timesheet sent to Arjun Mehta (Project Lead)"; several → "Sent to 2 Project Leads". */
export function submitMessage(pendingL1Names: string[], l2Name: string | null, finalStatus: string): string {
  if (pendingL1Names.length === 1) return `Timesheet sent to ${pendingL1Names[0]} (Project Lead)`;
  if (pendingL1Names.length > 1) return `Sent to ${pendingL1Names.length} Project Leads`;
  if (finalStatus === 'APPROVED') return 'Timesheet approved · sent to payroll';
  return l2Name ? `Timesheet sent to ${l2Name} (Reporting Manager)` : 'Timesheet submitted';
}
