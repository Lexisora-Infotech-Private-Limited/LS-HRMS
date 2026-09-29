import { Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { LoginInput, LoginResponse, SessionUser } from '@lexisora/shared';
import { initialsOf } from '@lexisora/shared';
import { env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AppError, badRequest } from '../http/errors';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256, TokenService } from './token.service';

export type ClientMeta = { ip?: string; userAgent?: string };

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** Accepts "lexisora.hrms.app", "lexisora" or a custom domain. */
  async resolveTenant(workspace: string) {
    const w = workspace.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const t = await this.prisma.raw.tenant.findFirst({
      where: { OR: [{ domain: w }, { slug: w }, { slug: w.split('.')[0] }] },
    });
    if (!t) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'No workspace found at that address');
    if (t.status === 'SUSPENDED') throw new AppError(403, 'WORKSPACE_SUSPENDED', 'This workspace is suspended');
    return t;
  }

  async login(input: LoginInput, meta: ClientMeta): Promise<LoginResponse & { refreshToken: string }> {
    const tenant = await this.resolveTenant(input.workspace);
    const user = await this.prisma.raw.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: input.email } },
      include: { role: true, employee: true },
    });
    const ok = user?.passwordHash && (await bcrypt.compare(input.password, user.passwordHash));
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (user.status === 'DISABLED') throw new AppError(403, 'ACCOUNT_DISABLED', 'Your account is disabled');
    if (user.employee?.status === 'EXITED') throw new AppError(403, 'ACCOUNT_EXITED', 'Your employment has ended');

    // Wireframe rule: mobile access is enabled only for top-level roles (CEO/Admin/HR by default).
    if (input.client === 'mobile' && !user.role.permissions.includes('mobile.access')) {
      throw new AppError(403, 'MOBILE_NOT_ALLOWED', 'Mobile access is enabled only for CEO, Admin and HR roles');
    }

    await this.prisma.raw.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), status: 'ACTIVE' } });
    const refreshToken = await this.issueRefresh(user.id, tenant.id, input.client, meta);
    await this.audit.recordRaw(tenant.id, { actorUserId: user.id, actorName: user.name, action: 'auth.login', entity: 'User', entityId: user.id, meta: { client: input.client }, ip: meta.ip });
    return {
      accessToken: this.tokens.signAccess(user.id, tenant.id),
      expiresIn: env.ACCESS_TOKEN_TTL_SEC,
      refreshToken,
      user: await this.sessionUser(user.id),
    };
  }

  private async issueRefresh(userId: string, tenantId: string, client: string, meta: ClientMeta) {
    const token = randomToken(48);
    await this.prisma.raw.refreshToken.create({
      data: {
        tenantId,
        userId,
        tokenHash: sha256(token),
        client,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 250),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
      },
    });
    return token;
  }

  /** Rotating refresh: old token is revoked; reuse of a revoked token revokes the whole family. */
  async refresh(token: string, meta: ClientMeta) {
    const row = await this.prisma.raw.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.expiresAt < new Date()) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    if (row.revokedAt) {
      await this.prisma.raw.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      this.log.warn(`Refresh token reuse detected for user ${row.userId}`);
      throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    }
    const user = await this.prisma.raw.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status === 'DISABLED') throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again');
    const next = await this.issueRefresh(row.userId, row.tenantId, row.client, meta);
    await this.prisma.raw.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: sha256(next) } });
    return {
      accessToken: this.tokens.signAccess(row.userId, row.tenantId),
      expiresIn: env.ACCESS_TOKEN_TTL_SEC,
      refreshToken: next,
      user: await this.sessionUser(row.userId),
    };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.raw.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async sessionUser(userId: string): Promise<SessionUser> {
    const u = await this.prisma.raw.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true, employee: { include: { designation: true, department: true } } },
    });
    const t = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    const e = u.employee;
    const name = e?.fullName ?? u.name;
    const title = e ? [e.designation?.name, e.department?.name].filter(Boolean).join(' · ') || null : null;
    return {
      id: u.id,
      tenantId: t.id,
      tenantName: t.brandName ?? t.name,
      tenantDomain: t.domain,
      employeeId: e?.id ?? null,
      email: u.email,
      name,
      firstName: e?.firstName ?? name.split(' ')[0]!,
      initials: initialsOf(name),
      title,
      roleKey: u.role.key,
      roleName: u.role.name,
      permissions: u.role.permissions,
      isPlatformAdmin: u.isPlatformAdmin,
      workMode: e?.workMode ?? null,
      branding: {
        accent: t.brandAccent,
        accent2: t.brandAccent2,
        logoUrl: t.logoFileId ? `/api/v1/files/${t.logoFileId}/public` : null,
      },
    };
  }

  async forgotPassword(workspace: string, email: string) {
    const tenant = await this.resolveTenant(workspace).catch(() => null);
    if (!tenant) return; // do not reveal whether the workspace/user exists
    const user = await this.prisma.raw.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    if (!user) return;
    const token = randomToken(32);
    await this.prisma.raw.passwordResetToken.create({
      data: { tenantId: tenant.id, userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
    });
    const link = `${env.WEB_ORIGIN}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Lexisora HRMS password',
      text: `Hi ${user.name},\n\nUse this link within one hour to set a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.raw.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired', 'RESET_INVALID');
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(password, 10), status: 'ACTIVE' } }),
      this.prisma.raw.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.raw.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async changePassword(userId: string, current: string, next: string) {
    const u = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.passwordHash || !(await bcrypt.compare(current, u.passwordHash))) {
      throw badRequest('Current password is incorrect', 'INVALID_PASSWORD');
    }
    await this.prisma.raw.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  }

  /** Invited users (Add employee → onboarding invite) set their password here. */
  async acceptInvite(token: string, password: string, meta: ClientMeta) {
    const u = await this.prisma.raw.user.findUnique({ where: { inviteToken: token }, include: { role: true } });
    if (!u || (u.inviteExpiresAt && u.inviteExpiresAt < new Date())) throw badRequest('This invite link is invalid or has expired', 'INVITE_INVALID');
    await this.prisma.raw.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(password, 10), inviteToken: null, inviteExpiresAt: null, status: 'ACTIVE', lastLoginAt: new Date() },
    });
    const refreshToken = await this.issueRefresh(u.id, u.tenantId, 'web', meta);
    return {
      accessToken: this.tokens.signAccess(u.id, u.tenantId),
      expiresIn: env.ACCESS_TOKEN_TTL_SEC,
      refreshToken,
      user: await this.sessionUser(u.id),
    };
  }

  static hashPassword(p: string) {
    return bcrypt.hash(p, 10);
  }
}
