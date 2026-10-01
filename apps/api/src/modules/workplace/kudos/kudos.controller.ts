import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  badgeUpsertSchema,
  certificateRevokeSchema,
  eotmCreateSchema,
  eotmRevokeSchema,
  kudosCreateSchema,
  kudosListQuery,
  kudosRevokeSchema,
  type BadgeUpsertInput,
  type CertificateRow,
  type EotmCreateInput,
  type KudosCreateInput,
} from '@lexisora/shared';
import { hasPerm, Public, RequirePerm } from '../../../core/auth/decorators';
import { requireContext } from '../../../core/context/request-context';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../core/audit/audit.service';
import { CertificatesService, formatCode } from '../common/certificates.service';
import { rateLimiter, sendFile } from '../common/http';
import { KudosService } from './kudos.service';

const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

/** Kudos — /kudos (spec §4). */
@Controller('kudos')
export class KudosController {
  constructor(private readonly svc: KudosService) {}

  @Get()
  @RequirePerm('kudos.view')
  list(@Query(new ZodPipe(kudosListQuery)) q: z.infer<typeof kudosListQuery>) {
    return this.svc.list(q.tab, q.page, q.pageSize);
  }

  @Post()
  @RequirePerm('kudos.give')
  give(@Body(new ZodPipe(kudosCreateSchema)) dto: KudosCreateInput) {
    return this.svc.give(dto);
  }

  @Post(':id/revoke')
  @RequirePerm('kudos.give', 'kudos.eotm')
  revoke(@Param('id') id: string, @Body(new ZodPipe(kudosRevokeSchema)) dto: z.infer<typeof kudosRevokeSchema>) {
    return this.svc.revoke(id, dto.reason);
  }

  @Get('badges')
  @RequirePerm('kudos.view')
  badges() {
    return this.svc.badges();
  }

  @Post('badges')
  @RequirePerm('kudos.eotm')
  createBadge(@Body(new ZodPipe(badgeUpsertSchema)) dto: BadgeUpsertInput) {
    return this.svc.saveBadge(null, dto);
  }

  @Patch('badges/:id')
  @RequirePerm('kudos.eotm')
  updateBadge(@Param('id') id: string, @Body(new ZodPipe(badgeUpsertSchema)) dto: BadgeUpsertInput) {
    return this.svc.saveBadge(id, dto);
  }

  /** Distinct badges with counts — profile header tags (public inside the tenant). */
  @Get('employees/:employeeId/badges')
  @RequirePerm('kudos.view')
  employeeBadges(@Param('employeeId') employeeId: string) {
    return this.svc.employeeBadges(employeeId);
  }
}

/** Employee of the Month — /eotm (spec §4). */
@Controller('eotm')
export class EotmController {
  constructor(private readonly svc: KudosService) {}

  @Get()
  @RequirePerm('kudos.view')
  list(@Query(new ZodPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.svc.eotmList(q.year);
  }

  @Get('current')
  @RequirePerm('kudos.view', 'feed.view')
  current() {
    return this.svc.currentAward();
  }

  @Get('options')
  @RequirePerm('kudos.eotm')
  options() {
    return this.svc.eotmOptions();
  }

  @Post()
  @RequirePerm('kudos.eotm')
  announce(@Body(new ZodPipe(eotmCreateSchema)) dto: EotmCreateInput) {
    return this.svc.announce(dto);
  }

  @Post(':id/revoke')
  @RequirePerm('kudos.eotm')
  revoke(@Param('id') id: string, @Body(new ZodPipe(eotmRevokeSchema)) dto: z.infer<typeof eotmRevokeSchema>) {
    return this.svc.revokeEotm(id, dto.reason);
  }
}

const verifyLimit = rateLimiter(30, 60_000);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Certificates — /certificates (download, regenerate, revoke) + the public verify page. */
@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly certs: CertificatesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('mine')
  @RequirePerm('kudos.view', 'lms.view')
  async mine(): Promise<CertificateRow[]> {
    const me = requireContext().employeeId;
    if (!me) return [];
    const rows = await this.prisma.certificate.findMany({ where: { recipientEmployeeId: me }, orderBy: { issuedAt: 'desc' } });
    return rows.map((c) => ({ id: c.id, type: c.type, title: c.title, subtitle: c.subtitle, holderName: c.holderName, issuedAt: c.issuedAt.toISOString(), status: c.status, code: formatCode(c.verificationCode) }));
  }

  /** The recipient, certificate managers, or anyone in the tenant for EOTM (the award is public). */
  @Get(':id/pdf')
  @RequirePerm('kudos.view', 'feed.view', 'lms.view')
  async pdf(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    const ctx = requireContext();
    const c = await this.prisma.certificate.findUnique({ where: { id } });
    if (!c) throw notFound('Certificate');
    const mine = !!ctx.employeeId && c.recipientEmployeeId === ctx.employeeId;
    const manager = hasPerm(ctx, c.type === 'EOTM' ? 'kudos.eotm' : 'lms.manage');
    if (!mine && !manager && !(c.type === 'EOTM' && c.status !== 'REVOKED')) throw forbidden('Only the recipient can download this certificate');
    const { cert, data } = await this.certs.pdfFor(id);
    sendFile(res, data, `${cert.title.replace(/[^\w]+/g, '-')}-${cert.holderName.replace(/[^\w]+/g, '-')}.pdf`, 'application/pdf', inline === '1');
  }

