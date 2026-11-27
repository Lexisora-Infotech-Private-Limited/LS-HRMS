import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  RTW_DOCUMENT_TYPES,
  RTW_METHOD_HELP,
  RTW_METHOD_LABELS,
  RTW_METHODS,
  RTW_RESULT_LABELS,
  RTW_RESULTS,
  formatDate,
  normaliseShareCode,
  type RtwCheckDto,
  type RtwMethod,
  type RtwPersonRow,
  type RtwResult,
  type RtwStatus,
} from '@lexisora/shared';
import { fileUrl, uploadFile } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { FileDrop } from '@/components/form';
import { DataTable, type Column } from '@/components/table';
import { Card, ErrorBlock, Kpis, Loading, Modal, PageHeader, Pills, Tag, type Tone } from '@/components/ui';
import { peopleApi, peopleKeys } from '../api';
import { todayKey } from '../components';
import '../people.css';

type Filter = 'all' | 'due' | 'missing' | 'checked';

export function rtwTone(s: RtwStatus): Tone {
  if (s === 'EXPIRED' || s === 'NO_RIGHT') return 'danger';
  if (s === 'MISSING' || s === 'FOLLOW_UP_DUE') return 'outline';
  return 'accent';
}

const inFilter = (r: RtwPersonRow, f: Filter) =>
  f === 'all' ? true : f === 'due' ? r.status === 'FOLLOW_UP_DUE' || r.status === 'EXPIRED' : f === 'missing' ? r.status === 'MISSING' || r.status === 'NO_RIGHT' : r.status === 'CURRENT';

