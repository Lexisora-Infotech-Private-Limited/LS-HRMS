import { describe, expect, it } from 'vitest';
import {
  bookingIcs,
  bookingProblem,
  findConflict,
  hostOverlapProblem,
  isPassValidAt,
  newShortCode,
  overlaps,
  parsePassCode,
  passToast,
  passWindow,
  SHORT_CODE_ALPHABET,
  visitorTimeLabel,
  visitorTone,
  waLink,
  waNumber,
} from './facility.rules';
import { istInstant } from '../common/dates';

const t = (hm: string, day = '2026-09-30') => istInstant(day, hm);
const iv = (from: string, to: string, day?: string) => ({ startAt: t(from, day), endAt: t(to, day) });
const room = { name: 'Board room', openFrom: '08:00', openTo: '21:00', maxBookingMins: 240 };
const NOW = new Date('2026-09-29T04:10:00Z'); // Tue 29 Sep 2026, 09:40 IST

describe('room booking overlap (half-open intervals)', () => {
  it('detects real overlaps', () => {
    expect(overlaps(iv('11:00', '12:00'), iv('11:30', '12:30'))).toBe(true);
    expect(overlaps(iv('11:00', '12:00'), iv('10:00', '13:00'))).toBe(true);
    expect(overlaps(iv('11:00', '12:00'), iv('11:15', '11:45'))).toBe(true);
  });
  it('back-to-back bookings do not overlap', () => {
    expect(overlaps(iv('11:00', '12:00'), iv('12:00', '13:00'))).toBe(false);
    expect(overlaps(iv('11:00', '12:00'), iv('10:00', '11:00'))).toBe(false);
  });
  it('different days never overlap', () => {
    expect(overlaps(iv('11:00', '12:00', '2026-09-30'), iv('11:00', '12:00', '2026-10-01'))).toBe(false);
  });
  it('findConflict ignores cancelled bookings and the booking being edited', () => {
    const existing = [
      { id: 'a', status: 'CANCELLED', ...iv('11:00', '12:00') },
      { id: 'b', status: 'BOOKED', ...iv('11:30', '12:30') },
    ];
    expect(findConflict(existing, iv('11:00', '11:30'))).toBeNull();
    expect(findConflict(existing, iv('11:00', '12:00'))?.id).toBe('b');
    expect(findConflict(existing, iv('11:00', '12:00'), 'b')).toBeNull();
  });
  it('limits a host to 3 overlapping bookings across rooms', () => {
    const mine = ['a', 'b', 'c'].map((id) => ({ id, status: 'BOOKED', ...iv('15:00', '16:00') }));
    expect(hostOverlapProblem(mine.slice(0, 2), iv('15:00', '15:30'))).toBeNull();
    expect(hostOverlapProblem(mine, iv('15:00', '15:30'))).toMatch(/already have 3 bookings/);
    expect(hostOverlapProblem(mine, iv('15:00', '15:30'), 'a')).toBeNull();
  });
});

describe('booking validation', () => {
  const ok = { date: '2026-09-30', from: '11:00', to: '12:00' };
  it('accepts the wireframe booking', () => expect(bookingProblem(ok, room, NOW)).toBeNull());
  it('needs 15-minute steps', () => expect(bookingProblem({ ...ok, to: '11:50' }, room, NOW)).toBe('Pick times in 15-minute steps'));
  it('needs the end after the start', () => expect(bookingProblem({ ...ok, to: '10:00' }, room, NOW)).toBe('End time must be after the start time'));
  it('caps the duration at the room maximum', () => expect(bookingProblem({ ...ok, from: '09:00', to: '13:15' }, room, NOW)).toMatch(/at most 4 hours/));
  it('stays inside the open window', () => expect(bookingProblem({ ...ok, from: '20:30', to: '21:30' }, room, NOW)).toBe('Board room is open 08:00 – 21:00'));
  it('rejects the past (5 minutes of grace)', () => {
    expect(bookingProblem({ date: '2026-09-29', from: '09:00', to: '09:30' }, room, NOW)).toBe('That time has already passed');
    expect(bookingProblem({ date: '2026-09-29', from: '09:45', to: '10:00' }, room, NOW)).toBeNull();
  });
  it('allows at most 60 days ahead', () => expect(bookingProblem({ date: '2026-12-15', from: '10:00', to: '11:00' }, room, NOW)).toBe('Rooms can be booked up to 60 days ahead'));
});

