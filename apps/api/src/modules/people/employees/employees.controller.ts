import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  branchSchema,
  completeExitSchema,
  convertInternSchema,
  createEmployeeSchema,
  departmentSchema,
  designationSchema,
  employeeListQuery,
  exitStatusSchema,
  importCommitSchema,
  startExitSchema,
  updateEmployeeSchema,
  updateSelfSchema,
  type CreateEmployeeInput,
  type EmployeeListQuery,
  type StartExitInput,
  type UpdateEmployeeInput,
  type UpdateSelfInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { forbidden } from '../../../core/http/errors';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { MastersService } from '../masters/masters.service';
import { PeopleAccess } from '../people.access';
import { EmployeesService } from './employees.service';
import { ProfileService } from './profile.service';

const sendCsv = (res: Response, name: string, csv: string) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + csv);
};

/** /employees — directory, add, import, edit, lifecycle. */
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly access: PeopleAccess,
  ) {}

  @Get()
  @RequirePerm('employees.view', 'employees.manage')
  list(@Query(new ZodPipe(employeeListQuery)) q: EmployeeListQuery) {
    return this.employees.list(q);
  }

  @Get('counts')
  @RequirePerm('employees.view', 'employees.manage')
  counts() {
    return this.employees.counts();
  }

  @Get('export')
  @RequirePerm('employees.view', 'employees.manage')
  async export(@Query(new ZodPipe(employeeListQuery)) q: EmployeeListQuery, @Res() res: Response) {
    sendCsv(res, 'employees.csv', await this.employees.exportCsv(q));
  }

  @Post()
  @RequirePerm('employees.manage')
  create(@Body(new ZodPipe(createEmployeeSchema)) dto: CreateEmployeeInput) {
    return this.employees.create(dto);
  }

  // ── CSV import ──
  @Get('import/template')
  @RequirePerm('employees.manage')
  template(@Res() res: Response) {
    sendCsv(res, 'employee-import-template.csv', this.employees.templateCsv());
  }

  @Post('import')
  @RequirePerm('employees.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  validateImport(@UploadedFile() file: Express.Multer.File | undefined, @Body('createMissingMasters') cmm?: string) {
    return this.employees.validateImport(file, cmm === 'true' || cmm === '1');
  }

  @Get('import/:id')
  @RequirePerm('employees.manage')
  importDto(@Param('id') id: string) {
    return this.employees.importDto(id);
  }

  @Post('import/:id/commit')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  commit(@Param('id') id: string, @Body(new ZodPipe(importCommitSchema)) dto: z.infer<typeof importCommitSchema>) {
    return this.employees.commitImport(id, dto);
  }

  @Get('import/:id/errors.csv')
  @RequirePerm('employees.manage')
  async importErrors(@Param('id') id: string, @Res() res: Response) {
    sendCsv(res, 'import-errors.csv', await this.employees.importErrorsCsv(id));
  }

  // ── Edit & lifecycle ──
  @Patch('me')
  updateSelf(@Body(new ZodPipe(updateSelfSchema)) dto: UpdateSelfInput) {
    return this.employees.updateSelf(dto);
  }

  @Patch(':id')
  @RequirePerm('employees.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(updateEmployeeSchema)) dto: UpdateEmployeeInput) {
    return this.employees.update(id, dto);
  }

  @Post(':id/invite')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  resendInvite(@Param('id') id: string) {
    return this.employees.resendInvite(id);
  }

  @Post(':id/exit')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  startExit(@Param('id') id: string, @Body(new ZodPipe(startExitSchema)) dto: StartExitInput) {
    return this.employees.startExit(id, dto);
  }

  @Get(':id/exit')
  async exitCase(@Param('id') id: string) {
    const rid = this.access.resolveId(id);
    await this.access.assertCanView(rid);
    return this.employees.exitCaseDto(rid);
  }

  @Put(':id/exit/checklist/:key')
  updateChecklist(@Param('id') id: string, @Param('key') key: string, @Body(new ZodPipe(exitStatusSchema)) dto: z.infer<typeof exitStatusSchema>) {
    return this.employees.updateChecklist(id, key, dto.status, dto.note);
  }

  @Post(':id/exit/withdraw')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  withdrawExit(@Param('id') id: string) {
    return this.employees.withdrawExit(id);
  }

  @Post(':id/exit/complete')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  completeExit(@Param('id') id: string, @Body(new ZodPipe(completeExitSchema)) dto: z.infer<typeof completeExitSchema>) {
    return this.employees.completeExit(id, dto.overrideReason);
  }

  @Post(':id/convert')
  @RequirePerm('employees.manage')
  @HttpCode(200)
  convert(@Param('id') id: string, @Body(new ZodPipe(convertInternSchema)) dto: z.infer<typeof convertInternSchema>) {
    return this.employees.convertIntern(id, dto.effectiveDate, dto.designationId);
  }
}

