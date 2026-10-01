import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_SEVERITY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS_PLATFORM,
  formatDate,
  formatTime,
  supportStatusTone,
  type SupportStatusKey,
  type SupportTab,
  type SupportTicketDetailDto,
  type SupportTicketRowDto,
} from '@lexisora/shared';
import { ErrorBlock, Loading, Modal, PageHeader, Seg, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { onRealtime } from '@/lib/socket';
import { saasKeys, supportApi, useSupportTicket, useSupportTickets } from '../api';
import '../platform.css';

/** New support request (wireframe FORMS "b2b") + the spec's Category. */
const requestFields: FieldDef[] = [
  { name: 'subject', label: 'Subject', type: 'text', span: 2, required: true, placeholder: 'SSO login failing for 3 users' },
  { name: 'severity', label: 'Severity', type: 'select', span: 2, required: true, options: [{ value: 'HIGH', label: 'High' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'LOW', label: 'Low' }] },
  { name: 'category', label: 'Category', type: 'select', span: 2, required: true, options: SUPPORT_CATEGORIES.map((c) => ({ value: c, label: SUPPORT_CATEGORY_LABELS[c] })) },
  { name: 'description', label: 'Description', type: 'area', span: 2, required: true, placeholder: 'What happened, who is affected, since when…', hint: 'Don’t paste salaries or personal documents — Lexisora never needs them.' },
];

const sevTone = (s: string) => (s === 'HIGH' ? 'outline' : 'neutral');
const when = (iso: string) => `${formatDate(iso)} · ${formatTime(iso)}`;

function slaCell(r: SupportTicketRowDto) {
  if (r.status === 'RESOLVED' || r.status === 'CLOSED') return <span className="muted">—</span>;
  if (r.slaBreached) return <span className="pf-sla-breach">Breached</span>;
  return <span className="pf-nowrap">by {formatDate(r.slaDueAt)} {formatTime(r.slaDueAt)}</span>;
}

/** Ticket thread: description, replies, and the actions each side may take. */
function TicketModal({ id, platform, onClose }: { id: string; platform: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const view = platform ? 'platform' : 'tenant';
  const t = useSupportTicket(id, view);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const refresh = (d: SupportTicketDetailDto) => {
    qc.setQueryData(saasKeys.ticket(id, view), d);
    void qc.invalidateQueries({ queryKey: saasKeys.supportAll });
  };
  const reply = useAction(() => supportApi.reply(id, body.trim(), { internal: platform && internal, asPlatform: platform }), {
    success: platform && internal ? 'Internal note added' : 'Reply sent',
    onSuccess: (d) => {
      setBody('');
      setInternal(false);
      refresh(d);
    },
  });
  const resolve = useAction(() => supportApi.resolve(id), { success: 'Request marked resolved', onSuccess: refresh });
  const reopen = useAction(() => supportApi.reopen(id), { success: 'Request reopened', onSuccess: refresh });
  const rate = useAction((score: number) => supportApi.rate(id, score), { success: 'Thanks for rating our support', onSuccess: refresh });
  const assign = useAction(() => supportApi.update(id, { assignToMe: true }), { success: 'Assigned to you', onSuccess: refresh });
  const setStatus = useAction((status: SupportStatusKey) => supportApi.update(id, { status }), { success: (d) => `${d.code}: ${d.statusLabel}`, onSuccess: refresh });

  if (t.isLoading) return <Modal title="Request" onClose={onClose} wide><Loading /></Modal>;
  if (t.error || !t.data) return <Modal title="Request" onClose={onClose} wide><ErrorBlock error={t.error} retry={() => void t.refetch()} /></Modal>;
  const d = t.data;
  const closed = d.status === 'CLOSED';

  return (
    <Modal
      wide
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="pf-mono">{d.code}</span> {d.subject}
        </span>
      }
      onClose={onClose}
      actions={
        <>
          {platform && d.assigneeName !== me.name && !closed && <button className="btn btn-secondary" disabled={assign.isPending} onClick={() => assign.mutate(undefined)}>Assign to me</button>}
          {!platform && d.canResolve && <button className="btn btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate(undefined)}>Mark resolved</button>}
          {!platform && d.canReopen && <button className="btn btn-secondary" disabled={reopen.isPending} onClick={() => reopen.mutate(undefined)}>Reopen</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="dialog-body stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Tag tone={sevTone(d.severity)}>{SUPPORT_SEVERITY_LABELS[d.severity]}</Tag>
          <Tag tone={supportStatusTone(d.status)}>{d.statusLabel}</Tag>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {SUPPORT_CATEGORY_LABELS[d.category as keyof typeof SUPPORT_CATEGORY_LABELS] ?? d.category}
            {platform && d.tenantName ? ` · ${d.tenantName} (${d.planAtOpen.toLowerCase()})` : ''}
            {d.assigneeName ? ` · ${d.assigneeName}` : ' · unassigned'}
            {d.status !== 'RESOLVED' && d.status !== 'CLOSED' ? ` · first response ${d.slaBreached ? 'overdue' : `by ${when(d.slaDueAt)}`}` : ''}
          </span>
        </div>
        {platform && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="muted" htmlFor="pf-status" style={{ fontSize: 12.5 }}>Status</label>
            <select id="pf-status" className="input" style={{ maxWidth: 220 }} value={d.status} disabled={setStatus.isPending || closed} onChange={(e) => setStatus.mutate(e.target.value as SupportStatusKey)}>
              {SUPPORT_STATUSES.map((s) => (
                <option key={s} value={s}>{SUPPORT_STATUS_LABELS_PLATFORM[s]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="pf-thread">
          <div className="pf-msg">
            <div className="pf-msg-head"><span>{d.openedByName}</span><span>{when(d.createdAt)}</span></div>
            {d.description}
          </div>
          {d.messages.map((m) =>
            m.authorType === 'SYSTEM' ? (
              <div key={m.id} className="pf-msg system">{m.body} · {when(m.createdAt)}</div>
            ) : (
              <div key={m.id} className={`pf-msg${m.authorType === 'PLATFORM_USER' ? ' platform' : ''}${m.internal ? ' internal' : ''}`}>
                <div className="pf-msg-head">
                  <span>{m.authorName}{m.internal ? ' · internal note' : ''}</span>
                  <span>{when(m.createdAt)}</span>
                </div>
                {m.body}
              </div>
            ),
          )}
        </div>
        {d.canRate && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>How was our support?</span>
            <span className="pf-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" disabled={rate.isPending} onClick={() => rate.mutate(n)} aria-label={`Rate ${n} of 5`}>{n} ★</button>
              ))}
            </span>
          </div>
        )}
        {d.csat !== null && <div className="muted" style={{ fontSize: 13 }}>Rated {d.csat}/5</div>}
        {closed ? (
          <div className="muted" style={{ fontSize: 13 }}>This request is closed. {d.canReopen ? 'Reopen it within 7 days of resolution, or open a new request.' : 'Open a new request if you need more help.'}</div>
        ) : (
          <form
            className="stack"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) reply.mutate(undefined);
            }}
          >
            <textarea className="input" rows={3} placeholder={platform ? 'Reply to the customer…' : 'Reply to Lexisora support…'} aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="submit" disabled={!body.trim() || reply.isPending}>{platform && internal ? 'Add internal note' : 'Send reply'}</button>
              {platform && (
                <label className="row" style={{ gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (customer can’t see it)
                </label>
              )}
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/** Lexisora support (wireframe GEN "support"): requests to the Lexisora team; platform admins also work the all-tenant queue. */
export default function SupportPage() {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sp, setSp] = useSearchParams();
  const scope: 'tenant' | 'all' = sp.get('scope') === 'all' && me.isPlatformAdmin ? 'all' : 'tenant';
  const ticketId = sp.get('ticket');
  const [tab, setTab] = useState<SupportTab>('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets({ tab, scope, page });

  useEffect(() => onRealtime('support.ticket.updated', () => void qc.invalidateQueries({ queryKey: saasKeys.supportAll })), [qc]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setSp(next, { replace: true });
  };
  const counts = list.data?.counts;

  const columns: Column<SupportTicketRowDto>[] = [
    { key: 'code', header: 'Request', render: (r) => <span className="pf-mono">{r.code}</span> },
    ...(scope === 'all' ? [{ key: 'tenant', header: 'Tenant', render: (r: SupportTicketRowDto) => <span>{r.tenantName}<div className="muted" style={{ fontSize: 11.5 }}>{r.planAtOpen.charAt(0) + r.planAtOpen.slice(1).toLowerCase()}</div></span> }] : []),
    { key: 'subject', header: 'Subject', render: (r) => r.subject },
    { key: 'sev', header: 'Severity', render: (r) => <Tag tone={sevTone(r.severity)}>{SUPPORT_SEVERITY_LABELS[r.severity]}</Tag> },
    ...(scope === 'all'
      ? [
          { key: 'sla', header: 'SLA', render: (r: SupportTicketRowDto) => slaCell(r) },
          { key: 'assignee', header: 'Assignee', render: (r: SupportTicketRowDto) => r.assigneeName ?? <span className="muted">Unassigned</span> },
        ]
      : [{ key: 'opened', header: 'Opened', render: (r: SupportTicketRowDto) => <span className="pf-nowrap">{r.opened}</span> }]),
    { key: 'status', header: 'Status', render: (r) => <Tag tone={supportStatusTone(r.status)}>{r.statusLabel}</Tag> },
  ];

  return (
    <div data-screen-label="Lexisora support" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Lexisora support"
        sub={
          <>
            24/7 channel for client company admins to reach the Lexisora technical team.
            {list.data?.slaHint && <span className="muted" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>{list.data.slaHint}</span>}
          </>
        }
        actions={scope === 'tenant' ? <button className="btn btn-primary" onClick={() => setCreating(true)}>New request</button> : undefined}
      />
      {me.isPlatformAdmin && (
        <div style={{ alignSelf: 'flex-start' }}>
          <Seg<'tenant' | 'all'>
            options={[
              { value: 'tenant', label: 'Our requests' },
              { value: 'all', label: 'Support queue · all tenants' },
            ]}
            value={scope}
            onChange={(v) => {
              setPage(1);
              setParam('scope', v === 'all' ? 'all' : null);
            }}
          />
        </div>
      )}
      <Tabs<SupportTab>
        tabs={[
          { value: 'open', label: `Open · ${counts?.open ?? 0}` },
          { value: 'resolved', label: `Resolved · ${counts?.resolved ?? 0}` },
          { value: 'all', label: `All · ${counts?.all ?? 0}` },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
      />
      {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        onRowClick={(r) => setParam('ticket', r.id)}
        empty={tab === 'open' ? 'No open requests.' : 'No requests yet.'}
        footer={list.data && list.data.total > list.data.pageSize ? <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : undefined}
      />

      {creating && (
        <FormModal
          title="New support request"
          fields={requestFields}
          submitLabel="Send"
          onSubmit={async (v) => {
            const r = await supportApi.create(v);
            await qc.invalidateQueries({ queryKey: saasKeys.supportAll });
            toast(`Request ${r.code} opened`);
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {ticketId && <TicketModal id={ticketId} platform={scope === 'all'} onClose={() => setParam('ticket', null)} />}
    </div>
  );
}
