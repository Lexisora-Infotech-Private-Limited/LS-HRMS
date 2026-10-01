import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  GST_STATE_NAMES,
  ROOT_DOMAIN,
  SUPPORT_STATUS_LABELS_PLATFORM,
  formatDate,
  formatINR,
  formatINRCompact,
  supportStatusTone,
  type SupportStatusKey,
  type TenantRowDto,
  type TenantTab,
} from '@lexisora/shared';
import { ConfirmDialog, ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { download } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { saasKeys, tenantsApi, useTenant, useTenants } from '../api';
import '../platform.css';

const STATE_OPTIONS = Object.entries(GST_STATE_NAMES).map(([value, label]) => ({ value, label }));

/** Add tenant (wireframe FORMS "tenant"), with the spec's paid-plan reveals. */
const tenantFields: FieldDef[] = [
  { name: 'company', label: 'Company', type: 'text', span: 2, required: true, placeholder: 'Nova Clinics' },
  { name: 'domain', label: 'Login domain', type: 'text', required: true, placeholder: 'nova', hint: `Becomes nova.${ROOT_DOMAIN}` },
  {
    name: 'planCode',
    label: 'Plan',
    type: 'select',
    required: true,
    options: [
      { value: 'FREE', label: 'Free (10 users)' },
      { value: 'GROWTH', label: 'Growth' },
      { value: 'ENTERPRISE', label: 'Enterprise' },
    ],
  },
  { name: 'adminEmail', label: 'Admin email', type: 'email', span: 2, required: true, placeholder: 'admin@company.com' },
  { name: 'adminName', label: 'Admin name', type: 'text', span: 2, placeholder: 'Optional — taken from the email otherwise' },
  {
    name: 'cycle',
    label: 'Billing cycle',
    type: 'select',
    required: true,
    options: [
      { value: 'YEARLY', label: 'Yearly · ₹149 / user / month' },
      { value: 'MONTHLY', label: 'Monthly · ₹179 / user / month' },
    ],
    showIf: (v) => v.planCode === 'GROWTH',
  },
  { name: 'seats', label: 'Seats', type: 'number', required: true, placeholder: '50', hint: 'Includes the 10 free seats', showIf: (v) => v.planCode !== 'FREE' },
  { name: 'stateCode', label: 'State (place of supply)', type: 'select', required: true, options: STATE_OPTIONS, showIf: (v) => v.planCode !== 'FREE' },
  { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: 'Optional', showIf: (v) => v.planCode !== 'FREE' },
];

function NotOperator() {
  return (
    <div data-screen-label="Tenants" className="stack">
      <PageHeader title="Tenants" sub="Client companies on the platform." />
      <div className="note">Tenants is available to Lexisora platform administrators only. Your workspace’s plan, seats and invoices are under Subscription &amp; billing.</div>
    </div>
  );
}

/** Tenant detail: metadata only — never employees, chats, salaries or documents. */
function TenantDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const t = useTenant(id);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const refresh = [saasKeys.tenantsAll];
  const suspend = useAction(() => tenantsApi.suspend(id, reason.trim() || null), { success: (r) => `${r.company} suspended`, invalidate: refresh, onSuccess: () => setConfirm(null) });
  const reactivate = useAction(() => tenantsApi.reactivate(id), { success: (r) => `${r.company} reactivated`, invalidate: refresh, onSuccess: () => setConfirm(null) });
  const grace = useAction(() => tenantsApi.extendGrace(id, 7), { success: 'Grace period extended by 7 days', invalidate: refresh });
  const invite = useAction(() => tenantsApi.resendInvite(id), { success: (r) => r.message, invalidate: refresh });

  if (t.isLoading) return <Modal title="Tenant" onClose={onClose} wide><Loading /></Modal>;
  if (t.error || !t.data) return <Modal title="Tenant" onClose={onClose} wide><ErrorBlock error={t.error} retry={() => void t.refetch()} /></Modal>;
  const d = t.data;
  const suspended = d.status === 'Suspended';
  const pastDue = d.subscription && ['PAST_DUE', 'READ_ONLY'].includes(d.subscription.status);
  const invited = d.adminContacts.some((a) => a.status === 'INVITED');

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {d.company} <Tag tone={d.statusTone}>{d.status}</Tag>
        </span>
      }
      onClose={onClose}
      actions={
        <>
          {invited && <button className="btn btn-secondary" disabled={invite.isPending} onClick={() => invite.mutate(undefined)}>Resend admin invite</button>}
          {pastDue && !suspended && <button className="btn btn-secondary" disabled={grace.isPending} onClick={() => grace.mutate(undefined)}>Extend grace +7 days</button>}
          {!d.isOperator && (suspended || d.subscription?.status === 'READ_ONLY') && <button className="btn btn-primary" onClick={() => setConfirm('reactivate')}>Reactivate</button>}
          {!d.isOperator && !suspended && <button className="btn btn-danger" onClick={() => setConfirm('suspend')}>Suspend</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="dialog-body stack" style={{ gap: 14 }}>
        <div className="grid-1-1">
          <div>
            <div className="kv-row"><span>Domain</span><span className="pf-mono">{d.domain}</span></div>
            <div className="kv-row"><span>Plan</span><span>{d.planLabel}</span></div>
            <div className="kv-row"><span>Seats</span><span>{d.seatsUsed} in use{d.planCode === 'GROWTH' || d.planCode === 'ENTERPRISE' ? ` of ${d.quantity} purchased` : ''}</span></div>
            <div className="kv-row"><span>Active users</span><span>{d.activeUsers}</span></div>
            <div className="kv-row"><span>Customer since</span><span>{formatDate(d.customerSince)}</span></div>
          </div>
          <div>
            <div className="kv-row"><span>Subscription</span><span>{d.isOperator ? 'Operator workspace · not billed' : d.subscription ? `${d.subscription.status.replace(/_/g, ' ').toLowerCase()} · ${d.subscription.collection === 'OFFLINE_INVOICE' ? 'offline invoice' : 'gateway'}` : '—'}</span></div>
            <div className="kv-row"><span>Renewal</span><span>{d.renewal}</span></div>
            {d.subscription?.graceEndsAt && <div className="kv-row"><span>Grace ends</span><span>{formatDate(d.subscription.graceEndsAt)}</span></div>}
            <div className="kv-row"><span>State</span><span>{d.stateName ?? '—'}</span></div>
            <div className="kv-row"><span>Admin</span><span>{d.adminContacts.map((a) => `${a.email}${a.status === 'INVITED' ? ' (invited)' : ''}`).join(', ') || '—'}</span></div>
          </div>
        </div>

        <div>
          <div className="kicker" style={{ marginBottom: 6 }}>Invoices</div>
          {d.invoices.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No invoices.</div>
          ) : (
            d.invoices.map((i) => (
              <div key={i.id} className="list-row">
                <span className="pf-mono">{i.number}</span>
                <span className="grow">{i.description}<div className="muted" style={{ fontSize: 12 }}>{formatDate(i.issueDate)}</div></span>
                <span className="tnum">{formatINR(i.totalPaise)}</span>
                <Tag tone={i.status === 'PAID' ? 'accent' : i.status === 'OVERDUE' ? 'danger' : 'outline'}>{i.status === 'ISSUED' ? 'Due' : i.status.charAt(0) + i.status.slice(1).toLowerCase()}</Tag>
                <button className="btn btn-ghost btn-sm" onClick={() => void download(`/tenants/${id}/invoices/${i.id}/pdf`, `${(i.number ?? i.id).replace(/\//g, '-')}.pdf`)}>PDF</button>
              </div>
            ))
          )}
        </div>

        <div className="grid-1-1">
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Support requests</div>
            {d.tickets.length === 0 && <div className="muted" style={{ fontSize: 13 }}>None.</div>}
            {d.tickets.map((k) => (
              <div key={k.id} className="list-row">
                <span className="pf-mono">{k.code}</span>
                <span className="grow">{k.subject}</span>
                <Tag tone={supportStatusTone(k.status)}>{SUPPORT_STATUS_LABELS_PLATFORM[k.status as SupportStatusKey] ?? k.status}</Tag>
              </div>
            ))}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Platform audit</div>
            {d.platformAudit.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No platform actions yet.</div>}
            {d.platformAudit.slice(0, 8).map((a) => (
              <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <span className="grow">{a.summary}<div className="muted" style={{ fontSize: 12 }}>{a.actorName} · {formatDate(a.createdAt)}</div></span>
              </div>
            ))}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>Lexisora sees metadata only: no employees, chats, salaries or documents of this workspace (enforced by the platform’s restricted reader).</div>
      </div>

      {confirm === 'suspend' && (
        <ConfirmDialog
          title={`Suspend ${d.company}?`}
          danger
          confirmLabel="Suspend"
          busy={suspend.isPending}
          body={
            <div className="stack" style={{ gap: 8 }}>
              <span>Everyone at {d.domain} is signed out and can’t sign in until you reactivate the workspace. Their data is kept. The admins are emailed.</span>
              <input className="input" placeholder="Reason (shown to the tenant)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          }
          onConfirm={() => suspend.mutate(undefined)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'reactivate' && (
        <ConfirmDialog
          title={`Reactivate ${d.company}?`}
          body="Sign-ins work again straight away. If an invoice is overdue the workspace returns to Payment due with a 7-day grace period."
          confirmLabel="Reactivate"
          busy={reactivate.isPending}
          onConfirm={() => {
            reactivate.mutate(undefined);
            void qc.invalidateQueries({ queryKey: saasKeys.tenant(id) });
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}

function TenantsScreen() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<TenantTab>('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const list = useTenants({ tab, q: q || undefined, page });
  const k = list.data?.kpis;
  const counts = list.data?.counts;

  const columns: Column<TenantRowDto>[] = [
    { key: 'company', header: 'Company', render: (r) => <span>{r.company}{r.isOperator && <span className="muted" style={{ fontSize: 12 }}> · operator</span>}</span> },
    { key: 'domain', header: 'Domain', render: (r) => <span className="pf-mono">{r.domain}</span> },
    { key: 'plan', header: 'Plan', render: (r) => r.planLabel },
    {
      key: 'seats',
      header: 'Seats',
      num: true,
      render: (r) => (
        <span title={r.planCode === 'GROWTH' || r.planCode === 'ENTERPRISE' ? `${r.seatsUsed} of ${r.quantity} seats in use` : `${r.seatsUsed} users`}>
          {r.seats}
          {(r.planCode === 'GROWTH' || r.planCode === 'ENTERPRISE') && <div className="muted" style={{ fontSize: 11.5 }}>{r.seatsUsed} in use</div>}
        </span>
      ),
    },
    { key: 'renewal', header: 'Renewal', render: (r) => r.renewal },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={r.statusTone}>{r.status}</Tag> },
  ];

  return (
    <div data-screen-label="Tenants" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Tenants"
        sub="Client companies on the platform. Each has isolated data and its own login domain (Enterprise: dedicated database)."
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>Add tenant</button>}
      />
      {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
      {k && (
        <Kpis
          items={[
            { label: 'Tenants', value: k.tenants, sub: `${k.freeTier} on free tier` },
            { label: 'Seats billed', value: k.seatsBilled.toLocaleString('en-IN'), sub: `${k.seatsDelta >= 0 ? '+' : ''}${k.seatsDelta} this month` },
            { label: 'MRR', value: formatINRCompact(k.mrrPaise), sub: k.mrrDeltaPct === null ? 'excl. GST' : `${k.mrrDeltaPct >= 0 ? '+' : ''}${k.mrrDeltaPct}% vs 30 days ago` },
          ]}
        />
      )}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs<TenantTab>
          tabs={[
            { value: 'all', label: `All · ${counts?.all ?? 0}` },
            { value: 'paid', label: `Paid · ${counts?.paid ?? 0}` },
            { value: 'free', label: `Free · ${counts?.free ?? 0}` },
            { value: 'attention', label: `Attention · ${counts?.attention ?? 0}` },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
        />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search company or domain" aria-label="Search tenants" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        onRowClick={(r) => setOpenId(r.id)}
        empty="No tenants match."
        footer={list.data && list.data.total > list.data.pageSize ? <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : undefined}
      />

      {adding && (
        <FormModal
          title="Add tenant"
          fields={tenantFields}
          submitLabel="Create tenant"
          intro="Creates the workspace with the 5 standard roles, its subscription and an admin login. The admin gets an invite email to set a password."
          onSubmit={async (v) => {
            await tenantsApi.create(v);
            await qc.invalidateQueries({ queryKey: saasKeys.tenantsAll });
            toast('Tenant provisioned');
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {openId && <TenantDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Tenants (wireframe GEN "tenants") — Lexisora platform administrators only. */
export default function TenantsPage() {
  const me = useMe();
  if (!me.isPlatformAdmin) return <NotOperator />;
  return <TenantsScreen />;
}
