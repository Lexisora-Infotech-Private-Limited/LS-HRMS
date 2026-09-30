import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LoginResponse } from '@lexisora/shared';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { PageHeader } from '@/components/ui';

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack" style={{ width: 'min(380px, 100%)', gap: 16 }}>
        <div className="serif" style={{ fontSize: 22, fontWeight: 600 }}>Lexisora</div>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [sp] = useSearchParams();
  const [workspace, setWorkspace] = useState(sp.get('workspace') ?? 'lexisora.hrms.app');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Centered title="Reset your password">
      {sent ? (
        <div className="note">If an account exists for {email}, a reset link is on its way. It expires in one hour.</div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await post('/auth/forgot-password', { workspace, email });
              setSent(true);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <div className="field"><label htmlFor="fp-ws">Workspace</label><input id="fp-ws" className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} required /></div>
          <div className="field"><label htmlFor="fp-email">Official email</label><input id="fp-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          {error && <div className="field-error">{error}</div>}
          <button className="btn btn-primary btn-block">Send reset link</button>
        </form>
      )}
      <Link to="/login" style={{ fontSize: 13 }}>← Back to sign in</Link>
    </Centered>
  );
}

function SetPasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) return setError('Use at least 8 characters');
        if (pw !== pw2) return setError('Passwords do not match');
        setBusy(true);
        try {
          await onSubmit(pw);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="pw-confirm">Confirm password</label><input id="pw-confirm" className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
      {error && <div className="field-error">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{submitLabel}</button>
    </form>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { toast } = useToast();
  return (
    <Centered title="Choose a new password">
      <SetPasswordForm
        submitLabel="Set password"
        onSubmit={async (password) => {
          await post('/auth/reset-password', { token: sp.get('token') ?? '', password });
          toast('Password updated · sign in with your new password');
          nav('/login');
        }}
      />
    </Centered>
  );
}

/** Onboarding invite link from "Add & send onboarding invite". */
export function AcceptInvitePage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { acceptSession } = useAuth();
  return (
    <Centered title="Welcome to Lexisora">
      <p className="muted" style={{ margin: 0 }}>Set a password to start your paperless onboarding.</p>
      <SetPasswordForm
        submitLabel="Set password & continue"
        onSubmit={async (password) => {
          const r = await post<LoginResponse>('/auth/accept-invite', { token: sp.get('token') ?? '', password });
          acceptSession(r);
          nav('/onboarding');
        }}
      />
    </Centered>
  );
}

export function ChangePasswordPage() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  return (
    <div className="stack" style={{ maxWidth: 420, gap: 16 }}>
      <PageHeader title="Change password" />
      <div className="field"><label htmlFor="pw-current">Current password</label><input id="pw-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <SetPasswordForm
        submitLabel="Update password"
        onSubmit={async (newPassword) => {
          await post('/auth/change-password', { currentPassword: current, newPassword });
          toast('Password updated');
        }}
      />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="empty">
      <div className="serif" style={{ fontSize: 24 }}>Page not found</div>
      <Link to="/dashboard">Go to dashboard</Link>
    </div>
  );
}
