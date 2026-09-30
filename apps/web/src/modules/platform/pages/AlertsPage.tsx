import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { alertCategory, alertWhenLabel, type AlertDto, type AlertTab } from '@lexisora/shared';
import { ErrorBlock, PageHeader, Tabs } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { alertsApi, useAlerts } from '../api';
import '../platform.css';

function upcomingLast(list: AlertDto[], now = Date.now()): AlertDto[] {
  const t = (a: AlertDto) => new Date(a.createdAt).getTime();
  const past = list.filter((a) => t(a) <= now).sort((a, b) => t(b) - t(a));
  const future = list.filter((a) => t(a) > now).sort((a, b) => t(a) - t(b));
  return [...past, ...future];
}

/** Alerts (wireframe GEN "notif"): Alert / From / When, backed by core /notifications. */
export default function AlertsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toastError } = useToast();
  const alerts = useAlerts();
  const [tab, setTab] = useState<AlertTab>('all');
  const readAll = useAction(() => alertsApi.readAll(), { success: 'All alerts marked as read', invalidate: [['notifications']] });

  // Newest first; alerts dated in the future (upcoming birthdays, events) follow, soonest first.
  const rows = useMemo(() => upcomingLast(alerts.data ?? []), [alerts.data]);
  const cat = useMemo(() => new Map(rows.map((a) => [a.id, alertCategory(a.type, a.link, a.title)])), [rows]);
  const counts = {
    all: rows.length,
    unread: rows.filter((a) => !a.readAt).length,
    approvals: rows.filter((a) => cat.get(a.id) === 'approval').length,
    reminders: rows.filter((a) => cat.get(a.id) === 'reminder').length,
  };
  const shown = rows.filter((a) =>
    tab === 'all' ? true : tab === 'unread' ? !a.readAt : tab === 'approvals' ? cat.get(a.id) === 'approval' : cat.get(a.id) === 'reminder',
  );

  async function open(a: AlertDto) {
    if (!a.readAt) {
      try {
        await alertsApi.read(a.id);
      } catch (e) {
        toastError(e);
      }
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (a.link) nav(a.link);
  }

  const columns: Column<AlertDto>[] = [
    {
      key: 'alert',
      header: 'Alert',
      render: (a) => (
        <div>
          <div className={`pf-alert-title${a.readAt ? '' : ' unread'}`}>
            {!a.readAt && <span className="pf-dot" aria-label="Unread" />}
            <span>{a.title}</span>
          </div>
          {a.body && a.body !== a.title && <div className="pf-alert-body">{a.body}</div>}
        </div>
      ),
    },
    { key: 'from', header: 'From', width: '140px', render: (a) => a.fromLabel },
    { key: 'when', header: 'When', width: '120px', render: (a) => <span className="tnum">{alertWhenLabel(a.createdAt)}</span> },
  ];

  const emptyCopy: Record<AlertTab, string> = {
    all: 'You’re all caught up. New reminders and approvals will appear here.',
    unread: 'No unread alerts.',
    approvals: 'Nothing is waiting for your approval.',
    reminders: 'No reminders right now.',
  };

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties} data-screen-label="Alerts">
      <PageHeader
        title="Alerts"
        sub="Reminders and approvals that need your attention."
        actions={
          <button className="btn btn-secondary" disabled={!counts.unread || readAll.isPending} onClick={() => readAll.mutate(undefined)}>
            Mark all read
          </button>
        }
      />
      <Tabs<AlertTab>
        tabs={[
          { value: 'all', label: `All · ${counts.all}` },
          { value: 'unread', label: `Unread · ${counts.unread}` },
          { value: 'approvals', label: `Approvals · ${counts.approvals}` },
          { value: 'reminders', label: `Reminders · ${counts.reminders}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {alerts.error ? (
        <ErrorBlock error={alerts.error} retry={() => void alerts.refetch()} />
      ) : (
        <DataTable columns={columns} rows={alerts.data ? shown : undefined} rowKey={(a) => a.id} loading={alerts.isLoading} onRowClick={(a) => void open(a)} empty={emptyCopy[tab]} />
      )}
      {rows.length >= 50 && <div className="faint" style={{ fontSize: 12 }}>Showing your 50 most recent alerts.</div>}
    </div>
  );
}
