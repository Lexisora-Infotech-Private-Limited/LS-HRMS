import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getContext } from '../context/request-context';

/** Models that carry a `tenantId` column — detected from the Prisma DMMF at startup. */
const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

function withTenant(base: PrismaClient) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getContext();
          // No context = system code that queries explicitly by tenantId (login, platform console).
          if (!ctx || !TENANT_MODELS.has(model)) return query(args);
          const tenantId = ctx.tenantId;
          const a = (args ?? {}) as Record<string, any>;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          }
          if (operation === 'create') {
            a.data = { tenantId, ...(a.data ?? {}) };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const d = a.data;
            a.data = Array.isArray(d) ? d.map((x) => ({ tenantId, ...x })) : { tenantId, ...d };
          } else if (operation === 'upsert') {
            a.create = { tenantId, ...(a.create ?? {}) };
          }
          return query(a);
        },
      },
    },
  });
}

export type ExtendedPrisma = ReturnType<typeof withTenant>;

/**
 * Injectable Prisma client. Every model accessor is tenant-scoped: reads are filtered and
 * writes are stamped with the tenant from the active request context.
 *
 * Nested writes (`create: { items: { create: [...] } }`) are NOT stamped automatically —
 * pass `tenantId` explicitly on nested records (use `currentTenantId()`).
 *
 * `this.prisma.raw` is the unscoped base client for platform/system code only.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly db: ExtendedPrisma;

  constructor() {
    this.raw = new PrismaClient();
    this.db = withTenant(this.raw);
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return (target.db as any)[prop];
      },
    });
  }

  async onModuleInit() {
    await this.raw.$connect();
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}

// Let `this.prisma.employee…`, `this.prisma.$transaction…` type-check via the proxy.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends Omit<ExtendedPrisma, '$connect' | '$disconnect'> {}
