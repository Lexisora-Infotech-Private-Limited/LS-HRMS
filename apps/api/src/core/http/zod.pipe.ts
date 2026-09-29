import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validate a body/query with a shared zod schema:
 *   @Post() create(@Body(new ZodPipe(createTaskSchema)) dto: CreateTaskInput) {}
 */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: r.error.issues[0]?.message ?? 'Invalid input',
        details: r.error.flatten(),
      });
    }
    return r.data;
  }
}
