import { useEffect, useState, type ReactNode } from 'react';
import type { IdleDialogView } from '@tracker-shared/ipc';
import { run } from '../bridge';

/** Modal over the window below the title bar (wireframe: inset 34px 0 0 0, neutral-900 45 %). */
function Overlay({ children, labelledBy, onEscape }: { children: ReactNode; labelledBy: string; onEscape?: () => void }) {
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);
  return (
    <div className="tw-overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="dialog tw-dialog">{children}</div>
    </div>
  );
}

/**
 * Idle dialog (spec T3 §1). Idle time stays out of the worked total until one of the three
 * choices is made:
 *   I was working → IDLE_WORK (claim, pending Project Lead review, optional ≤ 140-char note)
 *   Count it as a break → BREAK
 *   Mark as idle & resume → IDLE (deducted)
 */
export function IdleDialog({ idle }: { idle: IdleDialogView }) {
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = async (resolution: 'WORKING' | 'BREAK' | 'IDLE', withNote?: string) => {
    setBusy(true);
    await run({ type: 'idle.resolve', resolution, ...(withNote ? { note: withNote } : {}) });
    setBusy(false);
  };

  return (
    <Overlay labelledBy="tw-idle-title">
      <div className="dialog-title" id="tw-idle-title">
        {idle.title}
      </div>
      <div className="dialog-body">{idle.body}</div>
      {claiming ? (
        <div className="tw-stack">
          <div className="field">
            <label htmlFor="tw-idle-note">What kept you away from the keyboard? (optional)</label>
            <input
              id="tw-idle-note"
              className="input"
              maxLength={140}
              value={note}
              autoFocus
              placeholder="e.g. Client call about AT-101"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void resolve('WORKING', note.trim());
              }}
            />
            <div className="field-hint tw-row-between">
              <span>Your Project Lead reviews claimed time.</span>
              <span className="tw-tnum">{note.length}/140</span>
            </div>
          </div>
          <div className="tw-grid-2">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setClaiming(false)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resolve('WORKING', note.trim())}>
              Send for review
            </button>
          </div>
        </div>
      ) : (
        <div className="tw-stack">
          {idle.claimsAllowed && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setClaiming(true)}>
              I was working (meeting / call)
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void resolve('BREAK')}>
            Count it as a break
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resolve('IDLE')}>
            Mark as idle &amp; resume
          </button>
        </div>
      )}
    </Overlay>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Overlay labelledBy="tw-confirm-title" onEscape={props.onCancel}>
      <div className="dialog-title" id="tw-confirm-title">
        {props.title}
      </div>
      <div className="dialog-body">{props.body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={props.onCancel}>
          {props.cancelLabel ?? 'Cancel'}
        </button>
        <button type="button" className="btn btn-primary" autoFocus onClick={() => void props.onConfirm()}>
          {props.confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}

/** "{N} entries not synced — connect first", with the "Unpair anyway (discard)" escape that needs UNPAIR typed (spec T7). */
export function UnpairOfflineDialog({ message, onCancel, onDiscard }: { message: string; onCancel: () => void; onDiscard: () => void }) {
  const [discarding, setDiscarding] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Overlay labelledBy="tw-unpair-title" onEscape={onCancel}>
      <div className="dialog-title" id="tw-unpair-title">
        {message}
      </div>
      <div className="dialog-body">
        Unsynced time stays encrypted on this PC until it reaches the server. Connect to the internet and try again.
      </div>
      {discarding ? (
        <div className="tw-stack">
          <div className="field">
            <label htmlFor="tw-unpair-typed">Type UNPAIR to discard the unsynced entries</label>
            <input id="tw-unpair-typed" className="input" value={typed} autoFocus spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={typed.trim() !== 'UNPAIR'} onClick={onDiscard}>
              Unpair &amp; discard
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions tw-actions-split">
          <button type="button" className="tw-link tw-link-danger" onClick={() => setDiscarding(true)}>
            Unpair anyway (discard)
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={onCancel}>
            OK
          </button>
        </div>
      )}
    </Overlay>
  );
}
