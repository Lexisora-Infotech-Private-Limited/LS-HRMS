import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { cameraUpdateSchema, cameraUpsertSchema } from '@lexisora/shared';
import { Public, RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { AppError } from '../../../core/http/errors';
import { CctvService } from './cctv.service';

const listQuery = z.object({ location: z.string().max(80).optional() });
const sessionsQuery = z.object({ cameraId: z.string().optional() });
const authSchema = z.object({ path: z.string().optional(), query: z.string().optional(), action: z.string().optional() }).passthrough();

/** Requests from loopback / private networks only (the gateway's auth hook). */
function isInternal(ip: string | undefined): boolean {
  const a = (ip ?? '').replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}

/** CCTV — /cctv (spec §11.4). Viewing needs cctv.view; camera admin needs cctv.manage. */
@Controller('cctv')
export class CctvController {
  constructor(private readonly cctv: CctvService) {}

  @Get('cameras')
  @RequirePerm('cctv.view', 'cctv.manage')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.cctv.list(q.location);
  }

  @Post('cameras')
  @RequirePerm('cctv.manage')
  create(@Body(new ZodPipe(cameraUpsertSchema)) dto: z.infer<typeof cameraUpsertSchema>) {
    return this.cctv.create(dto);
  }

  @Patch('cameras/:id')
  @RequirePerm('cctv.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(cameraUpdateSchema)) dto: z.infer<typeof cameraUpdateSchema>) {
    return this.cctv.update(id, dto);
  }

  @Delete('cameras/:id')
  @RequirePerm('cctv.manage')
  remove(@Param('id') id: string) {
    return this.cctv.remove(id);
  }

  @Post('cameras/:id/test')
  @RequirePerm('cctv.manage')
  test(@Param('id') id: string) {
    return this.cctv.test(id);
  }

  @Post('cameras/:id/reconnect')
  @RequirePerm('cctv.view', 'cctv.manage')
  reconnect(@Param('id') id: string) {
    return this.cctv.reconnect(id);
  }

  @Post('cameras/:id/view')
  @RequirePerm('cctv.view', 'cctv.manage')
  view(@Param('id') id: string) {
    return this.cctv.view(id);
  }

  @Post('sessions/:sid/heartbeat')
  @RequirePerm('cctv.view', 'cctv.manage')
  heartbeat(@Param('sid') sid: string) {
    return this.cctv.heartbeat(sid);
  }

  @Post('sessions/:sid/end')
  @RequirePerm('cctv.view', 'cctv.manage')
  end(@Param('sid') sid: string) {
    return this.cctv.endView(sid);
  }

  @Get('sessions')
  @RequirePerm('cctv.manage')
  sessions(@Query(new ZodPipe(sessionsQuery)) q: z.infer<typeof sessionsQuery>) {
    return this.cctv.sessions(q.cameraId);
  }

  /** MediaMTX external auth hook — internal network only; 200 = allow, 401 = deny. */
  @Public()
  @Post('internal/auth')
  @HttpCode(200)
  async auth(@Ip() ip: string, @Body(new ZodPipe(authSchema)) body: z.infer<typeof authSchema>) {
    if (!isInternal(ip)) throw new AppError(403, 'FORBIDDEN', 'Internal endpoint');
    if (!(await this.cctv.authorize(body))) throw new AppError(401, 'CCTV_TOKEN_INVALID', 'Viewing token is invalid or expired');
    return { ok: true };
  }
}
