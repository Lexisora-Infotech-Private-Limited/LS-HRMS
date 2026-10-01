import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  formatBizMinutes,
  HELPDESK_PRIORITY_LABEL,
  HELPDESK_STATUS_LABEL,
  SLA_STATE_LABEL,
  type HelpdeskSettings,
  type HelpdeskTicketStatus,
  type TicketDetail,
  type TicketRow,
  type TicketTab,
} from '@lexisora/shared';
import { fileUrl, uploadFile } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, ErrorBlock, Loading, Modal, PageHeader, Tabs, Tag, toneFor } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { ago, dayMonthTime, fileSize, wpApi, wpKeys } from '../api';
import '../workplace.css';

type PageTab = TicketTab | 'settings';
const PAGE_SIZE = 25;
const statusLabel = (s: string) => HELPDESK_STATUS_LABEL[s as HelpdeskTicketStatus] ?? s;
const prioLabel = (p: string) => HELPDESK_PRIORITY_LABEL[p as keyof typeof HELPDESK_PRIORITY_LABEL] ?? p;

/** Helpdesk — GEN.helpdesk + FORMS.ticket (spec §6). */
export default function HelpdeskPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as PageTab) || 'mine';
  const ticketId = params.get('ticket');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', categoryId: '', priority: '', sla: '', q: '' });
  // Deep link from other screens: /helpdesk?raise=1&category=Payroll&subject=… opens a prefilled form.
  const [raise, setRaise] = useState(params.get('raise') === '1');
  const prefill = { category: params.get('category'), subject: params.get('subject') };
  const meta = useQuery({ queryKey: wpKeys.helpdeskMeta, queryFn: wpApi.helpdeskMeta });
  const canWork = !!meta.data?.canWork;
  const canAdmin = !!meta.data?.canAdmin;

  const listTab: TicketTab = tab === 'settings' ? 'mine' : tab;
  const q = { tab: listTab, page, pageSize: PAGE_SIZE, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  const list = useQuery({ queryKey: wpKeys.ticketList(q), queryFn: () => wpApi.tickets(q), enabled: tab !== 'settings' });
  const counts = list.data?.counts;

  useEffect(() => onRealtime('ticket:updated', () => void qc.invalidateQueries({ queryKey: wpKeys.helpdesk })), [qc]);

  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
      return n;
    });
  const setTab = (t: PageTab) => {
    setPage(1);
    set({ tab: t, ticket: null });
  };

  const tabs: { value: PageTab; label: string }[] = [
    { value: 'mine', label: `My tickets${counts ? ` · ${counts.mine}` : ''}` },
    ...(canWork ? [{ value: 'assigned' as const, label: `Assigned to me${counts ? ` · ${counts.assigned}` : ''}` }] : []),
    ...(canWork ? [{ value: 'all' as const, label: `All${counts ? ` · ${counts.all}` : ''}` }] : []),
    ...(canAdmin || (counts?.escalations ?? 0) > 0 || tab === 'escalations' ? [{ value: 'escalations' as const, label: `Escalations${counts ? ` · ${counts.escalations}` : ''}` }] : []),
    ...(canAdmin ? [{ value: 'settings' as const, label: 'Settings' }] : []),
  ];

  const cols: Column<TicketRow>[] = [
    { key: 'code', header: 'Ticket', render: (r) => <span className="tnum">{r.code}</span> },
    {
      key: 'subject',
      header: 'Subject',
      render: (r) => (
        <span>
          {r.subject}
          {tab !== 'mine' && <div className="faint" style={{ fontSize: 12 }}>{r.requester}</div>}
        </span>
      ),
    },
    { key: 'cat', header: 'Category', render: (r) => r.category },
    { key: 'prio', header: 'Priority', render: (r) => (r.priority === 'HIGH' ? <Tag tone="outline">High</Tag> : prioLabel(r.priority)) },
    { key: 'asg', header: 'Assignee', render: (r) => <span className={r.unassigned ? 'faint' : undefined}>{r.assignee}</span> },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={toneFor(statusLabel(r.status))}>{statusLabel(r.status)}</Tag> },
    {
      key: 'sla',
      header: 'SLA',
      render: (r) => (
        <span className={`wp-sla wp-sla-${r.slaLabel.startsWith('Breached') || r.slaLabel === 'Response overdue' ? 'bad' : r.slaState === 'AT_RISK' ? 'risk' : 'ok'}`}>
          {r.slaLabel}
          {r.escalationLevel > 0 && r.status !== 'RESOLVED' && r.status !== 'CLOSED' ? ` · L${r.escalationLevel}` : ''}
        </span>
      ),
    },
    { key: 'upd', header: 'Updated', render: (r) => <span className="faint" style={{ fontSize: 12.5 }}>{ago(r.updatedAt)}</span> },
  ];

  return (
    <div data-screen-label="Helpdesk" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Helpdesk"
        sub="Raise IT or HR tickets and track them to resolution."
        actions={
          can('helpdesk.use') ? (
            <button className="btn btn-primary" onClick={() => setRaise(true)}>
              Raise ticket
            </button>
          ) : undefined
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab !== 'settings' && (
        <>
          <div className="wp-filters">
            <select className="input" aria-label="Status" value={filters.status} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, status: e.target.value })))}>
              <option value="">All statuses</option>
              <option value="open">Open (any)</option>
              {Object.entries(HELPDESK_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Category" value={filters.categoryId} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, categoryId: e.target.value })))}>
              <option value="">All categories</option>
              {(meta.data?.categories ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Priority" value={filters.priority} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, priority: e.target.value })))}>
              <option value="">All priorities</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select className="input" aria-label="SLA" value={filters.sla} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, sla: e.target.value })))}>
              <option value="">Any SLA</option>
              <option value="ON_TRACK">On track</option>
              <option value="AT_RISK">At risk</option>
              <option value="BREACHED">Breached</option>
              <option value="MET">Met</option>
            </select>
            <input className="input" placeholder="Search HD-1042 or subject" aria-label="Search tickets" value={filters.q} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, q: e.target.value })))} />
          </div>
          {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
          <DataTable
            columns={cols}
            rows={list.data?.items}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            onRowClick={(r) => set({ ticket: r.id })}
            empty={tab === 'mine' ? 'You haven’t raised any tickets. Use “Raise ticket” for IT, payroll or HR help.' : tab === 'escalations' ? 'No escalated tickets.' : 'No tickets here.'}
          />
          {list.data && list.data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
        </>
      )}
      {tab === 'settings' && canAdmin && <SettingsTab />}

      {ticketId && <TicketDrawer id={ticketId} onClose={() => set({ ticket: null })} />}
      {raise && meta.data && (
        <RaiseTicketForm
          categories={meta.data.categories}
          prefill={prefill}
          onClose={() => {
            setRaise(false);
            if (params.get('raise')) set({ raise: null, category: null, subject: null });
          }}
          onCreated={(t) => {
            setPage(1);
            set({ tab: 'mine', ticket: t.id, raise: null, category: null, subject: null });
          }}
        />
      )}
    </div>
  );
}

