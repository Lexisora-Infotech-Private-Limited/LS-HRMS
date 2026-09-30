import type { TrackerPolicyResponse, TrackerTask, TrackerToday } from '@lexisora/shared';
import { clock, hm, istMinuteOfDay, parseHHMM, relativeInput, shortDate } from '@tracker-shared/format';
import type { EngineStatus, IdleCauseView, IdleDialogView, Prefs, SettingsRow, TaskRow, Tone, TrackingMode } from '@tracker-shared/ipc';

/**
 * Pure copy + view-model helpers (wireframe docs/wireframes/desktop-tracker.html and
 * spec-tracker T1–T7, with the COVERAGE-AUDIT copy fixes). Unit-tested; no electron here.
 */

export const FOOTER_NOTE = 'Available to Remote / WFH employees. Office staff punch with biometric.';
/** Audit fix #9 (pairing copy). */
export const PAIR_HELP = 'Enter this code in the web portal under My profile → Devices, or ask HR to approve it.';
/** Audit fix #1 (screenshot disclosure copy). */
export const SCREENSHOT_AUDIENCE = 'Visible to your Project Lead and Reporting Manager';
export const HR_POLICY_FOOTNOTE = 'Rules marked "HR policy" are set by your admin and can\'t be changed here.';
export const WEEK_SUBMITTED_HINT = 'Week already submitted — changes go to your Project Lead as an update';
export const DEFAULT_PERMISSIONS = ['activity monitor', 'screen capture'];

export type DotState = 'WORKING' | 'IDLE' | 'BREAK' | 'OUT';

export function statusView(status: EngineStatus, idle: boolean): { label: string; tone: Tone; dot: DotState } {
  if (status === 'WORKING') return idle ? { label: 'Idle', tone: 'tag-accent', dot: 'IDLE' } : { label: 'Working', tone: 'tag-accent', dot: 'WORKING' };
  if (status === 'BREAK') return { label: 'On break', tone: 'tag-outline', dot: 'BREAK' };
  return { label: 'Not punched in', tone: 'tag-neutral', dot: 'OUT' };
}

export function shiftLabel(policy: Pick<TrackerPolicyResponse, 'shiftStart' | 'shiftEnd'> | null): string {
  if (!policy || parseHHMM(policy.shiftStart) === null || parseHHMM(policy.shiftEnd) === null) return 'No shift assigned';
  return `Shift ${policy.shiftStart} – ${policy.shiftEnd}`;
}

