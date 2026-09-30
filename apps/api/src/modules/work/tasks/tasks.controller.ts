import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  boardMemberInput,
  boardQuery,
  taskCommentInput,
  taskCreateInput,
  taskMoveInput,
  taskUpdateInput,
  type TaskCreateInput,
  type TaskMoveInput,
  type TaskUpdateInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { TasksService } from './tasks.service';
import { BoardsService } from '../boards/boards.service';

const cancelBody = z.object({ reason: z.string().trim().max(500).optional() }).default({});

@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Post()
  @RequirePerm('tasks.manage')
  create(@Body(new ZodPipe(taskCreateInput)) body: TaskCreateInput) {
    return this.svc.create(body);
  }

  /** The signed-in employee's open tasks (+ internal standing tasks). */
  @Get('mine')
  mine() {
    return this.svc.mine();
  }

  @Get(':id')
  @RequirePerm('tasks.board')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  @RequirePerm('tasks.board')
  update(@Param('id') id: string, @Body(new ZodPipe(taskUpdateInput)) body: TaskUpdateInput) {
    return this.svc.update(id, body);
  }

  @Post(':id/move')
  @RequirePerm('tasks.board')
  move(@Param('id') id: string, @Body(new ZodPipe(taskMoveInput)) body: TaskMoveInput) {
    return this.svc.move(id, body);
  }

  @Post(':id/comments')
  @RequirePerm('tasks.board')
  comment(@Param('id') id: string, @Body(new ZodPipe(taskCommentInput)) body: z.infer<typeof taskCommentInput>) {
    return this.svc.comment(id, body.body);
  }

  @Post(':id/git/retry')
  @RequirePerm('tasks.board')
  retry(@Param('id') id: string) {
    return this.svc.retryGit(id);
  }

  @Post(':id/cancel')
  @RequirePerm('tasks.board')
  cancel(@Param('id') id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>) {
    return this.svc.remove(id, body.reason);
  }

  @Delete(':id')
  @RequirePerm('tasks.board')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

@Controller('boards')
@RequirePerm('tasks.board', 'tasks.viewAllBoards')
export class BoardsController {
  constructor(private readonly svc: BoardsService) {}

  @Get(':projectId/:departmentId')
  view(@Param('projectId') projectId: string, @Param('departmentId') departmentId: string, @Query(new ZodPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.svc.view(projectId, departmentId, !!q.includeDone);
  }

  @Get(':projectId/:departmentId/members')
  members(@Param('projectId') projectId: string, @Param('departmentId') departmentId: string) {
    return this.svc.members(projectId, departmentId);
  }

  @Post(':projectId/:departmentId/members')
  allocate(@Param('projectId') projectId: string, @Param('departmentId') departmentId: string, @Body(new ZodPipe(boardMemberInput)) body: z.infer<typeof boardMemberInput>) {
    return this.svc.allocate(projectId, departmentId, body.employeeId);
  }

  @Delete(':projectId/:departmentId/members/:employeeId')
  revoke(@Param('projectId') projectId: string, @Param('departmentId') departmentId: string, @Param('employeeId') employeeId: string) {
    return this.svc.revoke(projectId, departmentId, employeeId);
  }
}
