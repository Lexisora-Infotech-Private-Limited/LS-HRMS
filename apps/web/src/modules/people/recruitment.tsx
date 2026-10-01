import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CANDIDATE_REJECT_REASONS,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  PEOPLE_EMPLOYMENT_TYPE_LABELS,
  PEOPLE_EMPLOYMENT_TYPES,
  formatINR,
  type CandidateDetail,
  type HireInput,
  type JobOfferInput,
  type ScheduleInterviewInput,
} from '@lexisora/shared';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef, type FormValues } from '@/components/form';
import { Modal } from '@/components/ui';
import { lookupsFor, peopleApi, peopleKeys } from './api';
import { WORK_MODE_OPTIONS, todayKey } from './components';

/** Days after `d` (YYYY-MM-DD). */
export const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

const recruitmentInvalidate = [peopleKeys.candidates, peopleKeys.interviews, peopleKeys.jobs];

/** FORMS.interview — "Schedule & email", toast "Invite emailed". */
export function ScheduleInterviewModal({ applicationId, onClose }: { applicationId?: string; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'interview-form'], queryFn: () => lookupsFor(['candidates', 'interviewRounds', 'employees']) });
  const save = useAction((b: ScheduleInterviewInput) => peopleApi.schedule(b), {
    success: (r) => (r.emailed ? 'Invite emailed' : 'Interview scheduled · the invite email could not be sent'),
    invalidate: recruitmentInvalidate,
  });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const modes = INTERVIEW_MODES.map((m) => ({ value: m, label: INTERVIEW_MODE_LABELS[m] }));
  const fields: FieldDef[] = [
    { name: 'applicationId', label: 'Candidate', type: 'select', span: 2, required: true, options: d.candidates ?? [] },
    { name: 'roundName', label: 'Round', type: 'select', required: true, options: d.interviewRounds ?? [] },
    { name: 'interviewerId', label: 'Interviewer', type: 'select', required: true, options: d.employees ?? [] },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'time', label: 'Time', type: 'time', required: true },
    { name: 'mode', label: 'Mode', type: 'select', span: 2, required: true, options: modes },
    { name: 'panelistIds', label: 'Other panelists (optional)', type: 'multiselect', span: 2, options: d.employees ?? [] },
    { name: 'durationMin', label: 'Duration (minutes)', type: 'number' },
    { name: 'notesToCandidate', label: 'Notes to candidate', type: 'area', placeholder: 'Shown in the invite email' },
  ];
  return (
    <FormModal
      title="Schedule interview"
      fields={fields}
      submitLabel="Schedule & email"
      initial={{ applicationId: applicationId ?? d.candidates?.[0]?.value, date: plusDays(todayKey(), 1), time: '11:00', mode: 'VIDEO', durationMin: 60, panelistIds: [] }}
      intro={!d.candidates?.length ? <span className="faint">No candidates are in screening or interview right now. Add a candidate first.</span> : undefined}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync({ ...(v as ScheduleInterviewInput), durationMin: v.durationMin ? Number(v.durationMin) : 60, panelistIds: v.panelistIds ?? [] })}
    />
  );
}

type App = CandidateDetail['applications'][number];

/** Offer panel: moves the stage to OFFERED and emails the candidate. */
export function OfferModal({ app, onClose }: { app: App; onClose: () => void }) {
  const lk = useQuery({ queryKey: ['lookups', 'people', 'offer-form'], queryFn: () => lookupsFor(['departments', 'designations', 'branches']) });
  const save = useAction((b: JobOfferInput) => peopleApi.saveOffer(app.id, b), { success: 'Offer saved · emailed to the candidate', invalidate: recruitmentInvalidate });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const o = app.offer;
  const fields: FieldDef[] = [
    { name: 'designationId', label: 'Designation', type: 'select', options: d.designations ?? [], placeholder: 'From the job' },
    { name: 'departmentId', label: 'Department', type: 'select', options: d.departments ?? [], placeholder: 'From the job' },
    { name: 'branchId', label: 'Branch', type: 'select', options: d.branches ?? [], placeholder: 'From the job' },
    { name: 'employmentType', label: 'Employment type', type: 'select', required: true, options: PEOPLE_EMPLOYMENT_TYPES.map((t) => ({ value: t, label: PEOPLE_EMPLOYMENT_TYPE_LABELS[t] })) },
    { name: 'annualCtcPaise', label: 'Annual CTC (₹)', type: 'money', required: true, placeholder: '9,00,000' },
    { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
    { name: 'expiresOn', label: 'Offer valid until', type: 'date', required: true },
  ];
  return (
    <FormModal
      title={`Offer · ${app.jobTitle}`}
      fields={fields}
      submitLabel="Save offer"
      initial={{
        designationId: o?.designationId ?? '',
        departmentId: o?.departmentId ?? '',
        branchId: o?.branchId ?? '',
        employmentType: o?.employmentType ?? (/intern/i.test(app.jobTitle) ? 'INTERN' : 'FULL_TIME'),
        annualCtcPaise: o ? String(o.annualCtcPaise / 100) : '',
        joiningDate: o?.joiningDate ?? plusDays(todayKey(), 14),
        expiresOn: o?.expiresOn ?? plusDays(todayKey(), 7),
      }}
      intro={<span className="faint" style={{ fontSize: 12.5 }}>The candidate gets the offer by email. The formal offer letter (with Annexure A) is e-signed during paperless onboarding after you convert them.</span>}
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync(v as JobOfferInput)}
    />
  );
}

