import { Injectable } from '@nestjs/common';
import type { EmployeeDocument, PeopleDocCategory, PeopleDocSource, PeopleDocType, PeopleDocVerification, Prisma } from '@prisma/client';
import { DOC_CATEGORY_LABELS, type VaultRow } from '@lexisora/shared';
import { AuditService } from '../../../core/audit/audit.service';
import { requireContext } from '../../../core/context/request-context';
import { AppError, badRequest, forbidden, notFound } from '../../../core/http/errors';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { StorageService } from '../../../core/storage/storage.service';
import { dbDateKey } from '../people.util';

export const DOC_TYPE_CATEGORY: Record<PeopleDocType, PeopleDocCategory> = {
  OFFER_LETTER: 'OFFER_COMPENSATION',
  COMPENSATION_BREAKDOWN: 'OFFER_COMPENSATION',
  NDA: 'LEGAL',
  POLICY_ACK: 'LEGAL',
  PAN: 'GOVERNMENT_ID',
  AADHAAR: 'GOVERNMENT_ID',
  PASSPORT: 'GOVERNMENT_ID',
  MARKSHEET_10: 'EDUCATION',
  MARKSHEET_12: 'EDUCATION',
  DEGREE: 'EDUCATION',
  PREV_EMPLOYMENT: 'EMPLOYMENT',
  EXPERIENCE_LETTER: 'EMPLOYMENT',
  RELIEVING_LETTER: 'EXIT',
  CANCELLED_CHEQUE: 'BANK_TAX',
  RESUME: 'CAREER',
  CERTIFICATE: 'CERTIFICATE',
  OTHER: 'OTHER',
};

export const DOC_TYPE_TITLE: Record<PeopleDocType, string> = {
  OFFER_LETTER: 'Offer letter',
  COMPENSATION_BREAKDOWN: 'Compensation breakdown',
  NDA: 'NDA',
  POLICY_ACK: 'Policy acknowledgement',
  PAN: 'PAN card',
  AADHAAR: 'Aadhaar card',
  PASSPORT: 'Passport',
  MARKSHEET_10: '10th marksheet',
  MARKSHEET_12: '12th marksheet',
  DEGREE: 'Degree marksheets',
  PREV_EMPLOYMENT: 'Previous employment letter',
  EXPERIENCE_LETTER: 'Experience letter',
  RELIEVING_LETTER: 'Relieving letter',
  CANCELLED_CHEQUE: 'Cancelled cheque',
  RESUME: 'Resume',
  CERTIFICATE: 'Certificate',
  OTHER: 'Document',
};

/** Types HR must verify; the rest are NOT_REQUIRED. */
const NEEDS_VERIFICATION = new Set<PeopleDocType>(['PAN', 'AADHAAR', 'PASSPORT', 'MARKSHEET_10', 'MARKSHEET_12', 'DEGREE', 'PREV_EMPLOYMENT', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'CANCELLED_CHEQUE']);
/** Types where a new upload replaces the previous one (versioned). */
const SINGLE_INSTANCE = new Set<PeopleDocType>(['PAN', 'AADHAAR', 'PASSPORT', 'MARKSHEET_10', 'MARKSHEET_12', 'CANCELLED_CHEQUE', 'RESUME']);
const SENSITIVE = new Set<PeopleDocCategory>(['GOVERNMENT_ID', 'BANK_TAX', 'OFFER_COMPENSATION']);

/** Vault status display mapping (spec M4). */
export function vaultStatus(d: Pick<EmployeeDocument, 'source' | 'docType' | 'verificationStatus' | 'isCurrent'>): { status: string; label: string } {
  if (d.source === 'ESIGNED') return { status: 'SIGNED', label: 'Signed' };
  if (d.docType === 'COMPENSATION_BREAKDOWN') return d.isCurrent ? { status: 'CURRENT', label: 'Current' } : { status: 'SUPERSEDED', label: 'Superseded' };
  switch (d.verificationStatus) {
    case 'VERIFIED':
      return { status: 'VERIFIED', label: 'Verified' };
    case 'PENDING':
      return { status: 'PENDING', label: 'Pending' };
    case 'REJECTED':
      return { status: 'REJECTED', label: 'Rejected · re-upload' };
    default:
      return { status: 'NA', label: '—' };
  }
}

