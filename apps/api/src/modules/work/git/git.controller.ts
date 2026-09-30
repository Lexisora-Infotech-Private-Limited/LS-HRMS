import { Body, Controller, Get, Headers, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { gitIntegrationInput } from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { GitService } from './git.service';

@Controller('git')
export class GitController {
  constructor(private readonly git: GitService) {}

  @Get('integration')
  @RequirePerm('git.manage', 'projects.manage')
  view() {
    return this.git.view();
  }

  @Put('integration')
  @RequirePerm('git.manage')
  save(@Body(new ZodPipe(gitIntegrationInput)) body: z.infer<typeof gitIntegrationInput>) {
    return this.git.save(body);
  }

  @Post('integration/test')
  @RequirePerm('git.manage', 'projects.manage')
  test() {
    return this.git.test();
  }

  @Post('integration/rotate-secret')
  @RequirePerm('git.manage')
  rotate() {
    return this.git.rotateSecret();
  }

  /** GitLab project/group webhook (push, merge request, pipeline). Verified by X-Gitlab-Token. */
  @Public()
  @Post('webhook')
  @HttpCode(202)
  webhook(
    @Headers('x-gitlab-token') token: string | undefined,
    @Headers('x-gitlab-event') event: string | undefined,
    @Headers('x-gitlab-event-uuid') uuid: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.git.receiveWebhook({ token, event, uuid }, payload);
  }
}