describe('visitor e-pass', () => {
  it('is valid from 2 hours before the expected time until 23:59 IST', () => {
    const w = passWindow('2026-09-30', '10:45');
    expect(w.validFrom.toISOString()).toBe('2026-09-30T03:15:00.000Z'); // 08:45 IST
    expect(w.validUntil.toISOString()).toBe('2026-09-30T18:29:59.000Z'); // 23:59:59 IST
    const pass = { ...w, passRevokedAt: null };
    expect(isPassValidAt(pass, t('08:44'))).toBe(false);
    expect(isPassValidAt(pass, t('10:52'))).toBe(true);
    expect(isPassValidAt({ ...pass, passRevokedAt: new Date() }, t('10:52'))).toBe(false);
  });
  it('short codes use the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = newShortCode();
      expect(c).toHaveLength(6);
      expect([...c].every((ch) => SHORT_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });
  it('parses scanned URLs, raw tokens and typed codes', () => {
    expect(parsePassCode('https://acme.hrms.app/api/v1/facility/pass/abcDEF123_-xyz7890')).toEqual({ token: 'abcDEF123_-xyz7890' });
    expect(parsePassCode('nk7-q4m')).toEqual({ shortCode: 'NK7Q4M' });
    expect(parsePassCode('abcdefghijklmnopqrstu')).toEqual({ token: 'abcdefghijklmnopqrstu' });
  });
  it('builds wa.me links for Indian mobiles only', () => {
    expect(waNumber('+91 98250 12345')).toBe('919825012345');
    expect(waNumber('09825012345')).toBe('919825012345');
    expect(waNumber('12345')).toBeNull();
    expect(waLink('+919825012345', 'Hi Amit')).toBe('https://wa.me/919825012345?text=Hi%20Amit');
  });
  it('toast copy follows the channels used', () => {
    expect(passToast(['WHATSAPP'])).toBe('E-pass sent on WhatsApp');
    expect(passToast(['EMAIL'])).toBe('E-pass sent by email');
    expect(passToast(['WHATSAPP', 'EMAIL'])).toBe('E-pass sent on WhatsApp and email');
    expect(passToast([])).toBe('E-pass ready to share');
  });
  it('visitor log time and tag tone', () => {
    expect(visitorTimeLabel('10:45', null, null)).toBe('10:45');
    expect(visitorTimeLabel('10:45', '10:52', '12:10')).toBe('10:45 · in 10:52 · out 12:10');
    expect(visitorTone('PASS_SENT')).toBe('outline');
    expect(visitorTone('CHECKED_IN')).toBe('accent');
    expect(visitorTone('CHECKED_OUT')).toBe('neutral');
  });
});

describe('booking invite', () => {
  it('renders an RFC 5545 request with organizer and attendees', () => {
    const ics = bookingIcs({ uid: 'b1@lx', method: 'REQUEST', ...iv('11:00', '12:00'), summary: 'Nimbus Retail review', location: 'Board room', organizer: { name: 'Rohit Verma', email: 'rohit@lexisora.in' }, attendees: [{ name: 'Neha Kapoor', email: 'neha@lexisora.in' }], now: NOW });
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20260930T053000Z');
    expect(ics).toContain('DTEND:20260930T063000Z');
    expect(ics).toContain('ATTENDEE;CN=Neha Kapoor;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:neha@lexisora.in');
    expect(bookingIcs({ uid: 'b1@lx', method: 'CANCEL', ...iv('11:00', '12:00'), summary: 'x', location: 'y', organizer: { name: 'a', email: 'a@x' }, attendees: [] })).toContain('STATUS:CANCELLED');
  });
});
