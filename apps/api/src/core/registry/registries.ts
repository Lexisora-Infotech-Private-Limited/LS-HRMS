import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { requireContext, type RequestContext } from '../context/request-context';

// ── Approval counts (dashboard "Awaiting your approval" card, header badges) ─────────

export type ApprovalCount = { key: string; label: string; count: number; link: string };
type CountProvider = (ctx: RequestContext) => Promise<ApprovalCount | null>;

/**
 * Domains register what the current user must act on:
 *   approvals.register(async (ctx) => ctx.permissions.has('timesheet.approve.l1') ? { key:'timesheets', label:'Timesheets', count, link:'/approvals' } : null)
 * GET /approvals/counts returns every non-null provider result.
 */
@Injectable()
export class ApprovalCountsService {
  private readonly providers: CountProvider[] = [];
  register(p: CountProvider) {
    this.providers.push(p);
  }
  async counts(): Promise<ApprovalCount[]> {
    const ctx = requireContext();
    const out = await Promise.all(this.providers.map((p) => p(ctx).catch(() => null)));
    return out.filter((x): x is ApprovalCount => !!x);
  }
}

// ── Global search (header "Search people, tasks, documents") ───────────────────

export type SearchHit = { type: string; id: string; title: string; subtitle?: string; link: string };
type SearchProvider = (q: string, ctx: RequestContext) => Promise<SearchHit[]>;

/** Domains register permission-aware providers; results are merged and capped. */
@Injectable()
export class SearchService {
  private readonly providers: { type: string; fn: SearchProvider }[] = [];
  register(type: string, fn: SearchProvider) {
    this.providers.push({ type, fn });
  }
  async search(q: string): Promise<{ type: string; hits: SearchHit[] }[]> {
    const ctx = requireContext();
    const term = q.trim();
    if (term.length < 2) return [];
    const res = await Promise.all(
      this.providers.map(async (p) => ({ type: p.type, hits: (await p.fn(term, ctx).catch(() => [])).slice(0, 6) })),
    );
    return res.filter((r) => r.hits.length);
  }
}

@Controller()
export class RegistriesController {
  constructor(
    private readonly approvals: ApprovalCountsService,
    private readonly searchSvc: SearchService,
  ) {}

  @Get('approvals/counts')
  counts() {
    return this.approvals.counts();
  }

  @Get('search')
  search(@Query('q') q = '') {
    return this.searchSvc.search(q);
  }
}
