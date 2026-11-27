import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { taxYearLabel, type RegionCode, type RegionStatusDto } from '@lexisora/shared';
import { Card, ConfirmDialog, ErrorBlock, Loading, PageHeader, Tag } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/query';
import '../platform.css';

const KEY = ['platform', 'region'];

/** What changes when a tenant runs in each region (shown before switching). */
const WHAT_CHANGES: Record<RegionCode, string[]> = {
  IN: [
    'Rupees (₹) and Indian digit grouping',
    'India time (IST) for attendance, leave and reminders',
    'Payroll with PF, ESI, professional tax and TDS (April–March year)',
    'GST invoices, input GST and the Indian filing calendar',
    'PAN, Aadhaar, UAN and IFSC on employee records',
  ],
  GB: [
    'Pounds (£) and UK time (Europe/London, with summer time)',
    'PAYE payroll: tax codes, National Insurance, student loans, workplace pension auto-enrolment and statutory pay (SSP, SMP, SPP)',
    'Tax year 6 April – 5 April, HMRC submissions (FPS) and P60s',
    'UK bank holidays by nation and UK holiday & absence types (5.6 weeks annual leave)',
    'Right to work checks, NI number and sort code on employee records',
    'VAT invoices (20% / 5% / 0%) and the HMRC filing calendar',
    'UK wording: Clock in, Line manager, Holiday, Rota and more',
  ],
};

/** Admin → Region & compliance: which country the company runs in, and the UK setup checklist. */
export default function RegionPage() {
  const q = useQuery({ queryKey: KEY, queryFn: () => get<RegionStatusDto>('/region') });
  const { reload, user } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<RegionCode | null>(null);
  const [vat, setVat] = useState('');
  useEffect(() => setVat(q.data?.vatNumber ?? ''), [q.data?.vatNumber]);
  const saveVat = useAction((vatNumber: string) => put<RegionStatusDto>('/region/company-tax', { vatNumber }), {
    success: (r) => (r.vatNumber ? `VAT number ${r.vatNumber} saved` : 'Marked as not VAT registered'),
    invalidate: [KEY],
  });
  const save = useAction((region: RegionCode) => put<RegionStatusDto>('/region', { region, force: !!user?.isPlatformAdmin }), {
    success: (r) => `Region set to ${r.config.name}`,
    onSuccess: async () => {
      setTarget(null);
      await reload();
      await qc.invalidateQueries();
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const done = d.checklist.filter((c) => c.done).length;
  const year = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  return (
    <div data-screen-label="Region & compliance" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Region & compliance"
        sub="The country your company runs in. It sets the currency, time zone, payroll and tax rules, holidays and the words on screen for everyone in this workspace."
      />

      <div className="grid-1-1" style={{ alignItems: 'start' }}>
        {d.options.map((o) => {
          const current = o.code === d.region;
          return (
            <Card
              key={o.code}
              kicker={current ? 'Current region' : 'Available'}
              title={
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  {o.name} {current && <Tag tone="accent">In use</Tag>}
                </span>
              }
            >
              <div className="muted" style={{ fontSize: 13 }}>
                {o.currency} ({o.currencySymbol}) · {o.timezone} · tax year {taxYearLabel(year, o.code)} from {o.taxYearStart.day} {o.taxYearStart.month === 4 ? 'April' : ''} · {o.salesTax}
              </div>
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
                {WHAT_CHANGES[o.code].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {!current && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 14, alignSelf: 'flex-start' }}
                  disabled={d.blockers.length > 0 || save.isPending}
                  onClick={() => setTarget(o.code)}
                >
                  Switch to {o.name}
                </button>
              )}
            </Card>
          );
        })}
      </div>

      {d.blockers.length > 0 && (
        <Card kicker="Switching is locked" title="Why the region cannot be changed here">
          {d.blockers.map((b) => (
            <div key={b} className="list-row">
              {b}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13 }}>
            Records already issued keep the rules they were made under. Contact Lexisora support to move an established company to another country.
          </div>
        </Card>
      )}

      {d.region === 'GB' && (
        <Card kicker="HMRC" title="VAT registration">
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ minWidth: 260 }}>
              <label htmlFor="rg-vat">VAT number</label>
              <input id="rg-vat" className="input" value={vat} onChange={(e) => setVat(e.target.value.toUpperCase())} placeholder="GB123456789 (empty if not VAT registered)" />
            </div>
            <button className="btn btn-secondary" disabled={saveVat.isPending} onClick={() => saveVat.mutate(vat)}>
              Save
            </button>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>Printed on VAT invoices. Leave it empty if the company is not VAT registered: invoices are then issued without VAT.</div>
        </Card>
      )}

      {d.region === 'GB' && (
        <Card kicker={`${done} of ${d.checklist.length} done`} title="UK setup checklist">
          {d.checklist.map((c) => (
            <div key={c.key} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 70, flexShrink: 0 }}>
                <Tag tone={c.done ? "accent" : "danger"}>{c.done ? 'Done' : 'To do'}</Tag>
              </span>
              <span className="grow">
                <strong style={{ fontWeight: 600 }}>{c.label}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{c.detail}</div>
              </span>
              <Link className="btn btn-ghost btn-sm" to={c.link}>
                Open
              </Link>
            </div>
          ))}
        </Card>
      )}

      {target && (
        <ConfirmDialog
          title={`Switch to ${d.options.find((o) => o.code === target)?.name}?`}
          body={
            <div className="stack" style={{ gap: 8 }}>
              <div>Everyone in this workspace will see the new currency, time zone, wording and rules straight away. Existing records are not converted.</div>
              {target === 'GB' && <div>After switching, finish the UK setup checklist before running the first UK pay run.</div>}
            </div>
          }
          confirmLabel="Switch region"
          busy={save.isPending}
          onConfirm={() => save.mutate(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
