import { useEffect, useRef, useState } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { formatDate } from '@lexisora/shared';
import type { DeviceRow, PairingLookup } from '@lexisora/shared';
import { HttpError } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Modal, StatusTag, Tag } from '@/components/ui';
import { ago, DEVICE_STATUS_LABEL, trackerApi } from './api';
import './tracker.css';

/** Six code boxes backed by one numeric input (paste-friendly). */
export function CodeInput({ value, onChange, invalid, autoFocus }: { value: string; onChange: (v: string) => void; invalid?: boolean; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <div className={`trk-code${invalid ? ' invalid' : ''}`} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit pairing code"
        value={value}
        maxLength={6}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      {digits.map((d, i) => (
        <span key={i} className={`box${d.trim() ? ' filled' : ''}${focused && i === Math.min(value.length, 5) ? ' caret' : ''}`} aria-hidden>
          {d.trim()}
        </span>
      ))}
    </div>
  );
}

export function DeviceStatusTag({ d }: { d: Pick<DeviceRow, 'status' | 'revokeReason'> }) {
  if (d.status === 'REVOKED' && /unpair/i.test(d.revokeReason ?? '')) return <Tag tone="neutral">Unpaired</Tag>;
  return <StatusTag status={d.status} label={DEVICE_STATUS_LABEL[d.status] ?? d.status} />;
}

export function DeviceCell({ d }: { d: DeviceRow }) {
  return (
    <div className="trk-device">
      <strong>{d.hostname}</strong>
      <small>
        {d.os} · v{d.appVersion}
      </small>
    </div>
  );
}

/**
 * "Pair a device": enter the code shown on the tracker → see the matched request → Approve / Reject.
 * Toasts: "PRIYA-LAPTOP paired" or "Sent to HR for approval".
 */
export function PairDeviceModal({ onClose, invalidate }: { onClose: () => void; invalidate: QueryKey[] }) {
  const [code, setCode] = useState('');
  const [found, setFound] = useState<PairingLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lookup = useAction((c: string) => trackerApi.lookup(c), {
    onSuccess: (r) => {
      setFound(r);
      setError(null);
    },
  });
  const decide = useAction((d: 'APPROVE' | 'REJECT') => trackerApi.approve(code, d), {
    invalidate,
    success: (r) =>
      r.status === 'APPROVED' ? `${r.device.hostname} paired` : r.status === 'AWAITING_HR' ? 'Sent to HR for approval' : 'Pairing request rejected · HR has been alerted',
    onSuccess: () => onClose(),
  });
  const submitLookup = () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code shown on the tracker');
      return;
    }
    lookup.mutate(code, {
      onError: (e) => setError(e instanceof HttpError ? e.message : 'Code not found'),
    });
  };
  const mins = found ? Math.max(0, Math.round((Date.now() - Date.parse(found.requestedAt)) / 60000)) : 0;
  const left = found ? Math.max(0, Math.round((Date.parse(found.expiresAt) - Date.now()) / 60000)) : 0;

  return (
    <Modal
      title="Pair device"
      onClose={onClose}
      actions={
        found ? (
          <>
            <button className="btn btn-danger" disabled={decide.isPending} onClick={() => decide.mutate('REJECT')}>
              Reject · this wasn't me
            </button>
            <button className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
              Approve
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={lookup.isPending || code.length !== 6} onClick={submitLookup}>
              Find device
            </button>
          </>
        )
      }
    >
      <div className="stack">
        {!found ? (
          <>
            <p className="faint" style={{ margin: 0, fontSize: 13 }}>
              Open Lexisora Tracker on your laptop and sign in. Enter the 6-digit code it shows. Only the person who signed in on the device can approve it.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitLookup();
              }}
            >
              <CodeInput value={code} onChange={(v) => { setCode(v); setError(null); }} invalid={!!error} autoFocus />
            </form>
            {error && <div className="field-error" role="alert">{error}</div>}
          </>
        ) : (
          <>
            <div className="kicker">Pairing request</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 26, lineHeight: 1.1 }}>{found.hostname}</div>
            <div className="trk-meta">
              <span>Device: {found.hostname} · {found.os}</span>
              <span>App version: v{found.appVersion}</span>
              <span>Requested {mins <= 0 ? 'just now' : `${mins} min ago`} · code expires in {left} min</span>
              <span>Permissions: {found.permissions.join(', ') || 'activity monitor'}</span>
            </div>
            <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
              Approving lets this laptop record your punches, tasks, idle time{found.permissions.includes('screen capture') ? ' and screenshots' : ''} under the tracker monitoring notice. You can revoke it any time.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Revoke confirm with a reason (optional for self, required for HR). Toast "Device revoked; tracker signed out". */