function RaiseTicketForm({
  categories,
  prefill,
  onClose,
  onCreated,
}: {
  categories: { value: string; label: string; group: string; restricted: boolean }[];
  prefill: { category: string | null; subject: string | null };
  onClose: () => void;
  onCreated: (t: TicketDetail) => void;
}) {
  const preCategory = prefill.category ? categories.find((c) => c.label.toLowerCase() === prefill.category!.toLowerCase())?.value : undefined;
  const raise = useAction((v: Record<string, any>) => wpApi.raiseTicket({ categoryId: v.category, priority: v.priority, subject: v.subject, description: v.description, attachmentFileIds: v.attachment ? [v.attachment] : [] }), {
    success: (t) => `Ticket ${t.code} created`,
    invalidate: [wpKeys.helpdesk],
    onSuccess: (t) => onCreated(t),
  });
  const fields: FieldDef[] = [
    { name: 'category', label: 'Category', type: 'select', required: true, options: categories.map((c) => ({ value: c.value, label: c.label })), hint: 'Payroll and HR tickets are visible only to you and the desk.' },
    {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      options: [
        { value: 'MEDIUM', label: 'Medium' },
        { value: 'HIGH', label: 'High' },
        { value: 'LOW', label: 'Low' },
      ],
    },
    { name: 'subject', label: 'Subject', type: 'text', required: true, span: 2 },
    { name: 'description', label: 'Description', type: 'area', required: true, span: 2, placeholder: 'What happened, since when, and what you have tried' },
    { name: 'attachment', label: 'Attachment', type: 'file', span: 2, category: 'helpdesk', hint: 'Screenshot or document, up to 10 MB' },
  ];
  return (
    <FormModal
      title="Raise ticket"
      fields={fields}
      initial={{ priority: 'MEDIUM', ...(preCategory ? { category: preCategory } : {}), ...(prefill.subject ? { subject: prefill.subject.slice(0, 150) } : {}) }}
      submitLabel="Raise ticket"
      onClose={onClose}
      onSubmit={(v) => raise.mutateAsync(v)}
    />
  );
}

