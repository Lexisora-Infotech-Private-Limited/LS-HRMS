import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PROJECT_MEMBER_ROLES, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, formatDate, formatINR, type ProjectDetail, type TaskStatusKey } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { useLookups, opts } from '@/components/lookups';
import { DataTable } from '@/components/table';
import { Card, ConfirmDialog, Empty, ErrorBlock, Kpis, Loading, PageHeader, Tabs, Tag, humanize } from '@/components/ui';
import { hours, workApi, workKeys } from '../api';
import { DocumentsList, Progress } from '../components';
import { GitIntegrationCard } from './GitIntegrationCard';
import '../work.css';

type Tab = 'overview' | 'modules' | 'members' | 'documents' | 'boards' | 'git';

export default function ProjectDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | { status: string; title: string; body: string }>(null);
  const q = useQuery({ queryKey: workKeys.project(id), queryFn: () => workApi.project(id), enabled: !!id });
  const inv = [workKeys.project(id), workKeys.projects];
  const setStatus = useAction((b: { status: string; cancelRemaining?: boolean }) => workApi.setProjectStatus(id, b), {
    success: (_r, b) => `Project ${PROJECT_STATUS_LABELS[b.status as keyof typeof PROJECT_STATUS_LABELS]?.toLowerCase() ?? 'updated'}`,
    invalidate: inv,
    onSuccess: () => setConfirm(null),
  });
  const archive = useAction(() => workApi.archiveProject(id), { success: 'Project archived · moved to the archive & client vault', invalidate: [...inv, workKeys.archive], onSuccess: () => nav('/archive') });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  const p = q.data;
  const firstBoard = p.boards.find((b) => !b.locked) ?? p.boards[0];
  const statusActions: { status: string; label: string; body: string }[] = [];
  if (p.canManage) {
    if (p.status === 'PLANNING') statusActions.push({ status: 'ACTIVE', label: 'Start project', body: 'The project becomes active and appears in the tracker task picker.' });
    if (p.status === 'ACTIVE') statusActions.push({ status: 'ON_HOLD', label: 'Put on hold', body: 'Tasks stay on the board; time can still be logged.' });
    if (p.status === 'ON_HOLD') statusActions.push({ status: 'ACTIVE', label: 'Resume', body: 'The project becomes active again.' });
    if (p.status === 'ACTIVE' || p.status === 'ON_HOLD') statusActions.push({ status: 'COMPLETED', label: 'Mark completed', body: 'Open tasks are cancelled. The project can then be archived to the client vault.' });
    if (p.status === 'COMPLETED') statusActions.push({ status: 'ACTIVE', label: 'Reopen', body: 'The project becomes active again.' });
  }
  return (
    <div data-screen-label="Project detail" className="stack" style={{ gap: 18 }}>
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/projects')}>← Projects</button>
      <PageHeader
        kicker={`${p.key} · ${p.clientName}`}
        title={p.name}
        sub={
          <span className="row" style={{ gap: 6 }}>
            <Tag tone={p.status === 'ACTIVE' ? (p.health === 'AT_RISK' || p.health === 'OFF_TRACK' ? 'outline' : 'accent') : 'neutral'}>{p.statusLabel}</Tag>
            {p.healthReason && <span className="faint" style={{ fontSize: 12.5 }}>{p.healthReason}</span>}
          </span>
        }
        actions={
          <>
            {firstBoard && <button className="btn btn-secondary" onClick={() => nav(`/board?project=${p.id}&board=${firstBoard.departmentId}`)}>Open board</button>}
            {statusActions.map((a) => (
              <button key={a.label} className="btn btn-secondary" onClick={() => setConfirm({ status: a.status, title: `${a.label} · ${p.name}?`, body: a.body })}>{a.label}</button>
            ))}
            {p.canArchive && <button className="btn btn-secondary" onClick={() => archive.mutate(undefined)}>Archive project</button>}
            {p.canManage && <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
          </>
        }
      />
      <Kpis
        items={[
          { label: 'Progress', value: `${p.progressPct}%`, sub: `${Object.entries(p.tasksByStatus).reduce((s, [, n]) => s + n, 0)} tasks` },
          { label: 'Estimated vs logged', value: `${hours(p.estimatedMinutes, '0h')} / ${hours(p.loggedMinutes, '0h')}`, sub: `${hours(p.taskEstimateMinutes, '0h')} broken down into tasks` },
          { label: 'Deadline', value: p.deadline ? formatDate(p.deadline) : '—', sub: p.startDate ? `Started ${formatDate(p.startDate)}` : '' },
          { label: 'Billing', value: p.billable ? (p.effectiveRatePaise != null ? `${formatINR(p.effectiveRatePaise)}/h` : 'Rate missing') : 'Non-billable', sub: p.billable ? (p.ratePerHourPaise == null && p.effectiveRatePaise != null ? 'Client default rate' : 'Project rate') : 'Internal' },
        ]}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'modules', label: `Modules · ${p.modules.filter((m) => !m.isArchived).length}` },
          { value: 'members', label: `Members · ${p.members.length}` },
          { value: 'documents', label: `Documents · ${p.documents.length}` },
          { value: 'boards', label: 'Boards' },
          { value: 'git', label: 'Git' },
        ]}
      />
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'modules' && <Modules p={p} />}
      {tab === 'members' && <Members p={p} />}
      {tab === 'documents' && <Documents p={p} />}
      {tab === 'boards' && <Boards p={p} />}
      {tab === 'git' && <GitTab p={p} />}
      {editing && <EditProject p={p} onClose={() => setEditing(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel="Confirm"
          busy={setStatus.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => setStatus.mutate({ status: confirm.status, cancelRemaining: confirm.status === 'COMPLETED' ? true : undefined })}
        />
      )}
    </div>
  );
}

