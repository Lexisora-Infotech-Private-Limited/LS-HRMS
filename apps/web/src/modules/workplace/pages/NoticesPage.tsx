import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { noticeReadLabel, WP_EVENT_KIND_LABEL, WP_EVENT_KINDS, type CompanyEventRow, type NoticeDetail, type NoticeRow, type NoticeTab, type QuoteRow } from '@lexisora/shared';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { Check, ConfirmDialog, ErrorBlock, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { dayMonthOf, dayMonthTime, fromLocalInput, toLocalInput, wpApi, wpKeys } from '../api';
import { NoticeDrawer, statusLabel } from '../components/NoticeDrawer';
import { NoticeFormModal } from '../components/NoticeForm';
import '../workplace.css';

type PageTab = NoticeTab | 'events' | 'quotes';
const PAGE_SIZE = 25;

/** Notice board — GEN.notices + FORMS.notice (spec §2), with Events and Thought of the day tabs. */
export default function NoticesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canPublish = can('notices.publish.global') || can('notices.publish.team');
  const tab = (params.get('tab') as PageTab) || 'all';
  const openId = params.get('open');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ notice: NoticeDetail | null } | null>(null);

  const setTab = (t: PageTab) => {
    setPage(1);
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', t);
      n.delete('open');
      return n;
    });
  };
  const setOpen = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('open', id);
      else n.delete('open');
      return n;
    });

  const listTab: NoticeTab = tab === 'events' || tab === 'quotes' ? 'all' : tab;
  const list = useQuery({ queryKey: wpKeys.noticeList(listTab, page), queryFn: () => wpApi.notices({ tab: listTab, page, pageSize: PAGE_SIZE }), enabled: tab !== 'events' && tab !== 'quotes' });
  const counts = list.data?.counts;

  useEffect(() => onRealtime('notice:new', () => void qc.invalidateQueries({ queryKey: wpKeys.notices })), [qc]);
  useEffect(() => onRealtime('notice:receipt', () => void qc.invalidateQueries({ queryKey: wpKeys.notices })), [qc]);

  const tabs: { value: PageTab; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'global', label: 'Global' },
    { value: 'teams', label: 'My teams' },
    ...(canPublish ? [{ value: 'drafts' as const, label: `Drafts & scheduled${counts?.drafts ? ` · ${counts.drafts}` : ''}` }] : []),
    { value: 'events', label: 'Events' },
    ...(can('quotes.manage') ? [{ value: 'quotes' as const, label: 'Thought of the day' }] : []),
  ];

  const cols: Column<NoticeRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (r) => (
        <span>
          {r.title}
          {r.pinned && (
            <span className="faint" style={{ fontSize: 11.5, marginLeft: 8, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Pinned
            </span>
          )}
          {r.hasAttachment && (
            <span className="faint" title="Has attachments" style={{ marginLeft: 8, fontSize: 12 }}>
              · attachment
            </span>
          )}
          {r.myRead === false && <span className="wp-dot" title="New" />}
        </span>
      ),
    },
    { key: 'vis', header: 'Visibility', render: (r) => <Tag tone={r.visibility === 'GLOBAL' ? 'accent' : 'outline'}>{r.visibility === 'GLOBAL' ? 'Global' : 'Team'}</Tag> },
    { key: 'aud', header: 'Audience', render: (r) => <span title={r.audienceLabel}>{r.audienceLabel}</span> },
    {
      key: 'pub',
      header: 'Published',
      render: (r) =>
        r.status === 'DRAFT' || r.status === 'SCHEDULED' ? (
          <Tag tone="outline">{statusLabel(r)}</Tag>
        ) : (
          <span>
            {dayMonthOf(r.publishedAt)}
            {r.status === 'EXPIRED' && (
              <>
                {' '}
                <Tag tone="neutral">Expired</Tag>
              </>
            )}
          </span>
        ),
    },
    {
      key: 'read',
      header: 'Read',
      render: (r) => {
        const l = noticeReadLabel(r);
        return l.tone === 'plain' ? <span className="tnum">{l.text}</span> : <Tag tone={l.tone}>{l.text}</Tag>;
      },
    },
  ];

  return (
    <div data-screen-label="Notice board" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Notice board"
        sub="Global notices reach everyone. Team-specific notices are visible only to the selected department or project."
        actions={
          canPublish ? (
            <button className="btn btn-primary" onClick={() => setForm({ notice: null })}>
              Publish notice
            </button>
          ) : undefined
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'events' && <EventsTab />}
      {tab === 'quotes' && can('quotes.manage') && <QuotesTab />}
      {tab !== 'events' && tab !== 'quotes' && (
        <>
          {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
          <DataTable
            columns={cols}
            rows={list.data?.items}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            onRowClick={(r) => setOpen(r.id)}
            empty={tab === 'drafts' ? 'No drafts or scheduled notices.' : tab === 'teams' ? 'No team notices for your teams yet.' : 'No notices yet.'}
          />
          {list.data && list.data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
        </>
      )}

      {openId && (
        <NoticeDrawer
          id={openId}
          onClose={() => setOpen(null)}
          onEdit={(n) => {
            setOpen(null);
            setForm({ notice: n });
          }}
        />
      )}
      {form && <NoticeFormModal notice={form.notice} onClose={() => setForm(null)} onSaved={(n) => n.status === 'DRAFT' && tab !== 'drafts' && canPublish && setTab('drafts')} />}
    </div>
  );
}

// ── Events (company events + birthdays & anniversaries) ───────────────────

const EVENT_FIELDS: FieldDef[] = [
  { name: 'title', label: 'Event', type: 'text', span: 2, required: true, placeholder: 'e.g. Town hall' },
  { name: 'kind', label: 'Type', type: 'select', required: true, options: WP_EVENT_KINDS.map((k) => ({ value: k, label: WP_EVENT_KIND_LABEL[k] })) },
  { name: 'location', label: 'Where', type: 'text', placeholder: 'e.g. Terrace · Mumbai HQ' },
  { name: 'startsAt', label: 'Starts', type: 'datetime', required: true },
  { name: 'endsAt', label: 'Ends', type: 'datetime' },
  { name: 'description', label: 'Details', type: 'area' },
];

function EventsTab() {
  const can = useCan();
  const manage = can('notices.publish.global');
  const events = useQuery({ queryKey: wpKeys.events, queryFn: () => wpApi.events(60) });
  const cel = useQuery({ queryKey: wpKeys.celebrations, queryFn: () => wpApi.celebrations(14) });
  const [form, setForm] = useState<{ row: CompanyEventRow | null } | null>(null);
  const [cancel, setCancel] = useState<CompanyEventRow | null>(null);
  const inv = [wpKeys.events, wpKeys.dashboard];
  const save = useAction(
    (a: { id?: string; body: Parameters<typeof wpApi.createEvent>[0] }) => (a.id ? wpApi.updateEvent(a.id, a.body) : wpApi.createEvent(a.body)),
    { success: (_r, a) => (a.id ? 'Event updated' : 'Event added'), invalidate: inv },
  );
  const doCancel = useAction((id: string) => wpApi.cancelEvent(id), { success: 'Event cancelled', invalidate: inv });

  const cols: Column<CompanyEventRow>[] = [
    { key: 'title', header: 'Event', render: (e) => <span className={e.cancelled ? 'wp-strike' : undefined}>{e.title}</span> },
    { key: 'when', header: 'When', render: (e) => <span className={e.cancelled ? 'wp-strike' : undefined}>{e.when}</span> },
    { key: 'where', header: 'Where', render: (e) => e.location ?? <span className="faint">—</span> },
    { key: 'kind', header: 'Type', render: (e) => (e.cancelled ? <Tag tone="danger">Cancelled</Tag> : <Tag tone={e.kind === 'TOWN_HALL' ? 'accent' : 'neutral'}>{WP_EVENT_KIND_LABEL[e.kind]}</Tag>) },
    ...(manage
      ? [
          {
            key: 'act',
            header: '',
            render: (e: CompanyEventRow) =>
              e.cancelled ? null : (
                <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setForm({ row: e })}>
                    Edit
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCancel(e)}>
                    Cancel
                  </button>
                </span>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="grid-2-1">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Company events</h4>
          {manage && (
            <button className="btn btn-secondary btn-sm" onClick={() => setForm({ row: null })}>
              Add event
            </button>
          )}
        </div>
        {events.error && <ErrorBlock error={events.error} retry={() => void events.refetch()} />}
        <DataTable columns={cols} rows={events.data} rowKey={(e) => e.id} loading={events.isLoading} empty="No events in the next 60 days." />
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <h4 style={{ margin: 0 }}>Birthdays &amp; anniversaries</h4>
        {(cel.data ?? []).map((c) => (
          <div key={c.id} className="list-row">
            <span>{c.what}</span>
            <span className="faint">{c.when}</span>
          </div>
        ))}
        {cel.data && !cel.data.length && <div className="list-row faint">None in the next two weeks.</div>}
      </div>
      {form && (
        <FormModal
          title={form.row ? 'Edit event' : 'Add event'}
          fields={EVENT_FIELDS}
          submitLabel={form.row ? 'Save' : 'Add event'}
          initial={
            form.row
              ? { title: form.row.title, kind: form.row.kind, location: form.row.location ?? '', startsAt: toLocalInput(form.row.startsAt), endsAt: toLocalInput(form.row.endsAt), description: form.row.description ?? '' }
              : { kind: 'TOWN_HALL' }
          }
          onSubmit={(v) =>
            save.mutateAsync({
              id: form.row?.id,
              body: { title: v.title, kind: v.kind, location: v.location, description: v.description, startsAt: fromLocalInput(v.startsAt) ?? '', endsAt: fromLocalInput(v.endsAt) },
            })
          }
          onClose={() => setForm(null)}
        />
      )}
      {cancel && (
        <ConfirmDialog
          title={`Cancel ${cancel.title}?`}
          body="It will show as cancelled for 24 hours, then disappear from dashboards."
          confirmLabel="Cancel event"
          danger
          busy={doCancel.isPending}
          onClose={() => setCancel(null)}
          onConfirm={() => {
            doCancel.mutate(cancel.id);
            setCancel(null);
          }}
        />
      )}
    </div>
  );
}

// ── Thought of the day (quotes.manage) ─────────────────────────────────────

const QUOTE_FIELDS: FieldDef[] = [
  { name: 'text', label: 'Quote', type: 'area', required: true, placeholder: 'Up to 280 characters' },
  { name: 'author', label: 'Author', type: 'text', placeholder: 'Optional' },
  { name: 'scheduledFor', label: 'Show on a specific day', type: 'date', hint: 'Leave empty to add it to the daily rotation' },
  { name: 'active', label: 'Active', type: 'checkbox' },
];

function QuotesTab() {
  const q = useQuery({ queryKey: wpKeys.quotes, queryFn: wpApi.quotes });
  const [form, setForm] = useState<{ row: QuoteRow | null } | null>(null);
  const [del, setDel] = useState<QuoteRow | null>(null);
  const inv = [wpKeys.quotes, wpKeys.dashboard];
  const save = useAction(
    (a: { id?: string; body: Parameters<typeof wpApi.createQuote>[0] }) => (a.id ? wpApi.updateQuote(a.id, a.body) : wpApi.createQuote(a.body)),
    { success: (_r, a) => (a.id ? 'Quote updated' : 'Quote added'), invalidate: inv },
  );
  const toggle = useAction((a: { id: string; active: boolean }) => wpApi.updateQuote(a.id, { active: a.active }), { success: (_r, a) => (a.active ? 'Quote back in rotation' : 'Quote paused'), invalidate: inv });
  const remove = useAction((id: string) => wpApi.deleteQuote(id), { success: 'Quote deleted', invalidate: inv });
  const today = q.data?.find((x) => x.isToday);
  const pool = (q.data ?? []).filter((x) => x.active && !x.scheduledFor).length;

  const cols: Column<QuoteRow>[] = [
    {
      key: 'text',
      header: 'Quote',
      render: (r) => (
        <span className="serif" style={{ fontStyle: 'italic' }}>
          {r.text}
          {r.isToday && (
            <>
              {' '}
              <Tag tone="accent">Today</Tag>
            </>
          )}
        </span>
      ),
    },
    { key: 'author', header: 'Author', render: (r) => r.author ?? <span className="faint">—</span> },
    { key: 'when', header: 'Shows', render: (r) => (r.scheduledFor ? dayMonthOf(`${r.scheduledFor}T06:30:00Z`) : <span className="faint">Rotation</span>) },
    { key: 'active', header: 'Active', render: (r) => <Check checked={r.active} onChange={(on) => toggle.mutate({ id: r.id, active: on })} label="Active" /> },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setForm({ row: r })}>
            Edit
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDel(r)}>
            Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        <div className="note" style={{ flex: 1, minWidth: 260 }}>
          Everyone sees the same thought on a given day. A quote scheduled for a date wins; otherwise the dashboard rotates through the {pool} active quote{pool === 1 ? '' : 's'} in the pool.
          {today && (
            <>
              {' '}
              Today: <em>“{today.text}”</em>
            </>
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => setForm({ row: null })}>
          Add quote
        </button>
      </div>
      {q.error && <ErrorBlock error={q.error} retry={() => void q.refetch()} />}
      <DataTable columns={cols} rows={q.data} rowKey={(r) => r.id} loading={q.isLoading} empty="No quotes yet — the dashboard falls back to the default set." />
      {form && (
        <FormModal
          title={form.row ? 'Edit quote' : 'Add quote'}
          fields={QUOTE_FIELDS}
          submitLabel={form.row ? 'Save' : 'Add quote'}
          initial={form.row ? { text: form.row.text, author: form.row.author ?? '', scheduledFor: form.row.scheduledFor ?? '', active: form.row.active } : { active: true }}
          onSubmit={(v) => save.mutateAsync({ id: form.row?.id, body: { text: String(v.text ?? ''), author: v.author || null, scheduledFor: v.scheduledFor || null, active: !!v.active } })}
          onClose={() => setForm(null)}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Delete this quote?"
          body={`“${del.text}”`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onClose={() => setDel(null)}
          onConfirm={() => {
            remove.mutate(del.id);
            setDel(null);
          }}
        />
      )}
    </div>
  );
}
