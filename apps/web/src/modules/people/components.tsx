import { useState } from 'react';
import {
  PEOPLE_BLOOD_GROUPS,
  PEOPLE_EMPLOYMENT_TYPE_LABELS,
  PEOPLE_EMPLOYMENT_TYPES,
  formatDate,
  type ProfileDocumentRow,
  type ProfileDto,
  type VaultRow,
} from '@lexisora/shared';
import { authUrl } from '@/lib/api';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef, type FormValues } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { DataTable, type Column } from '@/components/table';
import { Modal, Tag, type Tone } from '@/components/ui';
import { peopleApi, peopleKeys } from './api';

export const WORK_MODE_OPTIONS = [
  { value: 'OFFICE', label: 'Office (biometric)' },
  { value: 'REMOTE', label: 'Remote (web + desktop)' },
  { value: 'HYBRID', label: 'Hybrid' },
];
export const WORK_MODE_SHORT: Record<string, string> = { OFFICE: 'Office', REMOTE: 'Remote', HYBRID: 'Hybrid' };
const EMP_TYPE_OPTIONS = PEOPLE_EMPLOYMENT_TYPES.map((t) => ({ value: t, label: PEOPLE_EMPLOYMENT_TYPE_LABELS[t] }));

/** Wireframe tone for a document / employee status. */
export function statusTone(status: string): Tone {
  if (['REJECTED', 'EXITED', 'DECLINED', 'NEEDS_ATTENTION'].includes(status)) return 'danger';
  if (['PENDING', 'NOTICE_PERIOD', 'ONBOARDING', 'SUBMITTED', 'IN_PROGRESS', 'PARTIAL'].includes(status)) return 'outline';
  if (['NA', 'INTERN', 'SUPERSEDED', 'NOT_STARTED'].includes(status)) return 'neutral';
  return 'accent';
}

export function DocStatus({ status, label }: { status: string; label: string }) {
  if (status === 'NA') return <span className="faint">—</span>;
  return <Tag tone={statusTone(status)}>{label}</Tag>;
}

