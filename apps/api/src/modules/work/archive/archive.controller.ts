import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { archiveAccessInput, archiveQuery, projectDocumentInput } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { ArchiveService } from './archive.service';

/** Archive list/detail: `archive.view` sees everything; other employees only "All developers" items. */
@Controller('archive')
@RequirePerm('archive.view', 'projects.view')
export class ArchiveController {
  constructor(private readonly svc: ArchiveService) {}

  @Get()
  list(@Query(new ZodPipe(archiveQuery)) q: z.infer<typeof archiveQuery>) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id/access')
  @RequirePerm('archive.manage')
  access(@Param('id') id: string, @Body(new ZodPipe(archiveAccessInput)) body: z.infer<typeof archiveAccessInput>) {
    return this.svc.setAccess(id, body.archiveAccess);
  }

  @Post(':id/documents')
  @RequirePerm('archive.manage')
  addDoc(@Param('id') id: string, @Body(new ZodPipe(projectDocumentInput)) body: z.infer<typeof projectDocumentInput>) {
    return this.svc.addDocument(id, body);
  }

  @Get(':id/documents/:docId/download')
  async download(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { row, data } = await this.svc.download(id, docId);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
    res.send(data);
  }

  @Post(':id/archive')
  @RequirePerm('archive.manage')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post(':id/unarchive')
  @RequirePerm('archive.manage')
  unarchive(@Param('id') id: string) {
    return this.svc.unarchive(id);
  }
}
