import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { ApiError } from '@lexisora/shared';

/** Domain error with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', message);
export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, code, message, details);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    let body: ApiError;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse() as any;
      body = {
        statusCode: status,
        code: r?.code ?? HttpStatus[status] ?? 'ERROR',
        message: Array.isArray(r?.message) ? r.message.join(', ') : (r?.message ?? exception.message),
        details: r?.details,
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        body = { statusCode: 409, code: 'DUPLICATE', message: 'A record with these details already exists', details: exception.meta };
      } else if (exception.code === 'P2025') {
        body = { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
      } else {
        this.log.error(exception);
        body = { statusCode: 500, code: 'DB_ERROR', message: 'Database error' };
      }
    } else {
      this.log.error(exception instanceof Error ? exception.stack : exception);
      body = { statusCode: 500, code: 'INTERNAL', message: 'Something went wrong' };
    }
    res.status(body.statusCode).json(body);
  }
}
