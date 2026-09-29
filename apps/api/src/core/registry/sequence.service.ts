import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireContext } from '../context/request-context';

/** Indian financial year label for a date: 29 Sep 2026 → "2026-27". */
export function financialYear(d: Date = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * Gap-free, concurrency-safe document numbers per tenant.
 *   await seq.next('helpdesk.ticket', { prefix: 'HD-', pad: 4, start: 1043 }) → "HD-1043"
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async nextValue(key: string, opts: { period?: string; start?: number; tenantId?: string } = {}): Promise<number> {
    const tenantId = opts.tenantId ?? requireContext().tenantId;
    const period = opts.period ?? '';
    const rows = await this.prisma.raw.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberSequence" ("id", "tenantId", "key", "period", "nextValue")
      VALUES (${`seq_${tenantId}_${key}_${period}`}, ${tenantId}, ${key}, ${period}, ${(opts.start ?? 1) + 1})
      ON CONFLICT ("tenantId", "key", "period")
      DO UPDATE SET "nextValue" = "NumberSequence"."nextValue" + 1
      RETURNING "nextValue" - 1 AS value`;
    return Number(rows[0]!.value);
  }

  async next(key: string, opts: { prefix?: string; pad?: number; period?: string; start?: number; tenantId?: string } = {}): Promise<string> {
    const n = await this.nextValue(key, opts);
    return `${opts.prefix ?? ''}${String(n).padStart(opts.pad ?? 4, '0')}`;
  }
}
