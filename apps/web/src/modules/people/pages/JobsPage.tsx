import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGES, JOB_TYPE_LABELS, JOB_TYPES, type JobInput, type JobRow } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef, type FormValues } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { Card, ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, StatusTag, Tabs, Tag } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys, type JobDetail, type RoundRow } from '../api';
import { PromptModal } from '../recruitment';
import '../people.css';

type Tab = 'open' | 'closed' | 'masters';

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: [...peopleKeys.jobs, tab], queryFn: () => peopleApi.jobs(tab === 'closed' ? 'closed' : 'open'), enabled: tab !== 'masters', placeholderData: (p) => p });
  const c = list.data?.counts;

  const columns: Column<JobRow>[] = [
    { key: 'p', header: 'Position', render: (r) => <span>{r.title}{r.status === 'DRAFT' && <span className="faint"> · draft</span>}</span> },
    { key: 'd', header: 'Department', render: (r) => r.department },
    { key: 't', header: 'Type', render: (r) => r.typeLabel },
    { key: 'o', header: 'Openings', render: (r) => <span className="tnum">{r.openings}</span> },
    { key: 'b', header: 'Branch', render: (r) => r.branch },
    { key: 'a', header: 'Applicants', render: (r) => <span className="tnum">{r.applicants}</span> },
    { key: 's', header: 'Status', render: (r) => <Tag tone={r.status === 'OPEN' ? 'accent' : r.status === 'DRAFT' ? 'outline' : 'neutral'}>{r.statusLabel}</Tag> },
  ];

  return (
    <div data-screen-label="Jobs" className="stack" style={{ gap: 18 }}>
      <PageHeader title="Jobs" sub="Open positions with department, designation, job type and branch masters." actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add job</button>} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: `Open${c ? ` · ${c.open}` : ''}` },
          { value: 'closed', label: `Closed${c && c.closed ? ` · ${c.closed}` : ''}` },
          { value: 'masters', label: 'Masters' },
        ]}
      />
      {tab === 'masters' ? (
        <JobMasters />
      ) : list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} empty={tab === 'closed' ? 'No closed positions yet.' : 'No open positions. Add a job to start hiring.'} />
      )}
      {adding && <JobFormModal onClose={() => setAdding(false)} />}
      {openId && <JobDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** FORMS.job — "Publish job" (or save as draft). */
function JobFormModal({ job, onClose }: { job?: JobDetail; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'job-form'], queryFn: () => lookupsFor(['departments', 'designations', 'branches', 'managers', 'interviewRounds']) });
  const save = useAction((b: JobInput) => peopleApi.saveJob(job?.id ?? null, b), {
    success: (r) => (job ? 'Job updated' : r.status === 'DRAFT' ? 'Job saved as draft' : `${r.title} published`),
    invalidate: [peopleKeys.jobs, ['lookups']],
  });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const fields: FieldDef[] = [
    { name: 'title', label: 'Position', type: 'text', span: 2, required: true, placeholder: 'React Developer' },
    { name: 'departmentId', label: 'Department', type: 'select', required: true, options: d.departments ?? [] },
    { name: 'jobType', label: 'Job type', type: 'select', required: true, options: JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] })) },
    { name: 'openings', label: 'Openings', type: 'number', required: true },
    { name: 'branchId', label: 'Branch', type: 'select', required: true, options: d.branches ?? [] },
    { name: 'designationId', label: 'Designation', type: 'select', options: d.designations ?? [] },
    { name: 'hiringManagerId', label: 'Hiring manager', type: 'select', options: d.managers ?? [] },
    { name: 'experienceMinYrs', label: 'Experience from (years)', type: 'number' },
    { name: 'experienceMaxYrs', label: 'Experience to (years)', type: 'number' },
    { name: 'roundNames', label: 'Interview rounds (in order)', type: 'multiselect', span: 2, options: d.interviewRounds ?? [] },
    { name: 'description', label: 'Description', type: 'area', placeholder: 'Responsibilities, skills, perks' },
    ...(job ? [] : [{ name: 'draft', label: 'Save as draft (publish later)', type: 'checkbox', span: 2 } as FieldDef]),
  ];
  const initial: FormValues = job
    ? { title: job.title, departmentId: job.departmentId, jobType: job.jobType, openings: job.openings, branchId: job.branchId ?? '', designationId: job.designationId ?? '', hiringManagerId: job.hiringManagerId ?? '', experienceMinYrs: job.experienceMinYrs ?? '', experienceMaxYrs: job.experienceMaxYrs ?? '', roundNames: job.roundNames, description: job.description ?? '' }
    : { jobType: 'FULL_TIME', openings: 1, roundNames: (d.interviewRounds ?? []).filter((r) => /technical 1|hr/i.test(r.label)).map((r) => r.value) };
  return (
    <FormModal
      title={job ? `Edit ${job.title}` : 'Add job'}
      fields={fields}
      initial={initial}
      wide
      submitLabel={job ? 'Save changes' : 'Publish job'}
      onClose={onClose}
      onSubmit={async (v) => {
        const { draft, ...rest } = v;
        await save.mutateAsync({ ...(rest as JobInput), openings: Number(rest.openings ?? 1), roundNames: rest.roundNames ?? [], status: job ? (job.status === 'DRAFT' ? 'DRAFT' : 'OPEN') : draft ? 'DRAFT' : 'OPEN' });
      }}
    />
  );
}

function JobDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: [...peopleKeys.jobs, 'detail', id], queryFn: () => peopleApi.job(id) });
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const status = useAction(({ to, reason }: { to: 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'CLOSED'; reason?: string }) => peopleApi.jobStatus(id, to, reason ?? null), {
    success: (r) => `${r.title} · ${r.statusLabel.toLowerCase()}`,
    invalidate: [peopleKeys.jobs, ['lookups']],
  });
  const j = q.data;
  return (
    <Modal
      title={j ? j.title : 'Job'}
      wide
      onClose={onClose}
      actions={
        j && (
          <>
            <button className="btn btn-ghost" onClick={() => nav(`/candidates?job=${j.id}`)}>View candidates</button>
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>Edit</button>
            {j.status === 'DRAFT' && <button className="btn btn-primary" onClick={() => status.mutate({ to: 'OPEN' })}>Publish</button>}
            {j.status === 'OPEN' && <button className="btn btn-secondary" onClick={() => status.mutate({ to: 'ON_HOLD' })}>Put on hold</button>}
            {j.status === 'ON_HOLD' && <button className="btn btn-primary" onClick={() => status.mutate({ to: 'OPEN' })}>Reopen</button>}
            {j.status === 'CLOSED' && <button className="btn btn-primary" onClick={() => status.mutate({ to: 'OPEN' })}>Reopen</button>}
            {j.status !== 'CLOSED' && <button className="btn btn-danger" onClick={() => setClosing(true)}>Close job</button>}
          </>
        )
      }
    >
      {q.isLoading || !j ? (
        <Loading />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 6 }}>
            <Tag tone="neutral">{j.code}</Tag>
            <StatusTag status={j.status === 'ON_HOLD' ? 'hold' : j.statusLabel} label={j.statusLabel} />
            <span className="faint" style={{ fontSize: 13 }}>{j.department} · {j.typeLabel} · {j.branch} · {j.openings} opening{j.openings === 1 ? '' : 's'}{j.experienceMinYrs != null ? ` · ${j.experienceMinYrs}–${j.experienceMaxYrs ?? j.experienceMinYrs + 3} yrs` : ''}</span>
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Pipeline</div>
            <div className="pp-pipeline">
              {APPLICATION_STAGES.filter((s) => s !== 'WITHDRAWN' || j.pipeline[s]).map((s) => (
                <div key={s} className="pp-pipe-cell">
                  <div className="pp-pipe-n tnum">{j.pipeline[s] ?? 0}</div>
                  <div className="pp-sub">{APPLICATION_STAGE_LABELS[s]}</div>
                </div>
              ))}
            </div>
          </div>
          {j.roundNames.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 13 }}>Interview rounds:</span>
              {j.roundNames.map((r, i) => (
                <Tag key={r} tone="outline">{i + 1}. {r}</Tag>
              ))}
            </div>
          )}
          {j.description ? <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{j.description}</div> : <div className="faint" style={{ fontSize: 13 }}>No description.</div>}
        </div>
      )}
      {editing && j && <JobFormModal job={j} onClose={() => setEditing(false)} />}
      {closing && j && (
        <PromptModal
          title={`Close ${j.title}`}
          label="Reason"
          submitLabel="Close job"
          initial="Position filled"
          onClose={() => setClosing(false)}
          onSubmit={(reason) => status.mutateAsync({ to: 'CLOSED', reason })}
        />
      )}
    </Modal>
  );
}

