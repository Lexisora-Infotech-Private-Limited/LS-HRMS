import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { requireContext } from '../context/request-context';
import { Public } from '../auth/decorators';
import { badRequest, forbidden } from '../http/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, StorageService } from './storage.service';

/**
 * Generic upload/download. Domain modules keep the FileObject id on their own rows and
 * decide who may see it; private files here are readable by their owner, anyone with a
 * module permission that references them (checked by domains), or HR/Admin.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('category') category?: string) {
    if (!file) throw badRequest('No file uploaded');
    if (!ALLOWED_UPLOAD_MIME.test(file.mimetype)) throw badRequest(`File type ${file.mimetype} is not allowed`, 'FILE_TYPE');
    return this.storage.save({
      data: file.buffer,
      filename: file.originalname,
      mime: file.mimetype,
      category: (category || 'misc').replace(/[^\w-]/g, '').slice(0, 40) || 'misc',
    });
  }

  @Get(':id')
  async download(@Param('id') id: string, @Res() res: Response) {
    const ctx = requireContext();
    const { row, data } = await this.storage.read(id);
    const privileged = ctx.permissions.has('employees.manage') || ctx.permissions.has('*');
    if (row.isPrivate && row.ownerUserId !== ctx.userId && !privileged && !(await this.referencedForViewer(row.id))) {
      throw forbidden();
    }
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(data);
  }

  /** Non-private files (tenant logo, published policy PDFs, course media) — no auth. */
  @Public()
  @Get(':id/public')
  async publicFile(@Param('id') id: string, @Res() res: Response) {
    const row = await this.prisma.raw.fileObject.findUnique({ where: { id } });
    if (!row || row.isPrivate) throw forbidden();
    const { data } = await this.storage.read(id, row.tenantId);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(data);
  }

  /**
   * Hook for domain modules: registered checkers decide whether the current user may view
   * a private file they don't own (e.g. a lead viewing a report's screenshot).
   */
  private async referencedForViewer(fileId: string): Promise<boolean> {
    for (const check of fileAccessCheckers) if (await check(fileId)) return true;
    return false;
  }
}

/** Domain modules push checkers here in onModuleInit (e.g. screenshots → lead/manager of the owner). */
export const fileAccessCheckers: ((fileId: string) => Promise<boolean>)[] = [];
