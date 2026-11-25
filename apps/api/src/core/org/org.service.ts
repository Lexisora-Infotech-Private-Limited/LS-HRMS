import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireContext } from '../context/request-context';
import { AppError } from '../http/errors';

/** A person on someone's reporting line, with what their role lets them do. */
export type ChainPerson = {
  id: string;
  fullName: string;
  status: string;
  managerId: string | null;
  user: { status: string; role: { permissions: string[] } | null } | null;
};

const CHAIN_SELECT = {
  id: true,
  fullName: true,
  status: true,
  managerId: true,
  user: { select: { status: true, role: { select: { permissions: true } } } },
} as const;

/** Pure: still employed, can sign in, and their role has one of `perms` (or every permission). */
export function canActWith(p: ChainPerson, perms: readonly string[]): boolean {
  if (p.status === 'EXITED' || !p.user || p.user.status === 'DISABLED') return false;
  const own = p.user.role?.permissions ?? [];
  return own.includes('*') || perms.some((x) => own.includes(x));
}

/** How far up a reporting line we look for an approver (guards against very deep or looped charts). */
const MAX_CHAIN_DEPTH = 15;

/** Common lookups about the org chart used by many domains. */
@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in user's Employee record (throws if the user has none, e.g. platform-only users). */
  async me() {
    const ctx = requireContext();
    if (!ctx.employeeId) throw new AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
    return this.prisma.employee.findUniqueOrThrow({
      where: { id: ctx.employeeId },
      include: { department: true, designation: true, manager: true, branch: true },
    });
  }

  myEmployeeId(): string {
    const id = requireContext().employeeId;
    if (!id) throw new AppError(400, 'NO_EMPLOYEE', 'Your account is not linked to an employee record');
    return id;
  }

  /** Direct + indirect reports of an employee (for Reporting Manager scopes). */
  async reportTree(employeeId: string): Promise<string[]> {
    const out: string[] = [];
    let frontier = [employeeId];
    for (let depth = 0; depth < 10 && frontier.length; depth++) {
      const rows = await this.prisma.employee.findMany({ where: { managerId: { in: frontier } }, select: { id: true } });
      frontier = rows.map((r) => r.id).filter((id) => !out.includes(id));
      out.push(...frontier);
    }
    return out;
  }

  /**
   * Approver for a request: the first person up the reporting line (manager, their manager, …)
   * who can actually decide it, i.e. still employed and with one of `perms`. Managers who can't
   * (e.g. a Team Lead without leave.approve) are skipped, so a request never waits on someone who
   * can't even see it. null = nobody on the line can → the caller falls back to HR.
   * `direct` is true when it is the employee's own manager.
   */
  async approverUpChain(employeeId: string, managerId: string | null, perms: readonly string[]): Promise<{ id: string; name: string; direct: boolean } | null> {
    const seen = new Set([employeeId]);
    let cur = managerId;
    for (let depth = 0; cur && depth < MAX_CHAIN_DEPTH && !seen.has(cur); depth++) {
      seen.add(cur);
      const p = (await this.prisma.employee.findUnique({ where: { id: cur }, select: CHAIN_SELECT })) as ChainPerson | null;
      if (!p) return null;
      if (canActWith(p, perms)) return { id: p.id, name: p.fullName, direct: depth === 0 };
      cur = p.managerId;
    }
    return null;
  }

  /** Can this employee still decide requests needing one of `perms`? (Exited, disabled or role changed → no.) */
  async canAct(employeeId: string, perms: readonly string[]): Promise<boolean> {
    const p = (await this.prisma.employee.findUnique({ where: { id: employeeId }, select: CHAIN_SELECT })) as ChainPerson | null;
    return !!p && canActWith(p, perms);
  }

  async userIdOf(employeeId: string | null | undefined): Promise<string | null> {
    if (!employeeId) return null;
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    return e?.userId ?? null;
  }

  async tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }
}
