import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { HttpError, post } from '@/lib/api';

const DEMO = [
  ['priya.sharma@lexisora.com', 'Employee'],
  ['arjun.mehta@lexisora.com', 'Team / Project Lead'],
  ['neha.kapoor@lexisora.com', 'Reporting Manager'],
  ['kavya.iyer@lexisora.com', 'HR'],
  ['rohit.verma@lexisora.com', 'Admin / CEO'],
] as const;
const SHOW_DEMO = import.meta.env.VITE_DEMO_LOGINS !== 'false';

function savedWorkspace() {
  try {
    return localStorage.getItem('lx.workspace') ?? 'lexisora.hrms.app';
  } catch {
    return 'lexisora.hrms.app';
  }
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [workspace, setWorkspace] = useState(savedWorkspace);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ workspace, email: override?.email ?? email, password: override?.password ?? password });
      nav(loc.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sso() {
    setError(null);
    try {
      await post('/auth/sso/start', { workspace });
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'SSO is not available');
    }
  }

  return (
    <div className="login" data-screen-label="Login">
      <div className="login-left">
        <div className="stack" style={{ gap: 4 }}>
          <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>Lexisora</div>
          <div className="kicker" style={{ letterSpacing: '.12em' }}>People &amp; Operations Suite</div>
        </div>
        <div className="stack" style={{ maxWidth: 460, gap: 14 }}>
          <h1 style={{ fontSize: 52, fontWeight: 400, margin: 0, lineHeight: 1.05 }}>Attendance, projects, payroll and people in one ledger.</h1>
          <p className="muted" style={{ margin: 0, textAlign: 'justify' }}>
            Sign in to your company workspace. Your role decides which modules you see; the desktop tracker handles punch, breaks and idle time on your laptop.
          </p>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Mobile access is enabled only for CEO, Admin and HR roles.</div>
      </div>
      <div className="login-right">
        <form className="stack" style={{ width: 'min(380px, 100%)', gap: 16 }} onSubmit={submit}>
          <h3 style={{ margin: 0 }}>Sign in</h3>
          <div className="field">
            <label htmlFor="ws">Workspace</label>
            <input id="ws" className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} autoComplete="organization" required />
          </div>
          <div className="field">
            <label htmlFor="em">Official email</label>
            <input id="em" className="input" type="email" placeholder="name@lexisora.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {SHOW_DEMO && (
            <div className="field">
              <label>Demo: sign in as</label>
              <div className="row" style={{ gap: 6 }}>
                {DEMO.map(([em, label]) => (
                  <button
                    key={em}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEmail(em);
                      setPassword('password');
                      void submit(undefined, { email: em, password: 'password' });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div className="field-error" role="alert">{error}</div>}
          {info && <div className="note">{info}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="row-between" style={{ fontSize: 13 }}>
            <Link to={`/forgot-password?workspace=${encodeURIComponent(workspace)}`} onClick={() => setInfo(null)}>Forgot password</Link>
            <a href="#" onClick={(e) => { e.preventDefault(); void sso(); }}>Use SSO</a>
          </div>
        </form>
      </div>
    </div>
  );
}
