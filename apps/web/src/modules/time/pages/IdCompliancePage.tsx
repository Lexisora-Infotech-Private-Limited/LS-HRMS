import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { IdCheckRow, IdComplianceSummary, IdPendingRow } from '@lexisora/shared';
import { opts, useLookups } from '@/components/lookups';
import { DataTable } from '@/components/table';
import { Check, ErrorBlock, Kpis, Modal, PageHeader, Pills, Seg, Tag } from '@/components/ui';
import { fileUrl, HttpError, patch, post, uploadFile } from '@/lib/api';
import { useAction } from '@/lib/query';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { dayKeyLabel, istToday, monthLabel, shiftMonth, tk, useIdChecks, useIdPending, useIdSummary } from '../api';
import '../time.css';

type Wearing = '' | 'yes' | 'no';

/** GEN `idcompliance`: KPIs + checks table + "Start today's check" (security desk check mode). */
export default function IdCompliancePage() {
  const today = istToday();
  const [date, setDate] = useState(today);
  const [wearing, setWearing] = useState<Wearing>('');
  const [dept, setDept] = useState('');
  const [checking, setChecking] = useState(false);
  const [photo, setPhoto] = useState<IdCheckRow | null>(null);
  const qc = useQueryClient();
  const summary = useIdSummary(date);
  const checks = useIdChecks(date, wearing);
  const s = summary.data;

  useEffect(() => onRealtime('idcheck.logged', () => void qc.invalidateQueries({ queryKey: tk.id })), [qc]);

  const toggle = useAction((v: { id: string; wearing: boolean }) => patch(`/id-compliance/checks/${v.id}`, { wearing: v.wearing }), {
    success: (_r, v) => (v.wearing ? 'Marked as wearing ID' : 'Marked as missing · reminder sent'),
    invalidate: [tk.id],
  });
  const remind = useAction(() => post<{ message: string }>('/id-compliance/remind', { date }), { success: (r) => r.message, invalidate: [tk.id] });

  const departments = useMemo(() => [...new Set((checks.data ?? []).map((r) => r.department).filter((x): x is string => !!x))].sort(), [checks.data]);
  const rows = (checks.data ?? []).filter((r) => !dept || r.department === dept);

  return (
    <div data-screen-label="ID card compliance" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="ID card compliance"
        sub="Security logs whether each employee in the office is wearing their ID card. Photo verification is optional."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => {
              setDate(today);
              setChecking(true);
            }}
          >
            Start today's check
          </button>
        }
      />

      <div className="row" style={{ gap: 10 }}>
        <label htmlFor="idc-date" style={{ fontSize: 13 }}>Day</label>
        <input id="idc-date" className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
        {date !== today && <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button>}
        {s && !s.checked && s.lastCheckDate && (
          <span className="faint" style={{ fontSize: 13 }}>
            No checks logged on {dayKeyLabel(date)} yet ·{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(s.lastCheckDate!)}>View {dayKeyLabel(s.lastCheckDate)}</button>
          </span>
        )}
      </div>

      {summary.isError ? <ErrorBlock error={summary.error} retry={() => void summary.refetch()} /> : <SummaryKpis s={s} date={date} today={today} onRemind={() => remind.mutate(undefined)} reminding={remind.isPending} />}

      <div className="row-between" style={{ gap: 10 }}>
        <Pills<Wearing>
          options={[
            { value: '', label: 'All' },
            { value: 'yes', label: 'Wearing' },
            { value: 'no', label: 'Missing' },
          ]}
          value={wearing}
          onChange={setWearing}
        />
        <div className="row" style={{ gap: 8 }}>
          {departments.length > 1 && (
            <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 180 }}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {!!s?.missing && (
            <button className="btn btn-secondary btn-sm" disabled={remind.isPending} onClick={() => remind.mutate(undefined)}>
              {s.remindersSent ? 'Remind again' : 'Send reminders'}
            </button>
          )}
        </div>
      </div>

      {checks.isError ? (
        <ErrorBlock error={checks.error} retry={() => void checks.refetch()} />
      ) : (
        <DataTable
          loading={checks.isLoading}
          rows={rows}
          rowKey={(r) => r.id}
          empty={date === today ? "No checks logged today. Use “Start today's check” at the entrance." : `No checks logged on ${dayKeyLabel(date)}.`}
          columns={[
            { key: 'e', header: 'Employee', render: (r) => r.employeeName },
            { key: 'd', header: 'Department', render: (r) => r.department ?? '—' },
            { key: 't', header: 'Checked at', render: (r) => r.checkedAt },
            {
              key: 'w',
              header: 'Wearing ID',
              render: (r) => <Check checked={r.wearing} label={`${r.employeeName} wearing ID`} onChange={(v) => toggle.mutate({ id: r.id, wearing: v })} disabled={toggle.isPending} />,
            },
            {
              key: 'p',
              header: 'Photo',
              render: (r) =>
                r.photoFileId ? (
                  <button className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => setPhoto(r)} title="Open photo">
                    <Tag>Taken</Tag>
                  </button>
                ) : (
                  <Tag>Skipped</Tag>
                ),
            },
            { key: 'l', header: 'Logged by', render: (r) => r.loggedBy },
          ]}
        />
      )}

      {checking && <CheckMode onClose={() => setChecking(false)} />}
      {photo && (
        <Modal title={`${photo.employeeName} · ${photo.checkedAt}`} onClose={() => setPhoto(null)}>
          <img src={fileUrl(photo.photoFileId)} alt={`ID check photo of ${photo.employeeName}`} style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: 'var(--color-neutral-100)' }} />
          <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Logged by {photo.loggedBy} · {photo.wearing ? 'wearing ID' : 'ID missing'}</div>
        </Modal>
      )}
    </div>
  );
}