export function punchHelper(policy: Pick<TrackerPolicyResponse, 'screenshotsEnabled' | 'screenshotIntervalMin'> | null): string {
  if (policy && !policy.screenshotsEnabled) return 'Punch in starts activity tracking.';
  return `Punch in starts activity tracking and ${policy?.screenshotIntervalMin ?? 10}-minute screenshots.`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Idle dialog copy (spec T3 §1): threshold title for no-input, "from … to …" variants for lock / sleep / app gaps. */
export function idleDialog(
  cause: IdleCauseView,
  since: number,
  until: number | null,
  thresholdMin: number,
  claimsAllowed: boolean,
): IdleDialogView {
  const from = clock(since);
  const to = until !== null ? clock(until) : null;
  const paused = 'Idle time is paused from your worked hours until you choose.';
  let title: string;
  let body: string;
  if (cause === 'LOCK') {
    title = `Your PC was locked from ${from} to ${to ?? 'now'}`;
    body = `The screen was locked. ${paused}`;
  } else if (cause === 'SUSPEND') {
    title = `Your PC was asleep from ${from} to ${to ?? 'now'}`;
    body = `The PC was asleep. ${paused}`;
  } else if (cause === 'APP_NOT_RUNNING') {
    title = `Tracker wasn't running from ${from} to ${to ?? 'now'}`;
    body = `The tracker was closed while you were punched in. ${paused}`;
  } else {
    title = `You've been idle for ${plural(Math.max(1, thresholdMin), 'minute')}`;
    body = `No keyboard or mouse input since ${from}. ${paused}`;
  }
  return { cause, title, body, since: from, until: to, claimsAllowed };
}

/** "Punch out before shift end (18:30)?" when now < shiftEnd − 30 min (day shifts only). */
export function earlyPunchOutPrompt(now: number, policy: Pick<TrackerPolicyResponse, 'shiftStart' | 'shiftEnd'> | null): string | null {
  if (!policy) return null;
  const end = parseHHMM(policy.shiftEnd);
  const start = parseHHMM(policy.shiftStart);
  if (end === null) return null;
  if (start !== null && end <= start) return null; // overnight shift — can't tell reliably
  return istMinuteOfDay(now) < end - 30 ? `Punch out before shift end (${policy.shiftEnd})?` : null;
}

export function nextShotLabel(opts: { enabled: boolean; status: EngineStatus; paused: boolean; seconds: number | null }): string | null {
  if (!opts.enabled || opts.status === 'OUT' || opts.seconds === null) return null;
  if (opts.paused) return 'Screenshots paused';
  return `Next screenshot in ${Math.max(1, Math.ceil(opts.seconds / 60))} min`;
}

export const lastInputLabel = (idleSec: number) => `Last input ${relativeInput(idleSec)}`;

export function breakReminderNote(min: number): string {
  if (min <= 0) return 'Turned off in your attendance policy';
  if (min % 60 === 0) return `Nudge after ${plural(min / 60, 'hour')} of work`;
  return `Nudge after ${min} minutes of work`;
}

export function onOff(v: boolean): { value: string; tone: Tone } {
  return v ? { value: 'On', tone: 'tag-accent' } : { value: 'Off', tone: 'tag-neutral' };
}

export interface SettingsInput {
  policy: TrackerPolicyResponse | null;
  prefs: Prefs;
  mode: TrackingMode;
  device: { hostname: string; pairedAt: string | null } | null;
  appVersion: string;
  update: { version: string; mandatory: boolean; notes: string | null } | null;
}

/** Settings tab rows (spec T2 §1 + T7 §1). HR-locked rows are read-only `tag-neutral` with "· HR policy". */
export function settingsRows(i: SettingsInput): SettingsRow[] {
  const p = i.policy;
  const rows: SettingsRow[] = [];
  rows.push({
    key: 'idle',
    label: 'Auto-idle after',
    note: 'No keyboard / mouse input',
    value: !p ? '— · HR policy' : p.autoIdleEnabled ? `${p.idleThresholdMin} min · HR policy` : 'Off · HR policy',
    tone: 'tag-neutral',
  });
  rows.push({
    key: 'shots',
    label: 'Screenshots',
    note: 'Mapped to the active task',
    value: !p ? '— · HR policy' : p.screenshotsEnabled ? `Every ${p.screenshotIntervalMin} min · HR policy${p.blurScreenshots ? ' · blurred' : ''}` : 'Off · HR policy',
    tone: 'tag-neutral',
  });
  rows.push({ key: 'launch', label: 'Launch at Windows start-up', note: 'Recommended', ...onOff(i.prefs.launchAtStartup), toggle: 'launchAtStartup' });
  rows.push({ key: 'widget', label: 'Show tray widget', note: 'Mini timer near the clock', ...onOff(i.prefs.showTrayWidget), toggle: 'showTrayWidget' });
  const reminderMin = p?.breakReminderMin ?? 120;
  rows.push(
    reminderMin > 0
      ? { key: 'breaks', label: 'Break reminders', note: breakReminderNote(reminderMin), ...onOff(i.prefs.breakReminders), toggle: 'breakReminders' }
      : { key: 'breaks', label: 'Break reminders', note: breakReminderNote(0), value: 'Off · HR policy', tone: 'tag-neutral', disabled: true },
  );
  rows.push({ key: 'offline', label: 'Offline storage', note: 'Encrypted, syncs on reconnect', value: `Up to ${p?.offlineRetentionDays ?? 7} days`, tone: 'tag-neutral' });
  if (i.mode === 'MONITOR_ONLY') {
    rows.push({ key: 'mode', label: 'Punch-in', note: 'Office staff punch with biometric', value: 'Monitor only · HR policy', tone: 'tag-neutral' });
  }
  if (i.update) {
    rows.push({
      key: 'update',
      label: `Update v${i.update.version} available`,
      note: i.update.mandatory ? 'Required by your admin' : (i.update.notes ?? 'Install it when you have punched out'),
      value: 'Download',
      tone: 'tag-outline',
      action: 'update.open',
    });
  }
  if (i.device) {
    rows.push({
      key: 'device',
      label: 'Device',
      note: `${i.device.hostname}${i.device.pairedAt ? ` · paired ${shortDate(i.device.pairedAt)}` : ''}`,
      value: `v${i.appVersion}`,
      tone: 'tag-neutral',
      action: 'copyDiagnostics',
      hint: 'Click to copy diagnostics',
    });
  }
  return rows;
}

export type TaskMeta = { key: string; title: string; projectName?: string };

/** "Working on" rows: assigned tasks + standing internal activities, with today's time. */
export function taskRows(tasks: readonly TrackerTask[], perTask: ReadonlyMap<string | null, number>, activeId: string | null): TaskRow[] {
  return tasks.map((t) => {
    const seconds = perTask.get(t.id) ?? 0;
    return { id: t.id, key: t.key, title: t.title, projectName: t.projectName, seconds, time: hm(seconds), active: t.id === activeId };
  });
}

/** Daily summary "By task": every task with time today, in task-list order, then the rest by time. */
export function byTaskRows(
  tasks: readonly TrackerTask[],
  perTask: ReadonlyMap<string | null, number>,
  known: ReadonlyMap<string, TaskMeta>,
): { key: string; title: string; time: string }[] {
  const order = new Map(tasks.map((t, i) => [t.id, i]));
  const rows = [...perTask.entries()]
    .filter(([, s]) => s >= 1)
    .map(([id, s]) => {
      const meta = id ? (known.get(id) ?? tasks.find((t) => t.id === id)) : null;
      return {
        id,
        seconds: s,
        key: meta?.key ?? (id ? '—' : ''),
        title: meta?.title ?? (id ? 'Task' : 'No task selected'),
      };
    });
  rows.sort((a, b) => {
    const oa = a.id ? (order.get(a.id) ?? 1e6) : 2e6;
    const ob = b.id ? (order.get(b.id) ?? 1e6) : 2e6;
    return oa - ob || b.seconds - a.seconds;
  });
  return rows.map((r) => ({ key: r.key, title: r.title, time: hm(r.seconds) }));
}

export function summaryTitle(status: EngineStatus, workedSec: number): string {
  return status === 'OUT' && workedSec >= 60 ? 'Day complete' : 'Today so far';
}

/** Windows tray tooltips can't show the wireframe's text chip, so it becomes the tooltip (≤ 127 chars). */
export function trayTooltip(statusLabel: string, status: EngineStatus, worked: string, task: TaskMeta | null): string {
  const text =
    status === 'OUT' ? 'Lexisora Tracker · Not punched in' : `${statusLabel} · ${worked}${task ? ` · ${task.key} ${task.title}` : ''}`;
  return text.length > 127 ? `${text.slice(0, 126)}…` : text;
}

/** Punch in is blocked when the offline queue is older than the retention window (spec T5 §1). */
export function offlineBlock(opts: { online: boolean; queued: number; lastSyncAt: number | null; oldestPendingAt: number | null; now: number; retentionDays: number }): string | null {
  if (opts.online || opts.queued === 0) return null;
  const since = opts.lastSyncAt ?? opts.oldestPendingAt;
  if (since === null) return null;
  const days = (opts.now - since) / 86_400_000;
  if (days <= opts.retentionDays) return null;
  return `Connect to the internet to sync ${plural(Math.ceil(days), 'day')} of tracking before punching in`;
}

const SOURCE_LABEL: Record<string, string> = { WEB: 'web', BIOMETRIC: 'biometric', DESKTOP: 'desktop', MOBILE: 'mobile', REGULARIZATION: 'regularization', SYSTEM: 'HR' };

/** "Punched in via web at 09:30 · Continue tracking here" (spec T3 §1). */
export function serverSessionView(today: Pick<TrackerToday, 'status' | 'punchedInAt' | 'punchSource'> | null): { label: string; action: string } | null {
  if (!today || today.status === 'OUT' || !today.punchedInAt) return null;
  const src = SOURCE_LABEL[today.punchSource ?? ''] ?? 'another device';
  return { label: `Punched in via ${src} at ${clock(Date.parse(today.punchedInAt))}`, action: 'Continue tracking here' };
}

/** "9:41" */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function permissionsLine(perms: readonly string[] | undefined | null): string {
  const list = perms && perms.length ? perms : DEFAULT_PERMISSIONS;
  return `Permissions: ${list.join(', ')}`;
}
