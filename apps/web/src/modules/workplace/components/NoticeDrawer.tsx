import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoticeDetail } from '@lexisora/shared';
import { fileUrl } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { Avatar, ConfirmDialog, ErrorBlock, Loading, Tabs, Tag } from '@/components/ui';
import { dayMonthOf, dayMonthTime, fileSize, wpApi, wpKeys } from '../api';
import { SafeHtml } from './RichText';

const LIVE = ['PUBLISHED', 'EXPIRED'];

export function statusLabel(n: Pick<NoticeDetail, 'status' | 'publishAt'>): string {
  switch (n.status) {
    case 'DRAFT':
      return 'Draft';
    case 'SCHEDULED':
      return `Scheduled · ${dayMonthTime(n.publishAt)}`;
    case 'EXPIRED':
      return 'Expired';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return 'Published';
  }
}

/** Notice detail drawer: full body, attachments, author; opening it marks the notice read. */
export function NoticeDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit?: (n: NoticeDetail) => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: n, isLoading, error, refetch } = useQuery({ queryKey: wpKeys.notice(id), queryFn: () => wpApi.notice(id) });
  const marked = useRef<string | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !confirm && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, confirm]);

  useEffect(() => {
    if (!n || marked.current === n.id) return;
    marked.current = n.id;
    if (LIVE.includes(n.status) && n.myRead === false) {
      wpApi
        .readNotice(n.id)
        .then(() => {
          void qc.invalidateQueries({ queryKey: wpKeys.notices });
          void qc.invalidateQueries({ queryKey: wpKeys.dashboard });
        })
        .catch(() => undefined);
    }
  }, [n, qc]);

  const inv = [wpKeys.notices, wpKeys.dashboard];
  const publish = useAction(() => wpApi.publishNotice(id, true), { success: (r) => (r.status === 'SCHEDULED' ? 'Notice scheduled' : 'Notice published'), invalidate: inv });
  const unschedule = useAction(() => wpApi.unscheduleNotice(id), { success: 'Moved back to drafts', invalidate: inv });
  const archive = useAction(() => wpApi.archiveNotice(id), { success: 'Notice archived', invalidate: inv, onSuccess: onClose });
  const remove = useAction(() => wpApi.deleteNotice(id), { success: 'Draft deleted', invalidate: inv, onSuccess: onClose });
  const pin = useAction((on: boolean) => wpApi.pinNotice(id, on), { success: (_r, on) => (on ? 'Pinned to top' : 'Unpinned'), invalidate: inv });

  const live = !!n && LIVE.includes(n.status);
  const draft = !!n && (n.status === 'DRAFT' || n.status === 'SCHEDULED');

  return (
    <div className="wp-drawer-backdrop" onMouseDown={onClose}>
      <aside className="wp-drawer" role="dialog" aria-modal aria-label="Notice" onMouseDown={(e) => e.stopPropagation()} data-screen-label="Notice detail">
        {isLoading && <Loading />}
        {error && <ErrorBlock error={error} retry={() => void refetch()} />}
        {n && (
          <>
            <div className="wp-drawer-head">
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Tag tone={n.visibility === 'GLOBAL' ? 'accent' : 'outline'}>{n.visibility === 'GLOBAL' ? 'Global' : 'Team'}</Tag>
                  {n.pinned && <Tag tone="neutral">Pinned</Tag>}
                  {n.status !== 'PUBLISHED' && <Tag tone={n.status === 'EXPIRED' || n.status === 'ARCHIVED' ? 'neutral' : 'outline'}>{statusLabel(n)}</Tag>}
                </div>
                <h3>{n.title}</h3>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {n.audienceLabel} · {n.publishedAt ? dayMonthOf(n.publishedAt) : statusLabel(n)}
                  {n.editedAt ? ` · edited ${dayMonthOf(n.editedAt)}` : ''}
                  {n.expiresAt ? ` · until ${dayMonthTime(n.expiresAt)}` : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <Avatar name={n.authorName} size={30} />
              <div style={{ fontSize: 13 }}>
                <div>{n.authorName}</div>
                {n.authorTitle && <div className="faint">{n.authorTitle}</div>}
              </div>
            </div>
            {n.bodyHtml ? <SafeHtml html={n.bodyHtml} /> : <div className="faint">No message — see the attachment.</div>}
            {n.attachments.length > 0 && (
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Attachments
                </div>
                {n.attachments.map((a) => (
                  <div key={a.fileId} className="wp-attach">
                    <span>
                      {a.name} <span className="faint">· {fileSize(a.sizeBytes)}</span>
                    </span>
                    <a className="btn btn-ghost btn-sm" href={fileUrl(a.fileId)} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </div>
                ))}
              </div>
            )}
            {n.canManage && (
              <div className="row" style={{ gap: 8 }}>
                {n.status !== 'ARCHIVED' && onEdit && (
                  <button className="btn btn-secondary btn-sm" onClick={() => onEdit(n)}>
                    Edit
                  </button>
                )}
                {draft && (
                  <button className="btn btn-primary btn-sm" disabled={publish.isPending} onClick={() => publish.mutate(undefined)}>
                    Publish now
                  </button>
                )}
                {n.status === 'SCHEDULED' && (
                  <button className="btn btn-secondary btn-sm" disabled={unschedule.isPending} onClick={() => unschedule.mutate(undefined)}>
                    Unschedule
                  </button>
                )}
                {n.status === 'PUBLISHED' && can('notices.publish.global') && (
                  <button className="btn btn-secondary btn-sm" disabled={pin.isPending} onClick={() => pin.mutate(!n.pinned)}>
                    {n.pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                )}
                {live && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('archive')}>
                    Archive
                  </button>
                )}
                {draft && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('delete')}>
                    Delete draft
                  </button>
                )}
              </div>
            )}
            {n.canManage && live && <Receipts id={n.id} />}
          </>
        )}
      </aside>
      {confirm && n && (
        <ConfirmDialog
          title={confirm === 'archive' ? 'Archive this notice?' : 'Delete this draft?'}
          body={confirm === 'archive' ? 'It will be hidden from the notice board and dashboards. Read receipts are kept.' : 'The draft and its attachments list will be removed.'}
          confirmLabel={confirm === 'archive' ? 'Archive' : 'Delete'}
          danger={confirm === 'delete'}
          busy={archive.isPending || remove.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            if (confirm === 'archive') archive.mutate(undefined);
            else remove.mutate(undefined);
          }}
        />
      )}
    </div>
  );
}

