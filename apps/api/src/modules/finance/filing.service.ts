import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FilingDocumentRow, FilingFolderDetail, FilingFolderTile, Paginated } from '@lexisora/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { StorageService } from '../../core/storage/storage.service';
import { requireContext } from '../../core/context/request-context';
import { AppError, badRequest, conflict, notFound } from '../../core/http/errors';
import { paginated, pageArgs } from '../../core/http/paginate';
import { SYSTEM_FOLDERS } from './lib/coa';
import { dateKeyOf, dateOnly, fyOf, todayDate } from './lib/money';

const LOCKED_LINKS = new Set(['PURCHASE', 'INVOICE']);
const FILING_MIME = /^(application\/pdf|image\/(png|jpe?g|webp)|text\/(csv|plain)|application\/(json|zip|msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.[\w.]+))$/;

export type AutoFileInput = {
  folderKey: 'BILLS' | 'SALES_INVOICES' | 'GST_RETURNS' | 'INCOME_TAX';
  fileId: string;
  title: string;
  tags: string[];
  linkedEntityType?: string;
  linkedEntityId?: string;
  linkedRef?: string;
  docDate?: Date;
};

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase().slice(0, 32)).filter(Boolean))].slice(0, 10);

/** Filing cabinet: system + custom folders, tagged documents, auto-filing, retention locks. */
@Injectable()
export class FilingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async ensureFolders(): Promise<Map<string, string>> {
    const rows = await this.prisma.filingFolder.findMany({ where: { systemKey: { not: null } }, select: { id: true, systemKey: true } });
    const map = new Map(rows.map((r) => [r.systemKey!, r.id]));
    let order = 0;
    for (const f of SYSTEM_FOLDERS) {
      order++;
      if (map.has(f.key)) continue;
      const row = await this.prisma.filingFolder.create({
        data: { name: f.name, systemKey: f.key, isSystem: true, sortOrder: order, parentId: f.parent ? (map.get(f.parent) ?? null) : null } as Prisma.FilingFolderUncheckedCreateInput,
      });
      map.set(f.key, row.id);
    }
    return map;
  }

  /** Folder id → count of live documents in it and all its descendants. */
  private async counts(): Promise<{ folders: { id: string; name: string; systemKey: string | null; isSystem: boolean; parentId: string | null; sortOrder: number }[]; total: Map<string, number> }> {
    const [folders, grouped] = await Promise.all([
      this.prisma.filingFolder.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.filingDocument.groupBy({ by: ['folderId'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    const own = new Map(grouped.map((g) => [g.folderId, g._count._all]));
    const total = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const f of folders) if (f.parentId) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f.id]);
    const sum = (id: string, depth = 0): number => {
      if (total.has(id)) return total.get(id)!;
      const n = (own.get(id) ?? 0) + (depth > 8 ? 0 : (children.get(id) ?? []).reduce((s, c) => s + sum(c, depth + 1), 0));
      total.set(id, n);
      return n;
    };
    folders.forEach((f) => sum(f.id));
    return { folders, total };
  }

  private tile(f: { id: string; name: string; systemKey: string | null; isSystem: boolean; parentId: string | null }, total: Map<string, number>): FilingFolderTile {
    return { id: f.id, name: f.name, systemKey: f.systemKey, isSystem: f.isSystem, parentId: f.parentId, files: total.get(f.id) ?? 0 };
  }

  async tiles(): Promise<{ folders: FilingFolderTile[]; all: FilingFolderTile[] }> {
    await this.ensureFolders();
    const { folders, total } = await this.counts();
    return { folders: folders.filter((f) => !f.parentId).map((f) => this.tile(f, total)), all: folders.map((f) => this.tile(f, total)) };
  }

  private toRow(d: Prisma.FilingDocumentGetPayload<{ include: { folder: true } }>): FilingDocumentRow {
    return {
      id: d.id,
      folderId: d.folderId,
      folderName: d.folder.name,
      fileId: d.fileId,
      title: d.title,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
      tags: d.tags,
      fy: d.fy,
      docDate: d.docDate ? dateKeyOf(d.docDate) : null,
      uploadedAt: d.uploadedAt.toISOString(),
      uploadedByName: d.uploadedByName,
      linkedEntityType: d.linkedEntityType,
      linkedEntityId: d.linkedEntityId,
      linkedRef: d.linkedRef,
      locked: LOCKED_LINKS.has(d.linkedEntityType ?? ''),
    };
  }

  private docWhere(q: { q?: string; tag?: string; fy?: string }): Prisma.FilingDocumentWhereInput {
    return {
      deletedAt: null,
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }, { linkedRef: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(q.tag ? { tags: { has: q.tag.toLowerCase() } } : {}),
      ...(q.fy ? { fy: q.fy } : {}),
    };
  }

  async folder(id: string, q: { q?: string; tag?: string; fy?: string; page: number; pageSize: number }): Promise<FilingFolderDetail> {
    const { folders, total } = await this.counts();
    const f = folders.find((x) => x.id === id);
    if (!f) throw notFound('Folder');
    const breadcrumb: { id: string; name: string }[] = [];
    let cur: typeof f | undefined = f;
    for (let i = 0; cur && i < 10; i++) {
      breadcrumb.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? folders.find((x) => x.id === cur!.parentId) : undefined;
    }
    const where = { ...this.docWhere(q), folderId: id };
    const [docs, count, tagRows] = await Promise.all([
      this.prisma.filingDocument.findMany({ where, include: { folder: true }, orderBy: [{ uploadedAt: 'desc' }], ...pageArgs(q) }),
      this.prisma.filingDocument.count({ where }),
      this.prisma.filingDocument.findMany({ where: { folderId: id, deletedAt: null }, select: { tags: true, fy: true }, take: 5000 }),
    ]);
    const tags = [...new Set(tagRows.flatMap((t) => t.tags))].sort().slice(0, 40);
    const fys = [...new Set(tagRows.map((t) => t.fy).filter((x): x is string => !!x))].sort().reverse();
    return {
      folder: this.tile(f, total),
      breadcrumb,
      subfolders: folders.filter((x) => x.parentId === id).map((x) => this.tile(x, total)),
      documents: docs.map((d) => this.toRow(d)),
      total: count,
      page: q.page,
      pageSize: q.pageSize,
      tags,
      fys,
    };
  }

  async search(q: { q?: string; tag?: string; fy?: string; page: number; pageSize: number }): Promise<Paginated<FilingDocumentRow>> {
    const where = this.docWhere(q);
    const [docs, count] = await Promise.all([
      this.prisma.filingDocument.findMany({ where, include: { folder: true }, orderBy: { uploadedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.filingDocument.count({ where }),
    ]);
    return paginated(docs.map((d) => this.toRow(d)), count, q);
  }

  async createFolder(name: string, parentId?: string | null) {
    if (parentId && !(await this.prisma.filingFolder.findFirst({ where: { id: parentId } }))) throw badRequest('Parent folder not found');
    const dup = await this.prisma.filingFolder.findFirst({ where: { parentId: parentId ?? null, name: { equals: name, mode: 'insensitive' } } });
    if (dup) throw conflict(`A folder named “${name}” already exists here`);
    const row = await this.prisma.filingFolder.create({ data: { name, parentId: parentId ?? null } as Prisma.FilingFolderUncheckedCreateInput });
    await this.audit.record({ action: 'filing.folder.created', entity: 'FilingFolder', entityId: row.id, meta: { name } });
    return row;
  }

  async deleteFolder(id: string) {
    const f = await this.prisma.filingFolder.findFirst({ where: { id } });
    if (!f) throw notFound('Folder');
    if (f.isSystem) throw badRequest('System folders cannot be deleted');
    const [docs, subs] = await Promise.all([this.prisma.filingDocument.count({ where: { folderId: id, deletedAt: null } }), this.prisma.filingFolder.count({ where: { parentId: id } })]);
    if (docs || subs) throw conflict('Only empty folders can be deleted');
    await this.prisma.filingDocument.deleteMany({ where: { folderId: id } });
    await this.prisma.filingFolder.delete({ where: { id } });
    await this.audit.record({ action: 'filing.folder.deleted', entity: 'FilingFolder', entityId: id, meta: { name: f.name } });
  }

  async upload(input: { folderId: string; fileIds: string[]; tags: string[]; docDate?: string | null }) {
    const ctx = requireContext();
    const folder = await this.prisma.filingFolder.findFirst({ where: { id: input.folderId } });
    if (!folder) throw badRequest('Pick a folder');
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: input.fileIds } } });
    if (files.length !== new Set(input.fileIds).size) throw badRequest('Some files were not uploaded — try again');
    for (const f of files) {
      if (!FILING_MIME.test(f.mime)) throw new AppError(422, 'FILE_TYPE', `${f.filename}: this file type can't be filed`);
      if (f.size > 25 * 1024 * 1024) throw new AppError(422, 'FILE_TOO_LARGE', `${f.filename} is larger than 25 MB`);
    }
    const docDate = input.docDate ? dateOnly(input.docDate) : todayDate();
    const tags = cleanTags(input.tags);
    const created = [];
    for (const f of files) {
      const d = await this.prisma.filingDocument.create({
        data: { folderId: folder.id, fileId: f.id, title: f.filename, mime: f.mime, sizeBytes: f.size, tags, fy: fyOf(docDate), docDate, uploadedByUserId: ctx.userId ?? null, uploadedByName: ctx.userName ?? null } as Prisma.FilingDocumentUncheckedCreateInput,
      });
      created.push(d);
      await this.audit.record({ action: 'filing.document.uploaded', entity: 'FilingDocument', entityId: d.id, meta: { title: d.title, folder: folder.name, tags } });
    }
    return { count: created.length, ids: created.map((d) => d.id) };
  }

  async update(id: string, input: { title?: string; tags?: string[]; folderId?: string }) {
    const d = await this.prisma.filingDocument.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Document');
    if (input.folderId && !(await this.prisma.filingFolder.findFirst({ where: { id: input.folderId } }))) throw badRequest('Folder not found');
    const row = await this.prisma.filingDocument.update({ where: { id }, data: { ...(input.title ? { title: input.title } : {}), ...(input.tags ? { tags: cleanTags(input.tags) } : {}), ...(input.folderId ? { folderId: input.folderId } : {}) } });
    await this.audit.record({ action: 'filing.document.updated', entity: 'FilingDocument', entityId: id, meta: input });
    return row;
  }

  async remove(id: string) {
    const ctx = requireContext();
    const d = await this.prisma.filingDocument.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Document');
    if (LOCKED_LINKS.has(d.linkedEntityType ?? '')) {
      throw new AppError(409, 'RETENTION_LOCKED', `This document is linked to ${d.linkedRef ?? 'a posted record'} and must be kept for 8 years (GST record retention)`);
    }
    await this.prisma.filingDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'filing.document.deleted', entity: 'FilingDocument', entityId: id, meta: { title: d.title, by: ctx.userName ?? null } });
  }

  async download(id: string) {
    const d = await this.prisma.filingDocument.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Document');
    const { row, data } = await this.storage.read(d.fileId);
    await this.audit.record({ action: 'filing.document.downloaded', entity: 'FilingDocument', entityId: id, meta: { title: d.title } });
    const ext = row.filename.includes('.') ? '' : row.mime === 'application/pdf' ? '.pdf' : '';
    return { data, mime: row.mime, filename: /\.\w{2,5}$/.test(d.title) ? d.title : `${d.title}${ext}` };
  }

  /** Auto-file a generated/uploaded document (invoice PDFs, purchase bills, GST returns). Idempotent per link. */
  async autoFile(i: AutoFileInput) {
    const ctx = requireContext();
    const folders = await this.ensureFolders();
    const folderId = folders.get(i.folderKey)!;
    if (i.linkedEntityType && i.linkedEntityId) {
      const existing = await this.prisma.filingDocument.findFirst({ where: { linkedEntityType: i.linkedEntityType, linkedEntityId: i.linkedEntityId, fileId: i.fileId, deletedAt: null } });
      if (existing) return existing;
    }
    const file = await this.prisma.fileObject.findFirst({ where: { id: i.fileId } });
    const docDate = i.docDate ?? todayDate();
    return this.prisma.filingDocument.create({
      data: {
        folderId,
        fileId: i.fileId,
        title: i.title,
        mime: file?.mime ?? 'application/pdf',
        sizeBytes: file?.size ?? 0,
        tags: cleanTags(i.tags),
        fy: fyOf(docDate),
        docDate,
        linkedEntityType: i.linkedEntityType ?? null,
        linkedEntityId: i.linkedEntityId ?? null,
        linkedRef: i.linkedRef ?? null,
        uploadedByUserId: ctx.userId ?? null,
        uploadedByName: ctx.userName ?? 'System',
      } as Prisma.FilingDocumentUncheckedCreateInput,
    });
  }

  /** Is this file referenced by a filing document? (file access checker). */
  async referencesFile(fileId: string): Promise<boolean> {
    return !!(await this.prisma.filingDocument.findFirst({ where: { fileId }, select: { id: true } }));
  }
}
