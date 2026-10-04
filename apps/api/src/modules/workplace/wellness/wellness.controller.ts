import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { GAME_KEYS, gameCompleteSchema, leaderboardQuery, type GameKey } from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { badRequest } from '../../../core/http/errors';
import { WellnessService } from './wellness.service';

const settingsSchema = z.object({
  enabledGames: z.array(z.enum(GAME_KEYS)).optional(),
  unlockTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').optional(),
});

function gameKey(g: string): GameKey {
  if (!(GAME_KEYS as readonly string[]).includes(g)) throw badRequest('Unknown game');
  return g as GameKey;
}

/** Wellness games — /wellness (spec §10.4). */
@Controller('wellness')
@RequirePerm('wellness.play')
export class WellnessController {
  constructor(private readonly wellness: WellnessService) {}

  @Get('today')
  today() {
    return this.wellness.today();
  }

  @Get('leaderboard')
  leaderboard(@Query(new ZodPipe(leaderboardQuery)) q: z.infer<typeof leaderboardQuery>) {
    return this.wellness.leaderboard(q.week);
  }

  @Get('settings')
  async settings() {
    return { ...(await this.wellness.config()), canManage: this.wellness.canManage() };
  }

  @Patch('settings')
  updateSettings(@Body(new ZodPipe(settingsSchema)) dto: z.infer<typeof settingsSchema>) {
    return this.wellness.updateConfig(dto);
  }

  @Post(':game/start')
  start(@Param('game') game: string) {
    return this.wellness.start(gameKey(game));
  }

  @Post(':game/complete')
  complete(@Param('game') game: string, @Body(new ZodPipe(gameCompleteSchema)) dto: z.infer<typeof gameCompleteSchema>) {
    return this.wellness.complete(gameKey(game), dto);
  }
}
