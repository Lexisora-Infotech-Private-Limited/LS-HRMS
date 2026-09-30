import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EMPLOYEE_TABS, type EmployeeRow, type ImportPreview } from '@lexisora/shared';
import { download } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FileDrop } from '@/components/form';
import { DataTable, Pager, type Column } from '@/components/table';
import { Avatar, ErrorBlock, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { peopleApi, peopleKeys } from '../api';
import { EmployeeFormModal, WORK_MODE_SHORT, statusTone } from '../components';
import '../people.css';

type Tab = (typeof EMPLOYEE_TABS)[number];
const TAB_LABELS: Record<Tab, string> = { all: 'All', full_time: 'Full-time', interns: 'Interns', notice: 'Notice period', exited: 'Exited' };

export default function EmployeesPage() {
  const nav = useNavigate();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useQuery({ queryKey: [...peopleKeys.employees, tab, q, page], queryFn: () => peopleApi.employees({ tab, q: q || undefined, page, pageSize: 25 }), placeholderData: (p) => p });
  const c = list.data?.counts;
  const manage = can('employees.manage');

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'n',
      header: 'Name',
      render: (r) => (
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <Avatar name={r.fullName} photoFileId={r.photoFileId} size={28} />
          <span>{r.fullName}</span>
        </span>
      ),
    },
    { key: 'c', header: 'Emp ID', render: (r) => <span className="tnum">{r.empCode}</span> },
    { key: 'd', header: 'Department', render: (r) => r.department ?? '—' },
    { key: 'g', header: 'Designation', render: (r) => r.designation ?? '—' },
    { key: 'w', header: 'Work mode', render: (r) => WORK_MODE_SHORT[r.workMode] ?? r.workMode },
    { key: 'm', header: 'Manager', render: (r) => r.manager ?? '—' },
    { key: 's', header: 'Status', render: (r) => <Tag tone={r.status === 'ACTIVE' && r.employmentType === 'INTERN' ? 'neutral' : statusTone(r.status)}>{r.statusLabel}</Tag> },
  ];

  return (
    <div data-screen-label="Employees" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Employees"
        sub="Directory of all staff and interns. Open a row for profile, documents, assets and compensation."
        actions={
          <>
            {can('masters.manage') && <button className="btn btn-ghost" onClick={() => nav('/masters')}>Masters</button>}
            <button className="btn btn-ghost" onClick={() => void download(`/employees/export?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ''}`, 'employees.csv')}>Export</button>
            {manage && <button className="btn btn-secondary" onClick={() => setImporting(true)}>Import CSV</button>}
            {manage && <button className="btn btn-primary" onClick={() => setAdding(true)}>Add employee</button>}
          </>
        }
      />
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs<Tab>
          value={tab}
          onChange={(t) => {
            setTab(t);
            setPage(1);
          }}
          tabs={EMPLOYEE_TABS.map((t) => ({ value: t, label: `${TAB_LABELS[t]}${c && (t !== 'exited' || c.exited) ? ` · ${c[t]}` : ''}` }))}
        />
        <input
          className="input pp-search"
          placeholder="Search name, Emp ID or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <DataTable columns={columns} rows={list.data?.items} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => nav(`/employees/${r.id}`)} empty={q ? `No one matches “${q}”.` : 'No employees in this tab.'} />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {adding && <EmployeeFormModal onClose={() => setAdding(false)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

/** Import CSV: upload → validate (row errors) → commit valid rows. */
function ImportModal({ onClose }: { onClose: () => void }) {
  const { toastError } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [sendInvites, setSendInvites] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = useAction(() => peopleApi.commitImport(preview!.id, { sendInvites, createMissingMasters: createMissing }), {
    success: (r) => `${r.importedRows} row${r.importedRows === 1 ? '' : 's'} imported`,
    invalidate: [peopleKeys.employees, ['lookups']],
    onSuccess: (r) => (r.errors.length ? setPreview(r) : onClose()),
  });

  async function validate() {
    if (!file) return;
    setBusy(true);
    try {
      setPreview(await peopleApi.validateImport(file, createMissing));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const done = preview?.status === 'DONE';
  return (
    <Modal
      title="Import employees"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-ghost" onClick={() => void download('/employees/import/template', 'employee-import-template.csv')}>Download template</button>
          {preview && preview.errors.length > 0 && <button className="btn btn-ghost" onClick={() => void download(`/employees/import/${preview.id}/errors.csv`, 'import-errors.csv')}>Error report</button>}
          <button className="btn btn-secondary" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {!preview ? (
            <button className="btn btn-primary" disabled={!file || busy} onClick={() => void validate()}>{busy ? 'Checking…' : 'Import'}</button>
          ) : !done ? (
            <button className="btn btn-primary" disabled={!preview.validRows || commit.isPending} onClick={() => commit.mutate(undefined)}>
              {commit.isPending ? 'Importing…' : `Import ${preview.validRows} valid row${preview.validRows === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </>
      }
    >
      {!preview ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label>CSV file</label>
            <FileDrop file={file} onFile={setFile} accept=".csv,text/csv" />
            <div className="field-hint">Columns: full_name, official_email, phone, department, designation, manager_email, employment_type, work_mode, joining_date, personal_email, branch.</div>
          </div>
          <label className="radio"><input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} /><span className="dot" style={{ borderRadius: 3 }} />Create departments, designations and branches that don't exist yet</label>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <Tag tone="neutral">{preview.filename}</Tag>
            <Tag tone="accent">{preview.validRows} valid</Tag>
            {preview.errors.length > 0 && <Tag tone="danger">{preview.errors.length} error{preview.errors.length === 1 ? '' : 's'}</Tag>}
            {done && <Tag tone="accent">{preview.importedRows} imported</Tag>}
          </div>
          {!done && <label className="radio"><input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} /><span className="dot" style={{ borderRadius: 3 }} />Send onboarding invites to imported employees</label>}
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>Row</th><th>Name</th><th>Official email</th><th>Department</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {preview.preview.map((r) => (
                  <tr key={r.row}>
                    <td className="tnum">{r.row}</td><td>{r.fullName}</td><td>{r.officialEmail}</td><td>{r.department}</td><td>{r.employmentType}</td>
                    <td>{r.ok ? <Tag tone="accent">OK</Tag> : <Tag tone="danger">Error</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors.length > 0 && (
            <div className="note" style={{ maxHeight: 160, overflow: 'auto', fontSize: 12.5 }}>
              {preview.errors.map((e, i) => (
                <div key={i}>Row {e.row}{e.field ? ` · ${e.field}` : ''}: {e.message}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
