import { randomBytes, randomInt } from 'node:crypto';
import { istInstant } from '../common/dates';

/** Pure rooms & visitors rules (spec §8.5). */

export const SLOT_MIN = 15;
export const MAX_DAYS_AHEAD = 60;
export const PAST_GRACE_MIN = 5;
/** Unambiguous alphabet for pass short codes: no 0/O, no 1/I/L. */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type Interval = { startAt: Date; endAt: Date };

/** Half-open ranges [start, end): 10:00-11:00 and 11:00-12:00 do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime();
}

export function findConflict<T extends Interval & { id: string; status: string }>(existing: T[], candidate: Interval, excludeId?: string | null): T | null {
  return existing.find((b) => b.status === 'BOOKED' && b.id !== excludeId && overlaps(b, candidate)) ?? null;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Validates a booking request; returns the user-facing problem or null.
 * 15-minute steps, at least 15 minutes, at most the room's maximum, inside the room's open
 * window, not in the past (5 minutes grace) and at most 60 days ahead.
 */
export function bookingProblem(
  p: { date: string; from: string; to: string },
  room: { openFrom: string; openTo: string; maxBookingMins: number; name: string },
  now: Date = new Date(),
): string | null {
  const from = toMin(p.from);
  const to = toMin(p.to);
  if (from % SLOT_MIN || to % SLOT_MIN) return 'Pick times in 15-minute steps';
  if (to <= from) return 'End time must be after the start time';
  if (to - from < SLOT_MIN) return 'Book at least 15 minutes';
  if (to - from > room.maxBookingMins) return `${room.name} can be booked for at most ${Math.round(room.maxBookingMins / 60)} hours`;
  if (from < toMin(room.openFrom) || to > toMin(room.openTo)) return `${room.name} is open ${room.openFrom} – ${room.openTo}`;
  const start = istInstant(p.date, p.from);
  if (start.getTime() < now.getTime() - PAST_GRACE_MIN * 60_000) return 'That time has already passed';
  if (start.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return 'Rooms can be booked up to 60 days ahead';
  return null;
}

/** "11:00 – 12:00" */
export function timeRange(from: string, to: string): string {
  return `${from} – ${to}`;
}

/** Pass validity: from 2 hours before the expected time until 23:59 on the visit date (IST). */
export function passWindow(dateKey: string, expectedTime: string): { validFrom: Date; validUntil: Date } {
  const expected = istInstant(dateKey, expectedTime);
  return { validFrom: new Date(expected.getTime() - 2 * 3_600_000), validUntil: new Date(istInstant(dateKey, '23:59').getTime() + 59_000) };
}

export function isPassValidAt(v: { validFrom: Date; validUntil: Date; passRevokedAt: Date | null }, at: Date = new Date()): boolean {
  return !v.passRevokedAt && at.getTime() >= v.validFrom.getTime() && at.getTime() <= v.validUntil.getTime();
}

export function newShortCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  return s;
}

export function newPassToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Accepts a short code, a raw token, or a scanned pass URL ending in the token. */
export function parsePassCode(input: string): { shortCode?: string; token?: string } {
  const s = input.trim();
  const fromUrl = /\/pass\/([A-Za-z0-9_-]{16,})/.exec(s);
  if (fromUrl) return { token: fromUrl[1] };
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === 6) return { shortCode: code };
  if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return { token: s };
  return { shortCode: code };
}

/** "+91 98250 12345" → "919825012345" (wa.me format); null when not an Indian mobile. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

export function waLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** "E-pass sent on WhatsApp" / "… by email" / "… on WhatsApp and email" / "E-pass ready to share". */
export function passToast(delivered: string[]): string {
  const wa = delivered.includes('WHATSAPP');
  const em = delivered.includes('EMAIL');
  if (wa && em) return 'E-pass sent on WhatsApp and email';
  if (wa) return 'E-pass sent on WhatsApp';
  if (em) return 'E-pass sent by email';
  return 'E-pass ready to share';
}

export const visitorCode = (n: number) => `VIS-${String(n).padStart(4, '0')}`;

/** A host may hold at most 3 overlapping bookings across rooms. */
export const MAX_HOST_OVERLAPS = 3;

export function hostOverlapProblem<T extends Interval & { id: string; status: string }>(hostBookings: T[], candidate: Interval, excludeId?: string | null): string | null {
  const n = hostBookings.filter((b) => b.status === 'BOOKED' && b.id !== excludeId && overlaps(b, candidate)).length;
  return n >= MAX_HOST_OVERLAPS ? `You already have ${MAX_HOST_OVERLAPS} bookings at that time` : null;
}

/** Wireframe tag tones: `~Booked` accent, `!E-pass sent` outline, `-Cancelled` neutral. */
export function bookingTone(status: string): 'accent' | 'outline' | 'neutral' {
  return status === 'BOOKED' ? 'accent' : 'neutral';
}

export function visitorTone(status: string): 'accent' | 'outline' | 'neutral' {
  if (status === 'CHECKED_IN') return 'accent';
  if (status === 'REGISTERED' || status === 'PASS_SENT') return 'outline';
  return 'neutral';
}

const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Minimal RFC 5545 invite (REQUEST) or cancellation (CANCEL) for a room booking. */
export function bookingIcs(p: {
  uid: string;
  method: 'REQUEST' | 'CANCEL';
  startAt: Date;
  endAt: Date;
  summary: string;
  location: string;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string }[];
  sequence?: number;
  now?: Date;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lexisora HRMS//Rooms//EN',
    `METHOD:${p.method}`,
    'BEGIN:VEVENT',
    `UID:${p.uid}`,
    `SEQUENCE:${p.sequence ?? 0}`,
    `DTSTAMP:${icsStamp(p.now ?? new Date())}`,
    `DTSTART:${icsStamp(p.startAt)}`,
    `DTEND:${icsStamp(p.endAt)}`,
    `SUMMARY:${icsText(p.summary)}`,
    `LOCATION:${icsText(p.location)}`,
    `ORGANIZER;CN=${icsText(p.organizer.name)}:mailto:${p.organizer.email}`,
    ...p.attendees.map((a) => `ATTENDEE;CN=${icsText(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${p.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** Visitor log time column: "10:45", then "10:45 · in 10:52", then "… · out 12:10". */
export function visitorTimeLabel(expected: string, inAt: string | null, outAt: string | null): string {
  return [expected, inAt ? `in ${inAt}` : null, outAt ? `out ${outAt}` : null].filter(Boolean).join(' · ');
}
