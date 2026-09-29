import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type Option = { value: string; label: string };
type Provider = () => Promise<Option[]>;

/**
 * Registry of dropdown sources for web forms (GET /lookups?types=employees,projects).
 * Core registers people/org lookups; domain modules register theirs in onModuleInit:
 *   this.lookups.register('projects', () => …)
 * Providers run inside the request context, so queries are tenant-scoped.
 */
@Injectable()
export class LookupsService {
  private readonly providers = new Map<string, Provider>();

  constructor(private readonly prisma: PrismaService) {
    this.register('employees', async () =>
      (await this.prisma.employee.findMany({ where: { status: { not: 'EXITED' } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, empCode: true } })).map((e) => ({ value: e.id, label: `${e.fullName} · ${e.empCode}` })),
    );
    this.register('managers', async () => {
      const rows = await this.prisma.employee.findMany({
        where: { status: { not: 'EXITED' }, user: { role: { key: { in: ['manager', 'lead', 'hr', 'admin'] } } } },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true },
      });
      return rows.map((e) => ({ value: e.id, label: e.fullName }));
    });
    this.register('interns', async () =>
      (await this.prisma.employee.findMany({ where: { employmentType: 'INTERN', status: { not: 'EXITED' } }, orderBy: { fullName: 'asc' } })).map((e) => ({ value: e.id, label: e.fullName })),
    );
    this.register('departments', async () => (await this.prisma.department.findMany({ orderBy: { name: 'asc' } })).map((d) => ({ value: d.id, label: d.name })));
    this.register('designations', async () => (await this.prisma.designation.findMany({ orderBy: { name: 'asc' } })).map((d) => ({ value: d.id, label: d.name })));
    this.register('branches', async () => (await this.prisma.branch.findMany({ orderBy: { name: 'asc' } })).map((d) => ({ value: d.id, label: d.name })));
  }

  register(type: string, p: Provider) {
    this.providers.set(type, p);
  }

  async resolve(types: string[]): Promise<Record<string, Option[]>> {
    const out: Record<string, Option[]> = {};
    await Promise.all(
      types.map(async (t) => {
        const p = this.providers.get(t);
        out[t] = p ? await p() : [];
      }),
    );
    return out;
  }
}

@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get()
  get(@Query('types') types = '') {
    return this.lookups.resolve(types.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20));
  }
}