/** /profile/:id (or `me`) — header + tabs. Scoped by relationship in the service. */
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.profile.profile(id);
  }

  @Get(':id/documents')
  documents(@Param('id') id: string) {
    return this.profile.documents(id);
  }

  @Get(':id/assets')
  assets(@Param('id') id: string) {
    return this.profile.assetsTab(id);
  }

  @Get(':id/pay')
  pay(@Param('id') id: string) {
    return this.profile.pay(id);
  }

  @Get(':id/attendance')
  attendance(@Param('id') id: string) {
    return this.profile.attendance(id);
  }
}

const kindParam = z.enum(['departments', 'designations', 'branches']);
const KIND: Record<z.infer<typeof kindParam>, 'department' | 'designation' | 'branch'> = { departments: 'department', designations: 'designation', branches: 'branch' };

/** /masters — departments, designations, branches (audit G8). */
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePerm('masters.manage', 'employees.manage', 'jobs.manage')
  async all() {
    const [departments, designations, branches, rounds, assetCategories] = await Promise.all([this.masters.departments(), this.masters.designations(), this.masters.branches(), this.masters.rounds(), this.masters.assetCategories()]);
    return { departments, designations, branches, rounds, assetCategories };
  }

  @Post('departments')
  @RequirePerm('masters.manage')
  createDept(@Body(new ZodPipe(departmentSchema)) dto: z.infer<typeof departmentSchema>) {
    return this.masters.createDepartment(dto);
  }
  @Put('departments/:id')
  @RequirePerm('masters.manage')
  updateDept(@Param('id') id: string, @Body(new ZodPipe(departmentSchema)) dto: z.infer<typeof departmentSchema>) {
    return this.masters.updateDepartment(id, dto);
  }
  @Post('designations')
  @RequirePerm('masters.manage', 'jobs.manage')
  createDesig(@Body(new ZodPipe(designationSchema)) dto: z.infer<typeof designationSchema>) {
    return this.masters.createDesignation(dto);
  }
  @Put('designations/:id')
  @RequirePerm('masters.manage')
  updateDesig(@Param('id') id: string, @Body(new ZodPipe(designationSchema)) dto: z.infer<typeof designationSchema>) {
    return this.masters.updateDesignation(id, dto);
  }
  @Post('branches')
  @RequirePerm('masters.manage')
  createBranch(@Body(new ZodPipe(branchSchema)) dto: z.infer<typeof branchSchema>) {
    return this.masters.createBranch(dto);
  }
  @Put('branches/:id')
  @RequirePerm('masters.manage')
  updateBranch(@Param('id') id: string, @Body(new ZodPipe(branchSchema)) dto: z.infer<typeof branchSchema>) {
    return this.masters.updateBranch(id, dto);
  }
  @Delete(':kind/:id')
  @RequirePerm('masters.manage')
  remove(@Param('kind') kind: string, @Param('id') id: string) {
    const k = kindParam.safeParse(kind);
    if (!k.success) throw forbidden('Unknown master');
    return this.masters.remove(KIND[k.data], id);
  }
}