/** Masters tab: org masters live on /masters (audit G8); interview rounds are managed here. */
function JobMasters() {
  const nav = useNavigate();
  const can = useCan();
  const masters = useQuery({ queryKey: peopleKeys.masters, queryFn: () => peopleApi.masters(), enabled: can('masters.manage') || can('jobs.manage') });
  const rounds = useQuery({ queryKey: peopleKeys.rounds, queryFn: () => peopleApi.rounds() });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<RoundRow | null>(null);
  const create = useAction((b: FormValues) => peopleApi.createRound({ name: String(b.name), defaultDurationMin: Number(b.defaultDurationMin || 60), criteria: String(b.criteria ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 1) }), {
    success: 'Interview round added',
    invalidate: [peopleKeys.rounds, ['lookups']],
  });
  const deactivate = useAction((id: string) => peopleApi.deactivateRound(id), { success: 'Round removed', invalidate: [peopleKeys.rounds, ['lookups']], onSuccess: () => setRemoving(null) });
  const m = masters.data;
  const block = (title: string, rows: { id: string; name: string; meta?: string }[] | undefined) => (
    <Card kicker={title} title={rows ? `${rows.length}` : '—'}>
      <div style={{ maxHeight: 180, overflow: 'auto' }}>
        {(rows ?? []).map((r) => (
          <div key={r.id} className="list-row">
            <span>{r.name}</span>
            {r.meta && <span className="faint">{r.meta}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row-between">
        <span className="faint" style={{ fontSize: 13 }}>Departments, designations and branches are shared with the employee directory.</span>
        {can('masters.manage') && <button className="btn btn-secondary" onClick={() => nav('/masters')}>Manage masters</button>}
      </div>
      <div className="grid-auto" style={{ ['--min' as string]: '220px' }}>
        {block('Departments', m?.departments.map((d) => ({ id: d.id, name: d.name, meta: `${d.employees}` })))}
        {block('Designations', m?.designations.map((d) => ({ id: d.id, name: d.name, meta: `${d.employees}` })))}
        {block('Branches', m?.branches.map((d) => ({ id: d.id, name: d.name, meta: `${d.employees}` })))}
      </div>
      <div className="row-between">
        <div>
          <div className="kicker">Interview rounds</div>
          <div className="faint" style={{ fontSize: 13 }}>Round types used when scheduling interviews, with the scorecard criteria for each.</div>
        </div>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>Add round</button>
      </div>
      <DataTable
        columns={[
          { key: 'n', header: 'Round', render: (r: RoundRow) => r.name },
          { key: 'd', header: 'Duration', render: (r: RoundRow) => <span className="tnum">{r.defaultDurationMin} min</span> },
          { key: 'c', header: 'Scorecard criteria', render: (r: RoundRow) => <span className="faint">{r.criteria.map((c) => c.label).join(', ') || '—'}</span> },
          { key: 'a', header: '', render: (r: RoundRow) => <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setRemoving(r); }}>Remove</button> },
        ]}
        rows={rounds.data}
        loading={rounds.isLoading}
        rowKey={(r) => r.id}
        empty="No interview rounds yet."
      />
      {adding && (
        <FormModal
          title="Add interview round"
          fields={[
            { name: 'name', label: 'Round name', type: 'text', span: 2, required: true, placeholder: 'System design' },
            { name: 'defaultDurationMin', label: 'Default duration (minutes)', type: 'number' },
            { name: 'criteria', label: 'Scorecard criteria (comma separated)', type: 'text', span: 2, placeholder: 'Problem solving, Architecture, Communication' },
          ]}
          initial={{ defaultDurationMin: 60 }}
          onClose={() => setAdding(false)}
          onSubmit={(v) => create.mutateAsync(v)}
        />
      )}
      {removing && <ConfirmDialog title={`Remove ${removing.name}?`} body="Existing interviews keep their round; it just won't be offered for new ones." confirmLabel="Remove" danger onConfirm={() => deactivate.mutate(removing.id)} onClose={() => setRemoving(null)} busy={deactivate.isPending} />}
    </div>
  );
}
