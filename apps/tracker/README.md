# Lexisora Tracker (Windows desktop app)

The desktop time tracker for Lexisora HRMS: punch in/out, per-task time, breaks, auto-idle with
the three-choice idle dialog, screenshots, an offline-first encrypted queue, a tray icon plus an
always-on-top tray widget, and a daily summary that feeds the weekly timesheet.

- **Stack:** Electron 37, electron-vite 4, React 18 renderer, electron-builder 26 (NSIS installer).
- **API contract:** `packages/shared/src/tracker.ts`, server endpoints under `/api/v1/tracker/**`.
- **Design source of truth:** `docs/wireframes/desktop-tracker.html`, spec `docs/specs/spec-tracker.md` (T1–T8).

## Requirements

- Windows 10 or 11, x64. Development also runs on macOS and Linux, but the tray, notification and
  start-up behaviour is written for Windows.
- Node 22 and pnpm, with the workspace installed (`pnpm install` at the repo root).
- A running Lexisora API. The default is `http://localhost:4000`. Change it with
  `LEXISORA_SERVER_URL`, or with **Server … · Change** on the sign-in screen (the setting is saved).

## Develop

```bash
# from the repo root
pnpm --filter @lexisora/tracker dev            # electron-vite dev: main + preload rebuild, renderer HMR
LEXISORA_SERVER_URL=http://localhost:4100 pnpm --filter @lexisora/tracker dev
```

Development builds keep their data in a separate profile (`%APPDATA%\Lexisora Tracker (dev)`),
so they never touch an installed tracker's queue.

**Demo sign-in** (the seed data, "today" = Tue 29 Sep 2026):

| Who | Email | Mode |
|---|---|---|
| Priya Sharma (Remote) | `priya.sharma@lexisora.com` | PUNCH: Punch in / Start break / Punch out |
| Arjun Mehta, Vikram Joshi (Hybrid) | `arjun.mehta@lexisora.com`, `vikram.joshi@lexisora.com` | PUNCH (monitor-only on a day with a biometric IN) |
| Rohit Verma, Kavya Iyer, Neha Kapoor, … (Office) | `rohit.verma@lexisora.com`, `neha.kapoor@lexisora.com`, … | MONITOR_ONLY: tracking follows the biometric punch |

Use workspace `lexisora.hrms.app` (or `lexisora`) and password `password`.

**Pairing:** after sign-in the app shows a 6-digit code (Step 2 of 2). Approve it in the web
portal under **My profile → Devices** (or HR approves it under Devices). The app polls
`/tracker/pair/status` and continues on its own; **I've approved it · continue** checks at once.

**Prototype controls:** in a development build, the **DEV** button in the title bar opens the
wireframe's prototype panel. It can trigger an idle span, capture a screenshot, go offline and
reconnect, toggle the tray widget, simulate a lock-screen gap, an app-not-running gap or a break
reminder, set the PC clock back 2 h (and restore it), and force a sync. It also shows the event
log. The `simulate` IPC command is refused in packaged builds.

## Scripts

| Script | What it does |
|---|---|
| `pnpm --filter @lexisora/tracker typecheck` | `tsc` for main/preload (`tsconfig.node.json`) and the renderer (`tsconfig.web.json`) |
| `pnpm --filter @lexisora/tracker test` | vitest: engine, clock, queue, outbox, sync, wire, view model, window placement, screens |
| `pnpm --filter @lexisora/tracker build` | `electron-vite build` → `out/main`, `out/preload`, `out/renderer` |
| `pnpm --filter @lexisora/tracker dist:dir` | icon + build + unpacked app in `dist/win-unpacked/` (quick packaging check) |
| `pnpm --filter @lexisora/tracker dist:win` | icon + build + NSIS installer `dist/Lexisora-Tracker-Setup-<version>-x64.exe` |
| `pnpm --filter @lexisora/tracker icon` | regenerates `build/icon.ico` (`scripts/make-icon.mjs`, no extra dependencies). `build/` is git-ignored, so the `dist:*` scripts run this first |

