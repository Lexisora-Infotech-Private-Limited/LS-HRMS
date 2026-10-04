import { describe, expect, it } from 'vitest';
import { callSummaryText, canEditMessage, canPostIn, channelLabel, channelSlug, dmKeyFor, normalizeBody, resolveMentions, unreadBadge } from './chat.rules';

const members = [
  { userId: 'u-neha', name: 'Neha Kapoor' },
  { userId: 'u-priya', name: 'Priya Sharma' },
  { userId: 'u-kavya', name: 'Kavya Iyer' },
  { userId: 'u-meera', name: 'Meera Iyer' },
  { userId: 'u-rahul', name: 'Rahul Desai' },
];

describe('comms hub rules', () => {
  it('DM keys are order-independent and de-duplicated', () => {
    expect(dmKeyFor(['b', 'a'])).toBe('a:b');
    expect(dmKeyFor(['a', 'b', 'a'])).toBe(dmKeyFor(['b', 'a']));
    expect(dmKeyFor(['me'])).toBe('me');
  });
  it('labels channels and DMs', () => {
    expect(channelLabel('PUBLIC', 'general')).toBe('# general');
    expect(channelLabel('DM', null, ['Neha Kapoor'])).toBe('Neha Kapoor');
    expect(channelLabel('GROUP_DM', null, ['Neha Kapoor', 'Rahul Desai'])).toBe('Neha Kapoor, Rahul Desai');
    expect(channelLabel('DM', null, [])).toBe('Notes to self');
  });
  it('slugs project and department names', () => {
    expect(channelSlug('Atlas CRM')).toBe('atlas-crm');
    expect(channelSlug('QA', 'team')).toBe('qa-team');
  });
  it('resolves full-name and unambiguous first-name mentions', () => {
    expect(resolveMentions('@Priya Sharma can you pair with Rahul?', members)).toEqual(['u-priya']);
    expect(resolveMentions('thanks @Neha and @rahul', members).sort()).toEqual(['u-neha', 'u-rahul']);
    expect(resolveMentions('ping @priya.sharma', members)).toEqual(['u-priya']);
  });
  it('ignores ambiguous or unknown mentions', () => {
    expect(resolveMentions('hello @Iyer', members)).toEqual([]);
    expect(resolveMentions('hi @Vikram', members)).toEqual([]);
  });
  it('unread badges cap at 99+', () => {
    expect(unreadBadge(0)).toBe('');
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(140)).toBe('99+');
  });
  it('messages are editable for 15 minutes', () => {
    const sent = new Date('2026-09-29T04:32:00Z');
    expect(canEditMessage(sent, new Date(sent.getTime() + 14 * 60_000))).toBe(true);
    expect(canEditMessage(sent, new Date(sent.getTime() + 16 * 60_000))).toBe(false);
  });
  it('call summaries read like the spec', () => {
    const start = new Date('2026-09-28T06:00:00Z');
    expect(callSummaryText('VIDEO', start, new Date(start.getTime() + 23 * 60_000), 4)).toBe('Call · 23 min · 4 participants');
    expect(callSummaryText('SCREEN', start, new Date(start.getTime() + 20_000), 1)).toBe('Screen share · 1 min · 1 participant');
    expect(callSummaryText('AUDIO', start, new Date(start.getTime() + 5 * 60_000), 2)).toBe('Audio call · 5 min · 2 participants');
  });
  it('#announcements accepts posts from publishers only; archived channels from nobody', () => {
    expect(canPostIn('ADMINS_ONLY', false, false)).toBe(false);
    expect(canPostIn('ADMINS_ONLY', true, false)).toBe(true);
    expect(canPostIn('ALL_MEMBERS', false, false)).toBe(true);
    expect(canPostIn('ALL_MEMBERS', true, true)).toBe(false);
  });
  it('normalizes composer text', () => {
    expect(normalizeBody('  hi\r\n\n\n\nthere  ')).toBe('hi\n\nthere');
  });
});
