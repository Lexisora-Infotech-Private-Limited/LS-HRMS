import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { rtwCheckSchema, type RtwCheckData } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { RtwService } from './rtw.service';

/** /right-to-work — UK right to work checks (region GB only; other regions get 403). */
@Controller('right-to-work')
export class RtwController {
  constructor(private readonly rtw: RtwService) {}

  @Get()
  @RequirePerm('rtw.manage')
  list() {
    return this.rtw.list();
  }

  /** The signed-in employee's own checks. */
  @Get('me')
  mine() {
    return this.rtw.history('me');
  }

  /** History for one person: HR (rtw.manage) or the employee themself (checked in the service). */
  @Get(':employeeId')
  history(@Param('employeeId') employeeId: string) {
    return this.rtw.history(employeeId);
  }

  @Post()
  @RequirePerm('rtw.manage')
  create(@Body(new ZodPipe(rtwCheckSchema)) dto: RtwCheckData) {
    return this.rtw.create(dto);
  }
}