  @Post(':id/regenerate')
  @RequirePerm('kudos.eotm', 'lms.manage')
  async regenerate(@Param('id') id: string) {
    const c = await this.certs.render(id);
    await this.audit.record({ action: 'certificate.regenerate', entity: 'Certificate', entityId: id });
    return { ok: true, status: c.status };
  }

  @Post(':id/revoke')
  @RequirePerm('kudos.eotm', 'lms.manage')
  async revoke(@Param('id') id: string, @Body(new ZodPipe(certificateRevokeSchema)) dto: z.infer<typeof certificateRevokeSchema>) {
    const c = await this.certs.revoke(id, dto.reason);
    return { ok: true, status: c.status };
  }

  /** Public verification (QR on the PDF). HTML for browsers, JSON for `Accept: application/json`. */
  @Public()
  @Get('verify/:code')
  async verify(@Param('code') code: string, @Ip() ip: string, @Res() res: Response, @Headers('accept') accept?: string) {
    if (!verifyLimit(ip ?? 'unknown')) throw new AppError(429, 'RATE_LIMITED', 'Too many verification requests — try again in a minute');
    const r = await this.certs.verify(code);
    if (r) {
      const c = await this.prisma.raw.certificate.findUnique({ where: { verificationCode: r.code.replace('-', '') }, select: { tenantId: true, id: true } });
      if (c) await this.audit.recordRaw(c.tenantId, { action: 'certificate.verify', entity: 'Certificate', entityId: c.id, meta: { ipHash: createHash('sha256').update(ip ?? '').digest('hex').slice(0, 16) } });
    }
    const body = r ? { valid: r.valid, status: r.status, holderName: r.holderName, title: r.title, subtitle: r.subtitle, issuedAt: r.issuedAt, issuer: r.issuer, code: r.code, revokedAt: r.revokedAt } : null;
    if ((accept ?? '').includes('application/json') && !(accept ?? '').includes('text/html')) {
      if (!body) throw notFound('Certificate');
      res.json(body);
      return;
    }
    res.status(body ? 200 : 404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(verifyPage(body, code));
  }

  /** Upload a PDF to check it is the genuine, unaltered certificate. */
  @Public()
  @Post('verify/:code/file')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async verifyFile(@Param('code') code: string, @Ip() ip: string, @UploadedFile() file?: Express.Multer.File) {
    if (!verifyLimit(ip ?? 'unknown')) throw new AppError(429, 'RATE_LIMITED', 'Too many verification requests — try again in a minute');
    if (!file) throw badRequest('Attach the certificate PDF');
    const r = await this.certs.verify(code);
    if (!r) throw notFound('Certificate');
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    return { matches: !!r.sha256 && sha === r.sha256, valid: r.valid, status: r.status };
  }
}

function verifyPage(r: { valid: boolean; status: string; holderName: string; title: string; subtitle: string | null; issuedAt: string; issuer: string; code: string; revokedAt: string | null } | null, code: string): string {
  const date = (s: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(s));
  const content = !r
    ? `<p class="k">Not found</p><h1>No certificate matches ${esc(code)}</h1><p>Check the code printed under the QR on the certificate.</p>`
    : `<p class="k ${r.valid ? 'ok' : 'bad'}">${r.valid ? 'Valid certificate' : `Revoked${r.revokedAt ? ` on ${date(r.revokedAt)}` : ''}`}</p>
       <h1>${esc(r.holderName)}</h1>
       <p class="t">${esc(r.title)}${r.subtitle ? ` · ${esc(r.subtitle)}` : ''}</p>
       <dl><dt>Issued by</dt><dd>${esc(r.issuer)}</dd><dt>Issued on</dt><dd>${date(r.issuedAt)}</dd><dt>Code</dt><dd>${esc(r.code)}</dd></dl>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate verification</title>
<style>:root{color-scheme:light dark;--bg:#faf8f5;--ink:#201f1d;--mut:#605d5d;--acc:#b68235;--rule:#d7d3d3}@media (prefers-color-scheme:dark){:root{--bg:#1b1a19;--ink:#f1eee9;--mut:#b4afa8;--rule:#3a3836}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:520px;width:100%;border-top:2px solid var(--acc);padding:28px 4px}h1{font:600 30px/1.2 Georgia,serif;margin:6px 0}.k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);margin:0}.k.bad{color:#b3261e}.t{color:var(--mut);margin:0 0 18px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;border-top:1px solid var(--rule);padding-top:14px}dt{color:var(--mut)}dd{margin:0}</style></head><body><main>${content}</main></body></html>`;
}
