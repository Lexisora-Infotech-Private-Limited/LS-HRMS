import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { auditQuerySchema, type AuditQuery } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { notFound } from '../../../core/http/errors';
import { AuditService } from '../../../core/audit/audit.service';
import { AuditLogService } from './audit-log.service';

@Controller('audit')
@RequirePerm('audit.view')
export class AuditLogController {
  constructor(
    private readonly log: AuditLogService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(new ZodPipe(auditQuerySchema)) q: AuditQuery) {
    return this.log.list(q);
  }

  @Get('facets')
  facets() {
    return this.log.facets();
  }

  @Get('export')
  async export(@Query(new ZodPipe(auditQuerySchema)) q: AuditQuery, @Res() res: Response) {
    const csv = await this.log.csv(q);
    await this.audit.record({ action: 'audit.exported', entity: 'AuditLog', meta: { summary: 'Exported the audit log as CSV', tab: q.tab } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const r = await this.log.get(id);
    if (!r) throw notFound('Audit entry');
    return r;
  }
}
