import type { Simulation, ViewState } from '@tracker-shared/ipc';
import { run } from '../bridge';

/**
 * Development builds only (!app.isPackaged): the wireframe's "Prototype controls" — simulate
 * what the real app detects on its own. Main refuses `simulate` in packaged builds anyway.
 */
export function DevPanel({ s, onClose }: { s: ViewState; onClose: () => void }) {
  const threshold = /^(\d+) min/.exec(s.settings.find((r) => r.key === 'idle')?.value ?? '')?.[1] ?? '5';
  const sim = (kind: Simulation) => void run({ type: 'simulate', kind });
  return (
    <aside className="tw-devpanel" aria-label="Prototype controls">
      <div className="tw-row-between">
        <div>
          <div className="tw-kicker-accent">Prototype controls</div>
          <div className="tw-h3">Windows tracker</div>
        </div>
        <button type="button" className="tw-x" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="tw-muted-12 tw-justify">Simulate events the real app detects on its own. Development builds only.</p>
      <div className="tw-dev-grid">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('idle')}>
          Trigger {threshold}-min idle
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('screenshot')}>
          Capture screenshot
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('offline')}>
          {s.online ? 'Go offline' : 'Reconnect (sync queue)'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run({ type: 'widget', action: 'toggle' })}>
          Toggle tray widget
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('lock')}>
          Lock screen gap
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('appGap')}>
          App not running gap
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => sim('breakReminder')}>
          Break reminder
        </button>
        <button type="button" className="btn btn-secondary btn-sm" title="Sets the PC clock back 2 h, or restores it" onClick={() => sim('clock')}>
          PC clock −2 h / restore
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run({ type: 'sync.force' })}>
          Force sync
        </button>
      </div>
      <div className="tw-dev-meta tw-muted-11">
        {s.serverUrl} · {s.online ? 'online' : 'offline'} · queue {s.queued}
        {s.syncing ? ' · syncing…' : ''}
      </div>
      <div className="tw-kicker">Event log</div>
      <div className="tw-dev-log">
        {s.log.length ? (
          s.log.map((l, i) => (
            <div key={i} className="tw-dev-log-row">
              <span className="tw-tnum tw-muted">{l.t}</span>
              <span>{l.m}</span>
            </div>
          ))
        ) : (
          <div className="tw-muted-12">Nothing yet</div>
        )}
      </div>
    </aside>
  );
}
