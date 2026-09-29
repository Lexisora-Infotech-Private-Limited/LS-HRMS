import { Injectable } from '@nestjs/common';
import { hasPerm } from '../../core/auth/decorators';
import { getContext, requireContext, type RequestContext } from '../../core/context/request-context';
import { forbidden, notFound } from '../../core/http/errors';
import { OrgService } from '../../core/org/org.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export const isHr = (ctx: RequestContext) => hasPerm(ctx, 'employees.manage');

/**
 * Relationship scoping for People data (flat permission keys + relationships):
 *  - HR/Admin (`employees.manage`) see everyone;
 *  - managers (`employees.view`) see their reporting subtree;
 *  - everyone sees themselves.
 */
@Injectable()
export class PeopleAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  ctx() {
    return requireContext();
  }

  meId(): string | null {
    return getContext()?.employeeId ?? null;
  }

  /** Resolves "me" to the caller's employee id. */
  resolveId(id: string): string {
    if (id === 'me') {
      const me = this.meId();
      if (!me) throw notFound('Employee');
      return me;
    }
    return id;
  }

  /** null = unrestricted; otherwise the employee ids the caller may see in lists. */
  async listScope(): Promise<string[] | null> {
    const ctx = this.ctx();
    if (isHr(ctx) || ctx.permissions.has('*')) return null;
    const me = ctx.employeeId;
    if (!me) return [];
    return [me, ...(await this.org.reportTree(me))];
  }

  async isInMyTree(employeeId: string): Promise<boolean> {
    const me = this.meId();
    if (!me) return false;
    if (me === employeeId) return true;
    return (await this.org.reportTree(me)).includes(employeeId);
  }

  /** Throws 404 (not 403, to avoid leaking existence) unless the caller may view the employee. */
  async assertCanView(employeeId: string): Promise<{ self: boolean; hr: boolean; manager: boolean }> {
    const ctx = this.ctx();
    const self = ctx.employeeId === employeeId;
    const hr = isHr(ctx) || ctx.permissions.has('*');
    const manager = !self && !hr && hasPerm(ctx, 'employees.view') && (await this.isInMyTree(employeeId));
    if (!self && !hr && !manager) throw notFound('Employee');
    return { self, hr, manager };
  }

  assertHr(message?: string) {
    if (!isHr(this.ctx())) throw forbidden(message);
  }

  /** Employee id → display name (for tables). */
  async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