## Package and install

```bash
pnpm --filter @lexisora/tracker dist:win
```

- electron-vite bundles everything, including `@lexisora/shared` and zod, into `out/`. The
  installer therefore ships **no `node_modules`**, which keeps electron-builder happy inside the
  pnpm workspace.
- The NSIS installer is a per-user one-click install to `%LOCALAPPDATA%\Programs\Lexisora Tracker`.
  It needs no admin rights and adds a Start-menu shortcut (whose AppUserModelID `in.lexisora.tracker`
  Windows toasts need). Uninstalling keeps `%APPDATA%\Lexisora Tracker`, so unsynced encrypted
  time survives a reinstall.
- Electron fuses: RunAsNode, `NODE_OPTIONS` and `--inspect` are off; cookie encryption, embedded
  ASAR integrity validation and only-load-from-ASAR are on.
- **Signing:** set `CSC_LINK` / `CSC_KEY_PASSWORD` (Authenticode) in CI. Local builds are unsigned,
  so SmartScreen warns on first run.
- **Updates:** electron-updater is not a dependency. The app checks `GET /api/v1/tracker/releases/latest`
  (`{ version, downloadUrl?, notes?, mandatory? }`) at start-up, every 4 h, and from **Check for
  updates** (Settings / tray). A newer version shows a badge on the Settings tab and an
  **Update v&lt;version&gt; available · Download** row that opens the download. A `mandatory` update
  blocks **Punch in** until it is installed. If the server has no such endpoint (404/405/501), the check is skipped quietly.
  `LEXISORA_UPDATE_URL` fills in a generic-provider feed placeholder (`app-update.yml`) for a
  future electron-updater integration.
- On first run the packaged app registers a Windows start-up entry (`app.setLoginItemSettings`,
  on by default). The entry runs it with `--hidden`, so it starts in the tray when the device is
  already paired. **Launch at Windows start-up** in Settings toggles it, and the row follows the
  real OS state if the entry is removed elsewhere.

## How it works

```
main process (Node)                                   renderer (sandboxed React, 3 windows)
─────────────────────────────────────────────         ─────────────────────────────────────
index.ts          single-instance lock, app lifecycle,   index.html?w=main    400×620 tracker window
                  IPC (sender URL checked), hardening    index.html?w=widget  tray widget (always on top)
app/controller.ts orchestrates everything below          index.html?w=toast   screenshot toast (no focus)
engine/*          pure time accounting (unit-tested)       ▲ view model pushed every second
services/*        API client, encrypted outbox, sync,      │ commands (zod-validated in main)
                  realtime, screenshots                   preload/index.ts → window.tracker
windows/*         frameless windows, tray, notifications
```

- **The engine is pure** (`src/main/engine`): a segment builder, an idle state machine
  (`ACTIVE → PROMPT → resolved`, lock/sleep/app-not-running gaps), per-task totals and day
  summaries, break reminders, the screenshot schedule and the offline queue ordering. Callers pass
  `now` and the system idle seconds, so the tests use fake clocks.
- **Idle:** `powerMonitor.getSystemIdleTime()` is polled every second. After the policy's
  threshold the window comes forward with "You've been idle for N minutes". Idle time stays out of
  worked time until the user chooses **I was working** (IDLE_WORK, an idle claim for the Project
  Lead, with an optional ≤ 140-char note), **Count it as a break** (BREAK), or **Mark as idle &
  resume** (IDLE, deducted). Lock-screen, sleep and "tracker wasn't running" gaps use the same
  dialog with their own copy ("Your PC was locked from 13:05 to 13:52").
- **Screenshots:** `desktopCapturer` every `screenshotIntervalMin` of active time. All displays
  are stitched side by side or only the primary is captured, per policy. Images are JPEG 70 %,
  blurred on the device when the policy says so, mapped to the active task, and never taken while
  the idle dialog is open. A 3-second toast reads "Screenshot captured · 10:10 · mapped to AT-101 ·
  Visible to your Project Lead and Reporting Manager".
