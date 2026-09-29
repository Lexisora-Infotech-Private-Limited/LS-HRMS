import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { getContext, requireContext } from '../context/request-context';
import { notFound } from '../http/errors';

/** Storage driver interface — local disk in dev; an S3-compatible driver plugs in via STORAGE_DRIVER=s3. */
export interface StorageDriver {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskDriver implements StorageDriver {
  private readonly root = resolve(env.STORAGE_DIR);
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export type StoredFile = { id: string; filename: string; mime: string; size: number; url: string };

export const ALLOWED_UPLOAD_MIME = /^(image\/(png|jpe?g|webp|gif|svg\+xml)|application\/pdf|text\/(csv|plain)|video\/(mp4|webm)|application\/(zip|vnd\.openxmlformats-officedocument\.[\w.]+|msword|vnd\.ms-excel))$/;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // course videos can be large

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver = new LocalDiskDriver();

  constructor(private readonly prisma: PrismaService) {}

  /** Persist bytes and create a FileObject row in the current tenant. */
  async save(input: {
    data: Buffer;
    filename: string;
    mime: string;
    category: string;
    isPrivate?: boolean;
    tenantId?: string;
    ownerUserId?: string | null;
  }): Promise<StoredFile> {
    const tenantId = input.tenantId ?? requireContext().tenantId;
    const safeName = input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'file';
    const key = `${tenantId}/${input.category}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safeName}`;
    await this.driver.put(key, input.data, input.mime);
    const row = await this.prisma.raw.fileObject.create({
      data: {
        tenantId,
        ownerUserId: input.ownerUserId ?? getContext()?.userId ?? null,
        storageKey: key,
        filename: safeName,
        mime: input.mime,
        size: input.data.length,
        sha256: createHash('sha256').update(input.data).digest('hex'),
        category: input.category,
        isPrivate: input.isPrivate ?? true,
      },
    });
    return { id: row.id, filename: row.filename, mime: row.mime, size: row.size, url: this.url(row.id) };
  }

  /** Authenticated download URL (the web client appends ?access_token=…). */
  url(fileId: string): string {
    return `/api/v1/files/${fileId}`;
  }

  async read(fileId: string, tenantId?: string) {
    const row = await this.prisma.raw.fileObject.findUnique({ where: { id: fileId } });
    const t = tenantId ?? getContext()?.tenantId;
    if (!row || (t && row.tenantId !== t)) throw notFound('File');
    return { row, data: await this.driver.get(row.storageKey) };
  }

  async remove(fileId: string) {
    const row = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!row) return;
    await this.driver.remove(row.storageKey);
    await this.prisma.fileObject.delete({ where: { id: fileId } });
  }
}
