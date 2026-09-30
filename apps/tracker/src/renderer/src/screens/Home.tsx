import { useMemo, useState } from 'react';
import { HR_POLICY_FOOTNOTE } from '@tracker-shared/copy';
import type { SettingsRow, TimelineBar, TrackerTab, ViewState } from '@tracker-shared/ipc';
import { CONFIRM_CODES, run } from '../bridge';
import { ConfirmDialog, UnpairOfflineDialog } from './Dialogs';

const TABS: [TrackerTab, string][] = [
  ['track', 'Tracker'],
  ['summary', 'Daily summary'],
  ['settings', 'Settings'],
];

/** Home: Tracker | Daily summary | Settings (wireframe tabs). */
export function Home({ s }: { s: ViewState }) {
  return (
    <>
      <div className="tw-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={s.tab === key}
            className={`tw-tab${s.tab === key ? ' is-active' : ''}`}
            onClick={() => void run({ type: 'tab', tab: key })}
          >
            {label}
            {key === 'settings' && s.update && <span className="tw-badge" title={`Update v${s.update.version} available`} />}
          </button>
        ))}
      </div>
      {s.tab === 'track' && <TrackerTabView s={s} />}
      {s.tab === 'summary' && <SummaryTab s={s} />}
      {s.tab === 'settings' && <SettingsTab s={s} />}
    </>
  );
}

// ── Tracker tab ──────────────────────────────────────────────────────────
function TrackerTabView({ s }: { s: ViewState }) {
  const out = s.status === 'OUT';
  return (
    <div className="tw-pane tw-track" role="tabpanel" data-screen-label="Tracker">
      <div className="tw-row-between">
        <span className={`tag ${s.statusTone}`}>{s.statusLabel}</span>
        <span className="tw-muted-12">{s.shiftLabel}</span>
      </div>
      <div className="tw-timer">
        <div className="tw-big-timer">{s.worked}</div>
        <div className="tw-muted-12">
          worked today · break {s.breakTime} · idle {s.idleTime}
        </div>
      </div>
      {out ? <PunchedOut s={s} /> : <PunchedIn s={s} />}
    </div>
  );
}

function PunchedOut({ s }: { s: ViewState }) {
  if (s.mode === 'MONITOR_ONLY') {
    return (
      <div className="tw-card tw-monitor">
        <div className="tw-kicker">Monitor only · HR policy</div>
        <div className="tw-13">{s.monitorNote}</div>
        <div className="tw-muted-12">Tracking starts on its own after your biometric IN.</div>
      </div>
    );
  }
  if (s.serverSession) {
    return (
      <>
        <div className="tw-card tw-session">
          <div className="tw-13">{s.serverSession.label}</div>
          <div className="tw-muted-12">Your day is already open — track it here without punching again.</div>
        </div>
        <button type="button" className="btn btn-primary tw-punch" onClick={() => void run({ type: 'attach' })}>
          {s.serverSession.action}
        </button>
        <div className="tw-helper">{s.punch.helper}</div>
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-primary tw-punch" disabled={!!s.punch.blocked || s.punch.busy} onClick={() => void run({ type: 'punchIn' })}>
        {s.punch.busy ? 'Punching in…' : 'Punch in'}
      </button>
      {s.punch.blocked ? (
        <div className="tw-helper is-warn" role="alert">
          {s.punch.blocked}
        </div>
      ) : (
        <div className="tw-helper">{s.punch.helper}</div>
      )}
    </>
  );
}

function PunchedIn({ s }: { s: ViewState }) {
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const tasks = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!s.showTaskSearch || !needle) return s.tasks;
    return s.tasks.filter((t) => `${t.key} ${t.title} ${t.projectName}`.toLowerCase().includes(needle));
  }, [q, s.tasks, s.showTaskSearch]);
  const idle = !!s.idle;

  const punchOut = async () => {
    const r = await run({ type: 'punchOut' });
    if (!r.ok && r.code === CONFIRM_CODES.earlyPunchOut) setConfirm(r.error);
  };

  return (
    <>
      <div className="field tw-working-on">
        <label>Working on</label>
        {s.showTaskSearch && (
          <input className="input tw-search" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        )}
        <div className="tw-tasklist" role="listbox" aria-label="Working on">
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.active}
              title={t.projectName}
              disabled={idle}
              className={`tw-taskrow${t.active ? ' is-active' : ''}`}
              onClick={() => {
                if (!t.active) void run({ type: 'task.switch', taskId: t.id });
              }}
            >
              <span className="tw-taskname">
                <span className="tw-taskkey">{t.key}</span> {t.title}
              </span>
              <span className="tw-tnum tw-12">{t.time}</span>
            </button>
          ))}
          {!tasks.length && <div className="tw-empty">{q ? 'No matching tasks' : 'No tasks assigned to you yet · ask your Project Lead'}</div>}
        </div>
      </div>
      {s.mode === 'PUNCH' ? (
        <div className="tw-grid-2">
          <button type="button" className="btn btn-secondary" disabled={idle} onClick={() => void run({ type: 'break.toggle' })}>
            {s.status === 'BREAK' ? 'End break' : 'Start break'}
          </button>
          <button type="button" className="btn btn-primary" disabled={idle || s.punch.busy} onClick={() => void punchOut()}>
            Punch out
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" disabled={idle} onClick={() => void run({ type: 'break.toggle' })}>
            {s.status === 'BREAK' ? 'End break' : 'Start break'}
          </button>
          <div className="tw-helper">Punch out with biometric — tracking stops on its own.</div>
        </>
      )}
      <div className="tw-footer-line">
        <span>{s.nextShot ?? ''}</span>
        <span>{s.lastInput}</span>
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm}
          body="Your shift hasn't ended yet. Punching out closes your day on this device and shows the daily summary."
          confirmLabel="Punch out"
          cancelLabel="Keep working"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await run({ type: 'punchOut', confirmed: true });
          }}
        />
      )}
    </>
  );
}

