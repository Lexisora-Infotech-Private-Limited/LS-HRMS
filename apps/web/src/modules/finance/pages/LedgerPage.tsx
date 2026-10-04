import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FIN_VOUCHER_SOURCE_LABEL,
  FIN_VOUCHER_TYPE_LABEL,
  FIN_VOUCHER_TYPES,
  formatDate,
  formatDayMonth,
  formatINR,
  formatINRKpi,
  type FinAccountRow,
  type LedgerLineRow,
  type TrialBalanceRow,
  type VoucherRow,
} from '@lexisora/shared';
import { ErrorBlock, Kpis, Loading, Modal, PageHeader, Tabs, Tag } from '@/components/ui';
import { DataTable, Pager, type Column } from '@/components/table';
import { FileDrop, FormModal, type FieldDef } from '@/components/form';
import { useLookups, opts as lookupOpts } from '@/components/lookups';
import { fileUrl, uploadFile } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { FIN_ALL, finApi, finKeys, fyStartKey, monthKeyNow, rupeesToPaise, todayKey } from '../api';
import { amt, drCr, errorText, Field, fieldErrors, inr2, MonthSelect, ReasonDialog, useFallbackMonth, useParamState, useReportEmpty } from '../components';
import '../finance.css';

type Tab = 'daybook' | 'income' | 'expenses' | 'hr' | 'trial';
const TAB_LABEL: Record<Tab, string> = { daybook: 'Day book', income: 'Income', expenses: 'Expenses', hr: 'HR vouchers', trial: 'Trial balance' };
const PAGE_SIZE = 25;
const SOURCES = Object.keys(FIN_VOUCHER_SOURCE_LABEL);

/** Ledger (GEN.ledger): month KPIs, day book / income / expenses / HR vouchers, trial balance, vouchers. */
export default function LedgerPage() {
  const can = useCan();
  const full = can('ledger.manage');
  const tabs: Tab[] = full ? ['daybook', 'income', 'expenses', 'hr', 'trial'] : ['hr'];
  const [tab, setTab] = useState<Tab>(full ? 'daybook' : 'hr');
  const [month, setMonth, reportEmpty] = useFallbackMonth();
  const [voucherId, setVoucherId] = useParamState('voucher');
  const [statementId, setStatementId] = useState<string | null>(null);
  const [newVoucher, setNewVoucher] = useState(false);
  const [coa, setCoa] = useState(false);
  const [lock, setLock] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const kpis = useQuery({ queryKey: finKeys.ledgerKpis(month), queryFn: () => finApi.ledgerKpis(month), enabled: full });
  const exportCsv = useAction(() => (tab === 'trial' ? finApi.exportLedger('trial', range.from || fyStartKey(todayKey()), range.to || todayKey()) : finApi.exportLedger('daybook', range.from || undefined, range.to || undefined)), {});
  const k = kpis.data;
  useReportEmpty(reportEmpty, full ? (k ? k.incomePaise === 0 && k.expensesPaise === 0 : undefined) : false);
  const short = (k?.monthLabel ?? '').slice(0, 3);
  const current = month === monthKeyNow();

  return (
    <div data-screen-label="Ledger" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Ledger"
        sub="Income, expenses and internal HR vouchers in a double-entry ledger."
        actions={
          <>
            {full && <button className="btn btn-ghost" onClick={() => setLock(true)}>Lock books</button>}
            {full && <button className="btn btn-secondary" onClick={() => setCoa(true)}>Chart of accounts</button>}
            <button className="btn btn-secondary" onClick={() => exportCsv.mutate(undefined)}>Export CSV</button>
            <button className="btn btn-primary" onClick={() => setNewVoucher(true)}>New voucher</button>
          </>
        }
      />
      {full && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="fin-toolbar">
            <MonthSelect value={month} onChange={setMonth} label="KPI month" />
            {k?.booksLockedUpTo && <span className="fin-muted fin-small">Books locked up to {formatDate(k.booksLockedUpTo)}</span>}
          </div>
          {k && (
            <Kpis
              items={[
                { label: `Income (${short})`, value: formatINRKpi(k.incomePaise), sub: `${k.invoiceCount} ${k.invoiceCount === 1 ? 'invoice' : 'invoices'}` },
                { label: `Expenses (${short})`, value: formatINRKpi(k.expensesPaise), sub: k.payrollPosted ? 'incl. payroll' : 'payroll not posted yet' },
                { label: 'Balance', value: formatINRKpi(k.balancePaise), sub: current ? 'Current month' : k.monthLabel },
              ]}
            />
          )}
        </div>
      )}
      <Tabs<Tab> tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))} value={tab} onChange={setTab} />
      {tab === 'trial' ? (
        <TrialBalanceTab range={range} setRange={setRange} onOpenAccount={setStatementId} />
      ) : (
        <VoucherListTab key={tab} tab={tab} full={full} range={range} setRange={setRange} onOpen={setVoucherId} />
      )}
      {newVoucher && <VoucherForm full={full} onClose={() => setNewVoucher(false)} onPosted={(id) => setVoucherId(id)} />}
      {voucherId && !newVoucher && <VoucherDetailModal id={voucherId} full={full} onClose={() => setVoucherId(null)} onOpen={setVoucherId} />}
      {statementId && <StatementModal accountId={statementId} onClose={() => setStatementId(null)} onOpenVoucher={(id) => (setStatementId(null), setVoucherId(id))} />}
      {coa && <ChartOfAccountsModal onClose={() => setCoa(false)} onOpenAccount={(id) => (setCoa(false), setStatementId(id))} />}
      {lock && <LockBooksDialog current={k?.booksLockedUpTo ?? null} onClose={() => setLock(false)} />}
    </div>
  );
}