/** UK right to work checks: who has been checked, how, and when the next check is due. */
export default function RightToWorkPage() {
  const me = useMe();
  const [sp] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [recording, setRecording] = useState<{ employeeId?: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(sp.get('employee'));
  const q = useQuery({ queryKey: peopleKeys.rtw, queryFn: peopleApi.rtwList, enabled: me.region === 'GB' });

  if (me.region !== 'GB') {
    return (
      <div className="stack" style={{ gap: 18 }}>
        <PageHeader title="Right to work" />
        <div className="note">Right to work checks are for companies set up in the United Kingdom.</div>
      </div>
    );
  }

  const c = q.data?.counts;
  const items = q.data?.items ?? [];
  const rows = items.filter((r) => inFilter(r, filter));
  const cols: Column<RtwPersonRow>[] = [
    { key: 'p', header: 'Person', render: (r) => <div><div>{r.name}</div><div className="pp-sub">{r.empCode}{r.employeeStatus === 'ONBOARDING' && r.joiningDate ? ` · starts ${formatDate(r.joiningDate)}` : ''}</div></div> },
    { key: 'm', header: 'How checked', render: (r) => (r.check ? <div><div>{r.check.methodLabel}</div><div className="pp-sub">{formatDate(r.check.checkedOn)}</div></div> : <span className="faint">—</span>) },
    { key: 'd', header: 'Document', render: (r) => (r.check ? <div><div>{r.check.documentType}</div>{r.check.shareCode && <div className="pp-sub tnum">{r.check.shareCode}</div>}</div> : '—') },
    {
      key: 'r',
      header: 'Permission',
      render: (r) =>
        r.check ? (
          <div>
            <div>{r.check.result === 'TIME_LIMITED' && r.check.permissionExpiresOn ? `Until ${formatDate(r.check.permissionExpiresOn)}` : r.check.resultLabel}</div>
            {r.check.sponsored && <div className="pp-sub">Sponsored worker</div>}
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'f',
      header: 'Re-check by',
      render: (r) =>
        r.check?.followUpOn ? (
          <div>
            <div>{formatDate(r.check.followUpOn)}</div>
            {r.daysToFollowUp !== null && <div className="pp-sub">{r.daysToFollowUp < 0 ? `${-r.daysToFollowUp} days overdue` : r.daysToFollowUp === 0 ? 'Today' : `In ${r.daysToFollowUp} days`}</div>}
          </div>
        ) : (
          <span className="faint">{r.check ? 'Not needed' : '—'}</span>
        ),
    },
    {
      key: 's',
      header: 'Status',
      render: (r) => (
        <span className="row" style={{ gap: 6, justifyContent: 'space-between' }} onClick={(e) => e.stopPropagation()}>
          <Tag tone={rtwTone(r.status)} title={r.check?.warnings.join(' ')}>{r.statusLabel}{r.check?.warnings.length ? ' · !' : ''}</Tag>
          <button className="btn btn-ghost btn-sm" onClick={() => setRecording({ employeeId: r.employeeId })}>{r.check ? 'Re-check' : 'Record'}</button>
        </span>
      ),
    },
  ];

  return (
    <div data-screen-label="Right to work" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Right to work"
        sub="Check every worker's right to work in the UK before they start, keep the evidence, and re-check time-limited permission before it ends."
        actions={<button className="btn btn-primary" onClick={() => setRecording({})}>Record a check</button>}
      />
      <Kpis
        items={[
          { label: 'Checked', value: c ? c.checked : '—', sub: c ? `of ${c.total} people` : undefined },
          { label: 'Re-check due', value: c ? c.followUpDue + c.expired : '—', sub: c?.expired ? `${c.expired} permission${c.expired === 1 ? '' : 's'} expired` : 'Within 60 days' },
          { label: 'Not checked', value: c ? c.missing : '—', sub: c?.noRight ? `${c.noRight} with no right to work` : 'Check before day one' },
          { label: 'Sponsored workers', value: c ? c.sponsored : '—', sub: 'Sponsor reporting duties apply' },
        ]}
      />
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {RTW_METHODS.map((m) => (
          <Card key={m} kicker="How to check" title={RTW_METHOD_LABELS[m]}>
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{RTW_METHOD_HELP[m]}</div>
          </Card>
        ))}
      </div>
      <Pills<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `All · ${items.length}` },
          { value: 'due', label: `Due soon · ${items.filter((r) => inFilter(r, 'due')).length}` },
          { value: 'missing', label: `Missing · ${items.filter((r) => inFilter(r, 'missing')).length}` },
          { value: 'checked', label: `Checked · ${items.filter((r) => inFilter(r, 'checked')).length}` },
        ]}
      />
      {q.error ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable columns={cols} rows={q.data ? rows : undefined} loading={q.isLoading} rowKey={(r) => r.employeeId} onRowClick={(r) => setHistoryFor(r.employeeId)} empty="Nobody here. Current staff and joiners show up automatically." />
      )}
      {recording && <RecordCheckModal people={items} employeeId={recording.employeeId} onClose={() => setRecording(null)} />}
      {historyFor && <HistoryModal employeeId={historyFor} onClose={() => setHistoryFor(null)} onRecord={() => setRecording({ employeeId: historyFor })} />}
    </div>
  );
}

