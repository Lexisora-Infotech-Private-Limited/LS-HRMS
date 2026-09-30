import { describe, expect, it } from 'vitest';
import { noticeReadLabel, noticeUpsertSchema } from '@lexisora/shared';
import {
  announcementBody,
  audienceKey,
  canRemind,
  canTransition,
  canViewNotice,
  datesError,
  dedupeRules,
  outOfScope,
  publishTarget,
  REMIND_THROTTLE_MS,
  type NoticeFacts,
} from './notices.rules';

const now = new Date('2026-09-29T04:30:00.000Z'); // 10:00 IST
const mins = (m: number) => new Date(now.getTime() + m * 60_000);

describe('notice state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransition('SCHEDULED', 'DRAFT')).toBe(true);
    expect(canTransition('SCHEDULED', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHED', 'EXPIRED')).toBe(true);
    expect(canTransition('PUBLISHED', 'ARCHIVED')).toBe(true);
    expect(canTransition('EXPIRED', 'ARCHIVED')).toBe(true);
    expect(canTransition('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransition('ARCHIVED', 'PUBLISHED')).toBe(false);
    expect(canTransition('EXPIRED', 'PUBLISHED')).toBe(false);
  });

  it('publishes now unless publishAt is more than a minute ahead (then schedules)', () => {
    expect(publishTarget(null, now)).toBe('PUBLISHED');
    expect(publishTarget(mins(-5), now)).toBe('PUBLISHED');
    expect(publishTarget(mins(1), now)).toBe('PUBLISHED');
    expect(publishTarget(mins(2), now)).toBe('SCHEDULED');
  });

  it('requires expiry after the publish time (or now)', () => {
    expect(datesError(null, null, now)).toBeNull();
    expect(datesError(null, mins(60), now)).toBeNull();
    expect(datesError(null, mins(-60), now)).toBe('Expiry must be after the publish time');
    expect(datesError(mins(120), mins(60), now)).toBe('Expiry must be after the publish time');
    expect(datesError(mins(60), mins(120), now)).toBeNull();
    expect(datesError(new Date('nope'), null, now)).toBe('Publish at is not a valid date');
  });
});

describe('team scope for publishers without "any team"', () => {
  const scope = { departmentIds: ['dev'], projectIds: ['atlas'] };

  it('accepts departments and projects the publisher leads', () => {
    expect(outOfScope([{ type: 'DEPARTMENT', refId: 'dev' }, { type: 'PROJECT', refId: 'atlas' }], scope)).toEqual([]);
  });

  it('rejects other teams and non-team rules (NOTICE_AUDIENCE_OUT_OF_SCOPE)', () => {
    const bad = outOfScope([{ type: 'DEPARTMENT', refId: 'qa' }, { type: 'PROJECT', refId: 'atlas' }, { type: 'ALL' }, { type: 'EMPLOYEE', refId: 'e1' }], scope);
    expect(bad.map((r) => r.type)).toEqual(['DEPARTMENT', 'ALL', 'EMPLOYEE']);
  });

  it('identifies an audience independent of order and drops duplicates', () => {
    expect(audienceKey([{ type: 'PROJECT', refId: 'atlas' }, { type: 'DEPARTMENT', refId: 'dev' }])).toBe(audienceKey([{ type: 'DEPARTMENT', refId: 'dev' }, { type: 'PROJECT', refId: 'atlas' }]));
    expect(audienceKey([{ type: 'DEPARTMENT', refId: 'dev' }])).not.toBe(audienceKey([{ type: 'DEPARTMENT', refId: 'qa' }]));
    expect(dedupeRules([{ type: 'DEPARTMENT', refId: 'dev' }, { type: 'DEPARTMENT', refId: 'dev' }, { type: 'PROJECT', refId: 'dev' }])).toHaveLength(2);
  });
});

describe('who can open a notice', () => {
  const live = (visibility: 'GLOBAL' | 'TEAM', status: NoticeFacts['status'] = 'PUBLISHED'): NoticeFacts => ({ status, visibility, authorEmployeeId: 'arjun', deletedAt: null });
  const qa = { employeeId: 'karan', isRecipient: false, moderator: false };
  const dev = { employeeId: 'priya', isRecipient: true, moderator: false };
  const hr = { employeeId: 'kavya', isRecipient: false, moderator: true };
  const author = { employeeId: 'arjun', isRecipient: false, moderator: false };

  it('Global notices are open to everyone once live', () => {
    expect(canViewNotice(live('GLOBAL'), qa)).toBe(true);
    expect(canViewNotice(live('GLOBAL', 'EXPIRED'), qa)).toBe(true);
  });

  it('Team notices reach recipients, the author and moderators only (acceptance §2.9-2)', () => {
    expect(canViewNotice(live('TEAM'), dev)).toBe(true);
    expect(canViewNotice(live('TEAM'), qa)).toBe(false);
    expect(canViewNotice(live('TEAM'), hr)).toBe(true);
    expect(canViewNotice(live('TEAM'), author)).toBe(true);
  });

  it('drafts, scheduled and archived notices are private to author and moderators; deleted to nobody', () => {
    for (const s of ['DRAFT', 'SCHEDULED', 'ARCHIVED'] as const) {
      expect(canViewNotice(live('GLOBAL', s), dev)).toBe(false);
      expect(canViewNotice(live('GLOBAL', s), author)).toBe(true);
      expect(canViewNotice(live('GLOBAL', s), hr)).toBe(true);
    }
    expect(canViewNotice({ ...live('GLOBAL'), deletedAt: now }, hr)).toBe(false);
  });
});

describe('dashboard announcement line', () => {
  it('prefixes team notices with their audience (wireframe copy)', () => {
    expect(announcementBody('TEAM', 'Development · Atlas', 'Merges close Wednesday EOD.')).toBe('Visible to Development · Atlas. Merges close Wednesday EOD.');
    expect(announcementBody('GLOBAL', 'Everyone', 'New per-km rates apply from 1 October.')).toBe('New per-km rates apply from 1 October.');
  });

  it('truncates to 160 characters with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const out = announcementBody('GLOBAL', 'Everyone', long);
    expect(out).toHaveLength(160);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('read receipts', () => {
  it('shows "read / recipients" to the author and moderators, my own state to everyone else', () => {
    const base = { readCount: 112, recipientCount: 128, status: 'PUBLISHED' };
    expect(noticeReadLabel({ ...base, canManage: true, myRead: null })).toEqual({ text: '112 / 128', tone: 'plain' });
    expect(noticeReadLabel({ ...base, canManage: false, myRead: true })).toEqual({ text: 'Read', tone: 'accent' });
    expect(noticeReadLabel({ ...base, canManage: false, myRead: false })).toEqual({ text: 'New', tone: 'outline' });
    expect(noticeReadLabel({ ...base, status: 'DRAFT', canManage: true, myRead: null }).text).toBe('—');
  });

  it('throttles "Remind unread" to once per 24 hours', () => {
    expect(canRemind(null, now)).toBe(true);
    expect(canRemind(new Date(now.getTime() - REMIND_THROTTLE_MS + 60_000), now)).toBe(false);
    expect(canRemind(new Date(now.getTime() - REMIND_THROTTLE_MS), now)).toBe(true);
  });
});

describe('publish form validation (FORMS.notice)', () => {
  const ok = { title: 'Atlas CRM release freeze', visibility: 'TEAM' as const, audiences: [{ type: 'DEPARTMENT' as const, refId: 'dev' }], bodyHtml: '<p>Merges close Wednesday EOD.</p>' };

  it('accepts a team notice with an audience', () => {
    expect(noticeUpsertSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects short titles and team notices without a team', () => {
    expect(noticeUpsertSchema.safeParse({ ...ok, title: 'Hi' }).success).toBe(false);
    expect(noticeUpsertSchema.safeParse({ ...ok, audiences: [] }).success).toBe(false);
  });

  it('rejects a Global notice that names an audience', () => {
    expect(noticeUpsertSchema.safeParse({ ...ok, visibility: 'GLOBAL' }).success).toBe(false);
    expect(noticeUpsertSchema.safeParse({ ...ok, visibility: 'GLOBAL', audiences: [] }).success).toBe(true);
  });
});
