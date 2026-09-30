import { useState, type FormEvent } from 'react';
import { FOOTER_NOTE, PAIR_CONSENT, PAIR_HELP } from '@tracker-shared/copy';
import type { ViewState } from '@tracker-shared/ipc';
import { pushToast, run } from '../bridge';

/** "Sign in to track your day" (spec T1 §1). */
export function LoginScreen({ s }: { s: ViewState }) {
  const [workspace, setWorkspace] = useState(s.login.workspace);
  const [email, setEmail] = useState(s.login.email);
  const [password, setPassword] = useState('');
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServer] = useState(s.serverUrl);
  const busy = s.login.busy;
  const canSubmit = !busy && workspace.trim() !== '' && email.trim() !== '' && password !== '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const r = await run({ type: 'login', workspace: workspace.trim(), email: email.trim(), password }, { silent: true });
    if (r.ok) setPassword('');
  };

  const saveServer = async () => {
    const r = await run({ type: 'server.set', url: server.trim() });
    if (r.ok) setServerOpen(false);
  };

  // TRACKER_NOT_ELIGIBLE shows the footer note itself as the error (spec T1).
  const inlineError = s.login.error && !s.login.notEligible ? s.login.error : null;

  return (
    <form className="tw-pane tw-auth" onSubmit={submit} noValidate data-screen-label="Sign in">
      <div className="tw-h1">Sign in to track your day</div>
      <div className="tw-sub">Use your Lexisora HRMS account.</div>
      {s.login.notice && (
        <div className="tw-note" role="status">
          {s.login.notice}
        </div>
      )}
      <div className="field">
        <label htmlFor="tw-ws">Workspace</label>
        <input id="tw-ws" className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} autoComplete="organization" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="tw-email">Official email</label>
        <input
          id="tw-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          spellCheck={false}
          autoFocus={!email}
        />
      </div>
      <div className="field">
        <label htmlFor="tw-pw">Password</label>
        <input
          id="tw-pw"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={!!email}
          aria-invalid={inlineError ? true : undefined}
        />
      </div>
      {inlineError && (
        <div className="field-error" role="alert">
          {inlineError}
        </div>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <div className="tw-auth-foot">
        {serverOpen ? (
          <div className="tw-server-edit">
            <input
              className="input"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://localhost:4000"
              spellCheck={false}
              aria-label="Server address"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveServer()}>
              Save
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setServerOpen(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="tw-muted-11">
            Server {s.serverUrl} ·{' '}
            <button
              type="button"
              className="tw-link"
              onClick={() => {
                setServer(s.serverUrl);
                setServerOpen(true);
              }}
            >
              Change
            </button>
          </div>
        )}
        <div className={s.login.notEligible ? 'tw-footnote is-error' : 'tw-footnote'} role={s.login.notEligible ? 'alert' : undefined}>
          {FOOTER_NOTE}
        </div>
      </div>
    </form>
  );
}

const STATUS_COPY: Partial<Record<ViewState['pair']['status'], string>> = {
  AWAITING_HR: 'Waiting for HR approval · this screen continues on its own once HR approves.',
  APPROVED: 'Approved · finishing pairing…',
};

/** "Pair this device" · Step 2 of 2 (spec T1 §1, audit fix #9 copy). */
export function PairScreen({ s }: { s: ViewState }) {
  const p = s.pair;
  const [polling, setPolling] = useState(false);
  const dead = p.status === 'EXPIRED' || p.status === 'REJECTED' || p.status === 'ERROR';

  const poll = async () => {
    setPolling(true);
    const r = await run({ type: 'pair.poll' }, { silent: true });
    setPolling(false);
    if (!r.ok) pushToast(r.error, r.code === 'NOT_APPROVED' || r.code === 'AWAITING_HR' ? 'info' : 'error');
  };

  return (
    <div className="tw-pane tw-auth" data-screen-label="Pair this device">
      <div className="tw-kicker-accent">Step 2 of 2</div>
      <div className="tw-h1">Pair this device</div>
      <div className="tw-sub tw-justify">{PAIR_HELP}</div>
      <div className={`tw-code${dead ? ' is-dead' : ''}`} aria-label={`Pairing code ${p.code.join(' ')}`}>
        {p.code.map((c, i) => (
          <span key={i} className="tw-code-box">
            {c || '·'}
          </span>
        ))}
      </div>
      <div className="tw-pair-status" role="status">
        {p.busy && !p.code.some(Boolean) && <span className="tw-muted-12">Requesting a pairing code…</span>}
        {p.status === 'PENDING' && p.expiresIn && <span className="tw-muted-12">Code expires in {p.expiresIn}</span>}
        {STATUS_COPY[p.status] && <span className="tw-note">{STATUS_COPY[p.status]}</span>}
        {p.status === 'EXPIRED' && <span className="field-error">This code has expired.</span>}
        {(p.status === 'REJECTED' || p.status === 'ERROR') && p.error && <span className="field-error">{p.error}</span>}
        {dead && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={p.busy} onClick={() => void run({ type: 'pair.newCode' })}>
            {p.busy ? 'Getting a new code…' : 'Get a new code'}
          </button>
        )}
      </div>
      <div className="tw-pair-meta">
        <span>{p.deviceLine}</span>
        <span>{p.permissions}</span>
        {p.userName && <span className="tw-muted-12">Signed in as {p.userName}</span>}
      </div>
      <div className="tw-muted-11">{PAIR_CONSENT}</div>
      <button className="btn btn-primary btn-block" type="button" disabled={dead || polling || p.busy || !p.code.some(Boolean)} onClick={() => void poll()}>
        {polling ? 'Checking…' : "I've approved it · continue"}
      </button>
      <button type="button" className="tw-link tw-center-self" onClick={() => void run({ type: 'pair.cancel' })}>
        Cancel / use another account
      </button>
    </div>
  );
}
