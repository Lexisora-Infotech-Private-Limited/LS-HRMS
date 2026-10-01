import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { BadgeRow, EotmRow, KudosRow, KudosTab } from '@lexisora/shared';
import { download } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, ErrorBlock, Kpis, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FormModal, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { dayMonthOf, wpApi, wpKeys } from '../api';
import '../workplace.css';

type PageTab = KudosTab | 'eotm' | 'badges';
const PAGE_SIZE = 25;

/** Kudos & Employee of the Month — GEN.kudos + FORMS.kudos / FORMS.eotm (spec §4). */
export default function KudosPage() {
  const can = useCan();
  const me = useMe();
  const { toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as PageTab) || 'all';
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<'kudos' | 'eotm' | null>(params.get('give') === '1' ? 'kudos' : null);
  const [revoke, setRevoke] = useState<KudosRow | null>(null);
  const canGive = can('kudos.give');
  const canEotm = can('kudos.eotm');

  useEffect(() => {
    if (params.get('give') === '1' && canGive) setForm('kudos');
  }, [params, canGive]);

  const setTab = (t: PageTab) => {
    setPage(1);
    setParams({ tab: t });
  };

  const listTab: KudosTab = tab === 'given' || tab === 'received' ? tab : 'all';
  const list = useQuery({ queryKey: wpKeys.kudosList(listTab, page), queryFn: () => wpApi.kudos({ tab: listTab, page, pageSize: PAGE_SIZE }) });
  const counts = list.data?.counts;
  const kpis = list.data?.kpis;

  const tabs: { value: PageTab; label: string }[] = [
    { value: 'all', label: `All${counts ? ` · ${counts.all}` : ''}` },
    { value: 'given', label: `Given by me${counts ? ` · ${counts.given}` : ''}` },
    { value: 'received', label: `Received${counts ? ` · ${counts.received}` : ''}` },
    { value: 'eotm', label: 'Employee of the Month' },
    ...(canEotm ? [{ value: 'badges' as const, label: 'Badges' }] : []),
  ];

  const cols: Column<KudosRow>[] = [
    { key: 'emp', header: 'Employee', render: (r) => r.employee },
    { key: 'badge', header: 'Badge', render: (r) => <Tag tone="accent">{r.badge}</Tag> },
    { key: 'from', header: 'From', render: (r) => r.from },
    { key: 'msg', header: 'Message', render: (r) => <span className="wp-cell-wrap">{r.message}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="tnum">{r.date}</span> },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 10, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {r.certificateId && (
            <button className="wp-link" onClick={() => void download(wpApi.certificatePdfPath(r.certificateId!)).catch(toastError)}>
              Certificate
            </button>
          )}
          {r.canRevoke && (
            <button className="wp-link" onClick={() => setRevoke(r)}>
              Withdraw
            </button>
          )}
        </span>
      ),
    },
  ];

  const revokeAction = useAction((r: KudosRow) => wpApi.revokeKudos(r.id), { success: 'Kudos withdrawn', invalidate: [wpKeys.kudos, wpKeys.feed], onSuccess: () => setRevoke(null) });

  return (
    <div data-screen-label="Kudos & Employee of the Month" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Kudos & Employee of the Month"
        sub="Managers award badges; EOTM is announced on the feed with a verifiable certificate."
        actions={
          <>
            {canEotm && (
              <button className="btn btn-secondary" onClick={() => setForm('eotm')}>
                Announce EOTM
              </button>
            )}
            {canGive && (
              <button className="btn btn-primary" onClick={() => setForm('kudos')}>
                Give kudos
              </button>
            )}
          </>
        }
      />
      {kpis && (
        <Kpis
          items={[
            { label: 'Kudos this month', value: kpis.thisMonth },
            { label: 'Top badge', value: kpis.topBadge ?? '—', sub: kpis.topBadge ? `${kpis.topBadgeCount} this month` : 'No kudos yet this month' },
            { label: 'Employee of the month', value: kpis.eotm?.name ?? '—', sub: kpis.eotm?.month ?? 'Not announced yet' },
          ]}
        />
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {(tab === 'all' || tab === 'given' || tab === 'received') && (
        <>
          {list.error && <ErrorBlock error={list.error} retry={() => void list.refetch()} />}
          <DataTable
            columns={cols}
            rows={list.data?.items}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            empty={tab === 'given' ? 'You haven’t given kudos yet.' : tab === 'received' ? 'No kudos received yet — they’ll show up here.' : 'No kudos yet.'}
          />
          {list.data && list.data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
        </>
      )}
      {tab === 'eotm' && <EotmHistory canManage={canEotm} />}
      {tab === 'badges' && canEotm && <BadgesTab />}

      {form === 'kudos' && (
        <GiveKudosForm
          meId={me.employeeId}
          onClose={() => {
            setForm(null);
            if (params.get('give')) setParams({ tab });
          }}
        />
      )}
      {form === 'eotm' && <AnnounceEotmForm onClose={() => setForm(null)} />}
      {revoke && (
        <ConfirmDialog
          title="Withdraw these kudos?"
          body={`The ${revoke.badge} badge for ${revoke.employee} and its feed post will be removed.`}
          confirmLabel="Withdraw"
          danger
          busy={revokeAction.isPending}
          onConfirm={() => revokeAction.mutate(revoke)}
          onClose={() => setRevoke(null)}
        />
      )}
    </div>
  );
}

const nameOnly = (label: string) => label.split(' · ')[0] ?? label;

function GiveKudosForm({ meId, onClose }: { meId: string | null; onClose: () => void }) {
  const lk = useLookups(['employees']);
  const badges = useQuery({ queryKey: wpKeys.badges, queryFn: wpApi.badges });
  const give = useAction((v: Record<string, any>) => wpApi.giveKudos({ recipientEmployeeId: v.employee, badgeId: v.badge, message: v.message }), {
    success: 'Kudos posted to feed',
    invalidate: [wpKeys.kudos, wpKeys.feed],
  });
  const people = opts(lk.data, 'employees')
    .filter((o) => o.value !== meId)
    .map((o) => ({ value: o.value, label: nameOnly(o.label) }));
  const badgeOpts = (badges.data ?? []).filter((b) => b.active && !b.system).map((b) => ({ value: b.id, label: b.name }));
  if (!lk.data || !badges.data) return null;
  const fields: FieldDef[] = [
    { name: 'employee', label: 'Employee', type: 'select', required: true, options: people },
    { name: 'badge', label: 'Badge', type: 'select', required: true, options: badgeOpts },
    { name: 'message', label: 'Message', type: 'area', required: true, span: 2, placeholder: 'What did they do? (at least 10 characters)' },
  ];
  return <FormModal title="Give kudos" fields={fields} submitLabel="Send kudos" onClose={onClose} onSubmit={(v) => give.mutateAsync(v)} />;
}

function AnnounceEotmForm({ onClose }: { onClose: () => void }) {
  const lk = useLookups(['employees']);
  const options = useQuery({ queryKey: [...wpKeys.eotm, 'options'], queryFn: wpApi.eotmOptions });
  const announce = useAction((v: Record<string, any>) => wpApi.announceEotm({ employeeId: v.employee, month: v.month, citation: v.citation }), {
    success: 'Posted to feed · certificate issued',
    invalidate: [wpKeys.kudos, wpKeys.feed],
  });
  if (!lk.data || !options.data) return null;
  const free = options.data.months.filter((m) => !m.taken);
  const taken = options.data.months.filter((m) => m.taken);
  const fields: FieldDef[] = [
    { name: 'employee', label: 'Employee', type: 'select', required: true, options: opts(lk.data, 'employees').map((o) => ({ value: o.value, label: nameOnly(o.label) })) },
    {
      name: 'month',
      label: 'Month',
      type: 'select',
      required: true,
      options: free.map((m) => ({ value: m.value, label: m.label })),
      hint: taken.length ? `Already announced: ${taken.map((m) => m.label).join(', ')}` : undefined,
    },
    { name: 'citation', label: 'Citation', type: 'area', required: true, span: 2, placeholder: 'Why they earned it (at least 20 characters) — shown on the feed and the certificate' },
  ];
  if (!free.length) {
    return (
      <FormModal
        title="Announce Employee of the Month"
        fields={[]}
        submitLabel="Close"
        intro={<p className="faint">Employee of the Month has already been announced for {taken.map((m) => m.label).join(', ')}.</p>}
        onClose={onClose}
        onSubmit={() => undefined}
      />
    );
  }
  return <FormModal title="Announce Employee of the Month" fields={fields} submitLabel="Announce & issue certificate" onClose={onClose} onSubmit={(v) => announce.mutateAsync(v)} />;
}

function EotmHistory({ canManage }: { canManage: boolean }) {
  const { toastError } = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...wpKeys.eotm, 'list'], queryFn: wpApi.eotmList });
  const [revoke, setRevoke] = useState<EotmRow | null>(null);
  const [reason, setReason] = useState('');
  const doRevoke = useAction((r: EotmRow) => wpApi.revokeEotm(r.id, reason.trim()), {
    success: 'Award revoked · certificate revoked',
    invalidate: [wpKeys.kudos, wpKeys.feed],
    onSuccess: () => {
      setRevoke(null);
      setReason('');
    },
  });
  const cols: Column<EotmRow>[] = [
    { key: 'm', header: 'Month', render: (r) => r.monthLabel },
    { key: 'n', header: 'Employee', render: (r) => r.name },
    { key: 'c', header: 'Citation', render: (r) => <span className="wp-cell-wrap">{r.citation}</span> },
    { key: 'b', header: 'Announced by', render: (r) => `${r.announcedBy} · ${dayMonthOf(r.announcedAt)}` },
    {
      key: 's',
      header: 'Certificate',
      render: (r) =>
        r.revoked ? (
          <Tag tone="danger">Revoked</Tag>
        ) : r.certificateId ? (
          <button className="wp-link" onClick={() => void download(wpApi.certificatePdfPath(r.certificateId!)).catch(toastError)}>
            Download
          </button>
        ) : (
          <span className="faint">—</span>
        ),
    },
    ...(canManage
      ? [
          {
            key: 'x',
            header: '',
            render: (r: EotmRow) =>
              !r.revoked && (
                <button className="wp-link" onClick={() => setRevoke(r)}>
                  Revoke
                </button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      {error && <ErrorBlock error={error} retry={() => void refetch()} />}
      <DataTable columns={cols} rows={data} rowKey={(r) => r.id} loading={isLoading} empty="No Employee of the Month announced yet." />
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>
        Certificates carry a QR code and a verification code that anyone can check without signing in. See the announcement on the <Link to="/feed">company feed</Link>.
      </p>
      {revoke && (
        <ConfirmDialog
          title={`Revoke ${revoke.monthLabel} for ${revoke.name}?`}
          body={
            <div className="stack" style={{ gap: 8 }}>
              <span>The feed post is archived and the certificate shows as revoked on the verification page.</span>
              <input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          }
          confirmLabel="Revoke award"
          danger
          busy={doRevoke.isPending}
          onConfirm={() => (reason.trim().length >= 3 ? doRevoke.mutate(revoke) : toastError(new Error('Give a reason (at least 3 characters)')))}
          onClose={() => setRevoke(null)}
        />
      )}
    </>
  );
}

function BadgesTab() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.badges, queryFn: wpApi.badges });
  const [edit, setEdit] = useState<BadgeRow | 'new' | null>(null);
  const save = useAction(
    (v: { id: string | null; name: string; description: string | null; active: boolean; icon: string }) =>
      v.id ? wpApi.updateBadge(v.id, { name: v.name, description: v.description, active: v.active, icon: v.icon }) : wpApi.createBadge({ name: v.name, description: v.description, active: v.active, icon: v.icon }),
    { success: (_r, v) => (v.id ? 'Badge updated' : 'Badge added'), invalidate: [wpKeys.badges] },
  );
  const toggle = useAction((b: BadgeRow) => wpApi.updateBadge(b.id, { name: b.name, description: b.description, active: !b.active, icon: b.icon }), {
    success: (_r, b) => (b.active ? 'Badge deactivated' : 'Badge activated'),
    invalidate: [wpKeys.badges],
  });
  const cols = useMemo<Column<BadgeRow>[]>(
    () => [
      { key: 'n', header: 'Badge', render: (b) => <Tag tone="accent">{b.name}</Tag> },
      { key: 'd', header: 'Description', render: (b) => b.description ?? <span className="faint">—</span> },
      { key: 'u', header: 'Given', num: true, render: (b) => b.uses },
      { key: 's', header: 'Status', render: (b) => (b.system ? <Tag tone="neutral">System</Tag> : b.active ? <Tag tone="accent">Active</Tag> : <Tag tone="neutral">Inactive</Tag>) },
      {
        key: 'a',
        header: '',
        render: (b) =>
          !b.system && (
            <span className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <button className="wp-link" onClick={() => setEdit(b)}>
                Edit
              </button>
              <button className="wp-link" onClick={() => toggle.mutate(b)}>
                {b.active ? 'Deactivate' : 'Activate'}
              </button>
            </span>
          ),
      },
    ],
    [toggle],
  );
  return (
    <>
      <div className="row-between">
        <span className="faint" style={{ fontSize: 13 }}>
          Badges in use can’t be deleted — deactivate them to hide them from the Give kudos form.
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => setEdit('new')}>
          Add badge
        </button>
      </div>
      {error && <ErrorBlock error={error} retry={() => void refetch()} />}
      <DataTable columns={cols} rows={data} rowKey={(b) => b.id} loading={isLoading} />
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add badge' : 'Edit badge'}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'icon', label: 'Icon', type: 'select', options: ['star', 'bug', 'people', 'rocket', 'heart', 'bolt'].map((x) => ({ value: x, label: x })) },
            { name: 'description', label: 'Description', type: 'area', span: 2 },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          initial={edit === 'new' ? { active: true, icon: 'star' } : { name: edit.name, icon: edit.icon, description: edit.description, active: edit.active }}
          submitLabel="Save"
          onClose={() => setEdit(null)}
          onSubmit={(v) => save.mutateAsync({ id: edit === 'new' ? null : edit.id, name: v.name, description: v.description ?? null, active: !!v.active, icon: v.icon || 'star' })}
        />
      )}
    </>
  );
}