- **Offline-first:** every punch, event, segment and screenshot is appended to an encrypted,
  append-only outbox (`outbox/outbox.jsonl`, one AES-256-GCM record per line, and screenshots in
  `outbox/shots/`) before any network call. Sync sends punches first (in order), then
  events + segments in bounded batches, then screenshots. It retries with exponential backoff
  (2 s → 5 min, jitter) and splits a refused batch in half until the bad entry is found. Every
  entry has a `crypto.randomUUID()` clientId and the server dedupes on it, so replays are
  idempotent. The banner reads "Offline · tracking locally · N entries queued". Entries older than
  the policy's `offlineRetentionDays` are pruned, and after that long offline Punch in is disabled
  with a message.
- **Clock integrity (T5 §5 / T8):** `engine/clock.ts` compares wall-clock and monotonic elapsed
  time on every read. A jump of more than 30 s outside suspend/resume is reported as
  `CLOCK_CHANGE {driftSec}`, and the server raises a CLOCK_CHANGED integrity flag. The tracker's
  own timeline stays continuous, so segments never overlap or stretch. The adjustment ends when the
  PC clock agrees with the server again (heartbeat / sync `serverTime`). A PC clock that is behind
  the last recorded time at start-up is flagged the same way.
- **Realtime:** a minimal Socket.IO v4 client (Engine.IO over Node 22's global WebSocket; no extra
  dependency) authenticates with the device token and handles `policy.updated`, `device.revoked`,
  `attendance.punched`, `tasks.updated` and `command.syncNow`. A heartbeat every 60 s reports status,
  queue depth, app version and display count.
- **MONITOR_ONLY** (office staff, biometric-only locations, or a day with a biometric IN): the
  punch buttons are hidden. Tracking attaches to the session opened by the biometric/web punch
  (`GET /tracker/today`) and stops when that session closes.

### Data on disk (`%APPDATA%\Lexisora Tracker`)

| File | Contents | Protection |
|---|---|---|
| `key.bin` | 256-bit data key | wrapped by `safeStorage` (DPAPI on Windows) |
| `device.bin` | device token + pairing details | `safeStorage` |
| `state.bin` | engine snapshot (open session, today's segments) | AES-256-GCM |
| `cache.bin` | policy, tasks, today baseline, ack log | AES-256-GCM |
| `outbox/outbox.jsonl`, `outbox/shots/*.bin` | unsynced entries and screenshots | AES-256-GCM per record |
| `prefs.json` | server URL, last workspace/email, toggles, widget position | none (no secrets) |
| `logs/tracker.log` | diagnostic log, 5 MB × 3, never contains tokens | none |

### Security

The renderer is sandboxed and context-isolated: no `nodeIntegration`, a strict CSP in production
(no inline script, no remote origins), navigation, new windows and webviews are blocked, and all
browser permission requests are denied. The renderer only sees the view model. Tokens and keys
stay in main, every IPC command is validated with zod, and IPC from a frame that isn't the app's
own page is refused. Screen capture runs in main.

## Troubleshooting

- **Settings → Device row** copies a diagnostics JSON to the clipboard: version, server, queue
  counts, last sync error, clock offset and the recent log. It contains no secrets.
- The log is at `%APPDATA%\Lexisora Tracker\logs\tracker.log`.
- **Sign out & unpair** refuses while entries are unsynced and offline. The dialog offers
  "Unpair anyway (discard)", which needs `UNPAIR` typed.
- To reset a dev profile, quit the tracker and delete `%APPDATA%\Lexisora Tracker (dev)`. This
  deletes unsynced entries.

## Known limitations

- Keyboard and mouse event counts are sent as 0: Electron exposes only system idle time, and a
  global input hook would need a native module.
- The contract's screenshot metadata has no `inIdle` flag. A shot taken just before idle was
  detected isn't tagged, but no shots are taken while the idle dialog is open.
- No silent auto-update (electron-updater isn't installed). The app points the user to the
  installer from `/tracker/releases/latest`.
- Local builds are unsigned.
