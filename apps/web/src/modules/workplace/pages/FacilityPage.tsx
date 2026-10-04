import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { FacilityRow, FrontDeskCard, RoomAvailability, RoomRow, VisitorPassResult } from '@lexisora/shared';
import { useCan, useMe } from '@/lib/auth';
import { useAction } from '@/lib/query';
import { useToast } from '@/lib/toast';
import { ConfirmDialog, Empty, ErrorBlock, Loading, Modal, PageHeader, Pills, Seg, Tabs, Tag } from '@/components/ui';
import { DataTable, type Column } from '@/components/table';
import { FormModal, MultiSelect, type FieldDef } from '@/components/form';
import { opts, useLookups } from '@/components/lookups';
import { hubApi, hubKeys, istTodayKey, type FacilityQuery } from '../api-b';
import '../workplace.css';
import '../hub.css';

type Tab = 'bookings' | 'visitors' | 'frontdesk' | 'rooms';
type BookingDraft = { roomId?: string; date?: string; from?: string; to?: string };

const SLOT_MIN = 15;
const DAY_FROM = 8 * 60;
const DAY_TO = 21 * 60;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Next quarter hour from now (IST), clamped to the bookable day. */
function nextQuarter(): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  const m = Math.ceil((ist.getUTCHours() * 60 + ist.getUTCMinutes()) / SLOT_MIN) * SLOT_MIN;
  return toHHMM(Math.min(Math.max(m, DAY_FROM + 60), DAY_TO - 60));
}
const plus = (t: string, mins: number) => toHHMM(Math.min(toMin(t) + mins, DAY_TO));

/** Rooms & visitors — GEN.facility + FORMS.booking / FORMS.visitor (spec §8). */
export default function FacilityPage() {
  const can = useCan();
  const manage = can('facility.manage');
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'bookings';
  const [booking, setBooking] = useState<BookingDraft | null>(null);
  const [visitor, setVisitor] = useState<{ walkIn: boolean } | null>(null);
  const [pass, setPass] = useState<VisitorPassResult | null>(null);
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
      return n;
    });
  // Counts for the tab labels come from the list endpoint (both tabs share the query shape).
  const countsQ = useQuery({ queryKey: hubKeys.facilityList({ tab: 'bookings', scope: 'all' }), queryFn: () => hubApi.facility({ tab: 'bookings', scope: 'all' }) });
  const counts = countsQ.data?.counts;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'bookings', label: `Room bookings${counts ? ` · ${counts.bookings}` : ''}` },
    { value: 'visitors', label: `Visitor log${counts ? ` · ${counts.visitors}` : ''}` },
    ...(manage ? [{ value: 'frontdesk' as const, label: 'Front desk' }, { value: 'rooms' as const, label: 'Rooms' }] : []),
  ];

  return (
    <div data-screen-label="Rooms & visitors" className="stack" style={{ gap: 18 }}>
      <PageHeader
        title="Rooms & visitors"
        sub="Book conference rooms and register visitors to issue e-passes."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setVisitor({ walkIn: false })}>Register visitor</button>
            <button className="btn btn-primary" onClick={() => setBooking({})}>Book room</button>
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={(v) => set({ tab: v === 'bookings' ? null : v, view: null })} />
      {tab === 'bookings' && <BookingsTab onBook={setBooking} />}
      {tab === 'visitors' && <VisitorsTab manage={manage} onPass={setPass} />}
      {tab === 'frontdesk' && manage && <FrontDeskTab onWalkIn={() => setVisitor({ walkIn: true })} />}
      {tab === 'rooms' && manage && <RoomsTab />}
      {booking && <BookRoomModal draft={booking} onClose={() => setBooking(null)} />}
      {visitor && <VisitorModal walkIn={visitor.walkIn} manage={manage} onClose={() => setVisitor(null)} onDone={(r) => { setVisitor(null); setPass(r); }} />}
      {pass && <PassModal result={pass} onClose={() => setPass(null)} />}
    </div>
  );
}

// ── Room bookings ─────────────────────────────────────────────────────────

