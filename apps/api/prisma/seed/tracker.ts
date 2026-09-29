import type { PrismaClient } from '@prisma/client';
import type { SeedCtx } from './core';

/** Demo data for the tracker domain (matches the wireframe sample rows). */
export async function seed_tracker(_prisma: PrismaClient, _ctx: SeedCtx): Promise<void> {}