// ── Day book / income / expenses / HR vouchers ───────────────────────────────

function RangeInputs({ range, setRange }: { range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <input type="date" className="input" aria-label="From" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      <span className="fin-muted">to</span>
      <input type="date" className="input" aria-label="To" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
    </>
  );
}

function VoucherListTab({ tab, full, range, setRange, onOpen }: { tab: Exclude<Tab, 'trial'>; full: boolean; range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [accountId, setAccountId] = useState('');
  const [page, setPage] = useState(1);
  const options = useQuery({ queryKey: finKeys.ledgerOptions, queryFn: finApi.ledgerOptions });
  const query = {
    tab,
    q: q.trim() || undefined,
    from: range.from || undefined,
    to: range.to || undefined,
    type: tab === 'daybook' && type ? type : undefined,
    source: tab === 'daybook' && source ? source : undefined,
    accountId: accountId || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: finKeys.vouchers(query), queryFn: () => finApi.vouchers(query), placeholderData: keepPreviousData });
  const accountOptions = (options.data?.ledgers ?? []).filter((a) => (tab === 'income' ? a.type === 'INCOME' : tab === 'expenses' ? a.type === 'EXPENSE' : true));
  const lineMode = tab === 'income' || tab === 'expenses';
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const voucherCols: Column<VoucherRow>[] = [
    { key: 'date', header: 'Date', width: '76px', render: (r) => formatDayMonth(r.date) },
    {
      key: 'no',
      header: 'Voucher',
      render: (r) => (
        <span className={r.status === 'REVERSED' ? 'fin-strike' : undefined} title={FIN_VOUCHER_TYPE_LABEL[r.type]}>
          {r.number}
          {r.status === 'REVERSED' && <Tag tone="neutral">Reversed</Tag>}
        </span>
      ),
    },
    { key: 'ledger', header: 'Ledger', render: (r) => r.ledger },
    { key: 'narration', header: 'Narration', render: (r) => r.narration },
    { key: 'dr', header: 'Debit', num: true, render: (r) => amt(r.debitPaise) },
    { key: 'cr', header: 'Credit', num: true, render: (r) => amt(r.creditPaise) },
  ];
  const lineCols: Column<LedgerLineRow>[] = [
    { key: 'date', header: 'Date', width: '76px', render: (r) => formatDayMonth(r.date) },
    { key: 'no', header: 'Voucher', render: (r) => r.number },
    { key: 'ledger', header: 'Ledger', render: (r) => r.account },
    { key: 'narration', header: 'Narration', render: (r) => r.narration },
    { key: 'dr', header: 'Debit', num: true, render: (r) => amt(r.debitPaise) },
    { key: 'cr', header: 'Credit', num: true, render: (r) => amt(r.creditPaise) },
  ];
  const rows = list.data?.items;
  return (
    <>
      <div className="fin-toolbar">
        <RangeInputs range={range} setRange={(r) => reset(setRange)(r)} />
        {tab === 'daybook' && (
          <>
            <select className="input" aria-label="Voucher type" value={type} onChange={(e) => reset(setType)(e.target.value)}>
              <option value="">All types</option>
              {FIN_VOUCHER_TYPES.map((t) => (
                <option key={t} value={t}>{FIN_VOUCHER_TYPE_LABEL[t]}</option>
              ))}
            </select>
            <select className="input" aria-label="Source" value={source} onChange={(e) => reset(setSource)(e.target.value)}>
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{FIN_VOUCHER_SOURCE_LABEL[s]}</option>
              ))}
            </select>
          </>
        )}
        {full && (
          <select className="input" aria-label="Account" value={accountId} onChange={(e) => reset(setAccountId)(e.target.value)}>
            <option value="">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a.value} value={a.value}>{a.code} · {a.label}</option>
            ))}
          </select>
        )}
        <input className="input grow" aria-label="Search vouchers" placeholder="Search voucher no., narration or reference" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : lineMode ? (
        <DataTable columns={lineCols} rows={rows as LedgerLineRow[] | undefined} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.voucherId)} loading={list.isLoading} empty={`No ${tab} lines in this range.`} />
      ) : (
        <DataTable columns={voucherCols} rows={rows as VoucherRow[] | undefined} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)} loading={list.isLoading} empty={tab === 'hr' ? 'No HR vouchers yet. Raise one with New voucher.' : 'No vouchers in this range.'} />
      )}
      {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
    </>
  );
}

