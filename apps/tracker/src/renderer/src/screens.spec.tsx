import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShotToast, ViewState } from '@tracker-shared/ipc';

/**
 * Renderer smoke tests: every screen and state from the wireframe renders from a ViewState
 * without runtime errors and shows the wireframe copy. (The GUI itself can't be launched in CI.)
 */

type StateListener = (s: ViewState) => void;
let pushState: StateListener | null = null;

function baseState(over: Partial<ViewState> = {}): ViewState {
  return {
    view: 'home',
    tab: 'track',
    isDev: false,
    appVersion: '1.4.2',
    serverUrl: 'http://localhost:4000',
    clock: '10:10',
    login: { workspace: 'lexisora.hrms.app', email: 'priya.sharma@lexisora.com', busy: false, error: null, notEligible: false, notice: null },
    pair: {
      code: ['4', '8', '2', '7', '1', '9'],
      expiresIn: '9:41',
      status: 'PENDING',
      deviceLine: 'Device: PRIYA-LAPTOP · Windows 11 (build 26200)',
      permissions: 'Permissions: activity monitor, screen capture',
      busy: false,
      error: null,
      userName: 'Priya Sharma',
    },
    mode: 'PUNCH',
    status: 'OUT',
    statusLabel: 'Not punched in',
    statusTone: 'tag-neutral',
    shiftLabel: 'Shift 09:30 – 18:30',
    workedSec: 0,
    worked: '0h 00m',
    breakTime: '0h 00m',
    idleTime: '0h 00m',
    tasks: [
      { id: 't1', key: 'AT-101', title: 'Invoice PDF export', projectName: 'Atlas', time: '2h 05m', seconds: 7500, active: true },
      { id: 't3', key: 'AT-103', title: 'Role-based menu', projectName: 'Atlas', time: '0h 40m', seconds: 2400, active: false },
      { id: 't10', key: 'AT-110', title: 'Code review', projectName: 'Atlas', time: '0h 00m', seconds: 0, active: false },
      { id: 'int', key: 'INT-1', title: 'Stand-up & meetings', projectName: 'Internal', time: '0h 15m', seconds: 900, active: false },
    ],
    showTaskSearch: false,
    activeTask: { id: 't1', key: 'AT-101', title: 'Invoice PDF export' },
    idle: null,
    punch: { blocked: null, helper: 'Punch in starts activity tracking and 10-minute screenshots.', busy: false },
    serverSession: null,
    monitorNote: null,
    nextShot: 'Next screenshot in 7 min',
    lastInput: 'Last input just now',
    summary: {
      title: 'Today so far',
      byTask: [
        { key: 'AT-101', title: 'Invoice PDF export', time: '2h 05m' },
        { key: 'AT-103', title: 'Role-based menu', time: '0h 40m' },
      ],
      screenshots: 18,
      timeline: [
        { kind: 'WORK', flex: 5400, label: '09:28–11:00 Active · AT-101' },
        { kind: 'BREAK', flex: 900, label: '11:00–11:15 Break' },
        { kind: 'IDLE', flex: 300, label: '11:42–11:47 Idle' },
        { kind: 'IDLE_WORK', flex: 600, label: '11:47–11:57 Active (claimed) · AT-101' },
        { kind: 'GAP', flex: 1800, label: '12:00–12:30 Not tracked' },
      ],
      canConfirm: true,
      confirmHint: null,
      confirmedAt: null,
    },
    online: true,
    queued: 0,
    syncing: false,
    lastSyncAt: '10:09',
    settings: [
      { key: 'idle', label: 'Auto-idle after', note: 'No keyboard / mouse input', value: '5 min · HR policy', tone: 'tag-neutral' },
      { key: 'shots', label: 'Screenshots', note: 'Mapped to the active task', value: 'Every 10 min · HR policy', tone: 'tag-neutral' },
      { key: 'launch', label: 'Launch at Windows start-up', note: 'Recommended', value: 'On', tone: 'tag-accent', toggle: 'launchAtStartup' },
      { key: 'widget', label: 'Show tray widget', note: 'Mini timer near the clock', value: 'On', tone: 'tag-accent', toggle: 'showTrayWidget' },
      { key: 'breaks', label: 'Break reminders', note: 'Nudge after 2 hours of work', value: 'On', tone: 'tag-accent', toggle: 'breakReminders' },
      { key: 'offline', label: 'Offline storage', note: 'Encrypted, syncs on reconnect', value: 'Up to 7 days', tone: 'tag-neutral' },
      { key: 'device', label: 'Device', note: 'PRIYA-LAPTOP · paired 29 Sep', value: 'v1.4.2', tone: 'tag-neutral', action: 'copyDiagnostics', hint: 'Click to copy diagnostics' },
    ],
    prefs: { launchAtStartup: true, showTrayWidget: true, breakReminders: true },
    device: { hostname: 'PRIYA-LAPTOP', pairedAt: '2026-09-29T04:10:00.000Z' },
    update: null,
    unpair: { busy: false, progress: null },
    widget: { open: false, lastShot: null },
    log: [{ t: '10:10', m: 'Screenshot · AT-101' }],
    ...over,
  };
}

