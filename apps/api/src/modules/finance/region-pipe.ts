import type { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ZodPipe } from '../../core/http/zod.pipe';
import { currentRegion } from '../../core/region/region-cache';

/**
 * Validate with the India schema (unchanged behaviour) or, for a UK (GB) tenant, the UK one
 * (VAT numbers instead of GSTINs). The region is read per request.
 */
export class RegionZodPipe implements PipeTransform {
  private readonly india: ZodPipe<ZodTypeAny>;
  private readonly uk: ZodPipe<ZodTypeAny>;

  constructor(india: ZodTypeAny, uk: ZodTypeAny) {
    this.india = new ZodPipe(india);
    this.uk = new ZodPipe(uk);
  }

  transform(value: unknown) {
    return currentRegion() === 'GB' ? this.uk.transform(value) : this.india.transform(value);
  }
}
