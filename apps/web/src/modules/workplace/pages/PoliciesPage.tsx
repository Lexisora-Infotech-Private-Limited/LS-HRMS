import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { WP_POLICY_CATEGORIES, WP_POLICY_CATEGORY_LABEL, type PolicyComplianceRow, type PolicyCompliancePerson, type PolicyDetail, type PolicyRow } from '@lexisora/shared';
import { download, fileUrl } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { Check, ConfirmDialog, ErrorBlock, Loading, PageHeader, Seg, Tabs, Tag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { dayMonthTime, longDay, wpApi, wpKeys } from '../api';
import '../workplace.css';

type PageTab = 'all' | 'pending' | 'holidays' | 'compliance' | 'archived';

/** Policies & rulebook — GEN.policies + FORMS.policy (spec §9), with the holiday list and compliance. */
export default function PoliciesPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as PageTab) || 'all';
  const readId = params.get('read');
  const manage = can('policies.manage');
  const [upload, setUpload] = useState(false);

  const listTab = tab === 'pending' || tab === 'archived' ? tab : 'all';
  const list = useQuery({ queryKey: wpKeys.policyList(listTab), queryFn: () => wpApi.policies(listTab), enabled: tab !== 'holidays' && tab !== 'compliance' });
  const counts = list.data?.counts;

  const setTab = (t: PageTab) => setParams({ tab: t });
  const openReader = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('read', id);
      else n.delete('read');
      return n;
    });

  const tabs: { value: PageTab; label: string }[] = [
    { value: 'all', label: `All${counts ? ` · ${counts.all}` : ''}` },
    { value: 'pending', label: `Pending for me${counts ? ` · ${counts.pending}` : ''}` },
    { value: 'holidays', label: 'Holiday list' },
    ...(manage ? [{ value: 'compliance' as const, label: 'Compliance' }, { value: 'archived' as const, label: `Archived${counts?.archived ? ` · ${counts.archived}` : ''}` }] : []),
  ];

  const cols: Column<PolicyRow>[] = [
    {
      key: 'doc',
      header: 'Document',
      render: (r) => (
        <span>
          {r.title}
          {r.version > 1 && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>v{r.version}</span>}
        </span>
      ),
    },
    { key: 'upd', header: 'Updated', render: (r) => <span className="tnum">{r.updated}</span> },
    { key: 'req', header: 'Requires acknowledgement', render: (r) => (r.requiresAck ? 'Yes' : 'No') },
    {
      key: 'ack',
      header: 'Acknowledged',
      render: (r) => (
        <span className="row" style={{ gap: 8 }}>
          <AckCell r={r} onRead={() => openReader(r.id)} />
          {r.compliance && (
            <span className="faint tnum" title="Acknowledged / required" style={{ fontSize: 12.5 }}>
              {r.compliance}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div data-screen-label="Policies & rulebook" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Policies & rulebook"
        sub="Official rules, HR policies, holiday list and compliance guidelines. Some require acknowledgement."
        actions={
          manage ? (
            <button className="btn btn-primary" onClick={() => setUpload(true)}>
              Upload policy
            </button>
          ) : undefined
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {(tab === 'all' || tab === 'pending' || tab === 'archived') && (
        <>
          {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
          <DataTable
            columns={cols}
            rows={list.data?.items}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            onRowClick={(r) => (r.isHolidayList ? setParams({ tab: 'holidays' }) : openReader(r.id))}
            empty={tab === 'pending' ? 'You’re all caught up — nothing waiting for your acknowledgement.' : tab === 'archived' ? 'No archived policies.' : 'No policies published yet.'}
          />
        </>
      )}
      {tab === 'holidays' && <HolidayTab />}
      {tab === 'compliance' && manage && <ComplianceTab onOpen={(id) => openReader(id)} />}

      {readId && <PolicyReader id={readId} onClose={() => openReader(null)} />}
      {upload && <UploadPolicyForm onClose={() => setUpload(false)} />}
    </div>
  );
}

function AckCell({ r, onRead }: { r: PolicyRow; onRead: () => void }) {
  if (r.myState === 'ACKNOWLEDGED')
    return (
      <span title={r.acknowledgedAt ? `Acknowledged ${dayMonthTime(r.acknowledgedAt)}` : undefined}>
        <Tag tone="accent">You acknowledged</Tag>
      </span>
    );
  if (r.myState === 'PENDING')
    return (
      <button
        className="wp-tag-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRead();
        }}
        title={r.dueAt ? `Due ${dayMonthTime(r.dueAt)}` : undefined}
      >
        <Tag tone={r.overdue ? 'danger' : 'outline'}>{r.overdue ? 'Overdue · read now' : 'Pending · read now'}</Tag>
      </button>
    );
  return <span className="faint">—</span>;
}

// ── Reader ─────────────────────────────────────────────────────────────────

function PolicyReader({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const manage = can('policies.manage');
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.policy(id), queryFn: () => wpApi.policy(id) });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [newVersion, setNewVersion] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | null>(null);
  const opened = useRef(Date.now());

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !newVersion && !confirm && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, newVersion, confirm]);
  useEffect(() => {
    opened.current = Date.now();
    setSeconds(0);
    setChecked(false);
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - opened.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [id]);

  const current = p?.versions.find((v) => v.isCurrent) ?? null;
  const shown = p?.versions.find((v) => v.id === (versionId ?? current?.id)) ?? current;
  const needsAck = !!p && p.myState === 'PENDING' && shown?.id === current?.id;
  const remaining = Math.max(0, (p?.minReadSeconds ?? 10) - seconds);

  const inv = [wpKeys.policies, wpKeys.dashboard, wpKeys.todos];
  const ack = useAction(() => wpApi.acknowledge(current!.id, seconds), {
    success: 'Policy acknowledged',
    invalidate: inv,
    onSuccess: (d) => qc.setQueryData(wpKeys.policy(id), d),
  });
  const archive = useAction(() => wpApi.archivePolicy(id), { success: 'Policy archived', invalidate: inv, onSuccess: onClose });
  const restore = useAction(() => wpApi.restorePolicy(id), { success: 'Policy restored', invalidate: inv });

  return (
    <div className="wp-drawer-backdrop" onMouseDown={onClose}>
      <aside className="wp-drawer wp-drawer-wide" role="dialog" aria-modal aria-label="Policy" onMouseDown={(e) => e.stopPropagation()} data-screen-label="Policy reader">
        {isLoading && <Loading />}
        {error && <ErrorBlock error={error} retry={() => void refetch()} />}
        {p && (
          <>
            <div className="wp-drawer-head">
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Tag tone="neutral">{WP_POLICY_CATEGORY_LABEL[p.category as keyof typeof WP_POLICY_CATEGORY_LABEL] ?? p.category}</Tag>
                  {p.status === 'ARCHIVED' && <Tag tone="neutral">Archived</Tag>}
                  {p.myState === 'ACKNOWLEDGED' && <Tag tone="accent">You acknowledged</Tag>}
                  {p.myState === 'PENDING' && <Tag tone={p.overdue ? 'danger' : 'outline'}>{p.overdue ? 'Overdue' : 'Pending'}</Tag>}
                </div>
                <h3>{p.title}</h3>
                <div className="faint" style={{ fontSize: 13 }}>
                  Version {shown?.version ?? p.version} · effective {longDay(shown?.effectiveFrom ? `${shown.effectiveFrom}T00:00:00Z` : null)}
                  {shown?.publishedBy && ` · published by ${shown.publishedBy}`}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            {p.versions.length > 1 && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <span className="faint">Version history</span>
                <select className="input" style={{ width: 'auto' }} value={shown?.id ?? ''} onChange={(e) => setVersionId(e.target.value)}>
                  {p.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version} · {longDay(`${v.effectiveFrom}T00:00:00Z`)}
                      {v.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shown?.changeSummary && (
              <div className="note">
                <strong style={{ fontWeight: 600 }}>What changed:</strong> {shown.changeSummary}
              </div>
            )}

            {shown?.fileId ? (
              <div className="wp-pdf">
                <iframe title={`${p.title} v${shown.version}`} src={`${fileUrl(shown.fileId)}#view=FitH`} />
              </div>
            ) : (
              <div className="placeholder-media" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>
                <span className="faint">No document attached to this version.</span>
              </div>
            )}
            {shown?.fileId && (
              <div className="row" style={{ gap: 12 }}>
                <a className="wp-link" href={fileUrl(shown.fileId)} target="_blank" rel="noreferrer">
                  Open in a new tab
                </a>
              </div>
            )}

            {needsAck && (
              <div className="wp-ack-box">
                <label className="row" style={{ gap: 10, flexWrap: 'nowrap', opacity: remaining ? 0.6 : 1 }}>
                  <Check checked={checked} onChange={remaining ? undefined : setChecked} label="I have read and understood this policy" />
                  <span>I have read and understood this policy</span>
                </label>
                <div className="row-between">
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    {remaining ? `Read the policy — you can acknowledge in ${remaining} s` : p.dueAt ? `Due ${dayMonthTime(p.dueAt)}` : ''}
                  </span>
                  <button className="btn btn-primary" disabled={!checked || !!remaining || ack.isPending} onClick={() => ack.mutate(undefined)}>
                    {ack.isPending ? 'Saving…' : 'Acknowledge'}
                  </button>
                </div>
              </div>
            )}
            {p.myState === 'PENDING' && shown?.id !== current?.id && <div className="note">You’re viewing an older version. Switch to the current version to acknowledge it.</div>}
            {p.myState === 'ACKNOWLEDGED' && p.acknowledgedAt && (
              <div className="faint" style={{ fontSize: 13 }}>
                You acknowledged version {p.version} on {dayMonthTime(p.acknowledgedAt)}.
              </div>
            )}

            {manage && (
              <div className="wp-receipts">
                <div className="row-between">
                  <span className="eyebrow">Manage</span>
                  {p.compliance && <span className="faint tnum" style={{ fontSize: 13 }}>{p.compliance} acknowledged</span>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {p.status !== 'ARCHIVED' ? (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => setNewVersion(true)}>
                        Publish new version
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('archive')}>
                        Archive
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-secondary btn-sm" disabled={restore.isPending} onClick={() => restore.mutate(undefined)}>
                      Restore
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {newVersion && p && <NewVersionForm policy={p} onClose={() => setNewVersion(false)} />}
        {confirm === 'archive' && (
          <ConfirmDialog
            title="Archive this policy?"
            body="It is hidden from employees and reminders stop. Acknowledgement history is kept."
            confirmLabel="Archive"
            busy={archive.isPending}
            onConfirm={() => archive.mutate(undefined)}
            onClose={() => setConfirm(null)}
          />
        )}
      </aside>
    </div>
  );
}

// ── Forms ──────────────────────────────────────────────────────────────────

const yesNo = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

function UploadPolicyForm({ onClose }: { onClose: () => void }) {
  const create = useAction((b: Record<string, unknown>) => wpApi.createPolicy(b), { success: 'Policy published', invalidate: [wpKeys.policies, wpKeys.dashboard] });
  const fields: FieldDef[] = [
    { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
    { name: 'fileId', label: 'File', type: 'file', required: true, span: 2, category: 'policy', accept: 'application/pdf', hint: 'PDF, up to 20 MB' },
    { name: 'requiresAck', label: 'Require acknowledgement', type: 'select', required: true, options: yesNo },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      options: WP_POLICY_CATEGORIES.filter((c) => c !== 'HOLIDAY_LIST').map((c) => ({ value: c, label: WP_POLICY_CATEGORY_LABEL[c] })),
    },
    { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
    { name: 'ackDueDays', label: 'Acknowledge within (days)', type: 'number', showIf: (v) => v.requiresAck !== 'No' },
    { name: 'changeSummary', label: 'What changed', type: 'area', span: 2, placeholder: 'Optional summary shown above the document' },
  ];
  return (
    <FormModal
      title="Upload policy"
      fields={fields}
      initial={{ requiresAck: 'Yes', category: 'HR', ackDueDays: 7 }}
      submitLabel="Publish"
      onClose={onClose}
      onSubmit={(v) =>
        create.mutateAsync({
          title: v.title,
          fileId: v.fileId,
          requiresAck: v.requiresAck !== 'No',
          category: v.category,
          effectiveFrom: v.effectiveFrom || null,
          ackDueDays: Number(v.ackDueDays) > 0 ? Number(v.ackDueDays) : 7,
          changeSummary: v.changeSummary || null,
        })
      }
    />
  );
}

function NewVersionForm({ policy, onClose }: { policy: PolicyDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useAction((b: Record<string, unknown>) => wpApi.newPolicyVersion(policy.id, b), {
    success: 'New version published',
    invalidate: [wpKeys.policies, wpKeys.dashboard],
    onSuccess: (d) => qc.setQueryData(wpKeys.policy(policy.id), d),
  });
  const fields: FieldDef[] = [
    { name: 'fileId', label: 'File', type: 'file', required: true, span: 2, category: 'policy', accept: 'application/pdf', hint: 'PDF, up to 20 MB' },
    { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
    ...(policy.requiresAck ? [{ name: 'requiresReack', label: 'Require re-acknowledgement', type: 'select' as const, required: true, options: yesNo }] : []),
    { name: 'changeSummary', label: 'What changed', type: 'area', span: 2 },
  ];
  return (
    <FormModal
      title={`New version of ${policy.title}`}
      fields={fields}
      initial={{ requiresReack: 'Yes' }}
      submitLabel="Publish version"
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync({ fileId: v.fileId, effectiveFrom: v.effectiveFrom || null, changeSummary: v.changeSummary || null, requiresReack: v.requiresReack !== 'No' })}
    />
  );
}

// ── Holiday list ───────────────────────────────────────────────────────────

function HolidayTab() {
  const { toastError } = useToast();
  const [year, setYear] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.holidays(year), queryFn: () => wpApi.holidays(year) });
  const y = data?.year ?? year ?? new Date().getFullYear();
  const cols: Column<NonNullable<typeof data>['items'][number]>[] = [
    { key: 'd', header: 'Date', render: (h) => <span className={`tnum${h.past ? ' faint' : ''}`}>{h.date}</span> },
    { key: 'w', header: 'Day', render: (h) => <span className={h.past ? 'faint' : undefined}>{h.day}</span> },
    { key: 'n', header: 'Holiday', render: (h) => <span className={h.past ? 'faint' : undefined}>{h.name}</span> },
    { key: 't', header: 'Type', render: (h) => <Tag tone={h.type === 'MANDATORY' ? 'accent' : 'outline'}>{h.typeLabel}</Tag> },
    { key: 'l', header: 'Location', render: (h) => h.location },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        {data && data.years.length > 1 ? <Seg options={data.years.map((x) => ({ value: String(x), label: String(x) }))} value={String(y)} onChange={(v) => setYear(Number(v))} /> : <span className="eyebrow">Holiday list {y}</span>}
        <button className="btn btn-secondary" onClick={() => void download(`/policies/holidays/${y}/pdf`).catch(toastError)}>
          Download PDF
        </button>
      </div>
      {error && <ErrorBlock error={error} retry={() => void refetch()} />}
      <DataTable columns={cols} rows={data?.items} rowKey={(h) => h.id} loading={isLoading} empty={`No holidays have been published for ${y} yet.`} />
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>
        Mandatory holidays are paid days off for everyone; optional (restricted) holidays can be taken against your leave plan. The list is maintained by HR under Attendance → Holidays.
      </p>
    </div>
  );
}

// ── Compliance ─────────────────────────────────────────────────────────────

function ComplianceTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.compliance, queryFn: wpApi.compliance });
  const [sel, setSel] = useState<PolicyComplianceRow | null>(null);
  const cols: Column<PolicyComplianceRow>[] = [
    { key: 't', header: 'Policy', render: (r) => `${r.title}${r.version > 1 ? ` · v${r.version}` : ''}` },
    { key: 'r', header: 'Required', num: true, render: (r) => r.required },
    { key: 'a', header: 'Acknowledged', num: true, render: (r) => r.acknowledged },
    { key: 'p', header: 'Pending', num: true, render: (r) => r.pending },
    { key: 'o', header: 'Overdue', num: true, render: (r) => (r.overdue ? <Tag tone="danger">{r.overdue}</Tag> : 0) },
    { key: 'c', header: 'Compliance', num: true, render: (r) => `${r.pct}%` },
  ];
  return (
    <>
      {error && <ErrorBlock error={error} retry={() => void refetch()} />}
      <DataTable columns={cols} rows={data} rowKey={(r) => r.id} loading={isLoading} onRowClick={setSel} empty="No policies require acknowledgement." />
      {sel && <ComplianceDrawer row={sel} onClose={() => setSel(null)} onOpen={() => onOpen(sel.id)} />}
    </>
  );
}

function ComplianceDrawer({ row, onClose, onOpen }: { row: PolicyComplianceRow; onClose: () => void; onOpen: () => void }) {
  const { toastError } = useToast();
  const [state, setState] = useState<'pending' | 'overdue' | 'done'>('pending');
  const { data, isLoading } = useQuery({ queryKey: wpKeys.compliancePeople(row.id, state), queryFn: () => wpApi.compliancePeople(row.id, state) });
  const remind = useAction(() => wpApi.remindPolicy(row.id), {
    success: (r) => (r.reminded ? `Reminder sent to ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}` : 'Everyone pending was reminded in the last 24 hours'),
    invalidate: [wpKeys.compliance],
  });
  const people = useMemo(() => data ?? [], [data]);
  return (
    <div className="wp-drawer-backdrop" onMouseDown={onClose}>
      <aside className="wp-drawer" role="dialog" aria-modal aria-label="Compliance" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wp-drawer-head">
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Acknowledgements</span>
            <h3>{row.title}</h3>
            <span className="faint tnum" style={{ fontSize: 13 }}>
              {row.acknowledged} / {row.required} acknowledged · {row.overdue} overdue
            </span>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="row-between">
          <Seg
            options={[
              { value: 'pending', label: `Pending · ${row.pending}` },
              { value: 'overdue', label: `Overdue · ${row.overdue}` },
              { value: 'done', label: `Done · ${row.acknowledged}` },
            ]}
            value={state}
            onChange={(v) => setState(v as typeof state)}
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void download(`/policies/${row.id}/compliance/csv`).catch(toastError)}>
              Export CSV
            </button>
            <button className="btn btn-secondary btn-sm" disabled={!row.pending || remind.isPending} onClick={() => remind.mutate(undefined)}>
              Remind
            </button>
          </div>
        </div>
        {isLoading && <Loading />}
        <div>
          {people.map((x: PolicyCompliancePerson) => (
            <div key={x.employeeId} className="wp-person">
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                {x.initials}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{x.name}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {x.department ?? '—'}
                  {x.lastRemindedAt && !x.acknowledgedAt ? ` · reminded ${dayMonthTime(x.lastRemindedAt)}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 12.5 }} className="tnum">
                {x.acknowledgedAt ? dayMonthTime(x.acknowledgedAt) : x.overdue ? <Tag tone="danger">Overdue</Tag> : `Due ${dayMonthTime(x.dueAt)}`}
              </span>
            </div>
          ))}
          {data && !people.length && <div className="faint" style={{ fontSize: 13, padding: '8px 0' }}>{state === 'done' ? 'No acknowledgements yet.' : 'Nobody here — all caught up.'}</div>}
        </div>
        <button className="wp-link" style={{ alignSelf: 'flex-start' }} onClick={onOpen}>
          Open the policy
        </button>
      </aside>
    </div>
  );
}