// ── Daily summary tab ────────────────────────────────────────────────────
function SummaryTab({ s }: { s: ViewState }) {
  const sum = s.summary;
  return (
    <div className="tw-pane tw-summary" role="tabpanel" data-screen-label="Daily summary">
      <div className="tw-h2">{sum.title}</div>
      <div className="tw-kpis">
        <Kpi value={s.worked} label="Worked" />
        <Kpi value={s.breakTime} label="Break" />
        <Kpi value={s.idleTime} label="Idle" />
      </div>
      <Timeline bars={sum.timeline} />
      <div className="tw-kicker">By task</div>
      <div className="tw-bytask">
        {sum.byTask.length ? (
          sum.byTask.map((t, i) => (
            <div key={`${t.key}-${i}`} className="tw-bytask-row">
              <span>
                {t.key} {t.title}
              </span>
              <span className="tw-tnum">{t.time}</span>
            </div>
          ))
        ) : (
          <div className="tw-empty-line">No task time yet today</div>
        )}
      </div>
      <div className="tw-row-between tw-125">
        <span>Screenshots captured</span>
        <span className="tw-tnum">{sum.screenshots}</span>
      </div>
      <div className="tw-summary-actions">
        {sum.confirmedAt && <div className="tw-muted-12 tw-center">{sum.confirmedAt}</div>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!sum.canConfirm || s.syncing}
          title={sum.confirmHint ?? (sum.canConfirm ? undefined : 'Track some time first')}
          onClick={() => void run({ type: 'sync.force' })}
        >
          {s.syncing ? 'Syncing…' : 'Add to weekly timesheet'}
        </button>
        {sum.confirmHint && <div className="tw-muted-11 tw-center">{sum.confirmHint}</div>}
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="tw-kpi">
      <div className="tw-kpi-num">{value}</div>
      {label}
    </div>
  );
}

const BAR_CLASS: Record<TimelineBar['kind'], string> = {
  WORK: 'is-work',
  IDLE_WORK: 'is-claimed',
  BREAK: 'is-break',
  IDLE: 'is-idle',
  GAP: 'is-gap',
};

