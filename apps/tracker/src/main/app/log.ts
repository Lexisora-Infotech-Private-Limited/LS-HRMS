import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clock } from '@tracker-shared/format';
import type { LogLine } from '@tracker-shared/ipc';

/**
 * Diagnostic log: the last lines in memory (the dev "Event log" and diagnostics) plus a
 * rolling file under userData/logs (tracker.log, 5 MB × 3). Never logs tokens.
 */
export class DiagLog {
  private readonly lines: LogLine[] = [];
  private readonly file: string | null;

  constructor(
    dir: string | null,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly keep = 3,
    private readonly now: () => number = Date.now,
  ) {
    this.file = dir ? join(dir, 'tracker.log') : null;
    if (dir) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        /* logging must never break the app */
      }
    }
  }

  add(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const t = this.now();
    this.lines.unshift({ t: clock(t), m: message });
    if (this.lines.length > 40) this.lines.length = 40;
    this.write(`${new Date(t).toISOString()} ${level.toUpperCase()} ${message}\n`);
  }

  recent(n = 8): LogLine[] {
    return this.lines.slice(0, n);
  }

  private write(line: string) {
    if (!this.file) return;
    try {
      if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) this.rotate();
      appendFileSync(this.file, line);
    } catch {
      /* ignore */
    }
  }

  private rotate() {
    if (!this.file) return;
    const f = this.file;
    rmSync(`${f}.${this.keep - 1}`, { force: true });
    for (let i = this.keep - 2; i >= 1; i--) if (existsSync(`${f}.${i}`)) renameSync(`${f}.${i}`, `${f}.${i + 1}`);
    renameSync(f, `${f}.1`);
  }
}
