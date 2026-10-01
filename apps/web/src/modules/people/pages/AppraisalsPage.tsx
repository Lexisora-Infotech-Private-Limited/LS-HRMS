import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  PEOPLE_EMPLOYMENT_TYPE_LABELS,
  PEOPLE_EMPLOYMENT_TYPES,
  formatDate,
  suggestAppraisalCycle,
  type AppraisalCycleInput,
  type AppraisalCycleRow,
  type KraTemplateDto,
  type KraTemplateInput,
  type MyReviewRow,
  type ParticipantRow,
} from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FormModal, MultiSelect, type FieldDef } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, StatusTag, Tabs, Tag } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys } from '../api';
import { todayKey } from '../components';
import { plusDays } from '../recruitment';
import '../people.css';

type Tab = 'cycles' | 'templates' | 'association' | 'mine';
const REVIEW_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted' };
const NEXT_LABEL: Record<string, string> = { DRAFT: 'Launch self review', SELF_REVIEW: 'Open manager review', MANAGER_REVIEW: 'Start calibration', CALIBRATION: 'Close cycle' };
const ADVANCED_TOAST: Record<string, string> = { SELF_REVIEW: 'Cycle launched · employees notified', MANAGER_REVIEW: 'Manager reviews opened · reviewers notified', CALIBRATION: 'Calibration started', CLOSED: 'Cycle closed · final ratings published' };
const keys = {
  cycles: [...peopleKeys.appraisals, 'cycles'] as const,
  templates: [...peopleKeys.appraisals, 'templates'] as const,
  mine: [...peopleKeys.appraisals, 'mine'] as const,
  participants: (id: string) => [...peopleKeys.appraisals, 'participants', id] as const,
};

export const reviewTag = (s: string) => <Tag tone={s === 'SUBMITTED' ? 'accent' : s === 'IN_PROGRESS' ? 'outline' : 'neutral'}>{REVIEW_LABEL[s] ?? s}</Tag>;
const scoreBand = (score: number | null, band: string | null) => (score == null ? <span className="faint">—</span> : <span className="tnum">{score.toFixed(2)}{band ? <span className="faint"> · {band}</span> : null}</span>);

export default function AppraisalsPage() {
  const can = useCan();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const view = can('appraisal.view');
  const manage = can('appraisal.manage');
  const mine = useQuery({ queryKey: keys.mine, queryFn: () => peopleApi.myReviews() });
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'mine' || params.get('tab') === 'my' || !view ? 'mine' : 'cycles');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const r = params.get('review');
    if (r) nav(`/appraisals/review/${r}`, { replace: true });
  }, [params, nav]);
  const tabs: { value: Tab; label: string }[] = view
    ? [
        { value: 'cycles', label: 'Cycles' },
        { value: 'templates', label: 'Templates' },
        { value: 'association', label: 'Employee association' },
        ...(mine.data?.length || tab === 'mine' ? [{ value: 'mine' as Tab, label: `My reviews${mine.data ? ` · ${mine.data.length}` : ''}` }] : []),
      ]
    : [{ value: 'mine', label: 'My reviews' }];

  return (
    <div data-screen-label="Appraisals" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Appraisals"
        sub={view ? 'Appraisal cycles, KRA templates and employee association.' : 'Your self reviews, the reviews you owe as a manager, and final ratings.'}
        actions={manage && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create cycle</button>}
      />
      {tabs.length > 1 && <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />}
      {tab === 'cycles' && view && <CyclesTab manage={manage} />}
      {tab === 'templates' && view && <TemplatesTab manage={manage} />}
      {tab === 'association' && view && <AssociationTab manage={manage} />}
      {tab === 'mine' && <MineTab rows={mine.data} loading={mine.isLoading} error={mine.error} />}
      {creating && <CreateCycleModal onClose={() => setCreating(false)} />}
    </div>
  );
}

// ── Cycles ─────────────────────────────────────────────────────────────────

