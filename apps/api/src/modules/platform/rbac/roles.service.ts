import { Injectable } from '@nestjs/common';
import {
  HIGH_RISK_KEYS,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_MIN_PLAN,
  PERMISSION_REQUIRES,
  ROLE_KEYS,
  ROLE_MATRIX_ROWS,
  ROLE_SHORT_LABELS,
  type CreateRoleInput,
  type PermissionKey,
  type PlanCode,
  type RoleChangeResult,
  type RoleDto,
  type RoleMemberDto,
  type RolesResponse,
  type UpdateRoleInput,
} from '@lexisora/shared';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext } from '../../../core/context/request-context';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { AppError, badRequest, conflict, notFound } from '../../../core/http/errors';
import {
  DependencyError,
  accessChangeSummary,
  applyToggle,
  isPermissionKey,
  label,
  lockedKeys,
  matrixCellState,
  matrixRow,
  planAllows,
  roleKeyFor,
} from './rbac.logic';

type RoleWithCount = Role & { _count: { users: number } };

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async tenantPlan(): Promise<PlanCode> {
    const sub = await this.prisma.subscription.findFirst({ select: { planCode: true } });
    return (sub?.planCode as PlanCode) ?? 'FREE';
  }

  private async myRoleId(): Promise<string | null> {
    const ctx = requireContext();
    if (!ctx.userId) return null;
    const u = await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { roleId: true } });
    return u?.roleId ?? null;
  }

  private sortRoles<T extends { key: string; isSystem: boolean; createdAt: Date }>(roles: T[]): T[] {
    const order = (r: T) => (r.isSystem ? (ROLE_KEYS as readonly string[]).indexOf(r.key) : 100);
    return [...roles].sort((a, b) => order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime());
  }

  private dto(r: RoleWithCount, myRoleId: string | null): RoleDto {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      shortName: r.isSystem && r.key in ROLE_SHORT_LABELS ? ROLE_SHORT_LABELS[r.key as keyof typeof ROLE_SHORT_LABELS] : r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions,
      memberCount: r._count.users,
      isMine: r.id === myRoleId,
    };
  }

  async list(): Promise<RolesResponse> {
    const [rows, myRoleId, plan] = await Promise.all([
      this.prisma.role.findMany({ include: { _count: { select: { users: true } } } }),
      this.myRoleId(),
      this.tenantPlan(),
    ]);
    const roles = this.sortRoles(rows).map((r) => this.dto(r, myRoleId));
    const matrix = ROLE_MATRIX_ROWS.map((row) => ({
      label: row.label,
      keys: row.keys as string[],
      cells: Object.fromEntries(roles.map((r) => [r.id, matrixCellState(r.permissions, row.keys)])),
    }));
    const groups: RolesResponse['groups'] = [];
    for (const key of PERMISSION_KEYS) {
      const def = PERMISSIONS[key];
      let g = groups.find((x) => x.group === def.group);
      if (!g) groups.push((g = { group: def.group, items: [] }));
      g.items.push({
        key,
        label: def.label,
        minPlan: PERMISSION_MIN_PLAN[key] ?? null,
        locked: !planAllows(plan, key),
        requires: (PERMISSION_REQUIRES[key] ?? []) as string[],
        highRisk: HIGH_RISK_KEYS.includes(key),
      });
    }
    return { roles, matrix, groups, plan };
  }

  private async load(id: string): Promise<RoleWithCount> {
    const r = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!r) throw notFound('Role');
    return r;
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (clash) throw conflict(`A role named “${clash.name}” already exists`, 'ROLE_NAME_TAKEN');
  }

  async create(input: CreateRoleInput): Promise<RoleDto> {
    await this.assertNameFree(input.name);
    const existing = await this.prisma.role.findMany({ select: { key: true } });
    let permissions: string[] = [];
    let copiedFrom: string | null = null;
    if (input.copyFromRoleId) {
      const src = await this.prisma.role.findUnique({ where: { id: input.copyFromRoleId } });
      if (!src) throw badRequest('The role to copy from no longer exists');
      permissions = [...src.permissions];
      copiedFrom = src.name;
    }
    // Never copy keys the plan doesn't include (they'd be inert anyway).
    const plan = await this.tenantPlan();
    permissions = permissions.filter((k) => planAllows(plan, k));
    const role = await this.prisma.role.create({
      data: {
        key: roleKeyFor(input.name, existing.map((e) => e.key)),
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        permissions,
      } as any,
      include: { _count: { select: { users: true } } },
    });
    await this.audit.record({ action: 'rbac.role.created', entity: 'Role', entityId: role.id, meta: { summary: `Created role ${role.name}${copiedFrom ? ` (copied from ${copiedFrom})` : ''}`, copiedFrom, permissions: permissions.length } });
    return this.dto(role, await this.myRoleId());
  }

  async update(id: string, input: UpdateRoleInput): Promise<RoleDto> {
    const role = await this.load(id);
    if (input.name && input.name !== role.name) await this.assertNameFree(input.name, id);
    const updated = await this.prisma.role.update({
      where: { id },
      data: { name: input.name ?? undefined, description: input.description === undefined ? undefined : input.description },
      include: { _count: { select: { users: true } } },
    });
    if (input.name && input.name !== role.name) {
      await this.audit.record({ action: 'rbac.role.renamed', entity: 'Role', entityId: id, meta: { summary: `Renamed ${role.name} → ${updated.name}`, from: role.name, to: updated.name } });
    }
    return this.dto(updated, await this.myRoleId());
  }

  async remove(id: string): Promise<void> {
    const role = await this.load(id);
    if (role.isSystem) throw conflict('System roles can’t be deleted. You can rename them or change their permissions.', 'SYSTEM_ROLE');
    if (role._count.users > 0) throw conflict(`Reassign the ${role._count.users} member(s) of ${role.name} to another role first`, 'ROLE_HAS_MEMBERS');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({ action: 'rbac.role.deleted', entity: 'Role', entityId: id, meta: { summary: `Deleted role ${role.name}` } });
  }

  /** Users (other than those in `exceptRoleId`) who would still hold roles.manage. */
  private async otherAdminsCount(exceptRoleId: string, exceptUserIds: string[] = []): Promise<number> {
    const roles = await this.prisma.role.findMany({ where: { permissions: { has: 'roles.manage' }, NOT: { id: exceptRoleId } }, select: { id: true } });
    return this.prisma.user.count({ where: { roleId: { in: roles.map((r) => r.id) }, status: 'ACTIVE', NOT: { id: { in: exceptUserIds } } } });
  }

  private async guardRolesManageRemoval(role: Role) {
    const myRoleId = await this.myRoleId();
    if (role.id === myRoleId) {
      throw conflict('You can’t remove Roles & access from your own role — ask another admin to do it.', 'SELF_LOCKOUT');
    }
    if ((await this.otherAdminsCount(role.id)) === 0) {
      throw conflict('At least one active person must keep Roles & access.', 'LAST_ADMIN');
    }
  }

  private async commit(role: RoleWithCount, next: string[], added: string[], removed: string[], context: string): Promise<RoleChangeResult> {
    if (!added.length && !removed.length) return { role: this.dto(role, await this.myRoleId()), added, removed };
    if (removed.includes('roles.manage')) await this.guardRolesManageRemoval(role);
    const plan = await this.tenantPlan();
    const blocked = lockedKeys(plan, added);
    if (blocked.length) {
      const min = PERMISSION_MIN_PLAN[blocked[0] as PermissionKey] ?? 'GROWTH';
      throw new AppError(402, 'FEATURE_NOT_IN_PLAN', `${label(blocked[0]!)} needs the ${min === 'ENTERPRISE' ? 'Enterprise' : 'Growth'} plan`, { keys: blocked });
    }
    const updated = await this.prisma.role.update({ where: { id: role.id }, data: { permissions: next }, include: { _count: { select: { users: true } } } });
    for (const [action, keys] of [['rbac.permission.granted', added], ['rbac.permission.revoked', removed]] as const) {
      if (!keys.length) continue;
      await this.audit.record({
        action,
        entity: 'Role',
        entityId: role.id,
        meta: { summary: `${action.endsWith('granted') ? 'Granted' : 'Revoked'} ${keys.map(label).join(', ')} ${action.endsWith('granted') ? 'to' : 'from'} ${role.name}${context ? ` · ${context}` : ''}`, role: role.name, keys },
      });
    }
    await this.announce(role.id, added, removed);
    return { role: this.dto(updated, await this.myRoleId()), added, removed };
  }

  /** Alert + live refresh for everyone holding the role. */
  private async announce(roleId: string, added: string[], removed: string[]) {
    const members = await this.prisma.user.findMany({ where: { roleId, status: { not: 'DISABLED' } }, select: { id: true } });
    const ids = members.map((m) => m.id).filter((id) => id !== requireContext().userId);
    this.realtime.toUsers(members.map((m) => m.id), 'rbac.changed', { roleId });
    if (ids.length) {
      await this.notifications.notify({ userIds: ids, type: 'rbac.role_changed', title: `Your access was updated: ${accessChangeSummary(added, removed)}`, link: '/dashboard', from: 'Admin' });
    }
  }

  async setPermission(id: string, key: string, enabled: boolean, cascade = false): Promise<RoleChangeResult> {
    if (!isPermissionKey(key)) throw badRequest(`Unknown permission ${key}`, 'UNKNOWN_PERMISSION');
    const role = await this.load(id);
    try {
      const r = applyToggle(role.permissions, [key], enabled, cascade);
      return await this.commit(role, r.next, r.added, r.removed, '');
    } catch (e) {
      if (e instanceof DependencyError) throw new AppError(409, 'PERMISSION_REQUIRED_BY', e.message, { dependents: e.dependents, labels: e.dependents.map(label) });
      throw e;
    }
  }

  async setMatrixRow(id: string, rowLabel: string, enabled: boolean): Promise<RoleChangeResult> {
    const row = matrixRow(rowLabel);
    if (!row) throw badRequest('Unknown matrix row');
    const role = await this.load(id);
    // Rows toggle as a unit: disabling also removes keys that depend on the row's keys.
    const r = applyToggle(role.permissions, row.keys, enabled, true);
    return this.commit(role, r.next, r.added, r.removed, `matrix row “${row.label}”`);
  }

  async members(id: string): Promise<RoleMemberDto[]> {
    await this.load(id);
    const users = await this.prisma.user.findMany({
      where: { roleId: id },
      include: { employee: { select: { empCode: true, department: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      empCode: u.employee?.empCode ?? null,
      department: u.employee?.department?.name ?? null,
      status: u.status,
      since: u.updatedAt.toISOString(),
    }));
  }

  /** People who can be moved into a role (everyone in the tenant, with their current role). */
  async assignable(): Promise<{ value: string; label: string; roleName: string }[]> {
    const users = await this.prisma.user.findMany({ where: { status: { not: 'DISABLED' } }, include: { role: { select: { name: true } } }, orderBy: { name: 'asc' } });
    return users.map((u) => ({ value: u.id, label: `${u.name} · ${u.role.name}`, roleName: u.role.name }));
  }

  async addMembers(id: string, userIds: string[]): Promise<RoleMemberDto[]> {
    const role = await this.load(id);
    const ctx = requireContext();
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, include: { role: true } });
    if (!users.length) throw badRequest('Pick at least one person');
    const losing = users.filter((u) => u.role.permissions.includes('roles.manage') && !role.permissions.includes('roles.manage'));
    if (losing.some((u) => u.id === ctx.userId)) throw conflict('Moving yourself to this role would remove your own Roles & access.', 'SELF_LOCKOUT');
    if (losing.length) {
      const remaining = await this.prisma.role.findMany({ where: { permissions: { has: 'roles.manage' } }, select: { id: true } });
      const left = await this.prisma.user.count({ where: { roleId: { in: remaining.map((r) => r.id) }, status: 'ACTIVE', NOT: { id: { in: losing.map((u) => u.id) } } } });
      if (left === 0) throw conflict('At least one active person must keep Roles & access.', 'LAST_ADMIN');
    }
    const moving = users.filter((u) => u.roleId !== id);
    for (const u of moving) {
      await this.prisma.user.update({ where: { id: u.id }, data: { roleId: id } });
      await this.audit.record({ action: 'rbac.member.added', entity: 'User', entityId: u.id, meta: { summary: `${u.name}: ${u.role.name} → ${role.name}`, from: u.role.name, to: role.name } });
    }
    if (moving.length) {
      this.realtime.toUsers(moving.map((u) => u.id), 'rbac.changed', { roleId: id });
      await this.notifications.notify({ userIds: moving.map((u) => u.id).filter((x) => x !== ctx.userId), type: 'rbac.role_changed', title: `Your role is now ${role.name}`, link: '/dashboard', from: 'Admin' });
    }
    return this.members(id);
  }

  /** Remove a member from a role = move them back to the Employee role. */
  async removeMember(id: string, userId: string): Promise<RoleMemberDto[]> {
    const role = await this.load(id);
    if (role.key === 'employee' && role.isSystem) throw badRequest('Everyone needs a role — move this person to another role instead');
    const fallback = await this.prisma.role.findFirst({ where: { key: 'employee' } });
    if (!fallback) throw badRequest('The Employee role is missing');
    const u = await this.prisma.user.findFirst({ where: { id: userId, roleId: id } });
    if (!u) throw notFound('Member');
    if (role.permissions.includes('roles.manage')) {
      if (u.id === requireContext().userId) throw conflict('You can’t remove yourself from a role that gives you Roles & access.', 'SELF_LOCKOUT');
      if ((await this.otherAdminsCount(id)) + (await this.prisma.user.count({ where: { roleId: id, status: 'ACTIVE', NOT: { id: u.id } } })) === 0) {
        throw conflict('At least one active person must keep Roles & access.', 'LAST_ADMIN');
      }
    }
    await this.prisma.user.update({ where: { id: u.id }, data: { roleId: fallback.id } });
    await this.audit.record({ action: 'rbac.member.removed', entity: 'User', entityId: u.id, meta: { summary: `${u.name}: ${role.name} → ${fallback.name}`, from: role.name, to: fallback.name } });
    this.realtime.toUser(u.id, 'rbac.changed', { roleId: fallback.id });
    await this.notifications.notify({ userIds: [u.id], type: 'rbac.role_changed', title: `Your role is now ${fallback.name}`, link: '/dashboard', from: 'Admin' });
    return this.members(id);
  }
}