const working = (over: Partial<ViewState> = {}) =>
  baseState({ status: 'WORKING', statusLabel: 'Working', statusTone: 'tag-accent', worked: '2h 45m', workedSec: 9900, breakTime: '0h 15m', ...over });

let mods: {
  MainApp: ComponentType;
  WidgetApp: ComponentType;
  ToastApp: ComponentType;
  Home: ComponentType<{ s: ViewState }>;
  LoginScreen: ComponentType<{ s: ViewState }>;
  PairScreen: ComponentType<{ s: ViewState }>;
  IdleDialog: ComponentType<{ idle: NonNullable<ViewState['idle']> }>;
  DevPanel: ComponentType<{ s: ViewState; onClose: () => void }>;
};

beforeAll(async () => {
  const off = () => () => undefined;
  (globalThis as unknown as { window: unknown }).window = {
    location: { search: '' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    tracker: {
      invoke: vi.fn(async () => ({ ok: true })),
      getState: vi.fn(async () => null),
      onState: vi.fn((fn: StateListener) => {
        pushState = fn;
        return () => undefined;
      }),
      onToast: vi.fn(off),
      onShot: vi.fn((_fn: (s: ShotToast) => void) => () => undefined),
    },
  };
  const [main, mini, home, auth, dialogs, dev] = await Promise.all([
    import('./MainApp'),
    import('./Mini'),
    import('./screens/Home'),
    import('./screens/Auth'),
    import('./screens/Dialogs'),
    import('./screens/DevPanel'),
  ]);
  mods = {
    MainApp: main.MainApp,
    WidgetApp: mini.WidgetApp,
    ToastApp: mini.ToastApp,
    Home: home.Home,
    LoginScreen: auth.LoginScreen,
    PairScreen: auth.PairScreen,
    IdleDialog: dialogs.IdleDialog,
    DevPanel: dev.DevPanel,
  };
});

const html = (el: JSX.Element) => renderToStaticMarkup(el);
const text = (el: JSX.Element) =>
  html(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

describe('main window shell', () => {
  it('boots, then follows the pushed view state (title bar, offline banner, idle overlay)', () => {
    const { MainApp } = mods;
    expect(text(<MainApp />)).toContain('Starting Lexisora Tracker');
    expect(pushState).toBeTypeOf('function');
    pushState!(working({ online: false, queued: 6, idle: { cause: 'NO_INPUT', title: "You've been idle for 5 minutes", body: 'No keyboard or mouse input since 11:42. Idle time is paused from your worked hours until you choose.', since: '11:42', until: null, claimsAllowed: true } }));
    const t = text(<MainApp />);
    expect(t).toContain('Lexisora Tracker');
    expect(t).toContain('Offline · tracking locally');
    expect(t).toContain('6 entries queued');
    expect(t).toContain("You've been idle for 5 minutes");
    expect(t).not.toContain('DEV');
    pushState!(baseState({ view: 'login', isDev: true }));
    expect(text(<MainApp />)).toContain('DEV');
  });
});

describe('sign in and pairing', () => {
  it('sign in shows the wireframe copy and the eligibility footer', () => {
    const t = text(<mods.LoginScreen s={baseState({ view: 'login' })} />);
    for (const s of ['Sign in to track your day', 'Use your Lexisora HRMS account.', 'Workspace', 'Official email', 'Password', 'Sign in', 'Available to Remote / WFH employees. Office staff punch with biometric.', 'Server http://localhost:4000'])
      expect(t).toContain(s);
    const err = text(<mods.LoginScreen s={baseState({ view: 'login', login: { ...baseState().login, error: 'Invalid email or password' } })} />);
    expect(err).toContain('Invalid email or password');
    const revoked = text(<mods.LoginScreen s={baseState({ view: 'login', login: { ...baseState().login, notice: 'This device was revoked by HR. Sign in again to pair it.' } })} />);
    expect(revoked).toContain('This device was revoked by HR');
  });

  it('pair screen: step 2 of 2, six code boxes, countdown, device and permissions, audit copy', () => {
    const t = text(<mods.PairScreen s={baseState({ view: 'pair' })} />);
    for (const s of ['Step 2 of 2', 'Pair this device', 'Enter this code in the web portal under My profile → Devices, or ask HR to approve it.', 'Code expires in 9:41', 'Device: PRIYA-LAPTOP', 'Permissions: activity monitor, screen capture', "I've approved it · continue", 'Cancel / use another account'])
      expect(t).toContain(s);
    expect(html(<mods.PairScreen s={baseState({ view: 'pair' })} />).match(/tw-code-box/g)).toHaveLength(6);
    const hr = text(<mods.PairScreen s={baseState({ view: 'pair', pair: { ...baseState().pair, status: 'AWAITING_HR' } })} />);
    expect(hr).toContain('Waiting for HR approval');
    const expired = text(<mods.PairScreen s={baseState({ view: 'pair', pair: { ...baseState().pair, status: 'EXPIRED' } })} />);
    expect(expired).toContain('This code has expired.');
    expect(expired).toContain('Get a new code');
  });
});

describe('tracker tab', () => {
  it('punched out: Punch in + helper; blocked punch shows the reason', () => {
    const t = text(<mods.Home s={baseState()} />);
    for (const s of ['Tracker', 'Daily summary', 'Settings', 'Not punched in', 'Shift 09:30 – 18:30', '0h 00m', 'worked today · break 0h 00m · idle 0h 00m', 'Punch in', 'Punch in starts activity tracking and 10-minute screenshots.'])
      expect(t).toContain(s);
    expect(t).not.toContain('Working on');
    const blocked = text(<mods.Home s={baseState({ punch: { blocked: 'Connect to the internet to sync 8 days of tracking before punching in', helper: '', busy: false } })} />);
    expect(blocked).toContain('Connect to the internet to sync 8 days');
  });

  it('a session opened on the web is offered as "Continue tracking here"', () => {
    const t = text(<mods.Home s={baseState({ serverSession: { label: 'Punched in via web at 09:30', action: 'Continue tracking here' } })} />);
    expect(t).toContain('Punched in via web at 09:30');
    expect(t).toContain('Continue tracking here');
    expect(html(<mods.Home s={baseState({ serverSession: { label: 'Punched in via web at 09:30', action: 'Continue tracking here' } })} />)).not.toMatch(/>Punch in</);
  });

  it('working: task list with per-task time, break + punch out, next screenshot and last input', () => {
    const markup = html(<mods.Home s={working()} />);
    const t = text(<mods.Home s={working()} />);
    for (const s of ['Working', '2h 45m', 'Working on', 'AT-101 Invoice PDF export', '2h 05m', 'INT-1 Stand-up & meetings', 'Start break', 'Punch out', 'Next screenshot in 7 min', 'Last input just now'])
      expect(t).toContain(s);
    expect(markup.match(/tw-taskrow is-active/g)).toHaveLength(1);
    expect(text(<mods.Home s={working({ status: 'BREAK', statusLabel: 'On break', statusTone: 'tag-outline' })} />)).toContain('End break');
  });

  it('monitor-only (office staff): no punch buttons, biometric note', () => {
    const note = 'Office staff punch with biometric. The tracker records your tasks, idle time and screenshots after your biometric IN.';
    const out = text(<mods.Home s={baseState({ mode: 'MONITOR_ONLY', monitorNote: note })} />);
    expect(out).toContain(note);
    expect(html(<mods.Home s={baseState({ mode: 'MONITOR_ONLY', monitorNote: note })} />)).not.toMatch(/>Punch in</);
    const inn = text(<mods.Home s={working({ mode: 'MONITOR_ONLY', monitorNote: note })} />);
    expect(inn).toContain('Start break');
    expect(inn).toContain('Punch out with biometric');
    expect(html(<mods.Home s={working({ mode: 'MONITOR_ONLY', monitorNote: note })} />)).not.toMatch(/>Punch out</);
    // …while the PUNCH-mode markup does have both buttons (so the negative checks above are meaningful)
    expect(html(<mods.Home s={baseState()} />)).toMatch(/>Punch in</);
    expect(html(<mods.Home s={working()} />)).toMatch(/>Punch out</);
  });

  it('idle dialog offers the three choices (claim hidden when HR turned claims off)', () => {
    const idle = { cause: 'LOCK' as const, title: 'Your PC was locked from 13:05 to 13:52', body: 'The screen was locked.', since: '13:05', until: '13:52', claimsAllowed: true };
    const t = text(<mods.IdleDialog idle={idle} />);
    for (const s of ['Your PC was locked from 13:05 to 13:52', 'I was working (meeting / call)', 'Count it as a break', 'Mark as idle & resume']) expect(t).toContain(s);
    expect(text(<mods.IdleDialog idle={{ ...idle, claimsAllowed: false }} />)).not.toContain('I was working');
  });
});

describe('daily summary and settings tabs', () => {
  it('summary: KPIs, timeline, by task, screenshots, Add to weekly timesheet', () => {
    const s = working({ tab: 'summary' });
    const markup = html(<mods.Home s={s} />);
    const t = text(<mods.Home s={s} />);
    for (const x of ['Today so far', 'Worked', 'Break', 'Idle', 'By task', 'AT-101 Invoice PDF export', 'Screenshots captured', '18', 'Add to weekly timesheet']) expect(t).toContain(x);
    expect(markup.match(/class="tw-bar /g)).toHaveLength(5);
    expect(markup).toContain('title="09:28–11:00 Active · AT-101"');
    const submitted = html(<mods.Home s={working({ tab: 'summary', summary: { ...s.summary, canConfirm: false, confirmHint: 'Week already submitted — changes go to your Project Lead as an update' } })} />);
    expect(submitted).toMatch(/<button[^>]*disabled=""[^>]*title="Week already submitted/);
  });

  it('settings: HR rows, user toggles as switches, device row, footnote, sign out', () => {
    const markup = html(<mods.Home s={baseState({ tab: 'settings', update: { version: '1.4.3', mandatory: false, notes: null, hasUrl: true } })} />);
    const t = text(<mods.Home s={baseState({ tab: 'settings' })} />);
    for (const x of ['Auto-idle after', '5 min · HR policy', 'Every 10 min · HR policy', 'Launch at Windows start-up', 'Show tray widget', 'Break reminders', 'Up to 7 days', 'PRIYA-LAPTOP · paired 29 Sep', 'v1.4.2', 'Rules marked "HR policy" are set by your admin', 'Sign out & unpair'])
      expect(t).toContain(x);
    expect(markup.match(/role="switch"/g)).toHaveLength(3);
    expect(markup).toContain('tw-badge');
  });
});

describe('tray widget, screenshot toast and dev panel', () => {
  it('widget shows status, timer, active task, break and Open', () => {
    pushState!(working({ widget: { open: true, lastShot: 'Last shot 10:10 · AT-101' } }));
    const t = text(<mods.WidgetApp />);
    for (const x of ['Working', '2h 45m', 'AT-101 · Invoice PDF export', 'Last shot 10:10 · AT-101', 'Start break', 'Open']) expect(t).toContain(x);
  });

  it('toast window renders nothing until a shot arrives', () => {
    expect(html(<mods.ToastApp />)).toBe('<div class="tw-shot"></div>');
  });

  it('dev panel lists the prototype controls and the event log', () => {
    const t = text(<mods.DevPanel s={working({ isDev: true })} onClose={() => undefined} />);
    for (const x of ['Prototype controls', 'Trigger 5-min idle', 'Capture screenshot', 'Go offline', 'Toggle tray widget', 'Event log', 'Screenshot · AT-101']) expect(t).toContain(x);
    expect(text(<mods.DevPanel s={working({ isDev: true, online: false })} onClose={() => undefined} />)).toContain('Reconnect (sync queue)');
  });
});