function SummaryKpis({ s, date, today, onRemind, reminding }: { s: IdComplianceSummary | undefined; date: string; today: string; onRemind: () => void; reminding: boolean }) {
  const isToday = date === today;
  const month = date.slice(0, 7);
  const prev = monthLabel(shiftMonth(month, -1)).split(' ')[0]!.slice(0, 3);
  const delta = s?.deltaPct;
  return (
    <Kpis
      items={[
        { label: isToday ? 'In office today' : `In office · ${dayKeyLabel(date)}`, value: s ? s.inOffice : '—', sub: s ? `of ${s.headcount} employees` : undefined },
        { label: 'Wearing ID', value: s ? s.wearing : '—', sub: s ? (s.checked ? `${s.wearingPct}%` : 'No checks yet') : undefined },
        {
          label: 'Missing',
          value: s ? s.missing : '—',
          sub: s ? (
            s.missing ? (
              s.remindersSent ? (
                'Reminder sent'
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ padding: 0 }} disabled={reminding} onClick={onRemind}>Send reminder</button>
              )
            ) : s.unchecked ? (
              `${s.unchecked} not checked yet`
            ) : (
              '—'
            )
          ) : undefined,
        },
        {
          label: 'Month compliance',
          value: s && (s.monthCompliancePct || s.checked) ? `${s.monthCompliancePct}%` : '—',
          sub: delta != null ? `${delta >= 0 ? '+' : ''}${delta}% vs ${prev}` : s?.prevMonthCompliancePct == null ? `No checks in ${prev}` : undefined,
        },
      ]}
    />
  );
}

// ── Check mode: "In office, not yet checked" + the ID card check form, scan-to-next ──────────

type Who = { mode: 'scan' | 'pick'; badge: string; employeeId: string };