// ── Trial balance ────────────────────────────────────────────────────────────

function TrialBalanceTab({ range, setRange, onOpenAccount }: { range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void; onOpenAccount: (id: string) => void }) {
  const from = range.from || fyStartKey(todayKey());
  const to = range.to || todayKey();
  const q = useQuery({ queryKey: finKeys.trial(from, to), queryFn: () => finApi.trialBalance(from, to) });
  const tb = q.data;
  const cols: Column<TrialBalanceRow>[] = [
    { key: 'code', header: 'Code', width: '70px', render: (r) => r.code },
    { key: 'name', header: 'Account', render: (r) => r.name },
    { key: 'type', header: 'Type', render: (r) => r.type.charAt(0) + r.type.slice(1).toLowerCase() },
    { key: 'open', header: 'Opening', num: true, render: (r) => (r.openingPaise ? drCr(r.openingPaise) : '') },
    { key: 'dr', header: 'Debit', num: true, render: (r) => amt(r.debitPaise) },
    { key: 'cr', header: 'Credit', num: true, render: (r) => amt(r.creditPaise) },
    { key: 'close', header: 'Closing', num: true, render: (r) => drCr(r.closingPaise) },
  ];
  return (
    <div className="stack" style={{ gap: 12 }} data-screen-label="Trial balance">
      <div className="fin-toolbar">
        <RangeInputs range={{ from, to }} setRange={setRange} />
        <span className="spacer" />
        {tb && <Tag tone={tb.balanced ? 'accent' : 'danger'}>{tb.balanced ? 'Balanced · Dr = Cr' : 'Not balanced'}</Tag>}
      </div>
      {q.error ? (
        <ErrorBlock error={q.error} retry={() => void q.refetch()} />
      ) : (
        <DataTable
          columns={cols}
          rows={tb?.rows}
          rowKey={(r) => r.accountId}
          onRowClick={(r) => onOpenAccount(r.accountId)}
          loading={q.isLoading}
          empty="No balances or movements in this range."
          footer={
            tb && (
              <tr className="fin-total-row">
                <td />
                <td>Total</td>
                <td />
                <td className="num">{formatINR(tb.totals.openingDr)} Dr · {formatINR(tb.totals.openingCr)} Cr</td>
                <td className="num">{formatINR(tb.totals.debitPaise)}</td>
                <td className="num">{formatINR(tb.totals.creditPaise)}</td>
                <td className="num">{formatINR(tb.totals.closingDr)} Dr · {formatINR(tb.totals.closingCr)} Cr</td>
              </tr>
            )
          }
        />
      )}
    </div>
  );
}

