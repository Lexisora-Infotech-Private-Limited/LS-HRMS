import type { PrismaClient } from '@prisma/client';
import type { SeedCtx } from './core';

/** Demo data for the finance domain (matches the wireframe sample rows). */
export async function seed_finance(_prisma: PrismaClient, _ctx: SeedCtx): Promise<void> {}
