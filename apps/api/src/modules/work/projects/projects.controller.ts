import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  projectCreateInput,
  projectDocumentInput,
  projectKpiQuery,
  projectListQuery,
  projectMemberInput,
  projectModuleInput,
  projectModuleUpdateInput,
  projectStatusInput,
  projectUpdateInput,
  PROJECT_MEMBER_ROLES,
  type ProjectCreateInput,
  type ProjectUpdateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { ProjectsService } from './projects.service';
import { WorkAccessService } from '../work-access.service';

const docsBody = z.object({ documents: z.array(projectDocumentInput).min(1).max(20) });
const memberUpdate = z.object({ role: z.enum(PROJECT_MEMBER_ROLES).optional(), allocationPct: z.number().int().min(0).max(100).nullable().optional() });

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly svc: ProjectsService,
    private readonly access: WorkAccessService,
  ) {}

  @Get()
  @RequirePerm('projects.view')
  list(@Query(new ZodPipe(projectListQuery)) q: z.infer<typeof projectListQuery>) {
    return this.svc.list(q);
  }

  @Get('kpis')
  @RequirePerm('projects.view')
  kpis(@Query(new ZodPipe(projectKpiQuery)) q: z.infer<typeof projectKpiQuery>) {
    return this.svc.kpis(q.month);
  }

  @Get('key-suggestion')
  @RequirePerm('projects.manage')
  key(@Query('name') name = '') {
    return this.svc.suggestKey(name);
  }

  @Post()
  @RequirePerm('projects.manage')
  create(@Body(new ZodPipe(projectCreateInput)) body: ProjectCreateInput) {
    return this.svc.create(body);
  }

  @Get(':id')
  @RequirePerm('projects.view', 'tasks.board')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/boards')
  @RequirePerm('projects.view', 'tasks.board')
  async boards(@Param('id') id: string) {
    const v = await this.access.viewer();
    const p = await this.access.requireProject(v, id);
    return this.svc.boards(v, p);
  }

  @Patch(':id')
  @RequirePerm('projects.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(projectUpdateInput)) body: ProjectUpdateInput) {
    return this.svc.update(id, body);
  }

  @Post(':id/status')
  @RequirePerm('projects.manage')
  status(@Param('id') id: string, @Body(new ZodPipe(projectStatusInput)) body: z.infer<typeof projectStatusInput>) {
    return this.svc.setStatus(id, body.status, body.reason, body.cancelRemaining);
  }

  @Post(':id/modules')
  @RequirePerm('projects.manage')
  addModule(@Param('id') id: string, @Body(new ZodPipe(projectModuleInput)) body: z.infer<typeof projectModuleInput>) {
    return this.svc.addModule(id, body.name, body.estimatedHours);
  }

  @Patch(':id/modules/:moduleId')
  @RequirePerm('projects.manage')
  updateModule(@Param('id') id: string, @Param('moduleId') moduleId: string, @Body(new ZodPipe(projectModuleUpdateInput)) body: z.infer<typeof projectModuleUpdateInput>) {
    return this.svc.updateModule(id, moduleId, body);
  }

  @Delete(':id/modules/:moduleId')
  @RequirePerm('projects.manage')
  removeModule(@Param('id') id: string, @Param('moduleId') moduleId: string) {
    return this.svc.removeModule(id, moduleId);
  }

  @Post(':id/members')
  @RequirePerm('projects.manage')
  addMember(@Param('id') id: string, @Body(new ZodPipe(projectMemberInput)) body: z.infer<typeof projectMemberInput>) {
    return this.svc.addMember(id, body);
  }

  @Patch(':id/members/:memberId')
  @RequirePerm('projects.manage')
  updateMember(@Param('id') id: string, @Param('memberId') memberId: string, @Body(new ZodPipe(memberUpdate)) body: z.infer<typeof memberUpdate>) {
    return this.svc.updateMember(id, memberId, body);
  }

  @Delete(':id/members/:memberId')
  @RequirePerm('projects.manage')
  removeMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    return this.svc.removeMember(id, memberId);
  }

  @Post(':id/documents')
  @RequirePerm('projects.manage')
  addDocs(@Param('id') id: string, @Body(new ZodPipe(docsBody)) body: z.infer<typeof docsBody>) {
    return this.svc.addDocuments(id, body.documents);
  }

  @Delete(':id/documents/:docId')
  @RequirePerm('projects.manage')
  removeDoc(@Param('id') id: string, @Param('docId') docId: string) {
    return this.svc.removeDocument(id, docId);
  }

  @Post(':id/git/link')
  @RequirePerm('projects.manage')
  link(@Param('id') id: string) {
    return this.svc.linkGit(id);
  }
}
