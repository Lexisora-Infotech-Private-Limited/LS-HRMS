import { describe, expect, it } from 'vitest';
import type { TrackerPolicyResponse, TrackerTask } from '@lexisora/shared';
import * as vm from './view-model';

/** 29 Sep 2026, IST wall-clock → epoch ms. */
const ist = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00+05:30`);

const policy = (over: Partial<TrackerPolicyResponse> = {}): TrackerPolicyResponse => ({
  idleThresholdMin: 5,
  screenshotIntervalMin: 10,
  screenshotsEnabled: true,
  blurScreenshots: false,
  offlineRetentionDays: 7,
  desktopPunchAllowed: true,
  breakReminderMin: 120,
  shiftStart: '09:30',
  shiftEnd: '18:30',
  mode: 'PUNCH',
  audience: 'REMOTE',
  autoIdleEnabled: true,
  deductIdleFromPayroll: true,
  screenshotRetentionDays: 90,
  idleClaimsAllowed: true,
  shiftName: 'General',
  breakAllowanceMin: 60,
  modeMessage: null,
  updatedAt: '2026-09-29T04:00:00.000Z',
  serverTime: '2026-09-29T04:00:00.000Z',
  ...over,
});

const prefs = { launchAtStartup: true, showTrayWidget: true, breakReminders: true };

const TASKS: TrackerTask[] = [
  { id: 't1', key: 'AT-101', title: 'Invoice PDF export', projectName: 'Atlas' },
  { id: 't3', key: 'AT-103', title: 'Role-based menu', projectName: 'Atlas' },
  { id: 't10', key: 'AT-110', title: 'Code review', projectName: 'Atlas' },
  { id: 'int', key: 'INT-1', title: 'Stand-up & meetings', projectName: 'Internal', isStanding: true },
];

describe('status, shift and punch copy (spec T3 §1)', () => {
  it('maps engine status to the wireframe tags and tray dots', () => {
    expect(vm.statusView('OUT', false)).toEqual({ label: 'Not punched in', tone: 'tag-neutral', dot: 'OUT' });
    expect(vm.statusView('WORKING', false)).toEqual({ label: 'Working', tone: 'tag-accent', dot: 'WORKING' });
    expect(vm.statusView('WORKING', true)).toEqual({ label: 'Idle', tone: 'tag-accent', dot: 'IDLE' });
    expect(vm.statusView('BREAK', false)).toEqual({ label: 'On break', tone: 'tag-outline', dot: 'BREAK' });
  });

  it('shows the shift from the policy or "No shift assigned"', () => {
    expect(vm.shiftLabel(policy())).toBe('Shift 09:30 – 18:30');
    expect(vm.shiftLabel(null)).toBe('No shift assigned');
    expect(vm.shiftLabel(policy({ shiftStart: '' }))).toBe('No shift assigned');
  });

  it('punch helper follows the screenshot policy', () => {
    expect(vm.punchHelper(policy())).toBe('Punch in starts activity tracking and 10-minute screenshots.');
    expect(vm.punchHelper(policy({ screenshotIntervalMin: 15 }))).toBe('Punch in starts activity tracking and 15-minute screenshots.');
    expect(vm.punchHelper(policy({ screenshotsEnabled: false }))).toBe('Punch in starts activity tracking.');
  });

  it('asks to confirm a punch-out more than 30 min before shift end', () => {
    expect(vm.earlyPunchOutPrompt(ist('17:00'), policy())).toBe('Punch out before shift end (18:30)?');
    expect(vm.earlyPunchOutPrompt(ist('18:05'), policy())).toBeNull();
    expect(vm.earlyPunchOutPrompt(ist('17:00'), policy({ shiftStart: '22:00', shiftEnd: '06:00' }))).toBeNull();
    expect(vm.earlyPunchOutPrompt(ist('17:00'), null)).toBeNull();
  });

  it('next-screenshot footer: rounds up, pauses, hides when screenshots are off', () => {
    expect(vm.nextShotLabel({ enabled: true, status: 'WORKING', paused: false, seconds: 450 })).toBe('Next screenshot in 8 min');
    expect(vm.nextShotLabel({ enabled: true, status: 'WORKING', paused: false, seconds: 5 })).toBe('Next screenshot in 1 min');
    expect(vm.nextShotLabel({ enabled: true, status: 'BREAK', paused: true, seconds: 300 })).toBe('Screenshots paused');
    expect(vm.nextShotLabel({ enabled: false, status: 'WORKING', paused: false, seconds: 300 })).toBeNull();
    expect(vm.nextShotLabel({ enabled: true, status: 'OUT', paused: false, seconds: 300 })).toBeNull();
    expect(vm.lastInputLabel(3)).toBe('Last input just now');
    expect(vm.lastInputLabel(180)).toBe('Last input 3 min ago');
  });

  it('offers "Continue tracking here" for a session opened on the web', () => {
    expect(vm.serverSessionView({ status: 'WORKING', punchedInAt: new Date(ist('09:30')).toISOString(), punchSource: 'WEB' })).toEqual({
      label: 'Punched in via web at 09:30',
      action: 'Continue tracking here',
    });
    expect(vm.serverSessionView({ status: 'OUT', punchedInAt: null, punchSource: null })).toBeNull();
  });

  it('blocks punch-in when the offline queue is older than the retention window', () => {
    const now = ist('10:00');
    const base = { online: false, queued: 6, oldestPendingAt: null, now, retentionDays: 7 };
    expect(vm.offlineBlock({ ...base, lastSyncAt: now - 8 * 86_400_000 })).toBe('Connect to the internet to sync 8 days of tracking before punching in');
    expect(vm.offlineBlock({ ...base, lastSyncAt: now - 2 * 86_400_000 })).toBeNull();
    expect(vm.offlineBlock({ ...base, online: true, lastSyncAt: now - 8 * 86_400_000 })).toBeNull();
    expect(vm.offlineBlock({ ...base, queued: 0, lastSyncAt: now - 8 * 86_400_000 })).toBeNull();
  });
});

describe('idle dialog copy (spec T3 §1)', () => {
  it('no input: threshold title and the "since" time', () => {
    const d = vm.idleDialog('NO_INPUT', ist('11:42'), null, 5, true);
    expect(d.title).toBe("You've been idle for 5 minutes");
    expect(d.body).toBe('No keyboard or mouse input since 11:42. Idle time is paused from your worked hours until you choose.');
    expect(d.claimsAllowed).toBe(true);
  });

  it('lock, sleep and app-not-running variants show the gap', () => {
    expect(vm.idleDialog('LOCK', ist('13:05'), ist('13:52'), 5, true).title).toBe('Your PC was locked from 13:05 to 13:52');
    expect(vm.idleDialog('SUSPEND', ist('13:05'), ist('13:52'), 5, true).title).toBe('Your PC was asleep from 13:05 to 13:52');
    expect(vm.idleDialog('APP_NOT_RUNNING', ist('17:10'), ist('17:55'), 5, false)).toMatchObject({
      title: "Tracker wasn't running from 17:10 to 17:55",
      claimsAllowed: false,
    });
    expect(vm.idleDialog('NO_INPUT', ist('11:42'), null, 1, true).title).toBe("You've been idle for 1 minute");
  });
});

describe('settings rows (spec T2 §1 / T7 §1)', () => {
  const device = { hostname: 'PRIYA-LAPTOP', pairedAt: '2026-09-29T04:10:00.000Z' };

  it('reproduces the wireframe rows with HR-locked values read-only', () => {
    const rows = vm.settingsRows({ policy: policy(), prefs, mode: 'PUNCH', device, appVersion: '1.4.2', update: null });
    expect(rows.map((r) => [r.label, r.note, r.value, r.tone])).toEqual([
      ['Auto-idle after', 'No keyboard / mouse input', '5 min · HR policy', 'tag-neutral'],
      ['Screenshots', 'Mapped to the active task', 'Every 10 min · HR policy', 'tag-neutral'],
      ['Launch at Windows start-up', 'Recommended', 'On', 'tag-accent'],
      ['Show tray widget', 'Mini timer near the clock', 'On', 'tag-accent'],
      ['Break reminders', 'Nudge after 2 hours of work', 'On', 'tag-accent'],
      ['Offline storage', 'Encrypted, syncs on reconnect', 'Up to 7 days', 'tag-neutral'],
      ['Device', 'PRIYA-LAPTOP · paired 29 Sep', 'v1.4.2', 'tag-neutral'],
    ]);
    expect(rows.filter((r) => r.toggle).map((r) => r.toggle)).toEqual(['launchAtStartup', 'showTrayWidget', 'breakReminders']);
    expect(rows.find((r) => r.key === 'device')?.action).toBe('copyDiagnostics');
  });

  it('user toggles show Off, HR-disabled reminders are locked, blur and idle-off are labelled', () => {
    const rows = vm.settingsRows({
      policy: policy({ breakReminderMin: 0, blurScreenshots: true, autoIdleEnabled: false }),
      prefs: { ...prefs, showTrayWidget: false },
      mode: 'PUNCH',
      device: null,
      appVersion: '1.4.2',
      update: null,
    });
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by('widget')).toMatchObject({ value: 'Off', tone: 'tag-neutral', toggle: 'showTrayWidget' });
    expect(by('breaks')).toMatchObject({ value: 'Off · HR policy', disabled: true, note: 'Turned off in your attendance policy' });
    expect(by('breaks').toggle).toBeUndefined();
    expect(by('shots').value).toBe('Every 10 min · HR policy · blurred');
    expect(by('idle').value).toBe('Off · HR policy');
    expect(rows.some((r) => r.key === 'device')).toBe(false);
  });

  it('monitor-only mode and an available update add rows', () => {
    const rows = vm.settingsRows({
      policy: policy({ mode: 'MONITOR_ONLY' }),
      prefs,
      mode: 'MONITOR_ONLY',
      device,
      appVersion: '1.4.2',
      update: { version: '1.4.3', mandatory: true, notes: null },
    });
    expect(rows.find((r) => r.key === 'mode')?.value).toBe('Monitor only · HR policy');
    expect(rows.find((r) => r.key === 'update')).toMatchObject({ label: 'Update v1.4.3 available', note: 'Required by your admin', action: 'update.open' });
  });

  it('break reminder note in hours or minutes', () => {
    expect(vm.breakReminderNote(120)).toBe('Nudge after 2 hours of work');
    expect(vm.breakReminderNote(60)).toBe('Nudge after 1 hour of work');
    expect(vm.breakReminderNote(90)).toBe('Nudge after 90 minutes of work');
  });
});

describe('task list, by-task summary and tray tooltip', () => {
  it('task rows carry today\'s per-task time and the active highlight', () => {
    const rows = vm.taskRows(TASKS, new Map([['t1', 2 * 3600 + 5 * 60], ['int', 900]]), 't1');
    expect(rows.map((r) => [r.key, r.time, r.active])).toEqual([
      ['AT-101', '2h 05m', true],
      ['AT-103', '0h 00m', false],
      ['AT-110', '0h 00m', false],
      ['INT-1', '0h 15m', false],
    ]);
  });

  it('by-task lists tracked tasks in list order, finished tasks from the known map, "No task" last', () => {
    const per = new Map<string | null, number>([
      [null, 120],
      ['t10', 1800],
      ['gone', 600],
      ['t1', 3600],
      ['t3', 0],
    ]);
    const known = new Map([['gone', { key: 'AT-099', title: 'Old bug' }]]);
    expect(vm.byTaskRows(TASKS, per, known)).toEqual([
      { key: 'AT-101', title: 'Invoice PDF export', time: '1h 00m' },
      { key: 'AT-110', title: 'Code review', time: '0h 30m' },
      { key: 'AT-099', title: 'Old bug', time: '0h 10m' },
      { key: '', title: 'No task selected', time: '0h 02m' },
    ]);
  });

  it('summary title switches to "Day complete" after the last punch-out', () => {
    expect(vm.summaryTitle('WORKING', 3600)).toBe('Today so far');
    expect(vm.summaryTitle('OUT', 3600)).toBe('Day complete');
    expect(vm.summaryTitle('OUT', 0)).toBe('Today so far');
  });

  it('tray tooltip replaces the wireframe text chip and stays within 127 chars', () => {
    expect(vm.trayTooltip('Working', 'WORKING', '4h 00m', { key: 'AT-101', title: 'Invoice PDF export' })).toBe('Working · 4h 00m · AT-101 Invoice PDF export');
    expect(vm.trayTooltip('Not punched in', 'OUT', '0h 00m', null)).toBe('Lexisora Tracker · Not punched in');
    const long = vm.trayTooltip('Working', 'WORKING', '4h 00m', { key: 'AT-101', title: 'x'.repeat(200) });
    expect(long.length).toBe(127);
    expect(long.endsWith('…')).toBe(true);
  });

  it('pairing helpers: countdown and permissions line', () => {
    expect(vm.countdown(581_000)).toBe('9:41');
    expect(vm.countdown(-5)).toBe('0:00');
    expect(vm.permissionsLine(undefined)).toBe('Permissions: activity monitor, screen capture');
    expect(vm.permissionsLine(['activity monitor'])).toBe('Permissions: activity monitor');
    expect(vm.PAIR_HELP).toBe('Enter this code in the web portal under My profile → Devices, or ask HR to approve it.');
    expect(vm.SCREENSHOT_AUDIENCE).toBe('Visible to your Project Lead and Reporting Manager');
  });
});