/** 18 px bar from the first punch-in to now / last punch-out; hover shows "09:28–11:00 Active · AT-101". */
function Timeline({ bars }: { bars: TimelineBar[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const label = hover !== null ? bars[hover]?.label : null;
  return (
    <div className="tw-timeline-wrap">
      <div className="tw-timeline" onMouseLeave={() => setHover(null)} role="img" aria-label="Today's timeline">
        {bars.map((b, i) => (
          <div
            key={i}
            className={`tw-bar ${BAR_CLASS[b.kind]}${hover === i ? ' is-hover' : ''}`}
            style={{ flex: `${Math.max(b.flex, 1)} 1 0` }}
            title={b.label}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </div>
      <div className="tw-timeline-label">
        {label ?? (bars.length ? (
          <span className="tw-legend">
            <i className="is-work" /> Active <i className="is-claimed" /> Claimed <i className="is-break" /> Break <i className="is-idle" /> Idle
          </span>
        ) : (
          'No tracked time yet today'
        ))}
      </div>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────
type UnpairDialog = null | { kind: 'punchOut' } | { kind: 'offline'; message: string };

function SettingsTab({ s }: { s: ViewState }) {
  const [dialog, setDialog] = useState<UnpairDialog>(null);

  const signOut = async (opts: { confirmed?: boolean; discard?: 'UNPAIR' } = {}) => {
    setDialog(null);
    const r = await run({ type: 'signOut', ...opts });
    if (r.ok) return;
    if (r.code === CONFIRM_CODES.unpairPunchOut) setDialog({ kind: 'punchOut' });
    else if (r.code === CONFIRM_CODES.unpairOffline) setDialog({ kind: 'offline', message: r.error });
  };

  return (
    <div className="tw-pane tw-settings" role="tabpanel" data-screen-label="Settings">
      {s.settings.map((row) => (
        <SettingRow key={row.key} row={row} s={s} />
      ))}
      <div className="tw-footnote">{HR_POLICY_FOOTNOTE}</div>
      <div className="tw-row-between tw-settings-links">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run({ type: 'update.check' })}>
          Check for updates
        </button>
        <span className="tw-muted-11">{s.lastSyncAt ? `Last synced ${s.lastSyncAt}` : s.queued ? `${s.queued} waiting to sync` : ''}</span>
      </div>
      <button type="button" className="btn btn-secondary tw-signout" disabled={s.unpair.busy} onClick={() => void signOut()}>
        {s.unpair.progress ?? 'Sign out & unpair'}
      </button>
      {dialog?.kind === 'punchOut' && (
        <ConfirmDialog
          title="Punch out and unpair?"
          body="You're punched in on this device. Punching out closes today's session, syncs your time and then unpairs this device."
          confirmLabel="Punch out & unpair"
          onCancel={() => setDialog(null)}
          onConfirm={() => void signOut({ confirmed: true })}
        />
      )}
      {dialog?.kind === 'offline' && (
        <UnpairOfflineDialog message={dialog.message} onCancel={() => setDialog(null)} onDiscard={() => void signOut({ confirmed: true, discard: 'UNPAIR' })} />
      )}
    </div>
  );
}

function SettingRow({ row, s }: { row: SettingsRow; s: ViewState }) {
  const body = (
    <>
      <span className="tw-setting-text">
        <span>{row.label}</span>
        <span className="tw-muted-115">{row.note}</span>
      </span>
      <span className={`tag ${row.tone}`}>{row.value}</span>
    </>
  );
  const toggle = row.toggle;
  if (toggle && !row.disabled) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={s.prefs[toggle]}
        className="tw-setting is-clickable"
        onClick={() => void run({ type: 'pref.set', key: toggle, value: !s.prefs[toggle] })}
      >
        {body}
      </button>
    );
  }
  if (row.action) {
    const action = row.action;
    return (
      <button type="button" className="tw-setting is-clickable" title={row.hint} onClick={() => void run(action === 'copyDiagnostics' ? { type: 'copyDiagnostics' } : { type: 'update.open' })}>
        {body}
      </button>
    );
  }
  return <div className={`tw-setting${row.disabled ? ' is-disabled' : ''}`}>{body}</div>;
}