function Overview({ p }: { p: ProjectDetail }) {
  const statuses: TaskStatusKey[] = ['OPEN', 'ALLOTTED', 'WIP', 'DEV_COMPLETED', 'QA', 'DONE', 'CANCELLED'];
  return (
    <div className="wk-detail-grid">
      <Card kicker="About">
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.description || <span className="faint">No description.</span>}</p>
        <div className="wk-kv" style={{ marginTop: 12 }}>
          <span>Client</span><span>{p.clientName}</span>
          <span>Project lead</span><span>{p.leadName ?? '—'}</span>
          <span>Category</span><span>{humanize(p.category)}</span>
          <span>Tech stack</span><span>{p.techStack.length ? p.techStack.join(', ') : '—'}</span>
          <span>Repository</span><span>{p.gitRepoUrl ? <a href={p.gitRepoUrl} target="_blank" rel="noreferrer">{p.gitRepoUrl}</a> : '—'}</span>
          <span>Archive access</span><span>{p.archiveAccess === 'ALL_DEVELOPERS' ? 'All developers' : 'Leads only'}</span>
        </div>
      </Card>
      <Card kicker="Tasks by status">
        <Progress pct={p.progressPct} />
        <div style={{ marginTop: 8 }}>
          {statuses.map((s) => (
            <div key={s} className="kv-row"><span>{TASK_STATUS_LABELS[s]}</span><span className="tnum">{p.tasksByStatus[s] ?? 0}</span></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Modules({ p }: { p: ProjectDetail }) {
  const [name, setName] = useState('');
  const [est, setEst] = useState('');
  const inv = [workKeys.project(p.id)];
  const add = useAction(() => workApi.addModule(p.id, { name: name.trim(), estimatedHours: est ? Number(est) : null }), { success: 'Module added', invalidate: inv, onSuccess: () => { setName(''); setEst(''); } });
  const toggle = useAction((m: { id: string; isArchived: boolean }) => workApi.updateModule(p.id, m.id, { isArchived: !m.isArchived }), { success: 'Module updated', invalidate: inv });
  const remove = useAction((mid: string) => workApi.removeModule(p.id, mid), { success: 'Module removed', invalidate: inv });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <DataTable
        rowKey={(m) => m.id}
        rows={p.modules}
        empty="No modules yet."
        columns={[
          { key: 'n', header: 'Module', render: (m) => <span>{m.name} {m.isArchived && <Tag>Archived</Tag>}</span> },
          { key: 't', header: 'Tasks', num: true, render: (m) => m.tasks },
          { key: 'e', header: 'Estimate', num: true, render: (m) => hours(m.estimatedMinutes) },
          { key: 'l', header: 'Logged', num: true, render: (m) => hours(m.loggedMinutes, '0h') },
          {
            key: 'a',
            header: '',
            render: (m) =>
              p.canManage && (
                <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggle.mutate(m)}>{m.isArchived ? 'Restore' : 'Archive'}</button>
                  {m.tasks === 0 && <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(m.id)}>Remove</button>}
                </span>
              ),
          },
        ]}
      />
      {p.canManage && (
        <div className="wk-inline-form">
          <input className="input" placeholder="Module name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Estimate (h)" inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value)} style={{ width: 120, minWidth: 0 }} />
          <button className="btn btn-secondary" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>Add module</button>
        </div>
      )}
    </div>
  );
}