function RecordCheckModal({ people, employeeId, onClose }: { people: RtwPersonRow[]; employeeId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const [v, setV] = useState({
    employeeId: employeeId ?? '',
    method: 'SHARE_CODE' as RtwMethod,
    documentType: 'eVisa',
    shareCode: '',
    result: 'TIME_LIMITED' as RtwResult,
    permissionExpiresOn: '',
    followUpOn: '',
    checkedOn: todayKey(),
    sponsored: false,
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  const person = people.find((p) => p.employeeId === v.employeeId);
  const code = normaliseShareCode(v.shareCode);
  const codeBad = v.method === 'SHARE_CODE' && v.shareCode.length > 0 && !/^[A-Z0-9]{9}$/.test(code);
  const late = !!person?.joiningDate && v.checkedOn > person.joiningDate;
  const ready = v.employeeId && v.documentType.trim().length >= 2 && v.checkedOn && (v.method !== 'SHARE_CODE' || (code.length === 9 && !codeBad)) && (v.result !== 'TIME_LIMITED' || v.permissionExpiresOn);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const evidenceFileId = file ? (await uploadFile(file, 'rtw')).id : null;
      await peopleApi.rtwCreate({
        employeeId: v.employeeId,
        method: v.method,
        documentType: v.documentType,
        shareCode: v.method === 'SHARE_CODE' ? code : null,
        result: v.result,
        permissionExpiresOn: v.result === 'TIME_LIMITED' ? v.permissionExpiresOn : null,
        followUpOn: v.result === 'NO_RIGHT' ? null : v.followUpOn || null,
        checkedOn: v.checkedOn,
        sponsored: v.sponsored,
        evidenceFileId,
        notes: v.notes || null,
      });
      void qc.invalidateQueries({ queryKey: peopleKeys.rtw });
      toast('Right to work check recorded');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record a right to work check"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save check'}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="rtw-p">Person</label>
          <select id="rtw-p" className="input" value={v.employeeId} onChange={(e) => set('employeeId', e.target.value)} disabled={!!employeeId}>
            <option value="">Pick a person</option>
            {people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name} · {p.empCode}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label>How was it checked?</label>
          <Pills<RtwMethod>
            value={v.method}
            onChange={(m) => setV((s) => ({ ...s, method: m, documentType: m === 'SHARE_CODE' ? 'eVisa' : 'British passport', result: m === 'SHARE_CODE' ? s.result : 'UNLIMITED' }))}
            options={RTW_METHODS.map((m) => ({ value: m, label: RTW_METHOD_LABELS[m] }))}
          />
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{RTW_METHOD_HELP[v.method]}</div>
        </div>
        <div className="field">
          <label htmlFor="rtw-d">Document type</label>
          <select id="rtw-d" className="input" value={v.documentType} onChange={(e) => set('documentType', e.target.value)}>
            {RTW_DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {v.method === 'SHARE_CODE' ? (
          <div className="field">
            <label htmlFor="rtw-c">Share code</label>
            <input id="rtw-c" className="input tnum" placeholder="W4K 7RT 2PQ" maxLength={11} value={v.shareCode} onChange={(e) => set('shareCode', e.target.value.toUpperCase())} aria-invalid={codeBad || undefined} />
            {codeBad && <div className="field-error">A share code is 9 letters or numbers</div>}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="rtw-on2">Checked on</label>
            <input id="rtw-on2" type="date" className="input" value={v.checkedOn} max={todayKey()} onChange={(e) => set('checkedOn', e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="rtw-r">Result</label>
          <select id="rtw-r" className="input" value={v.result} onChange={(e) => set('result', e.target.value as RtwResult)}>
            {RTW_RESULTS.map((r) => <option key={r} value={r}>{RTW_RESULT_LABELS[r]}</option>)}
          </select>
        </div>
        {v.method === 'SHARE_CODE' && (
          <div className="field">
            <label htmlFor="rtw-on">Checked on</label>
            <input id="rtw-on" type="date" className="input" value={v.checkedOn} max={todayKey()} onChange={(e) => set('checkedOn', e.target.value)} />
          </div>
        )}
        {v.result === 'TIME_LIMITED' && (
          <div className="field">
            <label htmlFor="rtw-x">Permission ends on</label>
            <input id="rtw-x" type="date" className="input" value={v.permissionExpiresOn} min={v.checkedOn} onChange={(e) => set('permissionExpiresOn', e.target.value)} />
          </div>
        )}
        {v.result !== 'NO_RIGHT' && (
          <div className="field">
            <label htmlFor="rtw-f">Re-check by (optional)</label>
            <input id="rtw-f" type="date" className="input" value={v.followUpOn} min={v.checkedOn} onChange={(e) => set('followUpOn', e.target.value)} />
            <div className="faint" style={{ fontSize: 11.5 }}>{v.result === 'TIME_LIMITED' ? 'Defaults to the day the permission ends.' : 'Unlimited right: no re-check is needed.'}</div>
          </div>
        )}
        <div className="field span-2">
          <label className="radio"><input type="checkbox" checked={v.sponsored} onChange={(e) => set('sponsored', e.target.checked)} /><span className="dot" style={{ borderRadius: 3 }} />Sponsored worker (e.g. Skilled Worker visa)</label>
        </div>
        <div className="field span-2">
          <label>Evidence (GOV.UK profile page, IDSP report or dated copy of the document)</label>
          <FileDrop file={file} onFile={setFile} accept=".pdf,image/*" label="Drop evidence or browse" />
        </div>
        <div className="field span-2">
          <label htmlFor="rtw-n">Notes (optional)</label>
          <textarea id="rtw-n" className="input" value={v.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      {late && <div className="note pp-err" style={{ fontSize: 12.5, marginTop: 10 }}>{person!.name} started on {formatDate(person!.joiningDate!)}. Checks must be done on or before the first day of work, otherwise you have no statutory excuse.</div>}
      {v.result === 'NO_RIGHT' && <div className="note pp-err" style={{ fontSize: 12.5, marginTop: 10 }}>This person has no right to work in the UK. Do not employ them; stop their work now.</div>}
      {err && <div className="field-error" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

function HistoryModal({ employeeId, onClose, onRecord }: { employeeId: string; onClose: () => void; onRecord: () => void }) {
  const q = useQuery({ queryKey: peopleKeys.rtwHistory(employeeId), queryFn: () => peopleApi.rtwHistory(employeeId) });
  const h = q.data;
  return (
    <Modal
      title={h ? `${h.name} · ${h.empCode}` : 'Right to work history'}
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={() => { onClose(); onRecord(); }}>Record a check</button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      {!h ? (
        q.error ? <ErrorBlock error={q.error} /> : <Loading />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <Tag tone={rtwTone(h.status)}>{h.statusLabel}</Tag>
            {h.joiningDate && <Tag tone="neutral">Started {formatDate(h.joiningDate)}</Tag>}
          </div>
          {h.checks.length === 0 ? (
            <div className="faint" style={{ fontSize: 13 }}>No checks recorded yet.</div>
          ) : (
            h.checks.map((c) => <CheckCard key={c.id} c={c} />)
          )}
        </div>
      )}
    </Modal>
  );
}

function CheckCard({ c }: { c: RtwCheckDto }) {
  return (
    <div className="card" style={{ opacity: c.supersededAt ? 0.7 : 1 }}>
      <div className="row-between" style={{ gap: 8 }}>
        <strong>{c.methodLabel} · {formatDate(c.checkedOn)}</strong>
        <Tag tone={c.supersededAt ? 'neutral' : c.result === 'NO_RIGHT' ? 'danger' : 'accent'}>{c.supersededAt ? 'Replaced' : 'Current'}</Tag>
      </div>
      <div className="pp-kv" style={{ marginTop: 8 }}>
        <div>Document</div><div>{c.documentType}</div>
        {c.shareCode && (<><div>Share code</div><div className="tnum">{c.shareCode}</div></>)}
        <div>Result</div><div>{c.resultLabel}{c.permissionExpiresOn ? ` · until ${formatDate(c.permissionExpiresOn)}` : ''}</div>
        <div>Re-check by</div><div>{c.followUpOn ? formatDate(c.followUpOn) : '—'}</div>
        <div>Sponsored</div><div>{c.sponsored ? 'Yes' : 'No'}</div>
        <div>Checked by</div><div>{c.checkedBy ?? '—'}</div>
        {c.notes && (<><div>Notes</div><div>{c.notes}</div></>)}
        <div>Evidence</div><div>{c.evidenceFileId ? <a href={fileUrl(c.evidenceFileId)} target="_blank" rel="noreferrer">Open evidence</a> : 'None attached'}</div>
      </div>
      {c.warnings.map((w) => <div key={w} className="pp-err" style={{ fontSize: 12.5, marginTop: 6 }}>{w}</div>)}
    </div>
  );
}