export function RevokeDeviceDialog({
  device,
  reasonRequired,
  onClose,
  invalidate,
}: {
  device: DeviceRow;
  reasonRequired: boolean;
  onClose: () => void;
  invalidate: QueryKey[];
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const revoke = useAction(() => trackerApi.revoke(device.id, reason.trim()), {
    invalidate,
    success: 'Device revoked; tracker signed out',
    onSuccess: () => onClose(),
  });
  const invalid = reasonRequired && !reason.trim();
  return (
    <Modal
      title={`Revoke ${device.hostname}?`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={revoke.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) revoke.mutate(undefined);
            }}
          >
            Revoke device
          </button>
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0, fontSize: 13.5 }}>
          The tracker on {device.hostname} is signed out within seconds. Data it recorded before now still syncs; a new pairing code is needed to use it again.
        </p>
        {device.pairedAt && (
          <div className="faint" style={{ fontSize: 12.5 }}>
            {device.os} · v{device.appVersion} · paired {formatDate(device.pairedAt)} · last seen {ago(device.lastSeenAt)}
          </div>
        )}
        <div className="field">
          <label htmlFor="trk-revoke-reason">Reason{reasonRequired ? ' *' : ' (optional)'}</label>
          <textarea
            id="trk-revoke-reason"
            className="input"
            rows={3}
            maxLength={300}
            value={reason}
            aria-invalid={touched && invalid}
            placeholder={reasonRequired ? 'e.g. Laptop returned to IT' : 'e.g. Replaced my laptop'}
            onChange={(e) => setReason(e.target.value)}
          />
          {touched && invalid && <div className="field-error">Give a reason for revoking this device</div>}
        </div>
      </div>
    </Modal>
  );
}

/** HR approve / reject of a pairing request that exceeded the device limit. */
export function HrDecisionDialog({ device, onClose, invalidate }: { device: DeviceRow; onClose: () => void; invalidate: QueryKey[] }) {
  const [reason, setReason] = useState('');
  const act = useAction((d: 'APPROVE' | 'REJECT') => trackerApi.hrDecision(device.id, d, reason.trim()), {
    invalidate,
    success: (_r, d) => (d === 'APPROVE' ? `${device.hostname} paired` : 'Pairing request rejected'),
    onSuccess: () => onClose(),
  });
  return (
    <Modal
      title={`Pairing request · ${device.employee?.name ?? device.hostname}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-danger" disabled={act.isPending} onClick={() => act.mutate('REJECT')}>
            Reject
          </button>
          <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate('APPROVE')}>
            Approve device
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="trk-meta">
          <span>Device: {device.hostname} · {device.os}</span>
          <span>App version: v{device.appVersion}</span>
          {device.employee && (
            <span>
              Employee: {device.employee.name} · {device.employee.empCode} · {device.employee.workMode}
            </span>
          )}
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
          The employee approved this device with their code, but it is over the limit of 2 active devices per person. Approve it only if an older laptop is being replaced.
        </p>
        <div className="field">
          <label htmlFor="trk-hr-reason">Note to employee (optional)</label>
          <input id="trk-hr-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
