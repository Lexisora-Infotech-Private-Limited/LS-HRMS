import { Injectable } from '@nestjs/common';
import type { ProjectDocumentRow } from '@lexisora/shared';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { badRequest } from '../../../core/http/errors';

type DocRow = { id: string; fileId: string; title: string; kind: string; sizeBytes: number; uploadedByEmployeeId: string | null; createdAt: Date; projectId: string | null; clientId: string | null };

/** Shared helpers for project/client documents (FileObject metadata + uploader names). */
@Injectable()
export class WorkDocsService {
  constructor(private readonly prisma: PrismaService) {}

  async rows(docs: DocRow[]): Promise<ProjectDocumentRow[]> {
    if (!docs.length) return [];
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: docs.map((d) => d.fileId) } }, select: { id: true, mime: true, size: true } });
    const fOf = new Map(files.map((f) => [f.id, f]));
    const emps = await this.prisma.employee.findMany({ where: { id: { in: docs.map((d) => d.uploadedByEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const eOf = new Map(emps.map((e) => [e.id, e.fullName]));
    return docs.map((d) => ({
      id: d.id,
      fileId: d.fileId,
      title: d.title,
      kind: d.kind,
      sizeBytes: d.sizeBytes || fOf.get(d.fileId)?.size || 0,
      mime: fOf.get(d.fileId)?.mime ?? null,
      uploadedBy: d.uploadedByEmployeeId ? (eOf.get(d.uploadedByEmployeeId) ?? null) : null,
      createdAt: d.createdAt.toISOString(),
      scope: d.projectId ? 'PROJECT' : 'CLIENT',
    }));
  }

  /** Validate uploaded file ids belong to this tenant; returns their metadata. */
  async files(fileIds: string[]) {
    if (!fileIds.length) return [];
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, filename: true, size: true } });
    if (files.length !== new Set(fileIds).size) throw badRequest('One of the uploaded files was not found — upload it again');
    return files;
  }
}