/** "Convert to employee": creates the User (invited) + Employee + onboarding. */
export function HireModal({ candidate, app, onClose, onHired }: { candidate: CandidateDetail; app: App; onClose: () => void; onHired?: (employeeId: string) => void }) {
  const me = useMe();
  const lk = useQuery({ queryKey: ['lookups', 'people', 'hire-form'], queryFn: () => lookupsFor(['managers', 'shifts', 'departments', 'designations']) });
  const save = useAction((b: HireInput) => peopleApi.hire(app.id, b), {
    success: (r) => `${r.employee.fullName} hired as ${r.employee.empCode}${r.inviteSent ? ' · onboarding invite sent' : ''}`,
    invalidate: [...recruitmentInvalidate, peopleKeys.employees, ['lookups']],
    onSuccess: (r) => onHired?.(r.employee.id),
  });
  if (lk.isLoading) return null;
  const d = lk.data ?? {};
  const domain = me.tenantDomain || me.email.split('@')[1] || 'lexisora.com';
  const suggested = `${candidate.fullName.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).join('.')}@${domain}`;
  const fields: FieldDef[] = [
    { name: 'officialEmail', label: 'Official email', type: 'email', span: 2, required: true },
    { name: 'managerId', label: 'Reporting manager', type: 'select', options: d.managers ?? [], placeholder: 'Hiring manager' },
    { name: 'workMode', label: 'Work mode', type: 'select', required: true, options: WORK_MODE_OPTIONS },
    { name: 'departmentId', label: 'Department', type: 'select', options: d.departments ?? [], placeholder: 'From the offer' },
    { name: 'designationId', label: 'Designation', type: 'select', options: d.designations ?? [], placeholder: 'From the offer' },
    { name: 'shiftId', label: 'Shift', type: 'select', options: d.shifts ?? [], placeholder: 'Default shift' },
    { name: 'joiningDate', label: 'Joining date', type: 'date' },
  ];
  return (
    <FormModal
      title={`Convert ${candidate.fullName} to employee`}
      fields={fields}
      submitLabel="Create employee & send invite"
      initial={{ officialEmail: suggested, workMode: 'OFFICE', joiningDate: app.offer?.joiningDate ?? '' }}
      intro={
        <span className="faint" style={{ fontSize: 12.5 }}>
          {app.offer ? `Offer ${formatINR(app.offer.annualCtcPaise)} a year, joining ${app.offer.joiningDate}. ` : ''}An Emp ID is generated, the resume moves to the digital vault and the joiner gets the paperless onboarding invite.
        </span>
      }
      onClose={onClose}
      onSubmit={(v) => save.mutateAsync(v as HireInput)}
    />
  );
}

/** Reject with a reason (required by the API) plus an optional note. */
export function RejectModal({ app, onClose }: { app: App; onClose: () => void }) {
  const [reason, setReason] = useState<string>(CANDIDATE_REJECT_REASONS[0]);
  const [note, setNote] = useState('');
  const save = useAction(() => peopleApi.moveStage(app.id, 'REJECTED', note.trim() ? `${reason} · ${note.trim()}` : reason), { success: 'Candidate rejected', invalidate: recruitmentInvalidate, onSuccess: onClose });
  return (
    <Modal
      title={`Reject for ${app.jobTitle}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Reject</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="rj-reason">Reason</label>
          <select id="rj-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {CANDIDATE_REJECT_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="rj-note">Note (internal)</label>
          <textarea id="rj-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kept in the interview vault for future hiring" />
        </div>
      </div>
    </Modal>
  );
}

/** Small helper: one-field form modal. */
export function PromptModal({ title, label, submitLabel, onSubmit, onClose, area, initial }: { title: string; label: string; submitLabel: string; onSubmit: (v: string) => Promise<unknown>; onClose: () => void; area?: boolean; initial?: string }) {
  const fields: FieldDef[] = [{ name: 'v', label, type: area ? 'area' : 'text', span: 2, required: true }];
  return <FormModal title={title} fields={fields} submitLabel={submitLabel} initial={{ v: initial ?? '' }} onClose={onClose} onSubmit={(v: FormValues) => onSubmit(String(v.v ?? ''))} />;
}
