import { describe, expect, it } from 'vitest';
import { archiveAccessLevels, canOpenArchiveItem, internAccess, internDayStatus, internForbiddenFields, meanScore, nextWorkingDay, weekStartOf } from './work.rules';

describe('project archive access (Leads only / All developers)', () => {
  const lead = { canViewArchive: true, canViewProjects: true };
  const dev = { canViewArchive: false, canViewProjects: true };
  const none = { canViewArchive: false, canViewProjects: false };

  it('archive.view holders see every item', () => {
    expect(archiveAccessLevels(lead)).toBeNull();
    expect(canOpenArchiveItem('LEADS_ONLY', lead)).toBe(true);
    expect(canOpenArchiveItem('ALL_DEVELOPERS', lead)).toBe(true);
  });
  it('other developers only see items shared with all developers', () => {
    expect(archiveAccessLevels(dev)).toEqual(['ALL_DEVELOPERS']);
    expect(canOpenArchiveItem('LEADS_ONLY', dev)).toBe(false); // Helix, Pulse
    expect(canOpenArchiveItem('ALL_DEVELOPERS', dev)).toBe(true); // Quill
  });
  it('no project access → nothing', () => {
    expect(archiveAccessLevels(none)).toEqual([]);
    expect(canOpenArchiveItem('ALL_DEVELOPERS', none)).toBe(false);
  });
});

describe('intern sheet scope', () => {
  it('the intern sees and edits their own sheet but cannot score it', () => {
    const a = internAccess({ viewerEmployeeId: 'isha', internId: 'isha', internManagerId: 'arjun', viewAll: false });
    expect(a).toMatchObject({ isSelf: true, isMentor: false, canView: true, canScore: false, canEditOwn: true });
  });
  it('the mentor (reporting manager) sees and scores the mentee', () => {
    const a = internAccess({ viewerEmployeeId: 'arjun', internId: 'isha', internManagerId: 'arjun', viewAll: false });
    expect(a).toMatchObject({ isMentor: true, canView: true, canScore: true, canEditOwn: false });
  });
  it('another lead cannot open someone else’s intern; HR with interns.viewAll can', () => {
    expect(internAccess({ viewerEmployeeId: 'sneha', internId: 'isha', internManagerId: 'arjun', viewAll: false }).canView).toBe(false);
    expect(internAccess({ viewerEmployeeId: 'kavya', internId: 'isha', internManagerId: 'arjun', viewAll: true })).toMatchObject({ canView: true, canScore: true });
    expect(internAccess({ viewerEmployeeId: null, internId: 'isha', internManagerId: 'arjun', viewAll: false }).canView).toBe(false);
  });
  it('interns may only change status, hours and their note', () => {
    expect(internForbiddenFields(['status', 'hours', 'internNote'])).toEqual([]);
    expect(internForbiddenFields(['status', 'mentorScore', 'date'])).toEqual(['mentorScore', 'date']);
  });
});

describe('intern day status (sheet Status column)', () => {
  it('wireframe rows: Done / In progress', () => {
    expect(internDayStatus(['DONE'], { isPastDay: false, afterCutoff: false }).label).toBe('Done');
    expect(internDayStatus(['IN_PROGRESS'], { isPastDay: false, afterCutoff: false }).label).toBe('In progress');
  });
  it('no tasks → Not assigned; untouched → Not started', () => {
    expect(internDayStatus([], { isPastDay: false, afterCutoff: false }).key).toBe('NOT_ASSIGNED');
    expect(internDayStatus(['ASSIGNED'], { isPastDay: false, afterCutoff: false }).label).toBe('Not started');
  });
  it('open work after the 18:30 cutoff or on a past day reads Not done', () => {
    expect(internDayStatus(['IN_PROGRESS'], { isPastDay: false, afterCutoff: true }).key).toBe('NOT_DONE');
    expect(internDayStatus(['DONE', 'ASSIGNED'], { isPastDay: true, afterCutoff: false }).key).toBe('NOT_DONE');
  });
});

describe('weekly score and calendar helpers', () => {
  it('mean of task scores rounded to one decimal', () => {
    expect(meanScore([8.5, 8, null, 9])).toBe(8.5);
    expect(meanScore([7, 7.5, 6.5])).toBe(7);
    expect(meanScore([null, undefined])).toBeNull();
  });
  it('ISO week starts on Monday', () => {
    expect(weekStartOf('2026-09-29')).toBe('2026-09-28');
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28'); // Sunday
  });
  it('carry-over skips Sunday', () => {
    expect(nextWorkingDay('2026-09-26')).toBe('2026-09-28');
    expect(nextWorkingDay('2026-09-29')).toBe('2026-09-30');
  });
});
