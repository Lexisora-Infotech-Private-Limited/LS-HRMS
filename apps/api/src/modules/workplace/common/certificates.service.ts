import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { Certificate } from '@prisma/client';
import { env } from '../../../config/env';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PdfService, PDF_COLORS } from '../../../core/pdf/pdf.service';
import { StorageService } from '../../../core/storage/storage.service';
import { JobsService } from '../../../core/jobs/jobs.service';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { EventsService } from '../../../core/registry/events.service';
import { requireContext } from '../../../core/context/request-context';
import { notFound } from '../../../core/http/errors';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10 Crockford base32 characters from 50 CSPRNG bits. */
export function newVerificationCode(): string {
  const b = randomBytes(7);
  let bits = 0n;
  for (const x of b) bits = (bits << 8n) | BigInt(x);
  bits >>= 6n; // keep 50 bits
  let s = '';
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[Number(bits & 31n)]! + s;
    bits >>= 5n;
  }
  return s;
}

export const formatCode = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export function verifyUrl(code: string): string {
  return `${env.WEB_ORIGIN.replace(/\/$/, '')}/api/v1/certificates/verify/${formatCode(code)}`;
}

export type IssueInput = {
  type: 'EOTM' | 'COURSE';
  recipientEmployeeId: string;
  title: string;
  subtitle?: string | null;
  sourceType: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
};

/**
 * Certificates (EOTM + course completion) with a public verification code. PDFs are
 * rendered by pdfkit (A4 landscape, tenant branding, QR to the public verify page).
 */
