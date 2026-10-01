import { Controller, Get, Injectable } from '@nestjs/common';
import type { PrivacyOverview } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RequirePerm } from '../../../core/auth/decorators';
import { UPCOMING_CONTROLS, blockedModelList, enforcedControls, privacyRows } from './privacy.logic';

const DAY = 86_400_000;

/** Short human line for an audit row: the producer's `meta.summary`, else the action. */
export function auditSummary(meta: unknown, action: string): string {
  const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  return typeof m.summary === 'string' && m.summary ? m.summary : action.replace(/^platform\./, '').replace(/[._]/g, ' ');
}

/** Data privacy guarantee (`privacy.view`): what Lexisora staff can and can't see, and their access log. */
@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<PrivacyOverview> {
    const since = new Date(Date.now() - 90 * DAY);
    const [roles, access] = await Promise.all([
      this.prisma.role.findMany({ select: { key: true, name: true, isSystem: true, permissions: true } }),
      this.prisma.auditLog.findMany({ where: { action: { startsWith: 'platform.' }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const blocked = blockedModelList();
    return {
      rows: privacyRows(roles),
      controls: enforcedControls(blocked.length),
      blockedModels: blocked,
      key: { algorithm: 'AES-256-GCM', provider: 'Platform-managed key', version: 'v1' },
      platformAccess: access.map((a) => ({ id: a.id, action: a.action, actorName: a.actorName ?? 'Lexisora platform', createdAt: a.createdAt.toISOString(), summary: auditSummary(a.meta, a.action) })),
      upcoming: UPCOMING_CONTROLS,
    };
  }
}

@Controller('privacy')
@RequirePerm('privacy.view')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('overview')
  overview() {
    return this.privacy.overview();
  }
}
