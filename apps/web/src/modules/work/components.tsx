import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WORK_DOC_KINDS, formatDate, type ProjectDocumentRow } from '@lexisora/shared';
import { download, uploadFile } from '@/lib/api';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FieldInput, FileDrop, FormModal, type FieldDef } from '@/components/form';
import { useLookups, opts } from '@/components/lookups';
import { Empty, Modal, Tag, humanize } from '@/components/ui';
import { workApi, workKeys, type DocInput } from './api';

/** Right-side drawer (task detail, archive item, client detail). */
export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="wk-drawer-backdrop" onMouseDown={onClose}>
      <aside className="wk-drawer" role="dialog" aria-modal aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="wk-progress">
      <span className="tnum" style={{ minWidth: 34 }}>{pct}%</span>
      <div className="wk-progress-bar"><span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}

const sizeLabel = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Documents table with download + optional upload/remove. */
export function DocumentsList({
  docs,
  onUpload,
  onRemove,
  uploadCategory = 'project-docs',
  emptyText = 'No documents yet.',
  removeClientDocs,
}: {
  docs: ProjectDocumentRow[];
  onUpload?: (doc: DocInput) => Promise<unknown>;
  onRemove?: (doc: ProjectDocumentRow) => void;
  uploadCategory?: string;
  emptyText?: string;
  removeClientDocs?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>('REQUIREMENT');
  const [busy, setBusy] = useState(false);
  const { toastError } = useToast();
  async function upload() {
    if (!file || !onUpload) return;
    setBusy(true);
    try {
      const f = await uploadFile(file, uploadCategory);
      await onUpload({ fileId: f.id, title: file.name, kind });
      setFile(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {docs.length === 0 ? (
        emptyText ? <Empty>{emptyText}</Empty> : null
      ) : (
        <div>
          {docs.map((d) => (
            <div key={d.id} className="list-row" style={{ alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {humanize(d.kind)} · {sizeLabel(d.sizeBytes)} · {d.uploadedBy ?? 'System'} · {formatDate(d.createdAt)}
                  {d.scope === 'CLIENT' && <> · <Tag tone="outline">Client vault</Tag></>}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => void download(`/files/${d.fileId}`, d.title).catch(() => undefined)}>Download</button>
                {onRemove && (d.scope !== 'CLIENT' || removeClientDocs) && <button className="btn btn-ghost btn-sm" onClick={() => onRemove(d)}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {onUpload && (
        <div className="wk-inline-form">
          <div style={{ flex: 1, minWidth: 220 }}><FileDrop file={file} onFile={setFile} /></div>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 160 }}>
            {WORK_DOC_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
          </select>
          <button className="btn btn-secondary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      )}
    </div>
  );
}

/** FORMS.project — "Create project" (+ optional extras used by the detail page). */
export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const lk = useLookups(['clients', 'employees', 'departments']);
  const create = useAction(workApi.createProject, {
    success: (r) => `Project created · ${r.key}`,
    invalidate: [workKeys.projects, ['lookups']],
    onSuccess: (r) => nav(`/projects/${r.id}`),
  });
  const depts = opts(lk.data, 'departments');
  const defaultBoards = depts.filter((d) => ['Development', 'QA', 'Design'].includes(d.label)).map((d) => d.value);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Project name', type: 'text', span: 2, required: true },
    { name: 'clientId', label: 'Client', type: 'select', options: opts(lk.data, 'clients'), required: true },
    { name: 'leadEmployeeId', label: 'Project lead', type: 'select', options: opts(lk.data, 'employees'), required: true },
    { name: 'startDate', label: 'Start', type: 'date', required: true },
    { name: 'deadline', label: 'Deadline', type: 'date', required: true },
    { name: 'billable', label: 'Billable', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], required: true },
    { name: 'gitRepoUrl', label: 'Git repository', type: 'text', placeholder: 'https://gitlab.com/lexisora/project' },
    { name: 'documentFileId', label: 'Requirement documents', type: 'file', span: 2, category: 'project-docs' },
    { name: 'key', label: 'Task key', type: 'text', placeholder: 'e.g. AT', hint: 'Prefix for task ids (AT-101). Leave blank to use the suggestion.' },
    { name: 'category', label: 'Category', type: 'select', options: [{ value: 'WEB', label: 'Web' }, { value: 'MOBILE', label: 'Mobile' }, { value: 'INTERNAL', label: 'Internal' }, { value: 'OTHER', label: 'Other' }], required: true },
    { name: 'estimatedHours', label: 'Estimated hours', type: 'number' },
    { name: 'ratePerHour', label: 'Rate per hour (₹)', type: 'money', hint: 'Blank uses the client default rate', showIf: (v) => v.billable === 'yes' },
    { name: 'boardDepartmentIds', label: 'Team boards', type: 'multiselect', span: 2, options: depts },
    { name: 'techStack', label: 'Tech stack', type: 'text', placeholder: 'React, Node', span: 2 },
    { name: 'modules', label: 'Modules', type: 'text', placeholder: 'Billing, Auth, Reports', span: 2 },
  ];
  if (lk.isLoading) return null;
  const split = (s: unknown) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <FormModal
      title="Create project"
      submitLabel="Create"
      wide
      fields={fields}
      initial={{ billable: 'yes', category: 'WEB', boardDepartmentIds: defaultBoards }}
      onSubmit={(v) => {
        return create.mutateAsync({
          name: v.name,
          key: v.key || undefined,
          clientId: v.clientId,
          leadEmployeeId: v.leadEmployeeId,
          startDate: v.startDate,
          deadline: v.deadline,
          billable: v.billable === 'yes',
          gitRepoUrl: v.gitRepoUrl || null,
          documentFileIds: v.documentFileId ? [v.documentFileId] : [],
          category: v.category,
          estimatedHours: v.estimatedHours ?? null,
          ratePerHourPaise: v.billable === 'yes' ? (v.ratePerHour ?? null) : null,
          boardDepartmentIds: v.boardDepartmentIds ?? [],
          techStack: split(v.techStack),
          modules: split(v.modules),
          status: 'ACTIVE',
        });
      }}
      onClose={onClose}
    />
  );
}

/**
 * FORMS.task — "Add task" on a team board: title, module, assignee (blank = Open), estimate, due date.
 * The board and project come from the board being viewed; the key (AT-112) comes from the API.
 * Only board members can be assigned (the lead may pick anyone on the board; others only themselves).
 */
export function AddTaskModal({
  projectId,
  departmentId,
  members,
  me,
  canAssignOthers,
  onClose,
}: {
  projectId: string;
  departmentId: string;
  members: { employeeId: string; name: string; isLead: boolean }[];
  me: string | null;
  canAssignOthers: boolean;
  onClose: () => void;
}) {
  const projectQ = useQuery({ queryKey: workKeys.project(projectId), queryFn: () => workApi.project(projectId) });
  const modules = (projectQ.data?.modules ?? []).filter((m) => !m.isArchived).map((m) => ({ value: m.name, label: m.name }));
  const assignees = (canAssignOthers ? members : members.filter((m) => m.employeeId === me)).map((m) => ({ value: m.employeeId, label: m.name }));
  const [v, setV] = useState<Record<string, string>>({ title: '', moduleName: '', assigneeEmployeeId: '', estimatedHours: '', dueDate: '' });
  const [err, setErr] = useState<string | null>(null);
  const add = useAction(workApi.createTask, {
    success: (r) => (r.warning ? `Task added · ${r.key} · ${r.warning}` : `Task added · ${r.key}`),
    invalidate: [['work', 'board', projectId], workKeys.projects],
    onSuccess: () => onClose(),
  });
  const set = (k: string) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  function submit() {
    if (v.title.trim().length < 2) return setErr('Title is required');
    const raw = (v.estimatedHours ?? '').trim().replace(/h$/i, '');
    const est = Number(raw);
    if (!raw || !Number.isFinite(est) || est <= 0) return setErr('Estimate is required and must be more than 0 hours');
    if (est > 200) return setErr('Estimate over 200h — split the task');
    setErr(null);
    add.mutate({
      title: v.title.trim(),
      projectId,
      departmentId,
      moduleName: v.moduleName || null,
      assigneeEmployeeId: v.assigneeEmployeeId || null,
      estimatedHours: est,
      dueDate: v.dueDate || null,
    });
  }
  const f = (name: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}) => (
    <div className={`field${extra.span === 2 ? ' span-2' : ''}`}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <FieldInput f={{ name, label, type, ...extra }} value={v[name]} onChange={set(name)} />
    </div>
  );
  return (
    <Modal
      title="Add task"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={add.isPending} onClick={submit}>{add.isPending ? 'Saving…' : 'Add task'}</button>
        </>
      }
    >
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {f('title', 'Title', 'text', { span: 2, required: true })}
        {f('moduleName', 'Module', 'select', { options: modules, placeholder: 'No module' })}
        {f('assigneeEmployeeId', 'Assignee', 'select', { options: assignees, placeholder: 'Unassigned (Open)' })}
        {f('estimatedHours', 'Estimate (hours)', 'text', { placeholder: 'e.g. 8 or 1.5', required: true })}
        {f('dueDate', 'Due date', 'date')}
        <button type="submit" hidden />
      </form>
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}