function Members({ p }: { p: ProjectDetail }) {
  const lk = useLookups(['employees']);
  const [emp, setEmp] = useState('');
  const [role, setRole] = useState<string>('MEMBER');
  const inv = [workKeys.project(p.id)];
  const add = useAction(() => workApi.addMember(p.id, { employeeId: emp, role }), { success: 'Member added', invalidate: inv, onSuccess: () => setEmp('') });
  const upd = useAction((a: { id: string; role: string }) => workApi.updateMember(p.id, a.id, { role: a.role }), { success: 'Role updated', invalidate: inv });
  const remove = useAction((mid: string) => workApi.removeMember(p.id, mid), { success: 'Member removed', invalidate: inv });
  const existing = new Set(p.members.map((m) => m.employeeId));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <DataTable
        rowKey={(m) => m.id}
        rows={p.members}
        empty="No members yet."
        columns={[
          { key: 'n', header: 'Member', render: (m) => m.name },
          { key: 'd', header: 'Department', render: (m) => m.department ?? '—' },
          { key: 'g', header: 'Designation', render: (m) => m.designation ?? '—' },
          {
            key: 'r',
            header: 'Role',
            render: (m) =>
              p.canManage ? (
                <select className="input" style={{ padding: '3px 6px', width: 'auto' }} value={m.role} onChange={(e) => upd.mutate({ id: m.id, role: e.target.value })}>
                  {PROJECT_MEMBER_ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
                </select>
              ) : (
                humanize(m.role)
              ),
          },
          { key: 'j', header: 'Joined', render: (m) => formatDate(m.joinedAt) },
          { key: 'a', header: '', render: (m) => p.canManage && m.role !== 'LEAD' && <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(m.id)}>Remove</button> },
        ]}
      />
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Board access is separate: each department lead allocates people to their team board (Boards tab).</p>
      {p.canManage && (
        <div className="wk-inline-form">
          <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">Add a member…</option>
            {opts(lk.data, 'employees').filter((o) => !existing.has(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 130, minWidth: 0 }}>
            {PROJECT_MEMBER_ROLES.filter((r) => r !== 'LEAD').map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </select>
          <button className="btn btn-secondary" disabled={!emp || add.isPending} onClick={() => add.mutate(undefined)}>Add member</button>
        </div>
      )}
    </div>
  );
}

function Documents({ p }: { p: ProjectDetail }) {
  const inv = [workKeys.project(p.id)];
  const add = useAction((d: { fileId: string; title?: string; kind: string }) => workApi.addDocs(p.id, [d]), { success: 'Document uploaded', invalidate: inv });
  const remove = useAction((docId: string) => workApi.removeDoc(p.id, docId), { success: 'Document removed', invalidate: inv });
  return (
    <Card kicker="Requirement, scope and design documents">
      <DocumentsList docs={p.documents} onUpload={p.canManage ? (d) => add.mutateAsync(d) : undefined} onRemove={p.canManage ? (d) => remove.mutate(d.id) : undefined} />
    </Card>
  );
}

function Boards({ p }: { p: ProjectDetail }) {
  const nav = useNavigate();
  if (!p.boards.length) return <Empty>No team boards on this project. Add team boards from Edit.</Empty>;
  return (
    <DataTable
      rowKey={(b) => b.departmentId}
      rows={p.boards}
      onRowClick={(b) => nav(`/board?project=${p.id}&board=${b.departmentId}`)}
      columns={[
        { key: 'n', header: 'Team board', render: (b) => <span>{b.name}{b.locked ? ' 🔒' : ''}</span> },
        { key: 'l', header: 'Board lead', render: (b) => b.leadName ?? '—' },
        { key: 'm', header: 'Allocated members', num: true, render: (b) => (b.memberCount == null ? '—' : b.memberCount) },
        { key: 'a', header: 'Access', render: (b) => (b.locked ? <Tag>Private</Tag> : b.canManage ? <Tag tone="accent">You allocate</Tag> : <Tag tone="outline">Member</Tag>) },
        { key: 'o', header: '', render: (b) => <Link to={`/board?project=${p.id}&board=${b.departmentId}`} onClick={(e) => e.stopPropagation()}>Open board →</Link> },
      ]}
    />
  );
}

function GitTab({ p }: { p: ProjectDetail }) {
  const can = useCan();
  const link = useAction(() => workApi.linkGit(p.id), {
    success: (r) => (r.status === 'LINKED' ? 'Repository linked' : r.status === 'ERROR' ? `Link failed · ${r.error ?? ''}` : 'Repository not set'),
    invalidate: [workKeys.project(p.id)],
  });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="wk-detail-grid">
        <Card kicker="Repository">
          <div className="wk-kv">
            <span>Repository</span><span>{p.gitRepoUrl ? <a href={p.gitRepoUrl} target="_blank" rel="noreferrer">{p.gitRepoUrl}</a> : 'Not set'}</span>
            <span>Target branch</span><span>{p.gitTargetBranch}</span>
            <span>Status</span><span><Tag tone={p.gitLinkStatus === 'LINKED' ? 'accent' : p.gitLinkStatus === 'ERROR' ? 'danger' : 'neutral'}>{humanize(p.gitLinkStatus)}</Tag></span>
            {p.gitLinkError && (<><span>Error</span><span className="field-error">{p.gitLinkError}</span></>)}
          </div>
          <p className="faint" style={{ fontSize: 12.5 }}>Moving a card to WIP creates <code>feature/&lt;key&gt;</code> from {p.gitTargetBranch}; Dev Completed opens a merge request.</p>
          {p.canManage && p.gitRepoUrl && <div className="row"><button className="btn btn-secondary" disabled={link.isPending} onClick={() => link.mutate(undefined)}>{p.gitLinkStatus === 'LINKED' ? 'Re-check link' : 'Link repository'}</button></div>}
        </Card>
        <Card kicker="Recent branches & merge requests">
          {p.recentGit.length === 0 ? (
            <Empty>No branches yet.</Empty>
          ) : (
            p.recentGit.map((g) => (
              <div key={g.taskId} className="list-row">
                <span>{g.key} · {g.title}</span>
                <span className="row" style={{ gap: 6 }}>
                  {g.branchUrl ? <a href={g.branchUrl} target="_blank" rel="noreferrer">{g.branch}</a> : <span className="faint">{g.branch}</span>}
                  {g.mrUrl && <a href={g.mrUrl} target="_blank" rel="noreferrer">MR {g.mrState ?? ''}</a>}
                  {g.syncStatus === 'FAILED' && <Tag tone="danger">Sync failed</Tag>}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
      {(can('git.manage') || can('projects.manage')) && <GitIntegrationCard />}
    </div>
  );
}

function EditProject({ p, onClose }: { p: ProjectDetail; onClose: () => void }) {
  const lk = useLookups(['clients', 'employees', 'departments']);
  const save = useAction((b: unknown) => workApi.updateProject(p.id, b), { success: 'Project updated', invalidate: [workKeys.project(p.id), workKeys.projects] });
  if (lk.isLoading) return null;
  const fields: FieldDef[] = [
    { name: 'name', label: 'Project name', type: 'text', span: 2, required: true },
    { name: 'key', label: 'Task key', type: 'text', required: true, hint: 'Locked once tasks exist' },
    { name: 'clientId', label: 'Client', type: 'select', options: opts(lk.data, 'clients'), required: true },
    { name: 'leadEmployeeId', label: 'Project lead', type: 'select', options: opts(lk.data, 'employees'), required: true },
    { name: 'category', label: 'Category', type: 'select', options: [{ value: 'WEB', label: 'Web' }, { value: 'MOBILE', label: 'Mobile' }, { value: 'INTERNAL', label: 'Internal' }, { value: 'OTHER', label: 'Other' }], required: true },
    { name: 'startDate', label: 'Start', type: 'date', required: true },
    { name: 'deadline', label: 'Deadline', type: 'date', required: true },
    { name: 'billable', label: 'Billable', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], required: true },
    { name: 'ratePerHour', label: 'Rate per hour (₹)', type: 'money', hint: 'Blank uses the client default rate' },
    { name: 'estimatedHours', label: 'Estimated hours', type: 'number' },
    { name: 'gitRepoUrl', label: 'Git repository', type: 'text' },
    { name: 'gitTargetBranch', label: 'Target branch', type: 'text', required: true },
    { name: 'boardDepartmentIds', label: 'Team boards', type: 'multiselect', span: 2, options: opts(lk.data, 'departments') },
    { name: 'techStack', label: 'Tech stack', type: 'text', span: 2 },
    { name: 'description', label: 'Description', type: 'area', span: 2 },
  ];
  return (
    <FormModal
      title={`Edit ${p.name}`}
      wide
      fields={fields}
      initial={{
        name: p.name,
        key: p.key,
        clientId: p.clientId ?? '',
        leadEmployeeId: p.leadEmployeeId ?? '',
        category: p.category,
        startDate: p.startDate ?? '',
        deadline: p.deadline ?? '',
        billable: p.billable ? 'yes' : 'no',
        ratePerHour: p.ratePerHourPaise != null ? String(p.ratePerHourPaise / 100) : '',
        estimatedHours: String(Math.round((p.estimatedMinutes / 60) * 100) / 100),
        gitRepoUrl: p.gitRepoUrl ?? '',
        gitTargetBranch: p.gitTargetBranch,
        boardDepartmentIds: p.boards.map((b) => b.departmentId),
        techStack: p.techStack.join(', '),
        description: p.description ?? '',
      }}
      onSubmit={(v) =>
        save.mutateAsync({
          name: v.name,
          key: v.key && v.key !== p.key ? v.key : undefined,
          clientId: v.clientId,
          leadEmployeeId: v.leadEmployeeId,
          category: v.category,
          startDate: v.startDate,
          deadline: v.deadline,
          billable: v.billable === 'yes',
          ratePerHourPaise: v.ratePerHour ?? null,
          estimatedHours: v.estimatedHours ?? null,
          gitRepoUrl: v.gitRepoUrl || null,
          gitTargetBranch: v.gitTargetBranch,
          boardDepartmentIds: v.boardDepartmentIds ?? [],
          techStack: String(v.techStack ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
          description: v.description || null,
        })
      }
      onClose={onClose}
    />
  );
}