export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Add employee (FORMS.employee) or HR edit of an employee. */
export function EmployeeFormModal({ profile, onClose, onCreated }: { profile?: ProfileDto | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const lk = useLookups(['departments', 'designations', 'managers', 'shifts', 'branches', 'locations']);
  const invalidate = [peopleKeys.employees, ['people', 'profile'], ['lookups']];
  const create = useAction((b: FormValues) => peopleApi.createEmployee(b as never), {
    success: (r) => (r.inviteSent ? 'Invite sent · ID card queued' : 'Employee added · invite email could not be sent, use Resend invite'),
    invalidate,
    onSuccess: (r) => onCreated?.(r.employee.id),
  });
  const update = useAction((b: FormValues) => peopleApi.updateEmployee(profile!.id, b as never), { success: 'Employee updated', invalidate });
  const editing = !!profile;
  const d = (lk.data ?? {}) as Record<string, { value: string; label: string }[]>;
  const fields: FieldDef[] = [
    { name: 'fullName', label: 'Full name', type: 'text', required: true },
    ...(editing ? [] : [{ name: 'officialEmail', label: 'Official email', type: 'email', required: true, placeholder: 'name@lexisora.com' } as FieldDef]),
    { name: 'phone', label: 'Phone', type: 'text', required: !editing, placeholder: '+91 98250 12345' },
    { name: 'personalEmail', label: 'Personal email', type: 'email', hint: editing ? undefined : 'The onboarding invite goes here if given' },
    { name: 'departmentId', label: 'Department', type: 'select', required: true, options: opts(d, 'departments') },
    { name: 'designationId', label: 'Designation', type: 'select', required: true, options: opts(d, 'designations') },
    { name: 'managerId', label: 'Reporting manager', type: 'select', options: opts(d, 'managers').filter((o) => o.value !== profile?.id) },
    { name: 'employmentType', label: 'Employment type', type: 'select', required: true, options: EMP_TYPE_OPTIONS },
    { name: 'workMode', label: 'Work mode', type: 'select', required: true, options: WORK_MODE_OPTIONS },
    { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
    { name: 'shiftId', label: 'Shift', type: 'select', options: d.shifts ?? [], placeholder: 'Default shift' },
    { name: 'branchId', label: 'Branch', type: 'select', options: d.branches ?? [], placeholder: 'Head office' },
    { name: 'workLocationId', label: 'Work location', type: 'select', options: d.locations ?? [], placeholder: 'By work mode', showIf: (v) => v.workMode !== 'REMOTE' },
    ...(editing
      ? ([
          { name: 'bloodGroup', label: 'Blood group', type: 'select', options: PEOPLE_BLOOD_GROUPS.map((b) => ({ value: b, label: b })) },
          { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
          { name: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((g) => ({ value: g, label: g })) },
          { name: 'maritalStatus', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Other'].map((g) => ({ value: g, label: g })) },
          { name: 'emergencyContactName', label: 'Emergency contact name', type: 'text' },
          { name: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'text' },
          { name: 'address', label: 'Address', type: 'area' },
        ] as FieldDef[])
      : []),
    { name: 'photoFileId', label: 'Photo', type: 'file', category: 'avatar', accept: 'image/*', span: 2 },
  ];
  const initial: FormValues = editing
    ? { ...(profile!.editable as FormValues) }
    : { employmentType: 'FULL_TIME', workMode: 'OFFICE', joiningDate: todayKey(), departmentId: opts(d, 'departments')[0]?.value, designationId: opts(d, 'designations')[0]?.value };
  if (lk.isLoading) return null;
  return (
    <FormModal
      key={editing ? profile!.id : 'new'}
      title={editing ? `Edit ${profile!.fullName}` : 'Add employee'}
      fields={fields}
      initial={initial}
      wide
      submitLabel={editing ? 'Save changes' : 'Add & send onboarding invite'}
      intro={editing ? undefined : <span className="faint" style={{ fontSize: 12.5 }}>Emp ID is generated automatically (LX-0161 for full-time, LX-I-024 for interns). The joiner gets an email to set a password and start paperless onboarding.</span>}
      onClose={onClose}
      onSubmit={async (v) => {
        const body: FormValues = { ...v };
        for (const k of Object.keys(body)) if (body[k] === null && !editing) delete body[k];
        if (editing) await update.mutateAsync(body);
        else await create.mutateAsync(body);
      }}
    />
  );
}

/** Fields an employee may change on their own profile. */
export function SelfEditModal({ profile, onClose }: { profile: ProfileDto; onClose: () => void }) {
  const save = useAction((b: FormValues) => peopleApi.updateSelf(b as never), { success: 'Profile updated', invalidate: [['people', 'profile']] });
  const fields: FieldDef[] = [
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'personalEmail', label: 'Personal email', type: 'email' },
    { name: 'bloodGroup', label: 'Blood group', type: 'select', options: PEOPLE_BLOOD_GROUPS.map((b) => ({ value: b, label: b })) },
    { name: 'maritalStatus', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Other'].map((g) => ({ value: g, label: g })) },
    { name: 'emergencyContactName', label: 'Emergency contact name', type: 'text' },
    { name: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'text' },
    { name: 'address', label: 'Address', type: 'area' },
    { name: 'photoFileId', label: 'Photo', type: 'file', category: 'avatar', accept: 'image/*' },
  ];
  return (
    <FormModal
      title="Edit my profile"
      fields={fields}
      initial={profile.editable as FormValues}
      submitLabel="Save changes"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>Name, department, designation and manager are changed by HR.</span>}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync(v)}
    />
  );
}

/** HR decision on a pending document: verify, or reject with a reason. */
export function VerifyButtons({ doc, invalidate }: { doc: { id: string; title: string }; invalidate: readonly (readonly unknown[])[] }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const inv = invalidate.map((k) => [...k]);
  const verify = useAction(() => peopleApi.verifyDoc(doc.id, 'VERIFIED'), { success: `${doc.title} verified`, invalidate: inv });
  const reject = useAction(() => peopleApi.verifyDoc(doc.id, 'REJECTED', reason), { success: `${doc.title} rejected · employee notified`, invalidate: inv, onSuccess: () => setRejecting(false) });
  return (
    <span className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-secondary btn-sm" disabled={verify.isPending} onClick={() => verify.mutate(undefined)}>Verify</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(true)}>Reject</button>
      {rejecting && (
        <Modal
          title={`Reject ${doc.title}`}
          onClose={() => setRejecting(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setRejecting(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={reason.trim().length < 2 || reject.isPending} onClick={() => reject.mutate(undefined)}>Reject & ask to re-upload</button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="rej-reason">Reason (shown to the employee)</label>
            <textarea id="rej-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Image is blurred; upload a clear scan of both sides" />
          </div>
        </Modal>
      )}
    </span>
  );
}

export const openDoc = (id: string) => window.open(authUrl(`/documents/${id}/file`), '_blank', 'noopener');

/** Documents table used on the profile (HR can verify). */
export function DocumentsTable({ rows, loading, employeeId }: { rows: (ProfileDocumentRow | VaultRow)[] | undefined; loading?: boolean; employeeId: string }) {
  const cols: Column<ProfileDocumentRow | VaultRow>[] = [
    { key: 'd', header: 'Document', render: (r) => <div><div>{r.title}</div>{r.rejectionReason && r.status === 'REJECTED' && <div className="pp-err">{r.rejectionReason}</div>}</div> },
    { key: 'c', header: 'Category', render: (r) => r.categoryLabel },
    { key: 'u', header: 'Uploaded', render: (r) => formatDate(r.uploadedAt) },
    { key: 's', header: 'Status', render: (r) => <DocStatus status={r.status} label={r.statusLabel} /> },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => openDoc(r.id)}>View</button>
          {'canVerify' in r && r.canVerify && <VerifyButtons doc={r} invalidate={[['people', 'profile', employeeId, 'documents'], peopleKeys.queue, peopleKeys.onboardingList]} />}
        </span>
      ),
    },
  ];
  return <DataTable columns={cols} rows={rows} loading={loading} rowKey={(r) => r.id} empty="No documents yet." />;
}