// ── Voucher detail ───────────────────────────────────────────────────────────

function VoucherDetailModal({ id, full, onClose, onOpen }: { id: string; full: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: finKeys.voucher(id), queryFn: () => finApi.voucher(id) });
  const v = q.data;
  const [reversing, setReversing] = useState(false);
  const reverse = useAction((reason: string) => finApi.reverseVoucher(id, reason), { success: (r) => `Reversed by ${r.number}`, invalidate: FIN_ALL });
  const totalDr = v?.lines.reduce((s, l) => s + l.debitPaise, 0) ?? 0;
  const totalCr = v?.lines.reduce((s, l) => s + l.creditPaise, 0) ?? 0;
  return (
    <>
      <Modal wide title={v ? `${v.number} · ${FIN_VOUCHER_TYPE_LABEL[v.type]}` : 'Voucher'} onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
        {!v ? (
          q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
        ) : (
          <div className="stack" style={{ gap: 14 }} data-screen-label="Voucher detail">
            <div className="row">
              <Tag tone={v.status === 'REVERSED' ? 'neutral' : 'accent'}>{v.status === 'REVERSED' ? 'Reversed' : 'Posted'}</Tag>
              {v.isReversal && <Tag tone="outline">Reversal</Tag>}
              <span className="fin-muted fin-small">FY {v.fy}</span>
            </div>
            <div className="fin-kv">
              <span>Date</span>
              <span>{formatDate(v.date)}</span>
              <span>Narration</span>
              <span>{v.narration}</span>
              <span>Source</span>
              <span>
                {FIN_VOUCHER_SOURCE_LABEL[v.source.type] ?? v.source.type}
                {v.source.ref && ` · ${v.source.ref}`}
                {v.source.link && (full || v.type === 'HR') && (
                  <>
                    {' · '}
                    <button className="fin-link" onClick={() => navigate(v.source.link!)}>Open</button>
                  </>
                )}
              </span>
              {v.employeeName && (
                <>
                  <span>Employee</span>
                  <span>{v.employeeName}</span>
                </>
              )}
              <span>Posted by</span>
              <span>{v.postedByName ?? 'System'} · {formatDate(v.createdAt)}</span>
              {v.attachmentFileId && (
                <>
                  <span>Attachment</span>
                  <span>
                    <a className="fin-link" href={fileUrl(v.attachmentFileId)} target="_blank" rel="noreferrer">Open attachment</a>
                  </span>
                </>
              )}
              {v.reversalOf && (
                <>
                  <span>Reverses</span>
                  <span>
                    <button className="fin-link" onClick={() => onOpen(v.reversalOf!.id)}>{v.reversalOf.number}</button>
                  </span>
                </>
              )}
              {v.reversedBy && (
                <>
                  <span>Reversed by</span>
                  <span>
                    <button className="fin-link" onClick={() => onOpen(v.reversedBy!.id)}>{v.reversedBy.number}</button>
                  </span>
                </>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="fin-lines">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Account</th>
                    <th>Line narration</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.accountCode}</td>
                      <td>{l.account}</td>
                      <td className="fin-muted">{l.narration ?? ''}</td>
                      <td className="num">{amt(l.debitPaise)}</td>
                      <td className="num">{amt(l.creditPaise)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td />
                    <td>Total</td>
                    <td />
                    <td className="num">{inr2(totalDr)}</td>
                    <td className="num">{inr2(totalCr)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {full && v.status === 'POSTED' && !v.isReversal && (
              <div className="fin-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setReversing(true)}>Reverse voucher</button>
              </div>
            )}
          </div>
        )}
      </Modal>
      {v && reversing && (
        <ReasonDialog
          title={`Reverse ${v.number}?`}
          body="A journal voucher with the debits and credits swapped is posted today. The original stays in the day book, marked Reversed."
          confirmLabel="Post reversal"
          danger
          onConfirm={async (reason) => {
            const r = await reverse.mutateAsync(reason);
            onOpen(r.id);
          }}
          onClose={() => setReversing(false)}
        />
      )}
    </>
  );
}

// ── Account statement ────────────────────────────────────────────────────────

function StatementModal({ accountId, onClose, onOpenVoucher }: { accountId: string; onClose: () => void; onOpenVoucher: (id: string) => void }) {
  const [from, setFrom] = useState(fyStartKey(todayKey()));
  const [to, setTo] = useState(todayKey());
  const q = useQuery({ queryKey: finKeys.statement(accountId, from, to), queryFn: () => finApi.statement(accountId, from, to) });
  const s = q.data;
  return (
    <Modal wide title={s ? `${s.account.code} · ${s.account.name}` : 'Account statement'} onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <div className="stack" style={{ gap: 12 }} data-screen-label="Account statement">
        <div className="fin-toolbar">
          <RangeInputs range={{ from, to }} setRange={(r) => (setFrom(r.from || fyStartKey(todayKey())), setTo(r.to || todayKey()))} />
          {s && <span className="fin-muted fin-small">Opening {drCr(s.openingPaise)} · Closing {drCr(s.closingPaise)}</span>}
        </div>
        {!s ? (
          q.error ? <ErrorBlock error={q.error} retry={() => void q.refetch()} /> : <Loading />
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 460 }}>
            <table className="fin-lines">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Narration</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="fin-dim">
                  <td>{formatDayMonth(s.from)}</td>
                  <td />
                  <td>Opening balance</td>
                  <td />
                  <td />
                  <td className="num">{drCr(s.openingPaise)}</td>
                </tr>
                {s.rows.map((r, i) => (
                  <tr key={`${r.voucherId}:${i}`} className="clickable" onClick={() => onOpenVoucher(r.voucherId)}>
                    <td>{formatDayMonth(r.date)}</td>
                    <td>{r.number}</td>
                    <td>{r.narration}</td>
                    <td className="num">{amt(r.debitPaise)}</td>
                    <td className="num">{amt(r.creditPaise)}</td>
                    <td className="num">{drCr(r.balancePaise)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td />
                  <td />
                  <td>Closing balance</td>
                  <td className="num">{formatINR(s.rows.reduce((t, r) => t + r.debitPaise, 0))}</td>
                  <td className="num">{formatINR(s.rows.reduce((t, r) => t + r.creditPaise, 0))}</td>
                  <td className="num">{drCr(s.closingPaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Chart of accounts ────────────────────────────────────────────────────────

function ChartOfAccountsModal({ onClose, onOpenAccount }: { onClose: () => void; onOpenAccount: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: finKeys.accounts, queryFn: finApi.accounts });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FinAccountRow | null>(null);
  const rows = q.data ?? [];
  const depth = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const d = new Map<string, number>();
    for (const r of rows) {
      let n = 0;
      let p = r.parentId ? byId.get(r.parentId) : undefined;
      while (p && n < 6) {
        n++;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      d.set(r.id, n);
    }
    return d;
  }, [rows]);
  const groups = rows.filter((r) => r.isGroup);
  const fields: FieldDef[] = [
    { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g. 5310' },
    { name: 'name', label: 'Account name', type: 'text', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() })) },
    { name: 'parentId', label: 'Under group', type: 'select', options: groups.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })), placeholder: 'Top level' },
    { name: 'opening', label: 'Opening balance (₹)', type: 'money' },
    { name: 'side', label: 'Opening side', type: 'select', required: true, options: [{ value: 'DR', label: 'Debit' }, { value: 'CR', label: 'Credit' }] },
  ];
  return (
    <>
      <Modal wide title="Chart of accounts" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={() => setAdding(true)}>Add account</button></>}>
        {q.error ? (
          <ErrorBlock error={q.error} retry={() => void q.refetch()} />
        ) : !q.data ? (
          <Loading />
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 520 }} data-screen-label="Chart of accounts">
            <table className="fin-lines">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="num">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`fin-tree-row${r.isGroup ? '' : ' clickable'}${r.isActive ? '' : ' fin-dim'}`} onClick={r.isGroup ? undefined : () => onOpenAccount(r.id)}>
                    <td>{r.code}</td>
                    <td style={{ paddingLeft: 6 + (depth.get(r.id) ?? 0) * 16, fontWeight: r.isGroup ? 600 : undefined }}>
                      {r.name}
                      {r.partyType && <span className="fin-muted fin-small"> · {r.partyType.toLowerCase()}</span>}
                    </td>
                    <td>{r.type.charAt(0) + r.type.slice(1).toLowerCase()}</td>
                    <td className="num">{drCr(r.balancePaise)}</td>
                    <td className="num">
                      {!r.isGroup && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(r);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {adding && (
        <FormModal
          title="Add account"
          fields={fields}
          submitLabel="Save"
          initial={{ type: 'EXPENSE', side: 'DR' }}
          onSubmit={async (v) => {
            const opening = Number(v.opening ?? 0) || 0;
            await finApi.createAccount({ code: v.code, name: v.name, type: v.type, parentId: v.parentId || null, openingPaise: v.side === 'CR' ? -opening : opening });
            void qc.invalidateQueries({ queryKey: ['finance', 'ledger'] });
            toast('Account added');
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <FormModal
          title={`Edit ${editing.code} · ${editing.name}`}
          fields={[
            { name: 'name', label: 'Account name', type: 'text', required: true, span: 2 },
            ...(editing.isSystem ? [] : [{ name: 'isActive', label: 'Active', type: 'checkbox' as const }]),
          ]}
          submitLabel="Save"
          initial={{ name: editing.name, isActive: editing.isActive }}
          onSubmit={async (v) => {
            await finApi.updateAccount(editing.id, editing.isSystem ? { name: v.name } : { name: v.name, isActive: !!v.isActive });
            void qc.invalidateQueries({ queryKey: ['finance', 'ledger'] });
            toast('Saved');
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ── Lock books ───────────────────────────────────────────────────────────────

function LockBooksDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const [upTo, setUpTo] = useState(current ?? '');
  const lock = useAction(() => finApi.lockBooks(upTo), {
    success: (r) => `Books locked up to ${formatDate(r.booksLockedUpTo)}${r.draftInvoicesInPeriod ? ` · ${r.draftInvoicesInPeriod} draft invoices fall inside` : ''}`,
    invalidate: FIN_ALL,
    onSuccess: onClose,
  });
  return (
    <Modal
      title="Lock books"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!upTo || lock.isPending} onClick={() => lock.mutate(undefined)}>{lock.isPending ? 'Locking…' : 'Lock books'}</button>
        </>
      }
    >
      <div className="dialog-body">No voucher, invoice, payment or purchase can be dated on or before this day once the books are locked (e.g. after filing GSTR-3B).</div>
      <Field label="Lock up to" htmlFor="lock-date" hint={current ? `Currently locked up to ${formatDate(current)}` : 'Books are open'}>
        <input id="lock-date" type="date" className="input" max={todayKey()} value={upTo} onChange={(e) => setUpTo(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ── New voucher (FORMS.voucher) ──────────────────────────────────────────────

type VType = 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'HR';
type JLine = { key: number; accountId: string; debit: string; credit: string };
let lineKey = 0;
const blankLine = (): JLine => ({ key: ++lineKey, accountId: '', debit: '', credit: '' });

function VoucherForm({ full, onClose, onPosted }: { full: boolean; onClose: () => void; onPosted: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const options = useQuery({ queryKey: finKeys.ledgerOptions, queryFn: finApi.ledgerOptions });
  const employees = useLookups(['employees']);
  const o = options.data;
  const [type, setType] = useState<VType>(full ? 'PAYMENT' : 'HR');
  const [date, setDate] = useState(todayKey());
  const [accountId, setAccountId] = useState('');
  const [counterId, setCounterId] = useState('');
  const [amount, setAmount] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [narration, setNarration] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<JLine[]>([blankLine(), blankLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ledgers = o?.ledgers ?? [];
  const counters = (o?.counters ?? []).filter((c) => (type === 'HR' ? true : c.systemKey !== 'REIMB_PAYABLE'));
  const byKey = (key: string) => ledgers.find((l) => l.systemKey === key)?.value;
  // Sensible defaults per type: Office supplies for payments, a client ledger for receipts, Staff welfare for HR.
  useEffect(() => {
    if (!o) return;
    const pick =
      type === 'PAYMENT'
        ? byKey('OFFICE_SUPPLIES') ?? ledgers.find((l) => l.type === 'EXPENSE')?.value
        : type === 'RECEIPT'
          ? ledgers.find((l) => l.type === 'ASSET' && !l.systemKey && /debtor|client/i.test(l.label))?.value ?? ledgers.find((l) => l.type === 'INCOME')?.value
          : type === 'HR'
            ? byKey('STAFF_WELFARE') ?? ledgers.find((l) => l.type === 'EXPENSE')?.value
            : undefined;
    setAccountId(pick ?? ledgers[0]?.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, o]);
  useEffect(() => {
    if (!o) return;
    const key = type === 'HR' && employeeId ? 'REIMB_PAYABLE' : 'BANK';
    setCounterId(o.counters.find((c) => c.systemKey === key)?.value ?? o.counters[0]?.value ?? '');
  }, [type, employeeId, o]);

  const jl = lines.map((l) => ({ ...l, dr: l.debit ? rupeesToPaise(l.debit) : 0, cr: l.credit ? rupeesToPaise(l.credit) : 0 }));
  const sumDr = jl.reduce((s, l) => s + (Number.isFinite(l.dr) ? l.dr : 0), 0);
  const sumCr = jl.reduce((s, l) => s + (Number.isFinite(l.cr) ? l.cr : 0), 0);
  const diff = sumDr - sumCr;
  const setLine = (key: number, patch: Partial<JLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Date is required';
    else if (date > todayKey()) errs.date = 'Voucher date cannot be in the future';
    if (narration.trim().length < 2) errs.narration = 'Narration is required';
    const amountPaise = rupeesToPaise(amount);
    if (type === 'JOURNAL') {
      const used = jl.filter((l) => l.accountId && (l.dr || l.cr));
      if (used.length < 2) errs.lines = 'A journal needs at least two lines';
      else if (jl.some((l) => l.dr && l.cr)) errs.lines = 'A line can be either a debit or a credit, not both';
      else if (diff !== 0) errs.lines = `Debits and credits don't match. Difference ${formatINR(Math.abs(diff), { decimals: true })}`;
    } else {
      if (!accountId) errs.accountId = 'Ledger is required';
      if (!(amountPaise > 0)) errs.amountPaise = 'Amount must be more than zero';
      if (accountId && accountId === counterId) errs.counterAccountId = 'Ledger and bank/cash account must be different';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const attachmentFileId = file ? (await uploadFile(file, 'voucher')).id : null;
      const r = await finApi.createVoucher({
        type,
        date,
        narration: narration.trim(),
        accountId: type === 'JOURNAL' ? null : accountId,
        amountPaise: type === 'JOURNAL' ? null : amountPaise,
        counterAccountId: type === 'JOURNAL' ? null : counterId || null,
        employeeId: type === 'HR' && employeeId ? employeeId : null,
        attachmentFileId,
        lines: type === 'JOURNAL' ? jl.filter((l) => l.accountId && (l.dr || l.cr)).map((l) => ({ accountId: l.accountId, debitPaise: l.dr, creditPaise: l.cr, narration: null })) : undefined,
      });
      void qc.invalidateQueries({ queryKey: finKeys.all });
      toast(`Voucher ${r.number} posted`);
      onPosted(r.id);
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const ledgerSelect = (id: string, value: string, onChange: (v: string) => void, invalid?: boolean) => (
    <select id={id} className="input" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Select…</option>}
      {ledgers.map((l) => (
        <option key={l.value} value={l.value}>{l.code} · {l.label}</option>
      ))}
    </select>
  );

  return (
    <Modal
      wide={type === 'JOURNAL'}
      title="New voucher"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !o} onClick={() => void submit()}>{busy ? 'Posting…' : 'Save'}</button>
        </>
      }
    >
      {!o ? (
        options.error ? <ErrorBlock error={options.error} retry={() => void options.refetch()} /> : <Loading />
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Type" htmlFor="v-type">
            <select id="v-type" className="input" value={type} disabled={!full} onChange={(e) => setType(e.target.value as VType)}>
              {full && <option value="PAYMENT">Payment</option>}
              {full && <option value="RECEIPT">Receipt</option>}
              {full && <option value="JOURNAL">Journal</option>}
              <option value="HR">HR voucher</option>
            </select>
          </Field>
          <Field label="Date" htmlFor="v-date" error={errors.date}>
            <input id="v-date" type="date" className="input" max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {type !== 'JOURNAL' ? (
            <>
              <Field label="Ledger" htmlFor="v-ledger" error={errors.accountId}>
                {ledgerSelect('v-ledger', accountId, setAccountId, !!errors.accountId)}
              </Field>
              <Field label="Amount" htmlFor="v-amt" error={errors.amountPaise}>
                <input id="v-amt" className="input" inputMode="decimal" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {type === 'HR' && (
                <Field label="Employee" htmlFor="v-emp" hint="Optional — a reimbursement to this employee">
                  <select id="v-emp" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                    <option value="">No employee</option>
                    {lookupOpts(employees.data, 'employees').map((e) => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={type === 'HR' ? 'Paid from / Payable' : type === 'RECEIPT' ? 'Received in' : 'Paid from'} htmlFor="v-counter" error={errors.counterAccountId}>
                <select id="v-counter" className="input" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                  {counters.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <div className="span-2 fin-journal">
              <div className="fin-journal-row fin-journal-head">
                <span>Account</span>
                <span>Debit</span>
                <span>Credit</span>
                <span />
              </div>
              {lines.map((l) => (
                <div key={l.key} className="fin-journal-row">
                  {ledgerSelect(`v-line-${l.key}`, l.accountId, (v) => setLine(l.key, { accountId: v }))}
                  <input className="input" inputMode="decimal" aria-label="Debit" value={l.debit} onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                  <input className="input" inputMode="decimal" aria-label="Credit" value={l.credit} onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button>
                </div>
              ))}
              <div className="row-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={lines.length >= 40} onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</button>
                <span className={`fin-diff ${diff === 0 && sumDr > 0 ? 'ok' : 'bad'}`}>
                  Dr {formatINR(sumDr, { decimals: true })} · Cr {formatINR(sumCr, { decimals: true })} · {diff === 0 ? (sumDr > 0 ? 'Balanced' : 'Enter amounts') : `Difference ${formatINR(Math.abs(diff), { decimals: true })}`}
                </span>
              </div>
              {errors.lines && <div className="field-error">{errors.lines}</div>}
            </div>
          )}
          <Field span2 label="Narration" htmlFor="v-narr" error={errors.narration}>
            <textarea id="v-narr" className="input" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Amazon order – stationery" />
          </Field>
          <Field span2 label="Attachment" hint="Optional — bill, receipt or approval">
            <FileDrop file={file} onFile={setFile} accept="application/pdf,image/png,image/jpeg,image/webp" />
          </Field>
          <button type="submit" hidden />
        </form>
      )}
      {formError && <div className="field-error" role="alert">{formError}</div>}
    </Modal>
  );
}

