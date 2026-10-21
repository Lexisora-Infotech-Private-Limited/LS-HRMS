import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompanyProfile, VCardAccessDto } from '@lexisora/shared';
import { useAction } from '@/lib/query';
import { FormModal, type FieldDef } from '@/components/form';
import { Card, ErrorBlock, Loading, Tag } from '@/components/ui';
import { peopleApi, peopleKeys } from '../api';
import '../people.css';

const MODE_LABELS = { EVERYONE: 'Everyone', ROLES: 'Selected roles', EMPLOYEES: 'Selected employees' } as const;

/** Who gets a digital visiting card. People outside the setting lose the menu entry and their public link stops working. Lives in the visiting card designer. */
export function VisitingCardAccessPanel() {
  const q = useQuery({ queryKey: peopleKeys.vcardAccess, queryFn: () => peopleApi.vcardAccess() });
  const emps = useQuery({ queryKey: [...peopleKeys.employees, 'vcard-picker'], queryFn: () => peopleApi.employees({ pageSize: 200, tab: 'all' }) });
  const [editing, setEditing] = useState(false);

  if (q.error) return <ErrorBlock error={q.error} retry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  const a = q.data;
  const roleName = (k: string) => a.roleOptions.find((r) => r.key === k)?.name ?? k;
  const empName = (id: string) => emps.data?.items.find((e) => e.id === id)?.fullName ?? 'Employee';

  return (
    <>
      <Card kicker="Visiting card access" title={MODE_LABELS[a.mode]} actions={<button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Change</button>}>
        <div className="stack" style={{ gap: 10 }}>
          {a.mode === 'EVERYONE' && <div className="faint" style={{ fontSize: 13 }}>Every employee has a visiting card.</div>}
          {a.mode === 'ROLES' && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {a.roles.map((r) => <Tag key={r} tone="accent">{roleName(r)}</Tag>)}
            </div>
          )}
          {a.mode === 'EMPLOYEES' && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {a.employeeIds.map((id) => <Tag key={id} tone="accent">{empName(id)}</Tag>)}
            </div>
          )}
          <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            People who are not covered no longer see the Visiting card menu entry, and the public link on any card they already made stops working. Their card settings are kept, so it all returns if you add them back. The menu updates for them within a few minutes, or when they sign in again.
          </div>
        </div>
      </Card>
      {editing && <AccessModal access={a} employees={emps.data?.items.map((e) => ({ value: e.id, label: `${e.fullName} (${e.empCode})` })) ?? []} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Slide-in panel opened from the ID card designer header: a phone preview of the page a scan opens, with its company details beside it. */
export function QrScanPageDrawer({ onClose }: { onClose: () => void }) {
  const company = useQuery({ queryKey: peopleKeys.companyProfile, queryFn: () => peopleApi.companyProfile() });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const c = company.data;
  const line = (label: string, v: string | undefined) => (v ? <div key={label} style={{ fontSize: 10.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}><b>{label}</b> {v}</div> : null);
  return (
    <div className="dialog-backdrop" style={{ placeItems: 'stretch end', padding: 0 }} onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal
        aria-label="QR scan page"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', height: '100%', overflow: 'auto', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="faint" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>When an ID card is scanned</div>
            <div className="dialog-title">QR scan page</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {c && (
          <div style={{ alignSelf: 'center', width: 230, border: '6px solid #1c1c1e', borderRadius: 26, overflow: 'hidden', background: '#fff', color: '#201f1d', boxShadow: 'var(--shadow-lg)' }} aria-label="Preview of the scan page">
            <div style={{ height: 84, background: `linear-gradient(135deg, ${c.primaryColor}, ${c.secondaryColor})`, color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'flex-end', fontWeight: 700, fontSize: 13 }}>{c.slogan || 'Your company'}</div>
            <div style={{ padding: '0 14px 14px', marginTop: -22 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e5e5e5', border: '3px solid #fff' }} />
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Employee name</div>
              <div style={{ fontSize: 10.5, opacity: 0.7 }}>Designation · Department</div>
              <div style={{ margin: '8px 0', padding: '6px 0', borderRadius: 6, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: c.primaryColor }}>Save Contact</div>
              <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {c.tagline && <div style={{ fontSize: 10.5, fontWeight: 700, color: c.secondaryColor }}>{c.tagline}</div>}
                {line('Web', c.website)}
                {line('Email', c.officeEmail)}
                {line('Phone', c.officePhone)}
                {line('Address', c.address)}
                {line('LinkedIn', c.linkedin)}
                {line('Instagram', c.instagram)}
              </div>
            </div>
          </div>
        )}
        <QrCompanyDetailsPanel />
        <div className="faint" style={{ fontSize: 12 }}>The preview is a sketch of the layout. The real page also fills in each employee’s photo and contact details.</div>
      </aside>
    </div>
  );
}

/** The company details shown on the page an ID card QR opens. Lives in the ID card designer. */
export function QrCompanyDetailsPanel() {
  const company = useQuery({ queryKey: peopleKeys.companyProfile, queryFn: () => peopleApi.companyProfile() });
  const [editingCompany, setEditingCompany] = useState(false);

  return (
    <>
      <Card kicker="ID card QR page" title="Company details" actions={<button className="btn btn-secondary btn-sm" onClick={() => setEditingCompany(true)} disabled={!company.data}>Change</button>}>
        {company.data ? (
          <div className="stack" style={{ gap: 6, fontSize: 13 }}>
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Scanning an employee’s ID card opens a profile page with their photo, contact details and a Save Contact button, followed by these company details. Anything left blank is not shown.</div>
            {([['Website', company.data.website], ['Office email', company.data.officeEmail], ['Office phone', company.data.officePhone || 'The company phone number'], ['Address', company.data.address || 'The company record’s address'], ['LinkedIn', company.data.linkedin], ['Instagram', company.data.instagram], ['Tagline', company.data.tagline]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="row" style={{ gap: 8 }}>
                <span className="faint" style={{ width: 110, flex: 'none' }}>{k}</span>
                <span style={{ overflowWrap: 'anywhere' }}>{v || <span className="faint">Not set</span>}</span>
              </div>
            ))}
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="faint" style={{ width: 110, flex: 'none' }}>Page colours</span>
              <span style={{ width: 22, height: 22, borderRadius: 4, background: company.data.primaryColor, border: '1px solid var(--color-divider)' }} aria-label={`Main colour ${company.data.primaryColor}`} />
              <span style={{ width: 22, height: 22, borderRadius: 4, background: company.data.secondaryColor, border: '1px solid var(--color-divider)' }} aria-label={`Second colour ${company.data.secondaryColor}`} />
            </div>
          </div>
        ) : company.error ? (
          <ErrorBlock error={company.error} retry={() => void company.refetch()} />
        ) : (
          <Loading />
        )}
      </Card>
      {editingCompany && company.data && <CompanyModal value={company.data} onClose={() => setEditingCompany(false)} />}
    </>
  );
}

function AccessModal({ access, employees, onClose }: { access: VCardAccessDto; employees: { value: string; label: string }[]; onClose: () => void }) {
  const save = useAction((b: { mode: VCardAccessDto['mode']; roles: string[]; employeeIds: string[] }) => peopleApi.saveVcardAccess(b), { success: 'Visiting card access saved', invalidate: [peopleKeys.vcardAccess] });
  // Keep people already chosen in the list even when they fall outside the first 200 shown.
  const known = new Set(employees.map((e) => e.value));
  const options = [...employees, ...access.employeeIds.filter((id) => !known.has(id)).map((id) => ({ value: id, label: 'Employee' }))];
  const fields: FieldDef[] = [
    { name: 'mode', label: 'Who gets a visiting card', type: 'select', required: true, span: 2, options: [{ value: 'EVERYONE', label: 'Everyone' }, { value: 'ROLES', label: 'Selected roles' }, { value: 'EMPLOYEES', label: 'Selected employees' }] },
    { name: 'roles', label: 'Roles', type: 'multiselect', span: 2, options: access.roleOptions.map((r) => ({ value: r.key, label: r.name })), showIf: (v) => v.mode === 'ROLES' },
    { name: 'employeeIds', label: 'Employees', type: 'multiselect', span: 2, options, showIf: (v) => v.mode === 'EMPLOYEES' },
  ];
  return (
    <FormModal
      title="Visiting card access"
      fields={fields}
      initial={{ mode: access.mode, roles: access.roles, employeeIds: access.employeeIds }}
      submitLabel="Save"
      onClose={onClose}
      onSubmit={(v) =>
        save.mutateAsync({
          mode: v.mode,
          roles: v.mode === 'ROLES' ? v.roles : [],
          employeeIds: v.mode === 'EMPLOYEES' ? v.employeeIds : [],
        })
      }
    />
  );
}

function CompanyModal({ value, onClose }: { value: CompanyProfile; onClose: () => void }) {
  const save = useAction((b: CompanyProfile) => peopleApi.saveCompanyProfile(b), { success: 'Company details saved', invalidate: [peopleKeys.companyProfile] });
  const fields: FieldDef[] = [
    { name: 'website', label: 'Website', type: 'text', placeholder: 'www.yourcompany.com' },
    { name: 'officeEmail', label: 'Office email', type: 'email', placeholder: 'hr@yourcompany.com' },
    { name: 'officePhone', label: 'Office phone (blank = the company phone number)', type: 'text', placeholder: '+91 44 1234 5678' },
    { name: 'address', label: 'Address (blank = the company record’s address)', type: 'text', span: 2, placeholder: '5, Vinayagar Koil Street, Villianur, Puducherry - 605110' },
    { name: 'tagline', label: 'Tagline (words separated by |)', type: 'text', placeholder: 'People | Technology | Growth' },
    { name: 'slogan', label: 'Slogan under the company name', type: 'text', span: 2, placeholder: 'Code with Passion' },
    { name: 'linkedin', label: 'Company LinkedIn', type: 'text', placeholder: 'linkedin.com/company/…' },
    { name: 'instagram', label: 'Instagram', type: 'text', placeholder: 'instagram.com/…' },
    { name: 'primaryColor', label: 'Main colour of the page', type: 'color' },
    { name: 'secondaryColor', label: 'Second colour of the page', type: 'color' },
  ];
  return (
    <FormModal
      title="Company details for the ID card page"
      fields={fields}
      initial={value}
      submitLabel="Save"
      intro={<span className="faint" style={{ fontSize: 12.5 }}>Shown under the employee’s details when an ID card is scanned. Leave a box empty to hide it. If you leave out https://, it is added for you.</span>}
      onClose={onClose}
      onSubmit={(v) =>
        save.mutateAsync({
          website: String(v.website ?? '').trim(),
          officeEmail: String(v.officeEmail ?? '').trim(),
          officePhone: String(v.officePhone ?? '').trim(),
          address: String(v.address ?? '').trim(),
          tagline: String(v.tagline ?? '').trim(),
          slogan: String(v.slogan ?? '').trim(),
          linkedin: String(v.linkedin ?? '').trim(),
          instagram: String(v.instagram ?? '').trim(),
          primaryColor: String(v.primaryColor || value.primaryColor),
          secondaryColor: String(v.secondaryColor || value.secondaryColor),
        })
      }
    />
  );
}