function BookingsTab({ onBook }: { onBook: (d: BookingDraft) => void }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'day' ? 'day' : 'list';
  const scope = (params.get('scope') as 'mine' | 'all') || 'all';
  const date = params.get('date') ?? '';
  const roomId = params.get('room') ?? '';
  const setP = (k: string, v: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      v ? n.set(k, v) : n.delete(k);
      return n;
    });
  const rooms = useQuery({ queryKey: hubKeys.rooms(false), queryFn: () => hubApi.rooms(false) });
  const q: FacilityQuery = { tab: 'bookings', scope, ...(date ? { date } : {}), ...(roomId ? { roomId } : {}) };
  const list = useQuery({ queryKey: hubKeys.facilityList(q), queryFn: () => hubApi.facility(q), enabled: view === 'list' });
  const [edit, setEdit] = useState<FacilityRow | null>(null);
  const [cancel, setCancel] = useState<FacilityRow | null>(null);
  const [reason, setReason] = useState('');
  const doCancel = useAction((r: FacilityRow) => hubApi.cancelBooking(r.id, reason.trim() || null), { success: (_, r) => `${r.name} booking cancelled`, invalidate: [hubKeys.facility] });

  const columns: Column<FacilityRow>[] = [
    { key: 'room', header: 'Room', render: (r) => <strong>{r.name}</strong> },
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'time', header: 'Time', render: (r) => <span className="num">{r.time}</span> },
    { key: 'host', header: 'Host', render: (r) => r.host },
    { key: 'purpose', header: 'Purpose', render: (r) => r.purpose },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={r.tone}>{r.statusLabel}</Tag> },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {r.canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit time</button>}
          {r.canCancel && <button className="btn btn-ghost btn-sm" onClick={() => { setReason(''); setCancel(r); }}>Cancel</button>}
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="wp-filters row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Seg options={[{ value: 'list', label: 'List' }, { value: 'day', label: 'Day calendar' }]} value={view} onChange={(v) => setP('view', v === 'list' ? null : v)} />
        {view === 'list' && <Pills options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'My bookings' }]} value={scope} onChange={(v) => setP('scope', v === 'all' ? null : v)} />}
        {view === 'list' && (
          <select className="input" style={{ width: 170 }} aria-label="Room" value={roomId} onChange={(e) => setP('room', e.target.value || null)}>
            <option value="">All rooms</option>
            {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.branch ? ` · ${r.branch}` : ''}</option>)}
          </select>
        )}
        <input className="input" type="date" style={{ width: 160 }} aria-label="Date" value={view === 'day' ? date || istTodayKey() : date} onChange={(e) => setP('date', e.target.value || null)} />
        {view === 'list' && date && <button className="btn btn-ghost btn-sm" onClick={() => setP('date', null)}>Clear date</button>}
      </div>
      {view === 'day' ? (
        <DayCalendar date={date || istTodayKey()} onPick={onBook} />
      ) : list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable columns={columns} rows={list.data?.items} rowKey={(r) => r.id} loading={list.isLoading} empty={scope === 'mine' ? 'You have no bookings in this range.' : 'No room bookings in this range.'} />
        </div>
      )}
      {edit && <EditTimeModal row={edit} onClose={() => setEdit(null)} />}
      {cancel && (
        <ConfirmDialog
          title={`Cancel ${cancel.name} · ${cancel.date} ${cancel.time}?`}
          body={
            <div className="stack" style={{ gap: 8 }}>
              <span>Attendees get a cancellation email.</span>
              <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
            </div>
          }
          confirmLabel="Cancel booking"
          danger
          busy={doCancel.isPending}
          onConfirm={() => doCancel.mutate(cancel, { onSuccess: () => setCancel(null) })}
          onClose={() => setCancel(null)}
        />
      )}
    </div>
  );
}

