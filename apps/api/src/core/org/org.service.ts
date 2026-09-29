import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireContext } from '../context/request-context';
import { AppError } from '../http/errors';

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

  async userIdOf(employeeId: string | null | undefined): Promise<string | null> {
    if (!employeeId) return null;
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    return e?.userId ?? null;
  }

  async tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }
}