const isHrCtx = () => {
  const ctx = requireContext();
  return ctx.permissions.has('*') || ctx.permissions.has('employees.manage') || ctx.permissions.has('onboarding.manage');
};

/** Digital vault + document service (M4). Leads/managers never get vault access. */
@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
  ) {}

  assertVaultAccess(employeeId: string) {
    const ctx = requireContext();
    if (ctx.employeeId !== employeeId && !isHrCtx()) throw forbidden('Documents are visible only to the employee and HR');
  }

  toRow(d: EmployeeDocument): VaultRow {
    const s = vaultStatus(d);
    const ctx = requireContext();
    const own = d.employeeId === ctx.employeeId;
    return {
      id: d.id,
      title: d.title,
      category: d.category,
      categoryLabel: DOC_CATEGORY_LABELS[d.category],
      docType: d.docType,
      uploadedAt: dbDateKey(d.uploadedAt)!,
      status: s.status,
      statusLabel: s.label,
      fileId: d.fileId,
      rejectionReason: d.rejectionReason,
      canDelete: (own && d.source === 'SELF_UPLOAD' && d.verificationStatus !== 'VERIFIED') || (isHrCtx() && d.source !== 'ESIGNED'),
      version: d.version,
    };
  }

  async listFor(employeeId: string, category?: string): Promise<VaultRow[]> {
    this.assertVaultAccess(employeeId);
    const rows = await this.prisma.employeeDocument.findMany({
      where: { employeeId, deletedAt: null, isCurrent: true, ...(category ? { category: category as PeopleDocCategory } : {}) },
      orderBy: [{ uploadedAt: 'asc' }],
    });
    // Order by category the way the vault groups them.
    const order = Object.keys(DOC_CATEGORY_LABELS);
    return rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.uploadedAt.getTime() - b.uploadedAt.getTime()).map((d) => this.toRow(d));
  }

  async versions(docId: string) {
    const d = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!d) throw notFound('Document');
    this.assertVaultAccess(d.employeeId);
    const chain: EmployeeDocument[] = [];
    const all = await this.prisma.employeeDocument.findMany({ where: { employeeId: d.employeeId, docType: d.docType, deletedAt: null }, orderBy: { version: 'desc' } });
    for (const x of all) chain.push(x);
    return chain.map((x) => ({ ...this.toRow(x), isCurrent: x.isCurrent, verifiedBy: x.verifiedByName }));
  }

  /**
   * Add a document. Self uploads need HR verification for identity/education types;
   * single-instance types (PAN, Aadhaar…) supersede the current version.
   */
  async add(employeeId: string, i: { docType: PeopleDocType; fileId: string; title?: string | null; tags?: string[]; source: PeopleDocSource; verificationStatus?: PeopleDocVerification; esignEnvelopeId?: string | null }) {
    const ctx = requireContext();
    const file = await this.prisma.fileObject.findUnique({ where: { id: i.fileId } });
    if (!file) throw badRequest('Upload the file first', 'FILE_MISSING');
    if (i.source === 'SELF_UPLOAD' && !/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(file.mime)) throw new AppError(422, 'FILE_TYPE', 'Upload a PDF, JPG or PNG');
    if (i.source === 'SELF_UPLOAD' && file.size > 10 * 1024 * 1024) throw new AppError(422, 'FILE_TOO_LARGE', 'Documents are limited to 10 MB');
    if (file.sha256) {
      const dup = await this.prisma.employeeDocument.findFirst({ where: { employeeId, docType: i.docType, deletedAt: null, isCurrent: true, fileId: { not: i.fileId } }, select: { fileId: true } });
      if (dup) {
        const f2 = await this.prisma.fileObject.findUnique({ where: { id: dup.fileId }, select: { sha256: true } });
        if (f2?.sha256 && f2.sha256 === file.sha256) throw new AppError(409, 'DUPLICATE_DOCUMENT', 'This exact file is already in your vault');
      }
    }
    let previous: EmployeeDocument | null = null;
    if (SINGLE_INSTANCE.has(i.docType) || i.source === 'GENERATED') {
      previous = await this.prisma.employeeDocument.findFirst({ where: { employeeId, docType: i.docType, isCurrent: true, deletedAt: null }, orderBy: { version: 'desc' } });
    } else {
      previous = await this.prisma.employeeDocument.findFirst({ where: { employeeId, docType: i.docType, isCurrent: true, deletedAt: null, verificationStatus: 'REJECTED' }, orderBy: { version: 'desc' } });
    }
    if (previous?.source === 'ESIGNED') previous = null;
    const verification: PeopleDocVerification = i.verificationStatus ?? (NEEDS_VERIFICATION.has(i.docType) ? (i.source === 'HR_UPLOAD' ? 'VERIFIED' : 'PENDING') : 'NOT_REQUIRED');
    const doc = await this.prisma.employeeDocument.create({
      data: {
        employeeId,
        category: DOC_TYPE_CATEGORY[i.docType],
        docType: i.docType,
        title: i.title?.trim() || DOC_TYPE_TITLE[i.docType],
        fileId: i.fileId,
        version: previous ? previous.version + 1 : 1,
        supersedesId: previous?.id ?? null,
        source: i.source,
        verificationStatus: verification,
        verifiedByName: verification === 'VERIFIED' && i.source === 'HR_UPLOAD' ? (ctx.userName ?? null) : null,
        verifiedAt: verification === 'VERIFIED' && i.source === 'HR_UPLOAD' ? new Date() : null,
        esignEnvelopeId: i.esignEnvelopeId ?? null,
        tags: i.tags ?? [],
        uploadedByUserId: ctx.userId ?? null,
      } as Prisma.EmployeeDocumentUncheckedCreateInput,
    });
    if (previous) await this.prisma.employeeDocument.update({ where: { id: previous.id }, data: { isCurrent: false } });
    await this.audit.record({ action: 'document.uploaded', entity: 'EmployeeDocument', entityId: doc.id, meta: { employeeId, docType: i.docType, version: doc.version, source: i.source } });
    if (verification === 'PENDING') {
      const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { fullName: true } });
      await this.notify.notify({
        userIds: await this.notify.usersWithPermission('onboarding.manage'),
        type: 'people.documentPending',
        title: `${e?.fullName ?? 'An employee'} uploaded ${doc.title}`,
        body: 'Verify it in Paperless onboarding → Document verification.',
        link: '/onboarding?tab=verification',
        from: 'System',
      });
    }
    return doc;
  }

  /** Vault "Upload document" (self) or HR upload onto someone's profile. */
  async upload(employeeId: string, i: { docType: PeopleDocType; fileId: string; title?: string | null; tags?: string | null }) {
    this.assertVaultAccess(employeeId);
    const ctx = requireContext();
    const self = ctx.employeeId === employeeId;
    if (['OFFER_LETTER', 'NDA', 'COMPENSATION_BREAKDOWN', 'POLICY_ACK'].includes(i.docType) && self && !isHrCtx()) {
      throw forbidden('Signed and generated documents are added by the system');
    }
    const tags = (i.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    const doc = await this.add(employeeId, { docType: i.docType, fileId: i.fileId, title: i.title, tags, source: self ? 'SELF_UPLOAD' : 'HR_UPLOAD' });
    return this.toRow(doc);
  }

  async verify(docId: string, decision: 'VERIFIED' | 'REJECTED', reason?: string | null) {
    const ctx = requireContext();
    const d = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!d || d.deletedAt) throw notFound('Document');
    if (d.source === 'ESIGNED' || d.source === 'GENERATED') throw new AppError(409, 'IMMUTABLE', 'Signed and generated documents need no verification');
    if (decision === 'REJECTED' && !reason?.trim()) throw badRequest('Give a reason so the employee can fix it', 'REASON_REQUIRED');
    await this.prisma.employeeDocument.update({
      where: { id: docId },
      data: { verificationStatus: decision, verifiedByUserId: ctx.userId ?? null, verifiedByName: ctx.userName ?? null, verifiedAt: new Date(), rejectionReason: decision === 'REJECTED' ? reason!.trim() : null },
    });
    await this.audit.record({ action: decision === 'VERIFIED' ? 'document.verified' : 'document.rejected', entity: 'EmployeeDocument', entityId: docId, meta: { employeeId: d.employeeId, docType: d.docType, reason: reason ?? null } });
    if (decision === 'REJECTED') {
      await this.notify.notify({
        userIds: await this.notify.usersForEmployees([d.employeeId]),
        type: 'people.documentRejected',
        title: `${d.title} needs a re-upload`,
        body: `HR: ${reason}`,
        link: '/vault',
        from: 'HR',
        email: true,
      });
    }
    return { employeeId: d.employeeId, docType: d.docType, decision };
  }

  async remove(docId: string) {
    const ctx = requireContext();
    const d = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!d || d.deletedAt) throw notFound('Document');
    const own = d.employeeId === ctx.employeeId && d.source === 'SELF_UPLOAD' && d.verificationStatus !== 'VERIFIED';
    if (!own && !(isHrCtx() && d.source !== 'ESIGNED')) throw forbidden('You can delete only your own unverified uploads');
    await this.prisma.employeeDocument.update({ where: { id: docId }, data: { deletedAt: new Date(), isCurrent: false } });
    if (d.supersedesId) await this.prisma.employeeDocument.updateMany({ where: { id: d.supersedesId, deletedAt: null }, data: { isCurrent: true } });
    await this.audit.record({ action: 'document.deleted', entity: 'EmployeeDocument', entityId: docId, meta: { employeeId: d.employeeId, docType: d.docType } });
    return { ok: true };
  }

  async download(docId: string) {
    const d = await this.prisma.employeeDocument.findUnique({ where: { id: docId } });
    if (!d || d.deletedAt) throw notFound('Document');
    this.assertVaultAccess(d.employeeId);
    const { row, data } = await this.storage.read(d.fileId);
    if (SENSITIVE.has(d.category)) await this.audit.record({ action: 'document.downloaded', entity: 'EmployeeDocument', entityId: docId, meta: { employeeId: d.employeeId, docType: d.docType } });
    return { data, mime: row.mime, filename: row.filename };
  }

  /** HR verification queue (Paperless onboarding → Document verification). */
  async queue(employeeId?: string) {
    if (!isHrCtx()) throw forbidden();
    const rows = await this.prisma.employeeDocument.findMany({
      where: { verificationStatus: 'PENDING', deletedAt: null, isCurrent: true, ...(employeeId ? { employeeId } : {}) },
      orderBy: { uploadedAt: 'asc' },
      take: 200,
    });
    const emps = await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, fullName: true, empCode: true, panEnc: true, aadhaarLast4: true } });
    const em = new Map(emps.map((e) => [e.id, e]));
    return rows.map((d) => ({ ...this.toRow(d), employeeId: d.employeeId, employee: em.get(d.employeeId)?.fullName ?? '—', empCode: em.get(d.employeeId)?.empCode ?? '', captured: d.docType === 'AADHAAR' && em.get(d.employeeId)?.aadhaarLast4 ? `XXXX XXXX ${em.get(d.employeeId)!.aadhaarLast4}` : null }));
  }

  async pendingCount() {
    return this.prisma.employeeDocument.count({ where: { verificationStatus: 'PENDING', deletedAt: null, isCurrent: true } });
  }
}
