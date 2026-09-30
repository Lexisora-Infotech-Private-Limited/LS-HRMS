import { useState } from 'react';
import type { ViewState } from '@tracker-shared/ipc';
import { dismissToast, run, useToasts, useViewState } from './bridge';
import { LoginScreen, PairScreen } from './screens/Auth';
import { DevPanel } from './screens/DevPanel';
import { IdleDialog } from './screens/Dialogs';
import { Home } from './screens/Home';

/** Main window (wireframe "Tracker window", 400×620): title bar, offline banner, the current view and overlays. */
export function MainApp() {
  const s = useViewState();
  const [devOpen, setDevOpen] = useState(false);
  return (
    <div className="tw-window" data-screen-label="Tracker window">
      <TitleBar isDev={!!s?.isDev} devOpen={devOpen} onDev={() => setDevOpen((v) => !v)} />
      {s && s.view === 'home' && !s.online && <OfflineBanner queued={s.queued} />}
      {!s || s.view === 'boot' ? <Boot /> : <View s={s} />}
      {s && s.view === 'home' && s.idle && <IdleDialog key={`${s.idle.cause}-${s.idle.since}`} idle={s.idle} />}
      {s?.isDev && devOpen && <DevPanel s={s} onClose={() => setDevOpen(false)} />}
      <Toasts />
    </div>
  );
}

function View({ s }: { s: ViewState }) {
  if (s.view === 'login') return <LoginScreen s={s} />;
  if (s.view === 'pair') return <PairScreen s={s} />;
  return <Home s={s} />;
}

function TitleBar({ isDev, devOpen, onDev }: { isDev: boolean; devOpen: boolean; onDev: () => void }) {
  return (
    <div className="tw-titlebar">
      <span className="tw-titlebar-name">
        <span className="tw-logo" aria-hidden="true" />
        Lexisora Tracker
      </span>
      {isDev && (
        <button type="button" className={`tw-tb-btn tw-tb-dev${devOpen ? ' is-on' : ''}`} title="Prototype controls (development build)" onClick={onDev}>
          DEV
        </button>
      )}
      <button type="button" className="tw-tb-btn" title="Minimize" aria-label="Minimize" onClick={() => void run({ type: 'window', action: 'minimize' })}>
        —
      </button>
      <button type="button" className="tw-tb-btn" title="Maximize" aria-label="Maximize" onClick={() => void run({ type: 'window', action: 'maximize' })}>
        ▢
      </button>
      <button
        type="button"
        className="tw-tb-btn tw-tb-close"
        title="Hide to tray (keeps tracking)"
        aria-label="Hide to tray"
        onClick={() => void run({ type: 'window', action: 'close' })}
      >
        ✕
      </button>
    </div>
  );
}

function OfflineBanner({ queued }: { queued: number }) {
  return (
    <div className="tw-offline" role="status">
      <span>Offline · tracking locally</span>
      <span>
        {queued} {queued === 1 ? 'entry' : 'entries'} queued
      </span>
    </div>
  );
}

function Boot() {
  return (
    <div className="tw-pane tw-boot">
      <span className="tw-logo tw-logo-lg" aria-hidden="true" />
      <span className="tw-muted-12">Starting Lexisora Tracker…</span>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="tw-toasts" aria-live="polite">
      {toasts.map((t) => (
        <button type="button" key={t.id} className={`tw-toast-msg${t.tone === 'error' ? ' is-error' : ''}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
