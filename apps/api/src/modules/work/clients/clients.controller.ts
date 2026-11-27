import { Body, Controller, Delete, Get, Param, Patch, Post, Query, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { clientInput, clientListQuery, clientStatusInput, projectDocumentInput, ukClientInput, type ClientInput } from '@lexisora/shared';
import { currentRegion } from '../../../core/region/region-cache';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { ClientsService } from './clients.service';

/** India: `clientInput` (GSTIN, GST registration type, state) unchanged; UK (GB): `ukClientInput` (VAT number, country). */
class ClientBodyPipe implements PipeTransform {
  private readonly india = new ZodPipe(clientInput);
  private readonly uk = new ZodPipe(ukClientInput);
  transform(value: unknown): ClientInput {
    return currentRegion() === 'GB' ? (this.uk.transform(value) as ClientInput) : this.india.transform(value);
  }
}

@Controller('clients')
@RequirePerm('clients.manage')
export class ClientsController {
  constructor(private readonly svc: ClientsService) {}

  @Get()
  list(@Query(new ZodPipe(clientListQuery)) q: z.infer<typeof clientListQuery>) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body(new ClientBodyPipe()) body: ClientInput) {
    return this.svc.create(body);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ClientBodyPipe()) body: ClientInput) {
    return this.svc.update(id, body);
  }

  @Post(':id/status')
  status(@Param('id') id: string, @Body(new ZodPipe(clientStatusInput)) body: z.infer<typeof clientStatusInput>) {
    return this.svc.setStatus(id, body.status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/documents')
  addDoc(@Param('id') id: string, @Body(new ZodPipe(projectDocumentInput)) body: z.infer<typeof projectDocumentInput>) {
    return this.svc.addDocument(id, body);
  }

  @Delete(':id/documents/:docId')
  removeDoc(@Param('id') id: string, @Param('docId') docId: string) {
    return this.svc.removeDocument(id, docId);
  }
}
