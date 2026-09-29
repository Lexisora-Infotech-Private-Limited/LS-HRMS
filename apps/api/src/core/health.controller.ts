import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.raw.$queryRaw`SELECT 1`;
    return { ok: true, service: 'lexisora-hrms-api', time: new Date().toISOString() };
  }
}
