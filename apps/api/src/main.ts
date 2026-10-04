import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 1);
  // ZKTeco/ADMS biometric devices always call /iclock/* at the server root.
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (req.url.startsWith('/iclock/')) req.url = '/api/v1/attendance/biometric' + req.url;
    next();
  });
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '10mb' });
  app.enableCors({ origin: [env.WEB_ORIGIN, /^http:\/\/localhost:\d+$/], credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`API listening on http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
}

void bootstrap();