/** Rooms as columns, 15-minute rows 08:00–21:00; drag over free slots to book. */
function DayCalendar({ date, onPick }: { date: string; onPick: (d: BookingDraft) => void }) {
  const avail = useQuery({ queryKey: hubKeys.availability(date), queryFn: () => hubApi.availability(date) });
  const [sel, setSel] = useState<{ roomId: string; a: number; b: number } | null>(null);
  const dragging = useRef(false);
  const slots = useMemo(() => Array.from({ length: (DAY_TO - DAY_FROM) / SLOT_MIN }, (_, i) => DAY_FROM + i * SLOT_MIN), []);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setSel((s) => {
        if (s) {
          const lo = Math.min(s.a, s.b);
          const hi = Math.max(s.a, s.b);
          // A single click books 30 minutes when the next slot is free too.
          onPick({ roomId: s.roomId, date, from: toHHMM(lo), to: toHHMM(hi + SLOT_MIN * (lo === hi ? 2 : 1)) });
        }
        return null;
      });
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [date, onPick]);

  if (avail.isLoading) return <Loading />;
  if (avail.error) return <ErrorBlock error={avail.error} retry={() => void avail.refetch()} />;
  const rooms = avail.data?.rooms ?? [];
  if (!rooms.length) return <Empty>No rooms are set up yet.</Empty>;

  const busyAt = (r: RoomAvailability['rooms'][number], m: number) => r.busy.find((b) => toMin(b.from) < m + SLOT_MIN && toMin(b.to) > m) ?? null;
  const closed = (r: RoomAvailability['rooms'][number], m: number) => m < toMin(r.openFrom) || m + SLOT_MIN > toMin(r.openTo);
  const past = (m: number) => {
    if (date > istTodayKey()) return false;
    if (date < istTodayKey()) return true;
    const ist = new Date(Date.now() + 330 * 60_000);
    return m + SLOT_MIN <= ist.getUTCHours() * 60 + ist.getUTCMinutes();
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="muted" style={{ fontSize: 12.5 }}>Drag across free slots in a room to book it. Dark blocks are your bookings.</div>
      <div className="wp-day-grid" style={{ gridTemplateColumns: `56px repeat(${rooms.length}, minmax(120px, 1fr))`, maxHeight: 560 }} role="grid" aria-label={`Room calendar for ${date}`}>
        <div className="wp-room-head" style={{ borderLeft: 0 }} />
        {rooms.map((r) => <div key={r.id} className="wp-room-head">{r.name} <span className="muted" style={{ fontWeight: 400 }}>· {r.capacity}</span></div>)}
        {slots.map((m) => (
          <div key={m} style={{ display: 'contents' }}>
            <div className="wp-hour">{m % 60 === 0 ? toHHMM(m) : ''}</div>
            {rooms.map((r) => {
              const b = busyAt(r, m);
              const off = closed(r, m) || past(m);
              const isStart = !!b && ((toMin(b.from) >= m && toMin(b.from) < m + SLOT_MIN) || m === DAY_FROM);
              const inSel = sel && sel.roomId === r.id && m >= Math.min(sel.a, sel.b) && m <= Math.max(sel.a, sel.b);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`wp-slot${b ? ` is-busy${b.mine ? ' is-mine' : ''}` : ''}${inSel ? ' is-sel' : ''}`}
                  style={{ ...(off && !b ? { background: 'var(--color-neutral-200)', cursor: 'not-allowed' } : {}), color: '#fff', fontSize: 11, textAlign: 'left', paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap' }}
                  title={b ? `${b.from} – ${b.to} · ${b.host} · ${b.purpose}` : `${r.name} · ${toHHMM(m)}`}
                  aria-label={b ? `${r.name} ${b.from} to ${b.to} booked by ${b.host}` : `${r.name} ${toHHMM(m)} ${off ? 'unavailable' : 'free'}`}
                  disabled={!!b || off}
                  onMouseDown={(e) => {
                    if (b || off) return;
                    e.preventDefault();
                    dragging.current = true;
                    setSel({ roomId: r.id, a: m, b: m });
                  }}
                  onMouseEnter={() => {
                    if (!dragging.current || !sel || sel.roomId !== r.id || b || off) return;
                    // Stop the drag at the first busy slot between the anchor and here.
                    const lo = Math.min(sel.a, m);
                    const hi = Math.max(sel.a, m);
                    for (let x = lo; x <= hi; x += SLOT_MIN) if (busyAt(r, x)) return;
                    setSel({ ...sel, b: m });
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !b && !off) {
                      e.preventDefault();
                      onPick({ roomId: r.id, date, from: toHHMM(m), to: toHHMM(m + 2 * SLOT_MIN) });
                    }
                  }}
                >
                  {b && isStart ? `${b.host.split(' ')[0]} · ${b.purpose}` : ''}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function useBookingCheck(v: { roomId: string; date: string; from: string; to: string }, excludeId?: string) {
  const [res, setRes] = useState<{ ok: boolean; message: string | null } | null>(null);
  useEffect(() => {
    if (!v.roomId || !v.date || !v.from || !v.to) return setRes(null);
    if (toMin(v.to) <= toMin(v.from)) return setRes({ ok: false, message: 'End time must be after the start time' });
    let live = true;
    const t = setTimeout(() => {
      hubApi
        .checkBooking({ roomId: v.roomId, date: v.date, from: v.from, to: v.to, ...(excludeId ? { excludeId } : {}) })
        .then((r) => live && setRes(r))
        .catch(() => live && setRes(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [v.roomId, v.date, v.from, v.to, excludeId]);
  return res;
}

function BookRoomModal({ draft, onClose }: { draft: BookingDraft; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useMe();
  const rooms = useQuery({ queryKey: hubKeys.rooms(false), queryFn: () => hubApi.rooms(false) });
  const lk = useLookups(['employees']);
  const people = opts(lk.data, 'employees').filter((o) => o.value !== me.employeeId);
  const initialFrom = draft.from ?? nextQuarter();
  const [v, setV] = useState({ roomId: draft.roomId ?? '', date: draft.date ?? istTodayKey(), from: initialFrom, to: draft.to ?? plus(initialFrom, 60), purpose: '' });
  const [attendees, setAttendees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roomId = v.roomId || rooms.data?.[0]?.id || '';
  const check = useBookingCheck({ ...v, roomId });
  const room = rooms.data?.find((r) => r.id === roomId);
  const upd = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));

  async function submit() {
    if (!roomId) return setErr('Pick a room');
    if (v.purpose.trim().length < 2) return setErr('Purpose is required');
    if (check && !check.ok) return setErr(check.message);
    setBusy(true);
    setErr(null);
    try {
      const row = await hubApi.book({ roomId, date: v.date, from: v.from, to: v.to, purpose: v.purpose.trim(), attendeeEmployeeIds: attendees });
      toast(`${row.name} booked · ${row.date} ${row.time}`);
      await qc.invalidateQueries({ queryKey: hubKeys.facility });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Book room" onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (!!check && !check.ok)} onClick={() => void submit()}>{busy ? 'Booking…' : 'Book'}</button></>}>
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="b-room">Room</label>
          <select id="b-room" className="input" value={roomId} onChange={(e) => upd('roomId', e.target.value)}>
            {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} · seats {r.capacity}{r.branch ? ` · ${r.branch}` : ''}</option>)}
          </select>
          {room && room.amenities.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{room.amenities.join(' · ')}</div>}
        </div>
        <div className="field span-2"><label htmlFor="b-date">Date</label><input id="b-date" className="input" type="date" min={istTodayKey()} value={v.date} onChange={(e) => upd('date', e.target.value)} /></div>
        <div className="field"><label htmlFor="b-from">From</label><input id="b-from" className="input" type="time" step={900} value={v.from} onChange={(e) => upd('from', e.target.value)} /></div>
        <div className="field"><label htmlFor="b-to">To</label><input id="b-to" className="input" type="time" step={900} value={v.to} onChange={(e) => upd('to', e.target.value)} /></div>
        <div className="field span-2"><label htmlFor="b-purpose">Purpose</label><input id="b-purpose" className="input" maxLength={120} value={v.purpose} onChange={(e) => upd('purpose', e.target.value)} placeholder="Sprint planning" /></div>
        <div className="field span-2"><label>Attendees (optional)</label><MultiSelect options={people} value={attendees} onChange={setAttendees} /><div className="muted" style={{ fontSize: 12 }}>They get a calendar invite by email.</div></div>
      </div>
      {check && <div className={check.ok ? 'note' : 'field-error'} role={check.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{check.message}</div>}
      {err && (!check || check.ok || err !== check.message) && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}

function EditTimeModal({ row, onClose }: { row: FacilityRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState({ date: row.dateKey, from: row.from ?? '10:00', to: row.to ?? '11:00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useBookingCheck({ roomId: row.roomId ?? '', ...v }, row.id);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await hubApi.updateBooking(row.id, v);
      toast(`${r.name} moved to ${r.date} ${r.time}`);
      await qc.invalidateQueries({ queryKey: hubKeys.facility });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Edit time · ${row.name}`} onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (!!check && !check.ok)} onClick={() => void submit()}>Save</button></>}>
      <div className="form-grid">
        <div className="field span-2"><label htmlFor="e-date">Date</label><input id="e-date" className="input" type="date" min={istTodayKey()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <div className="field"><label htmlFor="e-from">From</label><input id="e-from" className="input" type="time" step={900} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></div>
        <div className="field"><label htmlFor="e-to">To</label><input id="e-to" className="input" type="time" step={900} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></div>
      </div>
      {check && <div className={check.ok ? 'note' : 'field-error'} style={{ marginTop: 8 }}>{check.message}</div>}
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}

// ── Visitor log ───────────────────────────────────────────────────────────

function VisitorsTab({ manage, onPass }: { manage: boolean; onPass: (r: VisitorPassResult) => void }) {
  const [scope, setScope] = useState<'mine' | 'all'>(manage ? 'all' : 'mine');
  const [date, setDate] = useState('');
  const q: FacilityQuery = { tab: 'visitors', scope, ...(date ? { date } : {}) };
  const list = useQuery({ queryKey: hubKeys.facilityList(q), queryFn: () => hubApi.facility(q) });
  const [cancel, setCancel] = useState<FacilityRow | null>(null);
  const inv = [hubKeys.facility];
  const resend = useAction((r: FacilityRow) => hubApi.resendPass(r.id), { success: (r) => r.toast, invalidate: inv, onSuccess: (r) => onPass(r) });
  const doCancel = useAction((r: FacilityRow) => hubApi.cancelVisitor(r.id), { success: (_, r) => `Visit by ${r.name} cancelled · e-pass revoked`, invalidate: inv });
  const checkIn = useAction((r: FacilityRow) => hubApi.checkIn(r.id), { success: (c) => `${c.name} checked in · host notified`, invalidate: inv });
  const checkOut = useAction((r: FacilityRow) => hubApi.checkOut(r.id), { success: (c) => `${c.name} checked out`, invalidate: inv });

  const columns: Column<FacilityRow>[] = [
    { key: 'name', header: 'Visitor', render: (r) => <strong>{r.name}</strong> },
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'time', header: 'Time', render: (r) => <span className="num">{r.time}</span> },
    { key: 'host', header: 'Host', render: (r) => r.host },
    { key: 'purpose', header: 'Purpose', render: (r) => r.purpose },
    { key: 'status', header: 'Status', render: (r) => <Tag tone={r.tone}>{r.statusLabel}</Tag> },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {r.canCheckIn && <button className="btn btn-secondary btn-sm" disabled={checkIn.isPending} onClick={() => checkIn.mutate(r)}>Check in</button>}
          {r.canCheckOut && <button className="btn btn-secondary btn-sm" disabled={checkOut.isPending} onClick={() => checkOut.mutate(r)}>Check out</button>}
          {r.passLink && (r.status === 'PASS_SENT' || r.status === 'REGISTERED' || r.status === 'CHECKED_IN') && <a className="btn btn-ghost btn-sm" href={r.passLink} target="_blank" rel="noreferrer">E-pass</a>}
          {r.waLink && <a className="btn btn-ghost btn-sm" href={r.waLink} target="_blank" rel="noreferrer">WhatsApp</a>}
          {r.canResend && <button className="btn btn-ghost btn-sm" disabled={resend.isPending} onClick={() => resend.mutate(r)}>Resend</button>}
          {r.canCancel && <button className="btn btn-ghost btn-sm" onClick={() => setCancel(r)}>Cancel</button>}
        </span>
      ),
    },
  ];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {manage && <Pills options={[{ value: 'all', label: 'All visitors' }, { value: 'mine', label: 'My visitors' }]} value={scope} onChange={setScope} />}
        <input className="input" type="date" style={{ width: 160 }} aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        {date && <button className="btn btn-ghost btn-sm" onClick={() => setDate('')}>Clear date</button>}
        {!manage && <span className="muted" style={{ fontSize: 12.5 }}>Visitors you host. Reception sees everyone.</span>}
      </div>
      {list.error ? (
        <ErrorBlock error={list.error} retry={() => void list.refetch()} />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable columns={columns} rows={list.data?.items} rowKey={(r) => r.id} loading={list.isLoading} empty="No visitors in this range. Register one to send an e-pass." />
        </div>
      )}
      {cancel && (
        <ConfirmDialog
          title={`Cancel the visit by ${cancel.name}?`}
          body="The e-pass stops working immediately."
          confirmLabel="Cancel visit"
          danger
          busy={doCancel.isPending}
          onConfirm={() => doCancel.mutate(cancel, { onSuccess: () => setCancel(null) })}
          onClose={() => setCancel(null)}
        />
      )}
    </div>
  );
}

function VisitorModal({ walkIn, manage, onClose, onDone }: { walkIn: boolean; manage: boolean; onClose: () => void; onDone: (r: VisitorPassResult) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useMe();
  const lk = useLookups(['employees']);
  const hosts = opts(lk.data, 'employees');
  const ist = new Date(Date.now() + 330 * 60_000);
  const nowHHMM = toHHMM(Math.ceil((ist.getUTCHours() * 60 + ist.getUTCMinutes()) / 5) * 5);
  const [v, setV] = useState({ name: '', company: '', hostEmployeeId: me.employeeId ?? '', date: istTodayKey(), expectedTime: walkIn ? nowHHMM : '10:00', phone: '', email: '', purpose: walkIn ? 'Walk-in' : 'Client visit', sendVia: 'WHATSAPP' as 'WHATSAPP' | 'EMAIL' | 'BOTH' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const upd = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const sendVia = !v.phone.trim() && v.sendVia !== 'EMAIL' ? (v.email.trim() ? 'EMAIL' : v.sendVia) : v.sendVia;

  async function submit() {
    const fe: Record<string, string> = {};
    if (v.name.trim().length < 2) fe.name = 'Visitor name is required';
    const phone = v.phone.replace(/[\s-]/g, '');
    if (phone && !/^(\+91)?[6-9]\d{9}$/.test(phone)) fe.phone = 'Enter a valid Indian mobile number';
    if (!phone && !v.email.trim() && !walkIn) fe.phone = 'Add a phone or an email to send the e-pass';
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await hubApi.registerVisitor({
        name: v.name.trim(),
        company: v.company.trim() || null,
        hostEmployeeId: manage ? v.hostEmployeeId || null : null,
        date: walkIn ? istTodayKey() : v.date,
        expectedTime: v.expectedTime,
        phone: phone || null,
        email: v.email.trim() || null,
        purpose: v.purpose.trim() || 'Visit',
        sendVia,
        walkIn,
      });
      toast(walkIn ? `${v.name.trim()} checked in · host notified` : r.toast);
      await qc.invalidateQueries({ queryKey: hubKeys.facility });
      onDone(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={walkIn ? 'Walk-in visitor' : 'Register visitor'} onClose={onClose} actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Sending…' : walkIn ? 'Register & check in' : 'Send e-pass'}</button></>}>
      <div className="form-grid">
        <div className="field"><label htmlFor="v-name">Visitor name</label><input id="v-name" className="input" value={v.name} onChange={(e) => upd('name', e.target.value)} aria-invalid={!!fieldErr.name} />{fieldErr.name && <div className="field-error">{fieldErr.name}</div>}</div>
        <div className="field"><label htmlFor="v-company">Company</label><input id="v-company" className="input" value={v.company} onChange={(e) => upd('company', e.target.value)} /></div>
        <div className="field">
          <label htmlFor="v-host">Host</label>
          <select id="v-host" className="input" value={v.hostEmployeeId} disabled={!manage} onChange={(e) => upd('hostEmployeeId', e.target.value)}>
            {!hosts.some((h) => h.value === v.hostEmployeeId) && <option value={v.hostEmployeeId}>{me.name}</option>}
            {hosts.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="v-date">Date</label><input id="v-date" className="input" type="date" min={istTodayKey()} disabled={walkIn} value={walkIn ? istTodayKey() : v.date} onChange={(e) => upd('date', e.target.value)} /></div>
        <div className="field"><label htmlFor="v-time">Expected time</label><input id="v-time" className="input" type="time" step={300} value={v.expectedTime} onChange={(e) => upd('expectedTime', e.target.value)} /></div>
        <div className="field"><label htmlFor="v-purpose">Purpose</label><input id="v-purpose" className="input" maxLength={160} value={v.purpose} onChange={(e) => upd('purpose', e.target.value)} /></div>
        <div className="field span-2"><label htmlFor="v-phone">Phone</label><input id="v-phone" className="input" inputMode="tel" placeholder="+91 98250 12345" value={v.phone} onChange={(e) => upd('phone', e.target.value)} aria-invalid={!!fieldErr.phone} />{fieldErr.phone && <div className="field-error">{fieldErr.phone}</div>}</div>
        <div className="field"><label htmlFor="v-email">Email (optional)</label><input id="v-email" className="input" type="email" value={v.email} onChange={(e) => upd('email', e.target.value)} /></div>
        <div className="field">
          <label htmlFor="v-via">Send pass via</label>
          <select id="v-via" className="input" value={sendVia} onChange={(e) => upd('sendVia', e.target.value)}>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
            <option value="BOTH">WhatsApp and email</option>
          </select>
        </div>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
    </Modal>
  );
}

function PassModal({ result, onClose }: { result: VisitorPassResult; onClose: () => void }) {
  const r = result.row;
  return (
    <Modal title="E-pass" onClose={onClose} actions={<><a className="btn btn-secondary" href={result.passUrl} target="_blank" rel="noreferrer">Open pass</a>{result.waLink && <a className="btn btn-primary" href={result.waLink} target="_blank" rel="noreferrer">Send on WhatsApp</a>}<button className="btn btn-secondary" onClick={onClose}>Done</button></>}>
      <div className="wp-pass">
        <img src={`${result.passUrl}/qr.png`} alt={`QR code for ${r.name}`} />
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 16 }}>{r.name}</strong>
          <span className="muted">{r.date} · {r.time} · Host {r.host}</span>
          <span>{r.purpose}</span>
          {r.shortCode && <div><div className="kicker">Pass code</div><div className="wp-pass-code">{r.shortCode}</div></div>}
          <Tag tone={r.tone}>{r.statusLabel}</Tag>
          {result.delivered.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>Sent via {result.delivered.join(' and ')}.</span>}
        </div>
      </div>
    </Modal>
  );
}

// ── Front desk (facility.manage) ──────────────────────────────────────────

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function FrontDeskTab({ onWalkIn }: { onWalkIn: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useToast();
  const desk = useQuery({ queryKey: hubKeys.frontDesk, queryFn: hubApi.frontDesk, refetchInterval: 60_000 });
  const [code, setCode] = useState('');
  const [card, setCard] = useState<FrontDeskCard | null>(null);
  const [scan, setScan] = useState(false);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  async function lookup(c: string) {
    if (c.trim().length < 4) return;
    try {
      setCard(await hubApi.lookupPass(c.trim()));
    } catch (e) {
      setCard(null);
      toastError(e);
    }
  }
  async function act(kind: 'in' | 'out', id: string) {
    try {
      const c = kind === 'in' ? await hubApi.checkIn(id) : await hubApi.checkOut(id);
      setCard((x) => (x && x.id === id ? c : x));
      toast(kind === 'in' ? `${c.name} checked in · host notified` : `${c.name} checked out`);
      await qc.invalidateQueries({ queryKey: hubKeys.facility });
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="grid-2-1">
      <div className="stack" style={{ gap: 14 }}>
        <div className="card">
          <div className="card-kicker">Scan or type a pass</div>
          <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
            <input className="input" style={{ flex: 1, minWidth: 180, letterSpacing: 2 }} placeholder="Pass code, e.g. K7Q2M9" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Pass code" />
            <button className="btn btn-primary" type="submit">Find</button>
            {canScan && <button className="btn btn-secondary" type="button" onClick={() => setScan(true)}>Scan QR</button>}
          </form>
          {card && <DeskCard card={card} onAct={act} />}
        </div>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-kicker">Expected today</div>
            <button className="btn btn-ghost btn-sm" onClick={onWalkIn}>Walk-in visitor</button>
          </div>
          {desk.isLoading ? <Loading /> : desk.error ? <ErrorBlock error={desk.error} retry={() => void desk.refetch()} /> : !desk.data?.length ? <Empty>No visitors expected today.</Empty> : (
            <div className="stack" style={{ gap: 0 }}>
              {desk.data.map((c) => (
                <div key={c.id} className="list-row">
                  <span>
                    <strong>{c.name}</strong>{c.company ? ` · ${c.company}` : ''}
                    <div className="muted" style={{ fontSize: 12.5 }}>{c.expectedTime} · Host {c.host}{c.checkedInAt ? ` · in ${c.checkedInAt}` : ''}{c.checkedOutAt ? ` · out ${c.checkedOutAt}` : ''}</div>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Tag tone={c.status === 'CHECKED_IN' ? 'accent' : c.status === 'PASS_SENT' ? 'outline' : 'neutral'}>{c.statusLabel}</Tag>
                    {(c.status === 'PASS_SENT' || c.status === 'REGISTERED') && <button className="btn btn-secondary btn-sm" onClick={() => void act('in', c.id)}>Check in</button>}
                    {c.status === 'CHECKED_IN' && <button className="btn btn-secondary btn-sm" onClick={() => void act('out', c.id)}>Check out</button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-kicker">How it works</div>
        <div className="card-body">Visitors show the QR on their phone or read out the six-character pass code. A pass is valid on the visit date only; checking in notifies the host.</div>
      </div>
      {scan && <ScanModal onClose={() => setScan(false)} onCode={(c) => { setScan(false); setCode(''); void lookup(c); }} />}
    </div>
  );
}

function DeskCard({ card, onAct }: { card: FrontDeskCard; onAct: (k: 'in' | 'out', id: string) => void }) {
  return (
    <div className="wp-desk-card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 16 }}>{card.name}</strong>
        <Tag tone={card.validNow ? 'accent' : 'outline'}>{card.statusLabel}</Tag>
      </div>
      <span className="muted">{card.company ? `${card.company} · ` : ''}Host {card.host}</span>
      <span>{card.date} · expected {card.expectedTime}{card.checkedInAt ? ` · in ${card.checkedInAt}` : ''}{card.checkedOutAt ? ` · out ${card.checkedOutAt}` : ''}</span>
      {card.reason && <div className="field-error">{card.reason}</div>}
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="btn btn-primary" disabled={!card.validNow || card.status === 'CHECKED_IN' || card.status === 'CHECKED_OUT'} onClick={() => onAct('in', card.id)}>Check in</button>
        <button className="btn btn-secondary" disabled={card.status !== 'CHECKED_IN'} onClick={() => onAct('out', card.id)}>Check out</button>
      </div>
    </div>
  );
}

function ScanModal({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    const detector = new Detector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        timer = setInterval(() => {
          if (!video.current || done || video.current.readyState < 2) return;
          void detector.detect(video.current).then((hits) => {
            const raw = hits[0]?.rawValue;
            if (raw && !done) {
              done = true;
              onCode(raw);
            }
          }).catch(() => undefined);
        }, 400);
      })
      .catch(() => setErr('Camera access was blocked. Type the pass code instead.'));
    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <Modal title="Scan e-pass" onClose={onClose} actions={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {err ? <div className="field-error">{err}</div> : <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 4, background: '#111', aspectRatio: '4/3' }} />}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Hold the visitor's QR code up to the camera.</div>
    </Modal>
  );
}

// ── Rooms master (facility.manage) ────────────────────────────────────────

function RoomsTab() {
  const rooms = useQuery({ queryKey: hubKeys.rooms(true), queryFn: () => hubApi.rooms(true) });
  const lk = useLookups(['branches']);
  const branches = opts(lk.data, 'branches');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<RoomRow | 'new' | null>(null);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
    { name: 'branchId', label: 'Location', type: 'select', options: [{ value: '', label: 'Any location' }, ...branches] },
    { name: 'capacity', label: 'Capacity', type: 'number', required: true },
    { name: 'amenities', label: 'Amenities', type: 'text', span: 2, placeholder: 'TV, Whiteboard, Video conferencing', hint: 'Comma-separated' },
    { name: 'active', label: 'Active (bookable)', type: 'checkbox', span: 2 },
  ];
  const columns: Column<RoomRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <strong>{r.name}</strong> },
    { key: 'loc', header: 'Location', render: (r) => r.branch ?? 'Any' },
    { key: 'cap', header: 'Capacity', num: true, render: (r) => r.capacity },
    { key: 'am', header: 'Amenities', render: (r) => r.amenities.join(', ') || '—' },
    { key: 'hours', header: 'Hours', render: (r) => `${r.openFrom} – ${r.openTo}` },
    { key: 'up', header: 'Upcoming', num: true, render: (r) => r.upcoming },
    { key: 'active', header: 'Active', render: (r) => <Tag tone={r.active ? 'accent' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Tag> },
    { key: 'act', header: '', render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit</button> },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-secondary" onClick={() => setEdit('new')}>Add room</button></div>
      {rooms.error ? <ErrorBlock error={rooms.error} retry={() => void rooms.refetch()} /> : (
        <div className="card" style={{ padding: 0 }}><DataTable columns={columns} rows={rooms.data} rowKey={(r) => r.id} loading={rooms.isLoading} empty="No rooms yet." /></div>
      )}
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Add room' : `Edit ${edit.name}`}
          fields={fields}
          submitLabel="Save"
          initial={edit === 'new' ? { capacity: 6, active: true } : { name: edit.name, branchId: edit.branchId ?? '', capacity: edit.capacity, amenities: edit.amenities.join(', '), active: edit.active }}
          onSubmit={async (v) => {
            const body = { name: String(v.name).trim(), capacity: Number(v.capacity) || 1, amenities: String(v.amenities ?? '').split(',').map((s) => s.trim()).filter(Boolean), branchId: v.branchId || null, active: !!v.active };
            if (edit === 'new') await hubApi.createRoom(body);
            else await hubApi.updateRoom(edit.id, body);
            toast(edit === 'new' ? `${body.name} added` : `${body.name} updated`);
            await qc.invalidateQueries({ queryKey: hubKeys.facility });
          }}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
