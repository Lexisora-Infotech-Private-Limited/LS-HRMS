/** ZKTeco ADMS (iclock) push protocol helpers — pure, unit-tested. */
import { IST_OFFSET_MIN } from './time-utils';

export type AttLogLine = { pin: string; local: string; status: number | null; verify: number | null; workCode: string | null; raw: string };

/** Parse an ADMS ATTLOG body: "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode…" per line. */
export function parseAttLog(body: string): AttLogLine[] {
  const out: AttLogLine[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t').map((p) => p.trim());
    const pin = parts[0] ?? '';
    const local = parts[1] ?? '';
    if (!/^\d{1,9}$/.test(pin) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(local)) continue;
    out.push({
      pin,
      local: local.length === 16 ? `${local}:00` : local,
      status: parts[2] !== undefined && parts[2] !== '' ? Number(parts[2]) : null,
      verify: parts[3] !== undefined && parts[3] !== '' ? Number(parts[3]) : null,
      workCode: parts[4] || null,
      raw: line,
    });
  }
  return out;
}

/** Device-local IST "YYYY-MM-DD HH:MM:SS" → instant. */
export function localToInstant(local: string): Date {
  return new Date(new Date(`${local.replace(' ', 'T')}Z`).getTime() - IST_OFFSET_MIN * 60_000);
}

/** ZKTeco status codes: 0 check-in, 1 check-out, 2 break-out, 3 break-in, 4 OT-in, 5 OT-out. */
export function directionFromStatus(status: number | null): 'IN' | 'OUT' | undefined {
  if (status === 0 || status === 3 || status === 4) return 'IN';
  if (status === 1 || status === 2 || status === 5) return 'OUT';
  return undefined;
}