function CyclesTab({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: keys.cycles, queryFn: () => peopleApi.cycles() });
  const [open, setOpen] = useState<AppraisalCycleRow | null>(null);
  const columns: Column<AppraisalCycleRow>[] = [
    { key: 'n', header: 'Cycle', render: (r) => r.name },
    { key: 'p', header: 'Period', render: (r) => r.period },
    { key: 'r', header: 'Reviewers', render: (r) => <span className="tnum" title={`${r.participants} employees in the cycle`}>{r.reviewers}</span> },
    { key: 's', header: 'Self review', render: (r) => <span className="tnum">{r.selfPct}%</span> },
    { key: 'm', header: 'Manager review', render: (r) => <span className="tnum">{r.managerPct}%</span> },
    { key: 'st', header: 'Status', render: (r) => <StatusTag status={r.statusLabel} label={r.statusLabel} /> },
  ];
  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const current = open ? (q.data?.find((c) => c.id === open.id) ?? open) : null;
  return (
    <>
      <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(r) => r.id} onRowClick={setOpen} empty="No appraisal cycles yet. Create one to start." />
      {current && <CycleModal cycle={current} manage={manage} onClose={() => setOpen(null)} />}
    </>
  );
}

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function CycleModal({ cycle, manage, onClose }: { cycle: AppraisalCycleRow; manage: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const ps = useQuery({ queryKey: keys.participants(cycle.id), queryFn: () => peopleApi.participants(cycle.id) });
  const [confirm, setConfirm] = useState(false);
  const advance = useAction(() => peopleApi.advanceCycle(cycle.id), {
    success: (r) => ADVANCED_TOAST[r.status] ?? 'Cycle updated',
    invalidate: [peopleKeys.appraisals],
    onSuccess: () => setConfirm(false),
  });
  const next = NEXT_LABEL[cycle.status];
  const columns: Column<ParticipantRow>[] = [
    { key: 'e', header: 'Employee', render: (p) => <div><div>{p.employee}</div><div className="pp-sub">{p.department ?? '—'}</div></div> },
    { key: 'r', header: 'Reviewer', render: (p) => p.reviewer },
    { key: 's', header: 'Self', render: (p) => reviewTag(p.selfStatus) },
    { key: 'm', header: 'Manager', render: (p) => reviewTag(p.managerStatus) },
    { key: 'f', header: 'Final score', render: (p) => scoreBand(p.finalScore, p.band) },
  ];
  return (
    <Modal
      title={`${cycle.name} · ${cycle.period}`}
      wide
      onClose={onClose}
      actions={
        <>
          <button
            className="btn btn-ghost"
            disabled={!ps.data?.length}
            onClick={() =>
              downloadCsv(`${cycle.name.replace(/\s+/g, '-')}-appraisals.csv`, [
                ['Employee', 'Department', 'Reviewer', 'Template', 'Self review', 'Manager review', 'Final score', 'Band'],
                ...(ps.data ?? []).map((p) => [p.employee, p.department, p.reviewer, p.template, REVIEW_LABEL[p.selfStatus] ?? p.selfStatus, REVIEW_LABEL[p.managerStatus] ?? p.managerStatus, p.finalScore, p.band]),
              ])
            }
          >
            Export CSV
          </button>
          {manage && next && <button className="btn btn-primary" onClick={() => setConfirm(true)}>{next}</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <StatusTag status={cycle.statusLabel} label={cycle.statusLabel} />
        <span className="faint" style={{ fontSize: 13 }}>
          Template {cycle.templateName} · self review due {formatDate(cycle.selfReviewDue)} · manager review due {formatDate(cycle.managerReviewDue)} · {cycle.participants} employees, {cycle.reviewers} reviewers
        </span>
      </div>
      <DataTable columns={columns} rows={ps.data} loading={ps.isLoading} rowKey={(p) => p.id} onRowClick={(p) => nav(`/appraisals/review/${p.id}`)} empty="No employees associated yet." />
      {confirm && next && (
        <ConfirmDialog
          title={`${next}?`}
          body={cycle.status === 'DRAFT' ? 'Employees get an alert and an email to start their self review. The KRA template is frozen for this cycle.' : cycle.status === 'CALIBRATION' ? 'Final scores and bands are published to employees. This cannot be undone.' : 'Everyone involved is notified.'}
          confirmLabel={next}
          busy={advance.isPending}
          onConfirm={() => advance.mutate(undefined)}
          onClose={() => setConfirm(false)}
        />
      )}
    </Modal>
  );
}

function CreateCycleModal({ onClose }: { onClose: () => void }) {
  const cycles = useQuery({ queryKey: keys.cycles, queryFn: () => peopleApi.cycles() });
  const lk = useQuery({ queryKey: ['lookups', 'people', 'kra'], queryFn: () => lookupsFor(['kraTemplates']) });
  const save = useAction((b: AppraisalCycleInput) => peopleApi.createCycle(b), { success: (r) => `Cycle created · ${r.participants} employees associated`, invalidate: [peopleKeys.appraisals] });
  if (lk.isLoading || cycles.isLoading) return null;
  let s = suggestAppraisalCycle(todayKey());
  if (cycles.data?.some((c) => c.name === s.name)) s = suggestAppraisalCycle(plusDays(s.to, 1));
  const fields: FieldDef[] = [
    { name: 'name', label: 'Cycle name', type: 'text', span: 2, required: true },
    { name: 'periodFrom', label: 'From', type: 'date', required: true },
    { name: 'periodTo', label: 'To', type: 'date', required: true },
    { name: 'templateId', label: 'KRA template', type: 'select', span: 2, required: true, options: lk.data?.kraTemplates ?? [] },
    { name: 'selfReviewDue', label: 'Self review due', type: 'date' },
    { name: 'managerReviewDue', label: 'Manager review due', type: 'date' },
    { name: 'minTenureDays', label: 'Minimum tenure (days)', type: 'number' },
    { name: 'employmentTypes', label: 'Employment types', type: 'multiselect', options: PEOPLE_EMPLOYMENT_TYPES.map((t) => ({ value: t, label: PEOPLE_EMPLOYMENT_TYPE_LABELS[t] })) },
  ];
  return (
    <FormModal
      title="Create appraisal cycle"
      fields={fields}
      initial={{ name: s.name, periodFrom: s.from, periodTo: s.to, selfReviewDue: plusDays(s.to, 10), managerReviewDue: plusDays(s.to, 20), minTenureDays: 90, employmentTypes: ['FULL_TIME'] }}
      intro={<span className="faint" style={{ fontSize: 12.5 }}>Eligible employees are associated automatically with their reporting manager as reviewer. Adjust them in Employee association before launching.</span>}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync({ ...(v as AppraisalCycleInput), minTenureDays: v.minTenureDays == null ? 90 : Number(v.minTenureDays), employmentTypes: v.employmentTypes?.length ? v.employmentTypes : ['FULL_TIME'] })}
    />
  );
}

// ── Templates ──────────────────────────────────────────────────────────────

function TemplatesTab({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: keys.templates, queryFn: () => peopleApi.kraTemplates() });
  const [editing, setEditing] = useState<KraTemplateDto | 'new' | null>(null);
  const [viewing, setViewing] = useState<KraTemplateDto | null>(null);
  const publish = useAction((id: string) => peopleApi.publishKraTemplate(id), { success: 'Template published', invalidate: [peopleKeys.appraisals, ['lookups']] });
  const columns: Column<KraTemplateDto>[] = [
    { key: 'n', header: 'Name', render: (t) => t.name },
    { key: 'v', header: 'Version', render: (t) => <span className="tnum">v{t.version}</span> },
    { key: 'k', header: 'KRAs', render: (t) => <span className="tnum">{t.items.length}</span> },
    { key: 'w', header: 'Total weight', render: (t) => <span className="tnum">{t.items.reduce((a, i) => a + i.weight, 0)}%</span> },
    { key: 'u', header: 'Used in cycles', render: (t) => <span className="tnum">{t.cycles}</span> },
    { key: 's', header: 'Status', render: (t) => <Tag tone={t.status === 'PUBLISHED' ? 'accent' : 'outline'}>{t.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Tag> },
    {
      key: 'a',
      header: '',
      render: (t) =>
        manage && (
          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
            {t.status === 'DRAFT' && <button className="btn btn-secondary btn-sm" onClick={() => publish.mutate(t.id)}>Publish</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>New version</button>
          </span>
        ),
    },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {manage && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setEditing('new')}>New template</button>
        </div>
      )}
      <DataTable columns={columns} rows={q.data} loading={q.isLoading} rowKey={(t) => t.id} onRowClick={setViewing} empty="No KRA templates yet." />
      {editing && <TemplateEditor base={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <Modal title={`${viewing.name} v${viewing.version}`} wide onClose={() => setViewing(null)} actions={<button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>}>
          {viewing.items.map((i) => (
            <div key={i.id} className="list-row">
              <span>
                {i.title}
                {i.description && <span className="faint"> · {i.description}</span>}
                {i.measurement && <div className="pp-sub">Measured by: {i.measurement}</div>}
              </span>
              <span className="tnum">{i.weight}%</span>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

type KraDraft = { title: string; description: string; measurement: string; weight: string };

function TemplateEditor({ base, onClose }: { base: KraTemplateDto | null; onClose: () => void }) {
  const { toastError } = useToast();
  const [name, setName] = useState(base?.name ?? '');
  const [items, setItems] = useState<KraDraft[]>(
    base ? base.items.map((i) => ({ title: i.title, description: i.description ?? '', measurement: i.measurement ?? '', weight: String(i.weight) })) : [{ title: '', description: '', measurement: '', weight: '100' }],
  );
  const save = useAction((b: KraTemplateInput) => peopleApi.createKraTemplate(b), { success: (_r, b) => (b.publish ? 'Template published' : 'Template saved as draft'), invalidate: [peopleKeys.appraisals, ['lookups']], onSuccess: onClose });
  const total = items.reduce((a, i) => a + (Number(i.weight) || 0), 0);
  const set = (n: number, k: keyof KraDraft, v: string) => setItems((s) => s.map((x, i) => (i === n ? { ...x, [k]: v } : x)));
  const submit = (publish: boolean) => {
    if (name.trim().length < 2) return toastError(new Error('Enter the template name'));
    if (items.some((i) => i.title.trim().length < 2)) return toastError(new Error('Every KRA needs a title'));
    save.mutate({ name: name.trim(), publish, items: items.map((i) => ({ title: i.title.trim(), description: i.description.trim() || null, measurement: i.measurement.trim() || null, weight: Number(i.weight) || 0 })) });
  };
  return (
    <Modal
      title={base ? `New version of ${base.name}` : 'New KRA template'}
      wide
      onClose={onClose}
      actions={
        <>
          <span className={`tnum ${Math.abs(total - 100) > 0.01 ? 'pp-err' : 'faint'}`} style={{ marginRight: 'auto', fontSize: 13 }}>Total weight {total}% {Math.abs(total - 100) > 0.01 ? '· must equal 100%' : ''}</span>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary" disabled={save.isPending} onClick={() => submit(false)}>Save draft</button>
          <button className="btn btn-primary" disabled={save.isPending || Math.abs(total - 100) > 0.01} onClick={() => submit(true)}>Publish</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="kra-name">Template name</label>
        <input id="kra-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" disabled={!!base} />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((it, n) => (
          <div key={n} className="pp-kra-row">
            <input className="input" placeholder="KRA title" value={it.title} onChange={(e) => set(n, 'title', e.target.value)} />
            <input className="input" placeholder="Description" value={it.description} onChange={(e) => set(n, 'description', e.target.value)} />
            <input className="input" placeholder="How it is measured" value={it.measurement} onChange={(e) => set(n, 'measurement', e.target.value)} />
            <input className="input tnum" inputMode="decimal" aria-label="Weight %" value={it.weight} onChange={(e) => set(n, 'weight', e.target.value.replace(/[^0-9.]/g, ''))} />
            <button className="btn btn-ghost btn-sm" disabled={items.length === 1} onClick={() => setItems((s) => s.filter((_, i) => i !== n))} aria-label="Remove KRA">✕</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setItems((s) => [...s, { title: '', description: '', measurement: '', weight: '0' }])}>+ Add KRA</button>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>Rating scale 1–5: Unsatisfactory · Needs improvement · Meets expectations · Exceeds expectations · Outstanding.</div>
    </Modal>
  );
}

// ── Employee association ───────────────────────────────────────────────────

function AssociationTab({ manage }: { manage: boolean }) {
  const nav = useNavigate();
  const cycles = useQuery({ queryKey: keys.cycles, queryFn: () => peopleApi.cycles() });
  const [cycleId, setCycleId] = useState<string>('');
  const active = useMemo(() => cycles.data?.find((c) => c.id === cycleId) ?? cycles.data?.find((c) => c.status !== 'CLOSED') ?? cycles.data?.[0] ?? null, [cycles.data, cycleId]);
  const ps = useQuery({ queryKey: keys.participants(active?.id ?? 'none'), queryFn: () => peopleApi.participants(active!.id), enabled: !!active });
  const lk = useQuery({ queryKey: ['lookups', 'people', 'association'], queryFn: () => lookupsFor(['employees', 'departments']), enabled: manage });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ParticipantRow | null>(null);
  const inv = [peopleKeys.appraisals];
  const reviewer = useAction(({ id, reviewerEmployeeId }: { id: string; reviewerEmployeeId: string }) => peopleApi.updateParticipant(id, { reviewerEmployeeId }), { success: 'Reviewer changed', invalidate: inv });
  const remove = useAction((id: string) => peopleApi.removeParticipant(id), { success: 'Removed from the cycle', invalidate: inv, onSuccess: () => setRemoving(null) });
  const locked = active?.status === 'CLOSED' || active?.status === 'CALIBRATION';
  if (cycles.isLoading) return <Loading />;
  if (!active) return <div className="empty">Create a cycle first.</div>;
  const employees = lk.data?.employees ?? [];
  const columns: Column<ParticipantRow>[] = [
    { key: 'e', header: 'Name', render: (p) => p.employee },
    { key: 'd', header: 'Department', render: (p) => p.department ?? '—' },
    {
      key: 'r',
      header: 'Reviewer',
      render: (p) =>
        manage && !locked && p.managerStatus !== 'SUBMITTED' ? (
          <select className="input" style={{ padding: '4px 8px', fontSize: 13 }} value={p.reviewerEmployeeId} onClick={(e) => e.stopPropagation()} onChange={(e) => reviewer.mutate({ id: p.id, reviewerEmployeeId: e.target.value })}>
            {!employees.some((o) => o.value === p.reviewerEmployeeId) && <option value={p.reviewerEmployeeId}>{p.reviewer}</option>}
            {employees.filter((o) => o.value !== p.employeeId).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          p.reviewer
        ),
    },
    { key: 't', header: 'Template', render: (p) => p.template },
    { key: 'el', header: 'Eligible', render: (p) => (p.eligible ? 'Yes' : <span className="faint" title="Outside the cycle's tenure or employment-type rule">No</span>) },
    { key: 's', header: 'Self', render: (p) => reviewTag(p.selfStatus) },
    { key: 'm', header: 'Manager', render: (p) => reviewTag(p.managerStatus) },
    {
      key: 'a',
      header: '',
      render: (p) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-secondary btn-sm" onClick={() => nav(`/appraisals/review/${p.id}`)}>Review</button>
          {manage && !locked && <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(p)}>Remove</button>}
        </span>
      ),
    },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor="assoc-cycle" className="faint" style={{ fontSize: 13 }}>Cycle</label>
          <select id="assoc-cycle" className="input" style={{ width: 'auto' }} value={active.id} onChange={(e) => setCycleId(e.target.value)}>
            {(cycles.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {c.statusLabel}</option>
            ))}
          </select>
        </div>
        {manage && !locked && <button className="btn btn-secondary" onClick={() => setAdding(true)}>Add employees</button>}
      </div>
      <DataTable columns={columns} rows={ps.data} loading={ps.isLoading} rowKey={(p) => p.id} empty="No one is associated with this cycle yet." />
      {adding && <AddParticipantsModal cycleId={active.id} employees={employees} departments={lk.data?.departments ?? []} onClose={() => setAdding(false)} />}
      {removing && <ConfirmDialog title={`Remove ${removing.employee} from ${active.name}?`} body="Their reviews in this cycle are kept but no longer count." confirmLabel="Remove" danger busy={remove.isPending} onConfirm={() => remove.mutate(removing.id)} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function AddParticipantsModal({ cycleId, employees, departments, onClose }: { cycleId: string; employees: { value: string; label: string }[]; departments: { value: string; label: string }[]; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [dept, setDept] = useState('');
  const save = useAction(() => peopleApi.addParticipants(cycleId, { employeeIds: ids, departmentId: dept || null }), {
    success: (r) => `${r.added} added${r.skipped ? ` · ${r.skipped} skipped (no reporting manager)` : ''}`,
    invalidate: [peopleKeys.appraisals],
    onSuccess: onClose,
  });
  return (
    <Modal
      title="Add employees to the cycle"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={(!ids.length && !dept) || save.isPending} onClick={() => save.mutate(undefined)}>Add</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label>Employees</label>
          <MultiSelect options={employees} value={ids} onChange={setIds} />
        </div>
        <div className="field span-2">
          <label htmlFor="ap-dept">Or everyone active in a department</label>
          <select id="ap-dept" className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}

// ── My reviews ─────────────────────────────────────────────────────────────

function MineTab({ rows, loading, error }: { rows: MyReviewRow[] | undefined; loading: boolean; error: unknown }) {
  const nav = useNavigate();
  if (error) return <ErrorBlock error={error} />;
  const columns: Column<MyReviewRow>[] = [
    { key: 'c', header: 'Cycle', render: (r) => r.cycleName },
    { key: 'e', header: 'Employee', render: (r) => r.employee },
    { key: 'r', header: 'Your part', render: (r) => (r.role === 'SELF' ? 'Self review' : 'Manager review') },
    { key: 's', header: 'Self', render: (r) => reviewTag(r.selfStatus) },
    { key: 'm', header: 'Manager', render: (r) => reviewTag(r.managerStatus) },
    { key: 'f', header: 'Final', render: (r) => scoreBand(r.finalScore, r.band) },
    { key: 'd', header: 'Due', render: (r) => (r.cycleStatus === 'CLOSED' ? <span className="faint">Closed</span> : formatDate(r.due)) },
  ];
  return <DataTable columns={columns} rows={rows} loading={loading} rowKey={(r) => r.id} onRowClick={(r) => nav(`/appraisals/review/${r.id}`)} empty="No reviews for you right now. You'll get an alert when a cycle opens." />;
}
