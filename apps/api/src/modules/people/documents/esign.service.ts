import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { EnvelopeDto, EsignInput } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, forbidden, notFound } from '../../../core/http/errors';
import { PdfService } from '../../../core/pdf/pdf.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { StorageService } from '../../../core/storage/storage.service';
import { fmtStamp } from '../people.util';
import { renderEsignDocument, type EsignDocData } from './esign-render';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Local e-sign provider: renders the document, captures a drawn (PNG data URL) or typed
 * signature after explicit consent, re-renders with the signature stamped plus a
 * certificate page (IP, user agent, timeline, hashes). Third-party providers are P2.
 */
@Injectable()
export class EsignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async event(envelopeId: string, type: string, meta?: Record<string, unknown>) {
    const ctx = requireContext();
    await this.prisma.esignEvent.create({
      data: { envelopeId, type, actorUserId: ctx.userId ?? null, ip: ctx.ip ?? null, meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined } as Prisma.EsignEventUncheckedCreateInput,
    });
  }

  async create(i: { purpose: 'OFFER' | 'NDA' | 'ADHOC'; title: string; subjectEmployeeId: string; doc: EsignDocData; signerName: string; signerEmail: string; signerUserId: string | null }) {
    const buf = await this.pdf.render((d) => renderEsignDocument(d, i.doc), { size: 'A4', margin: 56, info: { Title: i.title, Author: i.doc.company } });
    const file = await this.storage.save({ data: buf, filename: `${i.title}.pdf`, mime: 'application/pdf', category: 'esign' });
    const env = await this.prisma.esignEnvelope.create({
      data: {
        title: i.title,
        purpose: i.purpose,
        subjectEmployeeId: i.subjectEmployeeId,
        docData: i.doc as unknown as Prisma.InputJsonValue,
        originalFileId: file.id,
        originalSha256: sha(buf),
        status: 'SENT',
        expiresAt: new Date(Date.now() + 30 * 86400_000),
        signerName: i.signerName,
        signerEmail: i.signerEmail,
        signerUserId: i.signerUserId,
      } as Prisma.EsignEnvelopeUncheckedCreateInput,
    });
    await this.event(env.id, 'CREATED');
    await this.event(env.id, 'SENT', { to: i.signerEmail });
    return env;
  }

  private async load(id: string) {
    const e = await this.prisma.esignEnvelope.findUnique({ where: { id }, include: { events: { orderBy: { at: 'asc' } } } });
    if (!e) throw notFound('Document');
    return e;
  }

  private assertViewer(e: { signerUserId: string | null; subjectEmployeeId: string | null }) {
    const ctx = requireContext();
    const hr = ctx.permissions.has('*') || ctx.permissions.has('onboarding.manage') || ctx.permissions.has('employees.manage');
    if (!hr && e.signerUserId !== ctx.userId && e.subjectEmployeeId !== ctx.employeeId) throw forbidden();
  }

  async dto(id: string): Promise<EnvelopeDto> {
    const e = await this.load(id);
    this.assertViewer(e);
    return {
      id: e.id,
      title: e.title,
      purpose: e.purpose,
      status: e.status,
      signerName: e.signerName,
      signedAt: e.signedAt?.toISOString() ?? null,
      signedSha256: e.signedSha256,
      originalSha256: e.originalSha256,
      events: e.events.map((x) => ({ type: x.type, at: x.at.toISOString(), ip: x.ip, actorEmail: x.actorEmail })),
    };
  }

  /** PDF stream (signed version when complete); first view by the signer records VIEWED. */
  async document(id: string): Promise<{ pdf: Buffer; filename: string }> {
    const e = await this.load(id);
    this.assertViewer(e);
    const ctx = requireContext();
    if (e.status === 'SENT' && e.signerUserId === ctx.userId) {
      await this.prisma.esignEnvelope.update({ where: { id }, data: { status: 'VIEWED' } });
      await this.event(id, 'VIEWED');
    }
    const fileId = e.signedFileId ?? e.originalFileId;
    const { data } = await this.storage.read(fileId);
    if (e.signedFileId) await this.event(id, 'DOWNLOADED');
    return { pdf: data, filename: `${e.title}${e.signedFileId ? ' (signed)' : ''}.pdf` };
  }

  async sign(id: string, input: EsignInput, ua?: string) {
    const ctx = requireContext();
    const e = await this.load(id);
    if (e.signerUserId && e.signerUserId !== ctx.userId) throw forbidden('Only the addressed signer can sign this document');
    if (e.status === 'COMPLETED') return { envelope: e, already: true };
    if (['EXPIRED', 'VOIDED', 'DECLINED'].includes(e.status) || e.expiresAt < new Date()) throw new AppError(410, 'ENVELOPE_CLOSED', 'This document can no longer be signed. Ask HR to resend it.');
    const now = new Date();
    let png: Buffer | null = null;
    let signatureFileId: string | null = null;
    if (input.signatureType === 'DRAWN' && input.drawnPng) {
      png = Buffer.from(input.drawnPng.replace(/^data:image\/png;base64,/, ''), 'base64');
      if (png.length > 200 * 1024) throw new AppError(422, 'SIGNATURE_TOO_LARGE', 'Signature image is too large');
      signatureFileId = (await this.storage.save({ data: png, filename: 'signature.png', mime: 'image/png', category: 'esign' })).id;
    }
    await this.event(id, 'CONSENTED', { text: 'I have read and agree to this document' });
    const timeline = [...e.events.map((x) => ({ type: x.type, at: `${fmtStamp(x.at)} IST`, ip: x.ip })), { type: 'CONSENTED', at: `${fmtStamp(now)} IST`, ip: ctx.ip ?? null }, { type: 'SIGNED', at: `${fmtStamp(now)} IST`, ip: ctx.ip ?? null }];
    const signed = await this.pdf.render(
      (d) =>
        renderEsignDocument(
          d,
          e.docData as unknown as EsignDocData,
          { signerName: e.signerName, signerEmail: e.signerEmail, signedAtLabel: fmtStamp(now), signatureType: input.signatureType, png, typedName: input.typedName, typedFont: input.typedFont },
          { envelopeId: e.id, title: e.title, originalSha256: e.originalSha256, signer: { name: e.signerName, email: e.signerEmail, ip: ctx.ip ?? null, userAgent: ua ?? null }, events: timeline },
        ),
      { size: 'A4', margin: 56, info: { Title: `${e.title} (signed)` } },
    );
    const file = await this.storage.save({ data: signed, filename: `${e.title} (signed).pdf`, mime: 'application/pdf', category: 'esign' });
    const signedSha256 = sha(signed);
    const updated = await this.prisma.esignEnvelope.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        signedFileId: file.id,
        signedSha256,
        signatureType: input.signatureType,
        typedName: input.typedName ?? null,
        typedFont: input.typedFont ?? null,
        signatureFileId,
        consentText: 'I have read and agree to this document',
        signedAt: now,
        signerIp: ctx.ip ?? null,
        signerUserAgent: ua ?? null,
      },
      include: { events: true },
    });
    await this.event(id, 'SIGNED', { signatureType: input.signatureType });
    await this.event(id, 'COMPLETED', { signedSha256 });
    await this.audit.record({ action: 'esign.completed', entity: 'EsignEnvelope', entityId: id, meta: { title: e.title, originalSha256: e.originalSha256, signedSha256 } });
    return { envelope: updated, already: false };
  }

  async decline(id: string, reason: string) {
    const e = await this.load(id);
    const ctx = requireContext();
    if (e.signerUserId && e.signerUserId !== ctx.userId) throw forbidden();
    if (e.status === 'COMPLETED') throw new AppError(409, 'ALREADY_SIGNED', 'This document is already signed');
    await this.prisma.esignEnvelope.update({ where: { id }, data: { status: 'DECLINED', declineReason: reason } });
    await this.event(id, 'DECLINED', { reason });
    await this.audit.record({ action: 'esign.declined', entity: 'EsignEnvelope', entityId: id, meta: { reason } });
  }

  async voidEnvelope(id: string) {
    const e = await this.load(id);
    if (e.status === 'COMPLETED') return;
    await this.prisma.esignEnvelope.update({ where: { id }, data: { status: 'VOIDED' } });
    await this.event(id, 'VOIDED');
  }

  /** Public hash check: does a hash belong to a completed envelope? (no PII) */
  async verifyHash(sha256: string) {
    const e = await this.prisma.raw.esignEnvelope.findFirst({ where: { signedSha256: sha256.toLowerCase(), status: 'COMPLETED' } });
    return e ? { valid: true, completedAt: e.signedAt?.toISOString() ?? null, title: e.title } : { valid: false };
  }
}
