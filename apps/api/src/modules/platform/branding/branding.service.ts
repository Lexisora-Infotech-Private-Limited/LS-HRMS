import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  BRAND_PRESETS,
  PLAN_RANK,
  ROOT_DOMAIN,
  formatDate,
  normalizeLoginDomain,
  publishBrandingSchema,
  slugOfDomain,
  type BrandingDto,
  type DomainCheckDto,
  type PlanCode,
  type PublishBrandingInput,
} from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { requireContext } from '../../../core/context/request-context';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { RealtimeGateway } from '../../../core/realtime/realtime.gateway';
import { StorageService } from '../../../core/storage/storage.service';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppError, badRequest, notFound } from '../../../core/http/errors';
import { effectivePlan } from '../rbac/rbac.logic';
import { slugProblem } from '../tenants/tenants.logic';
import { checkLogo, presetFor } from './branding.logic';

const publicLogoUrl = (id: string | null) => (id ? `/api/v1/files/${id}/public` : null);

/**
 * White-label theme (`branding.manage`, Growth+): palette, logo, product name and login domain.
 * "Publish theme" writes the tenant's brand fields (served by /auth/me, applied live by the web)
 * and keeps a version history for "Restore".
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId } });
  }

  private async plan(): Promise<PlanCode> {
    return effectivePlan(await this.prisma.subscription.findFirst({ select: { planCode: true, status: true } }));
  }

  async get(): Promise<BrandingDto> {
    const [t, plan, versions] = await Promise.all([this.tenant(), this.plan(), this.prisma.brandingVersion.findMany({ orderBy: { version: 'desc' }, take: 12 })]);
    const current = versions.find((v) => v.status === 'PUBLISHED') ?? null;
    return {
      presetKey: presetFor(t.brandAccent, t.brandAccent2) ?? (current && current.primaryHex === t.brandAccent ? current.presetKey : null),
      primaryHex: t.brandAccent,
      secondaryHex: t.brandAccent2,
      logoFileId: t.logoFileId,
      logoUrl: publicLogoUrl(t.logoFileId),
      productName: t.brandName,
      tenantName: t.name,
      domain: t.domain,
      version: current?.version ?? null,
      publishedAt: current?.publishedAt.toISOString() ?? null,
      publishedByName: current?.publishedByName ?? null,
      locked: PLAN_RANK[plan] < PLAN_RANK.GROWTH,
      planCode: plan,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        presetKey: v.presetKey,
        primaryHex: v.primaryHex,
        secondaryHex: v.secondaryHex,
        productName: v.productName,
        domain: v.domain,
        publishedAt: v.publishedAt.toISOString(),
        publishedByName: v.publishedByName,
      })),
    };
  }

  /** Why `domain` can't be this workspace's login address, or null + its slug. */
  private async domainProblem(domain: string, tenantId: string): Promise<{ slug: string | null; problem: string | null; status: number; code: string }> {
    const slug = slugOfDomain(domain);
    if (!slug) return { slug: null, problem: `Custom domains are available on Enterprise. Use an address like yourcompany.${ROOT_DOMAIN}`, status: 400, code: 'CUSTOM_DOMAIN_NOT_AVAILABLE' };
    const p = slugProblem(slug);
    if (p) return { slug, problem: p, status: 400, code: 'DOMAIN_INVALID' };
    const taken = await this.prisma.raw.tenant.findFirst({ where: { id: { not: tenantId }, OR: [{ domain }, { slug }] }, select: { id: true } });
    if (taken) return { slug, problem: `${domain} is already taken`, status: 409, code: 'DOMAIN_TAKEN' };
    return { slug, problem: null, status: 200, code: 'OK' };
  }

  async domainCheck(raw: string): Promise<DomainCheckDto> {
    const domain = normalizeLoginDomain(raw || '');
    const r = await this.domainProblem(domain, requireContext().tenantId);
    return { domain, available: !r.problem, message: r.problem ?? `${domain} is available` };
  }

  /** Copy an uploaded (private) logo into a public, validated brand asset. */
  private async publicLogo(fileId: string): Promise<string> {
    const { row, data } = await this.storage.read(fileId);
    if (!row.isPrivate && row.category === 'brand-logo') return row.id;
    const check = checkLogo(row.mime, data);
    if (!check.ok) throw badRequest(check.message, 'LOGO_INVALID');
    const saved = await this.storage.save({ data: check.data, filename: row.filename, mime: row.mime, category: 'brand-logo', isPrivate: false });
    return saved.id;
  }

  async publish(input: PublishBrandingInput, reason?: string): Promise<BrandingDto> {
    const ctx = requireContext();
    const t = await this.tenant();
    if (PLAN_RANK[await this.plan()] < PLAN_RANK.GROWTH) {
      throw new AppError(402, 'FEATURE_NOT_IN_PLAN', 'Branding is available on Growth. Upgrade to publish your own theme.');
    }
    const d = await this.domainProblem(input.domain, t.id);
    if (d.problem) throw new AppError(d.status, d.code, d.problem);
    const primary = input.primaryHex.toLowerCase();
    const secondary = input.secondaryHex.toLowerCase();
    const logoFileId = input.logoFileId ? (input.logoFileId === t.logoFileId ? t.logoFileId : await this.publicLogo(input.logoFileId)) : null;
    const productName = input.productName?.trim() || null;
    // A preset is recorded only when the colours really are that preset ("Custom" otherwise).
    const presetKey = presetFor(primary, secondary);
    const last = await this.prisma.brandingVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    await this.prisma.raw.$transaction([
      this.prisma.raw.brandingVersion.updateMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } }),
      this.prisma.raw.brandingVersion.create({
        data: { tenantId: t.id, version, status: 'PUBLISHED', presetKey, primaryHex: primary, secondaryHex: secondary, logoFileId, productName, domain: input.domain, publishedById: ctx.userId ?? null, publishedByName: ctx.userName ?? null },
      }),
      this.prisma.raw.tenant.update({ where: { id: t.id }, data: { brandAccent: primary, brandAccent2: secondary, logoFileId, brandName: productName, domain: input.domain, slug: d.slug! } }),
    ]);

    const presetName = BRAND_PRESETS.find((p) => p.key === presetKey)?.name ?? `Custom ${primary} / ${secondary}`;
    await this.audit.record({
      action: reason ? 'branding.restored' : 'branding.published',
      entity: 'Tenant',
      entityId: t.id,
      meta: {
        summary: `${reason ?? 'Published theme'} v${version} · ${presetName}`,
        changes: {
          primary: [t.brandAccent, primary],
          secondary: [t.brandAccent2, secondary],
          logo: [t.logoFileId ? 'set' : 'none', logoFileId ? (logoFileId === t.logoFileId ? 'unchanged' : 'new') : 'none'],
          productName: [t.brandName, productName],
          domain: [t.domain, input.domain],
        },
      },
    });
    const others = (await this.notifications.usersWithPermission('branding.manage')).filter((u) => u !== ctx.userId);
    await this.notifications.notify({ userIds: others, type: 'branding.published', title: `${ctx.userName ?? 'An admin'} published a new theme (v${version})`, body: presetName, link: '/branding', from: 'Branding' });
    if (input.domain !== t.domain) {
      await this.audit.record({ action: 'domain.slug_changed', entity: 'Tenant', entityId: t.id, meta: { summary: `Login domain changed from ${t.domain} to ${input.domain}`, from: t.domain, to: input.domain } });
      const everyone = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      await this.notifications.notify({
        userIds: everyone.map((u) => u.id).filter((u) => u !== ctx.userId),
        type: 'tenant.domain_changed',
        title: `Sign in at ${input.domain} from now on`,
        body: `${t.name} moved its workspace address from ${t.domain} on ${formatDate(new Date())}. Update the workspace field in the desktop tracker and your bookmarks.`,
        link: '/branding',
        from: 'Admin',
        email: true,
      });
    }
    this.realtime.toTenant(t.id, 'branding.updated', { version });
    return this.get();
  }

  async restore(versionId: string): Promise<BrandingDto> {
    const v = await this.prisma.brandingVersion.findUnique({ where: { id: versionId } });
    if (!v) throw notFound('Theme version');
    const t = await this.tenant();
    return this.publish(
      { presetKey: v.presetKey, primaryHex: v.primaryHex, secondaryHex: v.secondaryHex, logoFileId: v.logoFileId, productName: v.productName, domain: t.domain },
      `Restored v${v.version} as`,
    );
  }
}

@Controller('branding')
@RequirePerm('branding.manage')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  get() {
    return this.branding.get();
  }

  @Get('domain-check')
  domainCheck(@Query('domain') domain: string) {
    return this.branding.domainCheck(domain ?? '');
  }

  @Post('publish')
  @HttpCode(200)
  publish(@Body(new ZodPipe(publishBrandingSchema)) dto: PublishBrandingInput) {
    return this.branding.publish(dto);
  }

  @Post('versions/:id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string) {
    return this.branding.restore(id);
  }
}