function CheckMode({ onClose }: { onClose: () => void }) {
  const today = istToday();
  const pending = useIdPending(today);
  const lookups = useLookups(['employees']);
  const employees = opts(lookups.data, 'employees');
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [who, setWho] = useState<Who>({ mode: 'scan', badge: '', employeeId: '' });
  const [wearing, setWearing] = useState<'yes' | 'no'>('yes');
  const [photo, setPhoto] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<string[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setWho((w) => ({ mode: w.mode, badge: '', employeeId: '' }));
    setWearing('yes');
    setPhoto(null);
    setNote('');
    setError(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  async function log(input: { employeeId?: string; badgeToken?: string; wearing: boolean; withForm: boolean }) {
    setBusy(true);
    setError(null);
    try {
      let photoFileId: string | null = null;
      if (input.withForm && photo) photoFileId = (await uploadFile(photo, 'idcheck')).id;
      const r = await post<IdCheckRow & { warning: string | null }>('/id-compliance/checks', {
        employeeId: input.employeeId || null,
        badgeToken: input.badgeToken || null,
        wearing: input.wearing,
        photoFileId,
        note: input.withForm ? note || null : null,
      });
      toast(r.warning ? `Logged · ${r.warning}` : 'Logged');
      setLogged((l) => [`${r.employeeName} · ${r.wearing ? 'wearing ID' : 'ID missing'} · ${r.checkedAt}`, ...l].slice(0, 6));
      void qc.invalidateQueries({ queryKey: tk.id });
      if (input.withForm) reset();
    } catch (e) {
      if (input.withForm) setError(e instanceof HttpError ? e.message : 'Could not log the check');
      else toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = who.mode === 'scan' ? !!who.badge.trim() : !!who.employeeId;
  const submit = () =>
    canSubmit && void log({ employeeId: who.mode === 'pick' ? who.employeeId : undefined, badgeToken: who.mode === 'scan' ? who.badge.trim() : undefined, wearing: wearing === 'yes', withForm: true });

  return (
    <Modal
      title="ID card check"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Done</button>
          <button className="btn btn-primary" disabled={!canSubmit || busy} onClick={submit}>{busy ? 'Logging…' : 'Log check'}</button>
        </>
      }
    >
      <div className="time-idc">
        <div className="stack" style={{ gap: 12 }}>
          <Seg
            options={[
              { value: 'scan', label: 'Scan badge' },
              { value: 'pick', label: 'Pick employee' },
            ]}
            value={who.mode}
            onChange={(m) => {
              setWho({ mode: m, badge: '', employeeId: '' });
              if (m === 'scan') setTimeout(() => scanRef.current?.focus(), 0);
            }}
          />
          {who.mode === 'scan' ? (
            <div className="field">
              <label htmlFor="idc-badge">Employee</label>
              <input
                id="idc-badge"
                ref={scanRef}
                autoFocus
                className="input"
                placeholder="Scan badge or pick"
                value={who.badge}
                onChange={(e) => setWho({ ...who, badge: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="field-hint">A USB scanner types the card's QR link here and presses Enter. You can also type an employee code (LX-0118).</div>
              <CameraScan onCode={(code) => setWho({ mode: 'scan', badge: code, employeeId: '' })} />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="idc-emp">Employee</label>
              <select id="idc-emp" className="input" value={who.employeeId} onChange={(e) => setWho({ ...who, employeeId: e.target.value })}>
                <option value="">Select employee</option>
                {employees.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <span className="time-label">Wearing ID</span>
            <Seg
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={wearing}
              onChange={setWearing}
            />
          </div>
          <div className="field">
            <label htmlFor="idc-photo">Photo (optional)</label>
            <input
              id="idc-photo"
              className="input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > 2 * 1024 * 1024) {
                  setError('Photo must be at most 2 MB');
                  e.target.value = '';
                  return;
                }
                setError(null);
                setPhoto(f);
              }}
            />
            <div className="field-hint">JPEG, PNG or WebP up to 2 MB. On a phone this opens the camera.</div>
          </div>
          <div className="field">
            <label htmlFor="idc-note">Note</label>
            <input id="idc-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. temporary card issued" />
          </div>
          {error && <div className="note" role="alert" style={{ borderColor: 'var(--color-danger, #b42318)' }}>{error}</div>}
          {logged.length > 0 && (
            <div>
              <div className="time-label">Logged this session</div>
              {logged.map((l, i) => <div key={i} className="faint" style={{ fontSize: 12.5 }}>{l}</div>)}
            </div>
          )}
        </div>
        <PendingList rows={pending.data} loading={pending.isLoading} busy={busy} onQuick={(r, w) => void log({ employeeId: r.employeeId, wearing: w, withForm: false })} onPick={(r) => setWho({ mode: 'pick', badge: '', employeeId: r.employeeId })} />
      </div>
    </Modal>
  );
}

function PendingList({ rows, loading, busy, onQuick, onPick }: { rows: IdPendingRow[] | undefined; loading: boolean; busy: boolean; onQuick: (r: IdPendingRow, wearing: boolean) => void; onPick: (r: IdPendingRow) => void }) {
  return (
    <div className="time-idc-pending">
      <div className="time-label">In office, not yet checked · {rows?.length ?? 0}</div>
      {loading && <div className="faint" style={{ fontSize: 13 }}>Loading…</div>}
      {rows && !rows.length && <div className="faint" style={{ fontSize: 13, padding: '8px 0' }}>Everyone who punched in by biometric has been checked.</div>}
      {rows?.map((r) => (
        <div key={r.employeeId} className="time-item" style={{ alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: 0 }} onClick={() => onPick(r)} title="Open in the form (to add a photo)">
            <span>
              <span style={{ display: 'block' }}>{r.name}</span>
              <span className="faint" style={{ fontSize: 11.5 }}>{r.department ?? '—'}{r.firstIn ? ` · in ${r.firstIn}` : ''}</span>
            </span>
          </button>
          <span className="row" style={{ gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onQuick(r, true)} aria-label={`${r.name} wearing ID`}>✓ Wearing</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onQuick(r, false)} aria-label={`${r.name} ID missing`}>✗ Missing</button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Camera QR scan via the browser BarcodeDetector API (Chrome on Android / ChromeOS / macOS). */
function CameraScan({ onCode }: { onCode: (code: string) => void }) {
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const [on, setOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const Detector = (window as any).BarcodeDetector;
    const detector = new Detector({ formats: ['qr_code'] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        timer = window.setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) {
            cb.current(codes[0].rawValue as string);
            setOn(false);
          }
        }, 300);
      })
      .catch(() => setOn(false));
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  if (!supported) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOn((v) => !v)}>{on ? 'Stop camera' : 'Scan with camera'}</button>
      {on && <video ref={video} muted playsInline style={{ width: '100%', maxHeight: 220, marginTop: 6, background: '#000' }} />}
    </div>
  );
}
