import { useEffect, useState } from 'react';
import type { ShotToast } from '@tracker-shared/ipc';
import { onShot, run, useViewState } from './bridge';

/**
 * Tray widget (wireframe "Tray widget", 260 px, always on top, draggable): status tag, ✕,
 * 36 px timer, active task, Start/End break, Open.
 */
export function WidgetApp() {
  const s = useViewState();
  if (!s) return <div className="tw-widget" />;
  const out = s.status === 'OUT';
  return (
    <div className="tw-widget" data-screen-label="Tray widget">
      <div className="tw-row-between">
        <span className={`tag ${s.statusTone}`}>{s.view === 'home' ? s.statusLabel : 'Not signed in'}</span>
        <button type="button" className="tw-x" title="Close widget" aria-label="Close widget" onClick={() => void run({ type: 'widget', action: 'close' }, { silent: true })}>
          ✕
        </button>
      </div>
      <div className="tw-widget-timer">{s.worked}</div>
      <div className="tw-widget-task">{s.activeTask ? `${s.activeTask.key} · ${s.activeTask.title}` : out ? 'Punch in to start tracking' : 'No task selected'}</div>
      <div className="tw-widget-shot">{s.widget.lastShot ?? (s.nextShot && !out ? s.nextShot : '')}</div>
      <div className="tw-grid-2">
        <button type="button" className="btn btn-secondary" disabled={out || !!s.idle} onClick={() => void run({ type: 'break.toggle' }, { silent: true })}>
          {s.status === 'BREAK' ? 'End break' : 'Start break'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void run({ type: 'open', tab: 'track' }, { silent: true })}>
          Open
        </button>
      </div>
    </div>
  );
}

/** Screenshot toast window: never focusable, 3 s, suppressed while the widget is open (main decides). */
export function ToastApp() {
  const [shot, setShot] = useState<ShotToast | null>(null);
  useEffect(() => onShot(setShot), []);
  if (!shot) return <div className="tw-shot" />;
  return (
    <div className="tw-shot" data-screen-label="Screenshot toast" onClick={() => void run({ type: 'open', tab: 'track' }, { silent: true })}>
      {shot.thumb ? <img className="tw-shot-thumb" src={shot.thumb} alt="" /> : <div className="tw-shot-thumb is-placeholder" />}
      <div className="tw-shot-text">
        <strong>Screenshot captured</strong>
        <span>
          {shot.time} · mapped to {shot.taskKey}
          {shot.blurred ? ' (blurred)' : ''}
        </span>
        <span className="tw-muted">{shot.audience}</span>
      </div>
    </div>
  );
}
