import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  createRoleSchema,
  roleMembersSchema,
  setMatrixRowSchema,
  setPermissionSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type RoleMembersInput,
  type SetMatrixRowInput,
  type SetPermissionInput,
  type SetRolePermissionsInput,
  type UpdateRoleInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { RolesService } from './roles.service';

@Controller('roles')
@RequirePerm('roles.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  @Get('assignable')
  assignable() {
    return this.roles.assignable();
  }

  @Post()
  create(@Body(new ZodPipe(createRoleSchema)) dto: CreateRoleInput) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(updateRoleSchema)) dto: UpdateRoleInput) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.roles.remove(id);
  }

  @Put(':id/permissions/:key')
  setPermission(@Param('id') id: string, @Param('key') key: string, @Body(new ZodPipe(setPermissionSchema)) dto: SetPermissionInput) {
    return this.roles.setPermission(id, key, dto.enabled, dto.cascade);
  }

  @Put(':id/matrix')
  setMatrixRow(@Param('id') id: string, @Body(new ZodPipe(setMatrixRowSchema)) dto: SetMatrixRowInput) {
    return this.roles.setMatrixRow(id, dto.row, dto.enabled);
  }

  @Put(':id/permissions')
  setAll(@Param('id') id: string, @Body(new ZodPipe(setRolePermissionsSchema)) dto: SetRolePermissionsInput) {
    return this.roles.setAll(id, dto.permissions);
  }

  @Get(':id/members')
  members(@Param('id') id: string) {
    return this.roles.members(id);
  }

  @Post(':id/members')
  addMembers(@Param('id') id: string, @Body(new ZodPipe(roleMembersSchema)) dto: RoleMembersInput) {
    return this.roles.addMembers(id, dto.userIds);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.roles.removeMember(id, userId);
  }
}