@Injectable()
export class CertificatesService implements OnModuleInit {
  private readonly log = new Logger('Certificates');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    this.jobs.register('workplace.certificate.render', async (d: { certificateId: string }) => {
      await this.render(d.certificateId);
    });
  }

  /** Idempotent on (sourceType, sourceId). Rendering is queued; download renders on demand. */
  async issue(i: IssueInput): Promise<Certificate> {
    const existing = await this.prisma.certificate.findFirst({ where: { sourceType: i.sourceType, sourceId: i.sourceId } });
    if (existing) return existing;
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: i.recipientEmployeeId }, select: { fullName: true, userId: true } });
    const cert = await this.prisma.certificate.create({
      data: {
        tenantId: i.tenantId ?? requireContext().tenantId,
        type: i.type,
        recipientEmployeeId: i.recipientEmployeeId,
        holderName: emp.fullName,
        title: i.title,
        subtitle: i.subtitle ?? null,
        verificationCode: newVerificationCode(),
        sourceType: i.sourceType,
        sourceId: i.sourceId,
        metadata: (i.metadata ?? {}) as object,
      },
    });
    await this.audit.record({ action: 'certificate.issue', entity: 'Certificate', entityId: cert.id, meta: { type: i.type, title: i.title } });
    await this.jobs.enqueue('workplace.certificate.render', { tenantId: requireContext().tenantId, certificateId: cert.id });
    this.events.emit('certificate.issued', { certificateId: cert.id, employeeId: i.recipientEmployeeId, type: i.type });
    return cert;
  }

  async render(certificateId: string): Promise<Certificate> {
    const cert = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!cert) throw notFound('Certificate');
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: cert.tenantId } });
    const signatory = await this.prisma.raw.employee.findFirst({
      where: { tenantId: cert.tenantId, user: { role: { key: 'admin' } }, status: 'ACTIVE' },
      orderBy: { joiningDate: 'asc' },
      include: { designation: true },
    });
    const qr = await QRCode.toBuffer(verifyUrl(cert.verificationCode), { type: 'png', margin: 1, width: 240 });
    const accent = tenant.brandAccent || PDF_COLORS.accent;
    const meta = (cert.metadata ?? {}) as Record<string, any>;
    const buf = await this.pdf.render(
      (doc) => {
        const W = doc.page.width;
        const H = doc.page.height;
        doc.rect(24, 24, W - 48, H - 48).lineWidth(2).strokeColor(accent).stroke();
        doc.rect(32, 32, W - 64, H - 64).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
        doc.font('Times-Bold').fontSize(26).fillColor(PDF_COLORS.ink).text(tenant.brandName ?? tenant.name, 0, 70, { align: 'center', width: W });
        doc.font('Helvetica').fontSize(9).fillColor(accent).text(cert.type === 'EOTM' ? 'CERTIFICATE OF RECOGNITION' : 'CERTIFICATE OF COMPLETION', 0, 104, { align: 'center', width: W, characterSpacing: 2 });
        doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.muted).text('This is to certify that', 0, 160, { align: 'center', width: W });
        doc.font('Times-Bold').fontSize(40).fillColor(PDF_COLORS.ink).text(cert.holderName, 0, 185, { align: 'center', width: W });
        doc.moveTo(W / 2 - 160, 238).lineTo(W / 2 + 160, 238).lineWidth(0.8).strokeColor(accent).stroke();
        doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.muted).text(cert.type === 'EOTM' ? 'has been named' : 'has successfully completed', 0, 254, { align: 'center', width: W });
        doc.font('Times-Bold').fontSize(24).fillColor(PDF_COLORS.ink).text(cert.title, 0, 276, { align: 'center', width: W });
        if (cert.subtitle) doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.muted).text(cert.subtitle, 0, 310, { align: 'center', width: W });
        if (meta.citation) doc.font('Times-Italic').fontSize(13).fillColor(PDF_COLORS.ink).text(`“${meta.citation}”`, 140, 336, { align: 'center', width: W - 280 });
        const baseY = H - 150;
        doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text('ISSUED ON', 80, baseY, { characterSpacing: 1 });
        doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.ink).text(new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(cert.issuedAt), 80, baseY + 14);
        doc.moveTo(W / 2 - 110, baseY + 30).lineTo(W / 2 + 110, baseY + 30).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
        doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_COLORS.ink).text(signatory?.fullName ?? 'Authorised signatory', W / 2 - 150, baseY + 36, { width: 300, align: 'center' });
        doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted).text(signatory?.designation?.name ?? 'Admin / CEO', W / 2 - 150, baseY + 52, { width: 300, align: 'center' });
        doc.image(qr, W - 170, baseY - 20, { width: 84 });
        doc.font('Helvetica').fontSize(7.5).fillColor(PDF_COLORS.muted).text(`Verify: ${formatCode(cert.verificationCode)}`, W - 200, baseY + 68, { width: 150, align: 'center' });
      },
      { size: 'A4', layout: 'landscape', margin: 40, info: { Title: `${cert.title} — ${cert.holderName}` } },
    );
    const stored = await this.storage.save({ data: buf, filename: `certificate-${formatCode(cert.verificationCode)}.pdf`, mime: 'application/pdf', category: 'certificate', isPrivate: true, tenantId: cert.tenantId, ownerUserId: null });
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const updated = await this.prisma.raw.certificate.update({ where: { id: cert.id }, data: { fileId: stored.id, sha256, status: cert.status === 'REVOKED' ? 'REVOKED' : 'READY' } });
    if (cert.status === 'PENDING') {
      const userId = (await this.prisma.raw.employee.findUnique({ where: { id: cert.recipientEmployeeId }, select: { userId: true } }))?.userId;
      if (userId) {
        await this.notifications.notify({ userIds: [userId], type: 'certificate.ready', title: `Your certificate is ready: ${cert.title}`, link: cert.type === 'EOTM' ? '/feed' : '/learning?tab=certificates' });
      }
    }
    return updated;
  }

  /** PDF bytes, rendering first if the job has not run yet. */
  async pdfFor(certificateId: string): Promise<{ cert: Certificate; data: Buffer }> {
    let cert = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!cert) throw notFound('Certificate');
    if (!cert.fileId) cert = await this.render(cert.id);
    const { data } = await this.storage.read(cert.fileId!, cert.tenantId);
    return { cert, data };
  }

  async revoke(id: string, reason: string) {
    const c = await this.prisma.certificate.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason } });
    await this.audit.record({ action: 'certificate.revoke', entity: 'Certificate', entityId: id, meta: { reason } });
    this.events.emit('certificate.revoked', { certificateId: id });
    return c;
  }

  /** Public lookup (no tenant context) — returns only non-identifying fields. */
  async verify(code: string) {
    const c = await this.prisma.raw.certificate.findUnique({ where: { verificationCode: normalizeCode(code) } });
    if (!c) return null;
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: c.tenantId } });
    return {
      valid: c.status !== 'REVOKED',
      status: c.status,
      holderName: c.holderName,
      title: c.title,
      subtitle: c.subtitle,
      issuedAt: c.issuedAt.toISOString(),
      issuer: tenant?.legalName ?? tenant?.name ?? '',
      code: formatCode(c.verificationCode),
      revokedAt: c.revokedAt?.toISOString() ?? null,
      sha256: c.sha256,
    };
  }
}