// ── Ticket drawer ──────────────────────────────────────────────────────────

function TicketDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toastError } = useToast();
  const { data: t, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.ticket(id), queryFn: () => wpApi.ticket(id) });
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState<'resolve' | 'cancel' | 'escalate' | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => onRealtime<{ id: string }>('ticket:updated', (e) => e.id === id && void refetch()), [id, refetch]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, dialog]);

  const done = (d: TicketDetail) => {
    qc.setQueryData(wpKeys.ticket(id), d);
    void qc.invalidateQueries({ queryKey: [...wpKeys.helpdesk, 'list'] });
  };
  const inv = [[...wpKeys.helpdesk, 'list'], wpKeys.dashboard];
  const update = useAction((b: Parameters<typeof wpApi.updateTicket>[1]) => wpApi.updateTicket(id, b), { success: 'Ticket updated', invalidate: inv, onSuccess: done });
  const resolve = useAction((n: string) => wpApi.resolveTicket(id, n), { success: 'Ticket resolved', invalidate: inv, onSuccess: (d) => (done(d), setDialog(null), setNote('')) });
  const reopen = useAction(() => wpApi.reopenTicket(id), { success: 'Ticket reopened', invalidate: inv, onSuccess: done });
  const cancel = useAction(() => wpApi.cancelTicket(id), { success: 'Ticket cancelled', invalidate: inv, onSuccess: (d) => (done(d), setDialog(null)) });
  const close = useAction(() => wpApi.closeTicket(id), { success: 'Ticket closed', invalidate: inv, onSuccess: done });
  const escalate = useAction((n: string) => wpApi.escalateTicket(id, n || null), { success: 'Ticket escalated', invalidate: inv, onSuccess: (d) => (done(d), setDialog(null), setNote('')) });
  const rate = useAction((s: number) => wpApi.rateTicket(id, s), { success: 'Thanks for the feedback', invalidate: inv, onSuccess: done });

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const fileIds = file ? [(await uploadFile(file, 'helpdesk')).id] : [];
      const d = await wpApi.ticketComment(id, { body: reply.trim(), visibility: internal ? 'INTERNAL' : 'PUBLIC', fileIds });
      done(d);
      setReply('');
      setFile(null);
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  }

  const slaPct = t ? Math.min(100, Math.round((t.elapsedMins / Math.max(1, t.resolutionMins)) * 100)) : 0;

  return (
    <div className="wp-drawer-backdrop" onMouseDown={onClose}>
      <aside className="wp-drawer wp-drawer-wide" role="dialog" aria-modal aria-label="Ticket" onMouseDown={(e) => e.stopPropagation()} data-screen-label="Ticket detail">
        {isLoading && <Loading />}
        {error && <ErrorBlock error={error} retry={() => void refetch()} />}
        {t && (
          <>
            <div className="wp-drawer-head">
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="eyebrow tnum">{t.code}</span>
                  <Tag tone={toneFor(statusLabel(t.status))}>{statusLabel(t.status)}</Tag>
                  {t.priority === 'HIGH' ? <Tag tone="outline">High</Tag> : <Tag tone="neutral">{prioLabel(t.priority)}</Tag>}
                  {t.restricted && <Tag tone="neutral">Restricted</Tag>}
                  {t.escalationLevel > 0 && <Tag tone="danger">Escalated · L{t.escalationLevel}</Tag>}
                </div>
                <h3>{t.subject}</h3>
                <div className="faint" style={{ fontSize: 13 }}>
                  {t.requester.name} · {t.category} · raised {dayMonthTime(t.createdAt)}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            {t.can.work ? (
              <div className="wp-ticket-meta">
                <label>
                  <span className="eyebrow">Status</span>
                  <select className="input" value={t.status} disabled={update.isPending || !['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)} onChange={(e) => update.mutate({ status: e.target.value as 'OPEN' | 'IN_PROGRESS' | 'WAITING' })}>
                    {(['OPEN', 'IN_PROGRESS', 'WAITING'] as const).map((s) => (
                      <option key={s} value={s}>
                        {HELPDESK_STATUS_LABEL[s]}
                      </option>
                    ))}
                    {!['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status) && <option value={t.status}>{statusLabel(t.status)}</option>}
                  </select>
                </label>
                <label>
                  <span className="eyebrow">Priority</span>
                  <select className="input" value={t.priority} disabled={update.isPending} onChange={(e) => update.mutate({ priority: e.target.value as 'HIGH' | 'MEDIUM' | 'LOW' })}>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </label>
                <label>
                  <span className="eyebrow">Assignee</span>
                  <select className="input" value={t.assigneeEmployeeId ?? ''} disabled={update.isPending} onChange={(e) => update.mutate({ assigneeEmployeeId: e.target.value || null })}>
                    <option value="">{t.group} (unassigned)</option>
                    {t.assignees.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <CategoryPicker value={t.categoryId} disabled={update.isPending} onChange={(categoryId) => update.mutate({ categoryId })} />
              </div>
            ) : (
              <div className="wp-ticket-meta wp-ticket-meta-ro">
                <div>
                  <span className="eyebrow">Assignee</span>
                  <div>{t.assignee}</div>
                </div>
                <div>
                  <span className="eyebrow">Support group</span>
                  <div>{t.group}</div>
                </div>
                <div>
                  <span className="eyebrow">Priority</span>
                  <div>{prioLabel(t.priority)}</div>
                </div>
              </div>
            )}

            <div className="wp-sla-panel">
              <div className="row-between">
                <span className="eyebrow">SLA · business hours</span>
                <span className={`wp-sla wp-sla-${t.slaState === 'BREACHED' ? 'bad' : t.slaState === 'AT_RISK' ? 'risk' : 'ok'}`}>{t.slaLabel}</span>
              </div>
              <div className="wp-sla-bar" aria-hidden>
                <span style={{ width: `${slaPct}%` }} className={t.slaState === 'BREACHED' ? 'bad' : t.slaState === 'AT_RISK' ? 'risk' : ''} />
              </div>
              <div className="wp-kv">
                <span>First response due</span>
                <span className="tnum">
                  {dayMonthTime(t.firstResponseDueAt)}
                  {t.firstRespondedAt ? ` · responded ${dayMonthTime(t.firstRespondedAt)}` : ''}
                </span>
                <span>Resolution due</span>
                <span className="tnum">{dayMonthTime(t.resolutionDueAt)}</span>
                <span>Elapsed</span>
                <span className="tnum">
                  {formatBizMinutes(t.elapsedMins)} of {formatBizMinutes(t.resolutionMins)}
                  {t.pausedMins ? ` · paused ${formatBizMinutes(t.pausedMins)}` : ''}
                  {t.paused ? ' · paused while waiting on the requester' : ''}
                </span>
                {t.escalatedTo.length > 0 && (
                  <>
                    <span>Escalated to</span>
                    <span>{t.escalatedTo.join(', ')}</span>
                  </>
                )}
                {t.csat && (
                  <>
                    <span>Rating</span>
                    <span>{'★'.repeat(t.csat)}{'☆'.repeat(5 - t.csat)}</span>
                  </>
                )}
              </div>
            </div>

            {t.headerOnly ? (
              <div className="note">This is a restricted {t.category} ticket. As an escalation contact you can follow its status and SLA, but the conversation stays with the requester and the {t.group}.</div>
            ) : (
              <>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="eyebrow">Description</span>
                  <div className="wp-pre">{t.description}</div>
                  {t.attachments.map((f) => (
                    <div key={f.fileId} className="wp-attach">
                      <a className="wp-link" href={fileUrl(f.fileId)} target="_blank" rel="noreferrer">
                        {f.name}
                      </a>
                      <span className="faint">{fileSize(f.size)}</span>
                    </div>
                  ))}
                  {t.resolutionNote && (
                    <div className="note">
                      <strong style={{ fontWeight: 600 }}>Resolution:</strong> {t.resolutionNote}
                    </div>
                  )}
                </div>

                <div className="wp-timeline">
                  <span className="eyebrow">Activity</span>
                  {(t.comments ?? []).map((c) => (
                    <div key={c.id} className={`wp-tl-item${c.visibility === 'INTERNAL' ? ' internal' : ''}${c.kind !== 'COMMENT' ? ' system' : ''}`}>
                      <span className="wp-comment-avatar">{c.initials}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5 }}>
                          <strong style={{ fontWeight: 600 }}>{c.authorName}</strong> <span className="faint">{dayMonthTime(c.createdAt)}</span>
                          {c.visibility === 'INTERNAL' && <span className="faint"> · internal note</span>}
                        </div>
                        <div className="wp-pre" style={{ fontSize: c.kind === 'COMMENT' ? 14 : 13 }}>
                          {c.body}
                        </div>
                        {c.files.map((f) => (
                          <a key={f.fileId} className="wp-link" style={{ fontSize: 12.5 }} href={fileUrl(f.fileId)} target="_blank" rel="noreferrer">
                            {f.name} · {fileSize(f.size)}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!(t.comments ?? []).length && <div className="faint" style={{ fontSize: 13 }}>No replies yet.</div>}
                </div>

                {t.can.comment && (
                  <div className="stack" style={{ gap: 8 }}>
                    <textarea className="input" rows={3} placeholder={internal ? 'Internal note — only the support desk sees this' : 'Reply…'} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
                    <div className="row-between">
                      <div className="row" style={{ gap: 12 }}>
                        {t.can.internal && (
                          <label className="row" style={{ gap: 6, fontSize: 13 }}>
                            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                          </label>
                        )}
                        <label className="wp-link" style={{ fontSize: 13 }}>
                          {file ? `${file.name} · remove` : 'Attach file'}
                          <input
                            type="file"
                            hidden
                            onClick={(e) => {
                              if (file) {
                                e.preventDefault();
                                setFile(null);
                              }
                            }}
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                      </div>
                      <button className="btn btn-primary" disabled={sending || !reply.trim()} onClick={() => void send()}>
                        {sending ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {t.can.csat && (
              <div className="wp-csat">
                <span>How did we do?</span>
                <div className="row" style={{ gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} className="wp-star" disabled={rate.isPending} aria-label={`${s} of 5`} onClick={() => rate.mutate(s)}>
                      ★
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="row" style={{ gap: 8, borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
              {t.can.resolve && (
                <button className="btn btn-primary" onClick={() => setDialog('resolve')}>
                  Resolve
                </button>
              )}
              {t.can.escalate && (
                <button className="btn btn-secondary" onClick={() => setDialog('escalate')}>
                  Escalate
                </button>
              )}
              {t.can.reopen && (
                <button className="btn btn-secondary" disabled={reopen.isPending} onClick={() => reopen.mutate(undefined)}>
                  Reopen
                </button>
              )}
              {t.can.close && (
                <button className="btn btn-secondary" disabled={close.isPending} onClick={() => close.mutate(undefined)}>
                  {t.can.work ? 'Close' : 'Confirm fixed · close'}
                </button>
              )}
              {t.can.cancel && (
                <button className="btn btn-ghost" onClick={() => setDialog('cancel')}>
                  Cancel ticket
                </button>
              )}
            </div>

            {dialog === 'resolve' && (
              <Modal
                title={`Resolve ${t.code}`}
                onClose={() => setDialog(null)}
                actions={
                  <>
                    <button className="btn btn-secondary" onClick={() => setDialog(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" disabled={note.trim().length < 3 || resolve.isPending} onClick={() => resolve.mutate(note.trim())}>
                      Resolve
                    </button>
                  </>
                }
              >
                <div className="field">
                  <label htmlFor="hd-note">Resolution note</label>
                  <textarea id="hd-note" className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done — the requester sees this and can reopen within 7 days" />
                </div>
              </Modal>
            )}
            {dialog === 'escalate' && (
              <Modal
                title={`Escalate ${t.code}`}
                onClose={() => setDialog(null)}
                actions={
                  <>
                    <button className="btn btn-secondary" onClick={() => setDialog(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" disabled={escalate.isPending} onClick={() => escalate.mutate(note.trim())}>
                      Escalate to level {t.escalationLevel + 1}
                    </button>
                  </>
                }
              >
                <p className="faint" style={{ marginTop: 0 }}>
                  Level 1 alerts the group lead and the reporting manager; level 2 adds HR and Admin.
                </p>
                <div className="field">
                  <label htmlFor="hd-esc">Note (optional)</label>
                  <textarea id="hd-esc" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </Modal>
            )}
            {dialog === 'cancel' && (
              <ConfirmDialog title={`Cancel ${t.code}?`} body="The desk stops working on it. You can raise a new ticket any time." confirmLabel="Cancel ticket" danger busy={cancel.isPending} onConfirm={() => cancel.mutate(undefined)} onClose={() => setDialog(null)} />
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function CategoryPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const meta = useQuery({ queryKey: wpKeys.helpdeskMeta, queryFn: wpApi.helpdeskMeta });
  return (
    <label>
      <span className="eyebrow">Category</span>
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {(meta.data?.categories ?? []).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Settings (helpdesk admin) ──────────────────────────────────────────────

function SettingsTab() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.helpdeskSettings, queryFn: wpApi.helpdeskSettings });
  const lk = useLookups(['employees']);
  const qc = useQueryClient();
  const [group, setGroup] = useState<HelpdeskSettings['groups'][number] | 'new' | null>(null);
  const [cat, setCat] = useState<HelpdeskSettings['categories'][number] | 'new' | null>(null);
  const [sla, setSla] = useState<Record<string, { f: string; r: string }>>({});
  const [days, setDays] = useState('');
  const after = (d: HelpdeskSettings) => {
    qc.setQueryData(wpKeys.helpdeskSettings, d);
    void qc.invalidateQueries({ queryKey: wpKeys.helpdeskMeta });
  };
  const saveSla = useAction((p: { priority: string; f: number; r: number }) => wpApi.saveSla(p.priority, { firstResponseMins: p.f, resolutionMins: p.r }), { success: 'SLA saved', onSuccess: after });
  const saveDays = useAction((n: number) => wpApi.saveAutoClose(n), { success: 'Auto-close saved', onSuccess: after });
  const saveGroup = useAction((v: { id: string | null; body: Parameters<typeof wpApi.saveGroup>[1] }) => wpApi.saveGroup(v.id, v.body), { success: 'Support group saved', onSuccess: after });
  const saveCat = useAction((v: { id: string | null; body: Parameters<typeof wpApi.saveCategory>[1] }) => wpApi.saveCategory(v.id, v.body), { success: 'Category saved', onSuccess: after });
  const people = opts(lk.data, 'employees').map((o) => ({ value: o.value, label: o.label.split(' · ')[0] ?? o.label }));

  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock error={error} retry={() => void refetch()} />;
  if (!data) return null;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="stack" style={{ gap: 8 }}>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>SLA by priority</h4>
          <span className="faint" style={{ fontSize: 12.5 }}>Business hours: Mon–Fri 09:30–18:30 IST, excluding mandatory holidays · 1 day = 9 h</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Priority</th>
                <th className="num">First response (min)</th>
                <th className="num">Resolution (min)</th>
                <th>Resolution</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sla.map((s) => {
                const e = sla[s.priority] ?? { f: String(s.firstResponseMins), r: String(s.resolutionMins) };
                const changed = e.f !== String(s.firstResponseMins) || e.r !== String(s.resolutionMins);
                return (
                  <tr key={s.priority}>
                    <td>{prioLabel(s.priority)}</td>
                    <td className="num">
                      <input className="input wp-num" inputMode="numeric" value={e.f} onChange={(x) => setSla((m) => ({ ...m, [s.priority]: { ...e, f: x.target.value } }))} />
                    </td>
                    <td className="num">
                      <input className="input wp-num" inputMode="numeric" value={e.r} onChange={(x) => setSla((m) => ({ ...m, [s.priority]: { ...e, r: x.target.value } }))} />
                    </td>
                    <td className="faint">{formatBizMinutes(Number(e.r) || 0)}</td>
                    <td>
                      {changed && (
                        <button className="btn btn-secondary btn-sm" disabled={saveSla.isPending} onClick={() => saveSla.mutate({ priority: s.priority, f: Number(e.f), r: Number(e.r) })}>
                          Save
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 8, fontSize: 13.5 }}>
          <span>Close resolved tickets automatically after</span>
          <input className="input wp-num" inputMode="numeric" value={days || String(data.autoCloseDays)} onChange={(e) => setDays(e.target.value)} />
          <span>days</span>
          {days && days !== String(data.autoCloseDays) && (
            <button className="btn btn-secondary btn-sm" disabled={saveDays.isPending} onClick={() => saveDays.mutate(Number(days))}>
              Save
            </button>
          )}
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Categories</h4>
          <button className="btn btn-secondary btn-sm" onClick={() => setCat('new')}>
            Add category
          </button>
        </div>
        <DataTable
          columns={[
            { key: 'n', header: 'Category', render: (c) => c.name },
            { key: 'g', header: 'Routes to', render: (c) => c.group },
            { key: 'r', header: 'Visibility', render: (c) => (c.restricted ? <Tag tone="outline">Restricted</Tag> : 'Requester & desk') },
            { key: 'o', header: 'Open tickets', num: true, render: (c) => c.openTickets },
            { key: 's', header: 'Status', render: (c) => (c.active ? <Tag tone="accent">Active</Tag> : <Tag tone="neutral">Inactive</Tag>) },
          ]}
          rows={data.categories}
          rowKey={(c) => c.id}
          onRowClick={(c) => setCat(c)}
        />
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Support groups</h4>
          <button className="btn btn-secondary btn-sm" onClick={() => setGroup('new')}>
            Add group
          </button>
        </div>
        <DataTable
          columns={[
            { key: 'n', header: 'Group', render: (g) => g.name },
            { key: 'l', header: 'Lead', render: (g) => g.lead ?? <span className="faint">—</span> },
            { key: 'm', header: 'Members', render: (g) => (g.members.length ? g.members.join(', ') : <span className="faint">—</span>) },
            { key: 'a', header: 'Assignment', render: (g) => (g.roundRobin ? 'Auto (round robin)' : 'Manual') },
            { key: 'o', header: 'Open tickets', num: true, render: (g) => g.openTickets },
            { key: 's', header: 'Status', render: (g) => (g.active ? <Tag tone="accent">Active</Tag> : <Tag tone="neutral">Inactive</Tag>) },
          ]}
          rows={data.groups}
          rowKey={(g) => g.id}
          onRowClick={(g) => setGroup(g)}
        />
      </section>

      {cat && (
        <FormModal
          title={cat === 'new' ? 'Add category' : `Edit ${cat.name}`}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
            { name: 'groupId', label: 'Routes to', type: 'select', required: true, options: data.groups.filter((g) => g.active).map((g) => ({ value: g.id, label: g.name })) },
            { name: 'restricted', label: 'Restricted (requester + desk only, e.g. Payroll, HR)', type: 'checkbox' },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          initial={cat === 'new' ? { active: true } : { name: cat.name, groupId: cat.groupId, restricted: cat.restricted, active: cat.active }}
          submitLabel="Save"
          onClose={() => setCat(null)}
          onSubmit={(v) => saveCat.mutateAsync({ id: cat === 'new' ? null : cat.id, body: { name: v.name, groupId: v.groupId, restricted: !!v.restricted, active: !!v.active } })}
        />
      )}
      {group && lk.data && (
        <FormModal
          title={group === 'new' ? 'Add support group' : `Edit ${group.name}`}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
            { name: 'leadEmployeeId', label: 'Lead', type: 'select', options: people },
            { name: 'memberEmployeeIds', label: 'Members', type: 'multiselect', options: people, span: 2 },
            { name: 'roundRobin', label: 'Auto-assign new tickets (member with the fewest open tickets)', type: 'checkbox', span: 2 },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          initial={group === 'new' ? { active: true, roundRobin: false, memberEmployeeIds: [] } : { name: group.name, leadEmployeeId: group.leadEmployeeId ?? '', memberEmployeeIds: group.memberEmployeeIds, active: group.active, roundRobin: group.roundRobin }}
          submitLabel="Save"
          onClose={() => setGroup(null)}
          onSubmit={(v) =>
            saveGroup.mutateAsync({ id: group === 'new' ? null : group.id, body: { name: v.name, leadEmployeeId: v.leadEmployeeId || null, memberEmployeeIds: v.memberEmployeeIds ?? [], active: !!v.active, roundRobin: !!v.roundRobin } })
          }
        />
      )}
    </div>
  );
}