/** Read receipts — "Read 112 / 128", who has / hasn't read, "Remind unread" (24 h throttle). */
function Receipts({ id }: { id: string }) {
  const [tab, setTab] = useState<'read' | 'unread'>('unread');
  const { data, isLoading } = useQuery({ queryKey: wpKeys.receipts(id), queryFn: () => wpApi.receipts(id) });
  const remind = useAction(() => wpApi.remindUnread(id), {
    success: (r) => (r.reminded ? `Reminder sent to ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}` : 'Everyone has read it'),
    invalidate: [wpKeys.receipts(id)],
  });
  if (isLoading || !data) return <Loading />;
  const list = tab === 'read' ? data.read : data.unread;
  return (
    <section className="wp-receipts" aria-label="Read receipts">
      <div className="row-between">
        <div>
          <div className="kicker">Read receipts</div>
          <div className="serif tnum" style={{ fontSize: 26 }}>
            Read {data.readCount} / {data.recipientCount}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" disabled={!data.canRemind || remind.isPending} onClick={() => remind.mutate(undefined)} title={data.canRemind ? undefined : data.lastRemindedAt ? `Last reminder ${dayMonthTime(data.lastRemindedAt)} — once every 24 hours` : 'Everyone has read it'}>
          Remind unread
        </button>
      </div>
      <Tabs
        tabs={[
          { value: 'unread' as const, label: `Not yet read · ${data.unread.length}` },
          { value: 'read' as const, label: `Read · ${data.read.length}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div>
        {list.map((p) => (
          <div key={p.employeeId} className="wp-person">
            <Avatar name={p.name} initials={p.initials} size={26} />
            <span className="grow">
              {p.name}
              {p.department && <span className="faint"> · {p.department}</span>}
              {p.exited && <span className="faint"> · left</span>}
            </span>
            <span className="faint tnum" style={{ fontSize: 12 }}>
              {p.readAt ? dayMonthTime(p.readAt) : ''}
            </span>
          </div>
        ))}
        {!list.length && <div className="faint" style={{ fontSize: 13, padding: '8px 0' }}>{tab === 'read' ? 'Nobody has opened it yet.' : 'Everyone has read it.'}</div>}
      </div>
    </section>
  );
}
