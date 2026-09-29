# Lexisora HRMS: Build spec for the Windows desktop tracker (Electron) and its ingestion backend

**What this domain covers.** Everything in the Desktop Tracker wireframe (`Desktop_Tracker/clean.html` L317–517). It also covers flow map journey #2 "Desktop tracker day" (11 steps: sign-in, pair, home, working, idle, break, shot, tray, offline, summary, settings). On the web side it covers the tracker parts of these screens:
- Attendance ("Source=Desktop", Breaks, Idle, Today's timeline, the "Active hours" and "Idle (auto)" KPIs)
- My timesheet (the "Auto-idle deducted" row)
- Timesheet approvals L1 (Worked / Auto-idle / Screenshots KPIs and the "Screenshots mapped to tasks · every 10 min" grid)
- Attendance policy (the rows "Allow desktop app punch-in", "Auto-idle after 5 min", "Screenshot every 10 min", "Blur screenshots", "Deduct idle time from payroll")
- Payslips and Payroll (idle deduction input)
- Profile → Devices

**Gap in the wireframe:** the web app's `PROF` tabs are `Overview, Documents, Assets, Offer & pay, Attendance`. There is no Devices tab. This spec adds a **Devices** tab to Profile, which the tracker's pair screen refers to.

**Core architecture decision (applies to every module).** The tracker is **event-sourced**. The device appends signed, sequenced, idempotent events to an encrypted local outbox. A **pure shared reducer** (`packages/shared/tracker/reducer.ts`: `reduceDay(events, policySnapshot, claimDecisions, now) → DayState{status, segments[], totals, perTask[], shotClock, pendingIdle}`) runs on both sides:
- in Electron main, to drive the live UI and timers;
- in the API, to project `ActivitySegment` and `TrackerDaySummary`.

This guarantees the timer the employee sees matches what lands in attendance, timesheets and payroll. The server is authoritative. The device is authoritative only about what happened on the device.

---

## Module T1: Device sign-in, pairing and device management

### 1. Screens and UX

**Tracker: Sign in** ("Sign in to track your day", "Use your Lexisora HRMS account.")
- **Workspace** (text, default = last used, e.g. `lexisora.hrms.app`). On blur it calls `GET https://{workspace}/.well-known/hrms-tenant` and shows the tenant name and logo. Unknown workspace → inline error "Workspace not found".
- **Official email** and **Password** fields.
- **Sign in** button (primary, block). Spinner while waiting. Errors: bad credentials; account locked; `TRACKER_NOT_ELIGIBLE`, which shows the footer text as an error: "Available to Remote / WFH employees. Office staff punch with biometric."
- Footer note, always shown: "Available to Remote / WFH employees. Office staff punch with biometric."
- If this machine already holds an ACTIVE device credential for this user (same `machineIdHash` and private key present), pairing is skipped and the app goes straight to home.
- P2: "Sign in with SSO" (system browser + PKCE loopback) when the tenant has SSO.

**Tracker: Pair this device** ("Step 2 of 2")
- Six code boxes with digits from the server (Cormorant, 28px), plus a countdown "Code expires in 9:41" (added).
- Body text: "Enter this code in the web portal under Profile → Devices, or approve the request HR sent to your email."
- Device line: `{hostname} · {Windows 11 (build)}`.
- Permissions line: "Permissions: activity monitor, screen capture". Screen capture is omitted if the policy disables screenshots.
- Added consent text: "By continuing you acknowledge the Tracker monitoring notice (v{n})" with a link.
- **I've approved it · continue**: forces an immediate poll.
  - APPROVED → claim → Home.
  - AWAITING_HR → "Waiting for HR approval" state.
  - Still PENDING → toast "Not approved yet".
- The app also auto-polls every 3 s, and listens for socket `pairing.approved` if a pre-pair socket is open.
- **Get a new code** after expiry. **Cancel / use another account** link.

**Web: Profile → Devices tab** (new; all roles on their own profile)
- Table columns: Device (hostname), OS, App version, Paired (date), Last seen (relative), Status tag (`~Active` / `-Revoked` / `-Unpaired` / `!Awaiting HR`), Actions (Revoke).
- Header action **Pair a device** opens the "Pair a device" modal: 6-digit input. On a valid code it shows the matched request (hostname, OS, app version, requested x min ago, permissions) with an **Approve** / **Reject** button. Success toast: "PRIYA-LAPTOP paired" or "Sent to HR for approval".
- A pending-request banner appears via socket `device.pairing.requested`: "A device (PRIYA-LAPTOP) is waiting — enter the code shown on it."
- Revoke → confirm modal with a Reason field (text, optional for self, required for HR) → toast "Device revoked; tracker signed out".

**Web: HR/Admin viewing another employee's profile → Devices.** Same table plus approve/reject for AWAITING_HR requests and Revoke with a mandatory reason. A manager sees the tab read-only for their reports.

**Web: Email approval landing** (`/device-approve?token=`). A card shows the device details with **Approve this device** / **This wasn't me**. "This wasn't me" rejects the request and raises a security alert to HR.

**Web: HR "Tracker devices" admin list (P2).** Tab "Devices" inside the Attendance policy screen. Columns: Employee, Device, OS, Version, Last seen, Queue (unsynced), Status. Filters: outdated version, not seen for 7 days.

### 2. Data model
```prisma
enum TrackerDeviceStatus { ACTIVE REVOKED UNPAIRED }
enum PairingStatus { PENDING AWAITING_HR APPROVED CLAIMED REJECTED EXPIRED CANCELLED }
enum PairingApproval { PORTAL_CODE EMAIL_LINK HR }

model TrackerDevice {
  id              String   @id @default(uuid())
  tenantId        String
  userId          String
  hostname        String   @db.VarChar(64)
  osPlatform      String   // "win32"
  osVersion       String   // "Windows 11 Pro 23H2 (22631)"
  arch            String   // x64|arm64
  appVersion      String
  machineIdHash   String   // sha256(MachineGuid + tenantSalt)
  publicKey       String   // Ed25519, base64
  status          TrackerDeviceStatus @default(ACTIVE)
  approvalMethod  PairingApproval
  approvedById    String?
  pairedAt        DateTime
  consentVersion  Int
  consentAt       DateTime
  displays        Int      @default(1)
  settings        Json     // {launchAtStartup, showTrayWidget, breakReminders}
  lastSeenAt      DateTime?
  lastSyncAt      DateTime?
  lastIp          String?
  queueDepth      Int      @default(0)
  revokedAt       DateTime?
  revokedById     String?
  revokeReason    String?
  syncGraceUntil  DateTime? // revokedAt + 24h: sync-only scope
  createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  @@index([tenantId, userId, status])
  @@index([tenantId, lastSeenAt])
  // raw SQL: UNIQUE (tenant_id, user_id, machine_id_hash) WHERE status='ACTIVE'
}

model DevicePairingRequest {
  id             String @id @default(uuid())
  tenantId       String
  userId         String
  codeHash       String   // HMAC-SHA256(code, serverPepper)
  status         PairingStatus @default(PENDING)
  hostname String; osVersion String; appVersion String; arch String
  machineIdHash  String
  publicKey      String
  permissions    String[] // ["activity","screen"]
  emailTokenHash String?
  attempts       Int @default(0)   // wrong-code attempts against this user
  expiresAt      DateTime          // createdAt + 10 min
  approvedAt DateTime?; approvedById String?; approvalMethod PairingApproval?
  deviceId       String? @unique
  ip String?; createdAt DateTime @default(now())
  @@index([tenantId, userId, status])
  // raw SQL: UNIQUE (tenant_id, user_id, code_hash) WHERE status IN ('PENDING','AWAITING_HR')
}

model TrackerDeviceToken {          // refresh-token family per device
  id String @id @default(uuid())
  tenantId String; deviceId String
  familyId String; tokenHash String @unique
  scope    String  // "tracker" | "tracker:sync-only"
  expiresAt DateTime; rotatedAt DateTime?; revokedAt DateTime?
  @@index([tenantId, deviceId])
}
```
RLS is on for all three tables, using `tenant_id = current_setting('app.tenant_id')`.

### 3. Workflows and state machines

**Pairing request states**
- PENDING → APPROVED: owner enters the correct code in the portal, or clicks the email link, while `requireHrDeviceApproval=false`.
- PENDING → AWAITING_HR: same actions, but `requireHrDeviceApproval=true` (or the user is already at `maxDevicesPerUser`).
- AWAITING_HR → APPROVED / REJECTED: an HR user with `tracker.device.manage`.
- APPROVED → CLAIMED: the device calls claim with a valid signature. This creates the TrackerDevice and tokens.
- PENDING / AWAITING_HR → EXPIRED (job, after `expiresAt`; AWAITING_HR requests get 72 h) or CANCELLED (device).
- Any open state → REJECTED ("This wasn't me" / Reject). Side effect: security alert to HR.

**Device states**
- ACTIVE → UNPAIRED: self, via "Sign out & unpair".
- ACTIVE → REVOKED: self or HR, from the web.
- On REVOKED: socket `device.revoked`, all tokens revoked, and a `sync-only` token is allowed until `syncGraceUntil` so the queued pre-revoke events can still land. An open session is closed at `revokedAt` (see T3).
- Re-pairing the same machine creates a new device row. The old row keeps its history.

**Device auth**
- Access JWT lasts 15 min. Claims: `sub=userId, tid, did, scope, pv (policyVersion)`.
- Refresh token lasts 30 days and rotates. Reuse of a rotated token revokes the whole family and the device is flagged `TOKEN_REUSE`.
- Refresh requires `{deviceId, nonce, Ed25519 signature}`, so stolen refresh tokens are useless off-device.
- The private key and tokens live only in Electron main, encrypted with `safeStorage` (DPAPI).

### 4. API
| Method / path | Auth / permission |
|---|---|
| GET `/.well-known/hrms-tenant` | public → `{tenantId, name, logoUrl, accent, apiBase, sso}` |
| POST `/api/v1/tracker/auth/login` `{email,password}` | `tracker.use` + eligibility (T2) → `{pairingToken (15 min, scope tracker:pair), user, knownDevice?:{deviceId, challenge}}` |
| POST `/api/v1/tracker/pairings` `{hostname,osVersion,arch,appVersion,machineIdHash,publicKey,permissions}` | pairingToken → `{pairingId, code, expiresAt, pollAfterSec:3}` |
| GET `/api/v1/tracker/pairings/:id` | pairingToken → `{status}` |
| POST `/api/v1/tracker/pairings/:id/claim` `{nonce, signature}` | pairingToken → `{deviceId, accessToken, refreshToken}` |
| DELETE `/api/v1/tracker/pairings/:id` | pairingToken |
| POST `/api/v1/tracker/auth/refresh` `{deviceId, refreshToken, nonce, signature}` | none |
| DELETE `/api/v1/tracker/devices/current` | device token (unpair) |
| GET `/api/v1/me/devices` | `tracker.device.self` |
| GET `/api/v1/me/device-pairings/pending` | `tracker.device.self` |
| POST `/api/v1/me/device-pairings/lookup` `{code}` → request details | `tracker.device.self` |
| POST `/api/v1/me/device-pairings/:id/approve` `{code}` / `/reject` | `tracker.device.self` |
| GET `/api/v1/device-pairings/email/:token` / POST `.../approve` / `.../reject` | one-time signed token |
| DELETE `/api/v1/me/devices/:id` `{reason?}` | `tracker.device.self` |
| GET `/api/v1/employees/:id/devices` | `tracker.device.manage` (or `tracker.activity.view.reports`, read-only) |
| POST `/api/v1/devices/:id/revoke` `{reason}` | `tracker.device.manage` |
| POST `/api/v1/device-pairings/:id/hr-approve` / `hr-reject` | `tracker.device.manage` |
| GET `/api/v1/tracker/devices?status&outdated&staleDays` (P2) | `tracker.device.manage` |

Realtime (web `/app` namespace, room `user:{id}`): `device.pairing.requested`, `device.paired`, `device.revoked`. Tracker namespace: `pairing.approved`, `device.revoked{by,reason}`.

### 5. Business rules
- Code: 6 digits, CSPRNG, unique among the tenant's open requests, TTL 10 min. Only the **same user** who signed in on the device can approve it. The code is looked up only within `userId=currentUser`, so guessing another person's code gives nothing.
- Wrong-code rate limits: 5 per user per 15 min, and 20 per IP per hour. After that, lookups for that user are blocked for 15 min.
- `maxDevicesPerUser` defaults to 2 ACTIVE devices. Pairing a third goes to AWAITING_HR.
- The email approval link is sent to the user's **official email** as soon as the pairing request is created. It is a one-time token (sha256 stored), TTL 10 min, and becomes invalid once the request leaves PENDING.
- Consent: `consentVersion` is the current tracker monitoring-notice version. Bumping the notice forces re-acknowledgement on the next bootstrap. This supports DPDP Act notice requirements.

### 6. Jobs, notifications, audit
- **Jobs:**
  - `pairing-expiry` (every 1 min)
  - `device-stale` (daily 09:00 IST): not seen for 30 days → Alert to HR; not seen for 90 days → auto-revoke if policy `autoRevokeStaleDays` is set
  - `token-cleanup` (daily)
- **Email:**
  - "Approve your new device" (with link)
  - "New device paired to your account" (security; includes "Not you? Revoke")
  - "Your device was revoked by {name}"
- **Alerts:**
  - HR: "Device pairing awaiting approval · {employee}"
  - Employee: "PRIYA-LAPTOP paired"
- **Audit events:** `device.pairing.requested|approved|rejected|expired|cancelled`, `device.paired`, `device.unpaired`, `device.revoked{by,reason}`, `device.token.reuse_detected`.

### 7. Integrations
- `Mailer.send(templateKey, to, vars)` (Notifications domain; SMTP / Mailpit).
- `SecureStore` on the device: `{get(key):Promise<Buffer|null>; set(key,buf); del(key)}`. Implementation: `safeStorage` + a file. Mock: in-memory.
- `DeviceIdentity`: `{machineId():string; hostname(); osInfo()}`. Implementation: registry MachineGuid via `node-machine-id`. Mock: fixed values.

### 8. Validation and edge cases
- Hostname is truncated to 64 characters and sanitized.
- If `appVersion < minAppVersion`, pairing is refused with `UPDATE_REQUIRED`.
- Two open requests from the same machine and user: the older one becomes CANCELLED.
- A user whose employment has ended (or is suspended) cannot log in, and all their devices are REVOKED by an offboarding event.
- A device approved but never claimed: after 10 min the request becomes EXPIRED.
- Clock-independent: TTLs use server time.
- Workspace change on a paired machine requires unpairing first.
- Switching users on one Windows account: the tracker holds one user at a time, and switching requires unpair.

### 9. Phase
**P1.** P2: HR fleet list and SSO. Depends on Identity/Auth (password login, lockout, RBAC), Org (employment status), Notifications, Platform (tenancy resolution, audit, realtime gateway).

### 10. Acceptance scenarios
1. Priya (Remote) signs in → code shown → enters it at Profile → Devices → Approve → tracker reaches Home within 3 s. The device row shows `PRIYA-LAPTOP · Windows 11 · v1.4.2 · paired 29 Sep`, and a "New device paired" email arrives in Mailpit.
2. Rahul (Office, biometric-only location) signs in → 403 `TRACKER_NOT_ELIGIBLE`, with the footer message shown as the error.
3. Arjun enters Priya's code on his own profile → "Code not found". After 5 wrong codes, lookup is blocked for 15 min.
4. `requireHrDeviceApproval=true` → Priya approves → tracker shows "Waiting for HR" → Kavya approves → tracker claims.
5. HR revokes a punched-in device → within 2 s the tracker shows the sign-in screen with "This device was removed by Kavya Iyer". Queued events with timestamps before revocation still sync. The session closes at the revoke time.
6. A replayed refresh token → family revoked, `TOKEN_REUSE` integrity flag raised, device must re-pair.

---

## Module T2: Tracker policy, eligibility and realtime policy push

### 1. Screens and UX
**Web: Attendance policy** (`settings`; `HRA` visibility; the Attendance domain owns the screen). My module owns the semantics of these rows, per policy group (Office employees / Remote-WFH employees):
- Allow desktop app punch-in `[ ]/[x]`
- Auto-idle after **N** min without input (the wireframe's checkbox becomes checkbox + number, default 5, range 1–30)
- Screenshot every **N** min (checkbox + select 5/10/15/20/30, default 10)
- Blur screenshots `[ ]`
- Deduct idle time from payroll `[x]`

Added rows (a "Desktop tracker" subsection): Screenshot retention days (90), Capture all monitors (on), Offline storage limit days (7), Allow "I was working" idle claims (on), Break reminder after (120 min, default for the user toggle), Auto-close open sessions after shift end + (360 min), Require HR approval for new devices (off), Max devices per user (2), Minimum app version (read-only; platform-managed).

Saving shows the toast "Policy saved · pushed to N connected trackers".

**Tracker: Settings**, HR-locked rows (read-only, tag `tag-neutral`, suffix "· HR policy"):
- "Auto-idle after · No keyboard / mouse input · 5 min · HR policy"
- "Screenshots · Mapped to the active task · Every 10 min · HR policy" (shows "Off · HR policy" if disabled; appends "· blurred" when blur is on)
- "Offline storage · Encrypted, syncs on reconnect · Up to 7 days"

Footer: "Rules marked 'HR policy' are set by your admin and can't be changed here."

### 2. Data model
```prisma
enum PolicyGroup { OFFICE REMOTE }  // extensible later to policyGroupId FK if Attendance adds custom groups
model TrackerPolicy {
  id String @id @default(uuid())
  tenantId String
  group PolicyGroup
  desktopPunchAllowed    Boolean @default(false) // OFFICE false, REMOTE true
  trackingEnabled        Boolean @default(true)
  idleThresholdSec       Int     @default(300)
  screenshotsEnabled     Boolean @default(true)
  screenshotIntervalSec  Int     @default(600)
  screenshotBlur         Boolean @default(false)
  screenshotAllMonitors  Boolean @default(true)
  screenshotRetentionDays Int    @default(90)
  deductIdleFromPayroll  Boolean @default(true)
  idleClaimsAllowed      Boolean @default(true)
  offlineMaxDays         Int     @default(7)
  breakReminderMin       Int     @default(120)
  autoCloseAfterShiftEndMin Int  @default(360)
  maxSessionHours        Int     @default(16)
  requireHrDeviceApproval Boolean @default(false)
  maxDevicesPerUser      Int     @default(2)
  version                Int     @default(1)
  updatedById String?; updatedAt DateTime @updatedAt
  @@unique([tenantId, group])
}
model TrackerPolicyVersion {  // immutable snapshot; events/segments stamp policyVersion
  id String @id @default(uuid()); tenantId String; group PolicyGroup
  version Int; snapshot Json; createdById String; createdAt DateTime @default(now())
  @@unique([tenantId, group, version])
}
model TenantTrackerSettings { tenantId String @id; updateChannel String @default("stable"); pinnedVersion String?; consentVersion Int @default(1); consentText String }
```

### 3. Workflows
- Policy edit (`tracker.policy.manage`) → version+1 → snapshot row → audit diff → socket `policy.updated{group,version}` to room `tenant:{tid}:tracker:{group}`.
- Each device refetches `GET /tracker/policy` (ETag) and applies immediately:
  - idle threshold applies from the next poll;
  - screenshot interval applies to the remaining countdown as `min(remaining, newInterval)`;
  - disabling tracking while punched in → device keeps the session (punch stays valid), stops screenshots and idle detection, and shows the toast "Tracking rules changed by HR".
- If `desktopPunchAllowed` becomes false for the user's group while they are punched in: the current session continues until punch-out, and further punch-ins are refused.

### 4. API
| Method / path | Auth / permission |
|---|---|
| GET `/api/v1/tracker/policies` / PUT `/api/v1/tracker/policies/:group` | `tracker.policy.manage` (zod-validated ranges) |
| GET `/api/v1/tracker/policies/:group/versions` | `tracker.policy.manage` |
| GET `/api/v1/tracker/policy` (If-None-Match) | device token → effective policy for this user + `serverTime`, `minAppVersion`, `consentVersion` |
| GET `/api/v1/tracker/bootstrap` | device token → `{user{name,empId}, shift{name,start,end,breakAllowanceMin,tz}, eligibility, policy, tasks, today:DayState, device settings, serverTime}` |
| GET `/api/v1/tracker/eligibility` | device token |
| PUT `/api/v1/tracker/consent` `{version}` | device token |

Socket (tracker namespace): `policy.updated`, `tasks.updated`, `eligibility.changed`.

### 5. Business rules
- **Group resolution** (via Attendance/Org contract `getPunchChannels(userId, date)`):
  - The work location's punch mode "Biometric only" → OFFICE.
  - "Web / desktop allowed" (Remote location) → REMOTE.
  - Hybrid: REMOTE on any day without a biometric punch. On a day with a biometric punch, desktop punch-in is refused with "You punched in at Ahmedabad HQ today".
- **Eligible to sign in** = `employment ACTIVE ∧ tracker.use ∧ group.trackingEnabled ∧ (group.desktopPunchAllowed ∨ attachToExistingSession allowed)`. With seeded defaults, Office staff are blocked.
- Validation ranges: idle threshold 60–1800 s; screenshot interval 300–3600 s; retention 7–365 days; offline limit 1–14 days.

### 6. Jobs, notifications, audit
- Audit `tracker.policy.updated{group, before, after}`.
- Alert to all users in the affected group: "Tracker rules updated: screenshots every 15 min".
- Job `policy-push-fanout` (for offline devices, the next bootstrap/heartbeat compares `pv` and refetches).

### 7. Integrations
None external. The realtime gateway (Socket.IO + Redis adapter) comes from Platform.

### 8. Edge cases
- Device offline during a policy change: it uses the cached policy. Events are stamped with the cached `policyVersion`. The server evaluates idle segments with the **policy version in force at the event time**: a device that was unaware of a change is not penalized; rules take effect from `policyVersion` acknowledgement or `updatedAt + 15 min`, whichever is earlier.
- A policy change mid-idle: the threshold already crossed stays crossed.

### 9. Phase
**P1.** Depends on Attendance (policy screen, groups, shift allocation), Org (work location, work mode).

### 10. Acceptance scenarios
1. HR changes the Remote screenshot interval 10→15 → a connected tracker's Settings row shows "Every 15 min · HR policy" within 5 s, and the next-shot countdown ≤ 15 min.
2. HR turns on Blur → the next uploaded screenshot has `blurred=true`, and the unblurred bytes never leave the device.
3. Hybrid Vikram punches biometric at 09:40 → tracker punch-in at 10:00 is refused with the message. The next day with no biometric punch → tracker punch-in allowed.
4. PUT with `idleThresholdSec=10` → 422.
5. Offline device, policy changed at 11:00, device syncs at 13:00 with idle events evaluated at 5 min → accepted under the old version, no penalty.

---

## Module T3: Tracking engine (punch, tasks, breaks, auto-idle, idle claims, ingestion)

### 1. Screens and UX

**Tracker: Tracker tab**
- **Status tag** (top-left):

  | Status | Tag |
  |---|---|
  | Not punched in | `tag-neutral` |
  | Working | `tag-accent` |
  | Idle (the idle dialog is open) | `tag-accent` |
  | On break | `tag-outline` |

  Right side: "Shift 09:30 – 18:30" from the shift allocation. It shows "No shift assigned" if there is none.
- **Big worked timer** `Xh MMm` (58px, tabular), with the subline "worked today · break Xh MMm · idle Xh MMm" (totals across all of today's sessions).
- **Punched out:**
  - **Punch in** (primary, large).
  - Helper text "Punch in starts activity tracking and {N}-minute screenshots." N comes from the policy; if screenshots are off: "Punch in starts activity tracking."
  - If a web punch-in already exists today: "Punched in via web at 09:30 · Continue tracking here" (attaches to that session, no second punch).
  - If another device is tracking: "Tracking on PRIYA-DESKTOP · Switch to this device".
- **Punched in:**
  - **Working on** list (max-height 150px, scrolls). Rows show `{taskKey} {title}` and today's per-task time. The active row is highlighted `accent-100`. Clicking a row → `TASK_SWITCH`.
  - List source: the user's assigned tasks not in Done/Closed columns (from the Projects domain), plus tenant internal activities (e.g. `INT Meetings & stand-up`), ordered by: active task, WIP, Alloted, QA, internal. Search box when there are more than 8 rows.
  - **Start break / End break** (secondary). **Punch out** (primary).
  - Footer: "Next screenshot in {ceil(remaining/60)} min" (hidden when screenshots are off; "paused" during break or idle) · "Last input {just now | n min ago}" from `getSystemIdleTime`.
- **Punch out:**
  - If there is an unresolved idle interval, the dialog must be answered first.
  - If `now < shiftEnd − 30 min`, a confirm step appears: "Punch out before shift end (18:30)?".
  - Then the app switches to the Daily summary tab with title "Day complete".

**Tracker: Idle dialog** (modal over the window; the window is brought to front, `flashFrame`, and the tray dot turns neutral-400)
- Title "You've been idle for {threshold} minutes".
- Body "No keyboard or mouse input since {HH:mm}. Idle time is paused from your worked hours until you choose."
- Buttons:
  - **I was working (meeting / call)** (secondary). Shows an optional note field (140 characters) and "Send for review". Hidden if `idleClaimsAllowed=false`.
  - **Count it as a break** (secondary).
  - **Mark as idle & resume** (primary).
- Variant titles, same three buttons:
  - after lock / sleep: "Your PC was locked from 13:05 to 13:52";
  - after the app was killed or the PC shut down: "Tracker wasn't running from 17:10 to 17:55".
- A Windows toast notification is shown as well, in case the window is hidden.

**Web additions**
- Attendance: "Today's timeline" (Active / Break / Auto-idle bars from segments); rows Date / In / Out / Source=Desktop / Breaks / Idle / Status; KPIs "Active hours" and "Idle (auto)" (from T6).
- Timesheet approvals L1 detail: an **Idle claims** list. Columns: Time range, Task, Minutes, Note, Decision (Approve / Reject, default Approve). The **Approve** button applies the claim decisions with the timesheet. The Comment field is mandatory when any claim is rejected.
- Web header presence (P2): the team lead's "Team now" list with live status tags.

### 2. Data model
```prisma
enum TrackerEventType { APP_START APP_QUIT PUNCH_IN PUNCH_OUT BREAK_START BREAK_END TASK_SWITCH
  IDLE_START IDLE_END IDLE_RESOLVED LOCK UNLOCK SUSPEND RESUME SHUTDOWN ACTIVITY_TICK
  SCREENSHOT CLOCK_CHANGE DISPLAY_CHANGE OFFLINE ONLINE SUMMARY_CONFIRMED ATTACH_SESSION DETACH_SESSION }
enum EventStatus { ACCEPTED DUPLICATE REJECTED }

model TrackerEvent {               // partitioned monthly by correctedTs (raw SQL)
  id String @id @default(uuid())
  tenantId String; userId String; deviceId String; sessionId String?
  clientEventId String            // UUIDv7 from device
  seq BigInt                      // per-device monotonic
  bootId String; monoMs BigInt
  type TrackerEventType
  clientTs DateTime; offsetMs Int; correctedTs DateTime
  serverReceivedAt DateTime @default(now())
  payload Json                    // typed per type (zod in packages/shared)
  prevHash String; hash String    // sha256 chain
  policyVersion Int
  status EventStatus; rejectReason String?
  @@unique([tenantId, deviceId, clientEventId])
  @@index([tenantId, deviceId, seq])
  @@index([tenantId, userId, correctedTs])
}

enum SessionStatus { OPEN CLOSED AUTO_CLOSED REJECTED_CONFLICT }
model TrackerSession {
  id String @id @default(uuid())
  tenantId String; userId String; workDate DateTime @db.Date
  primaryDeviceId String
  attendanceSessionId String?     // Attendance domain's punch session
  punchInAt DateTime; punchOutAt DateTime?
  punchInSource String            // DESKTOP | WEB (attached)
  status SessionStatus @default(OPEN)
  closeReason String?             // USER | AUTO_SHIFT_END | MAX_HOURS | DEVICE_REVOKED | WEB_PUNCH_OUT
  lastEventAt DateTime?; lastHeartbeatAt DateTime?
  @@index([tenantId, userId, workDate])
  // raw SQL: UNIQUE (tenant_id, user_id) WHERE status='OPEN'
}

enum SegmentKind { ACTIVE BREAK IDLE }
enum IdleCause { NO_INPUT LOCK SLEEP APP_NOT_RUNNING }
enum IdleResolution { PENDING CLAIMED_WORK AS_BREAK DEDUCTED AUTO_DEDUCTED }
model ActivitySegment {           // projection; rebuilt per session by reducer
  id String @id                   // deterministic: sha256(sessionId+startEventId)
  tenantId String; userId String; sessionId String; deviceId String
  workDate DateTime @db.Date
  kind SegmentKind
  idleCause IdleCause?; idleResolution IdleResolution?
  taskId String?; projectId String?
  startAt DateTime; endAt DateTime?; durationSec Int
  activitySamples Int @default(0); activeSamples Int @default(0)
  startEventId String
  flags String[]                  // CLOCK_ADJUSTED, OFFLINE, SKEW
  @@index([tenantId, userId, workDate])
  @@index([tenantId, taskId, workDate])
}

enum ClaimStatus { PENDING APPROVED REJECTED }
model IdleClaim {
  id String @id @default(uuid())
  tenantId String; userId String
  startEventId String @unique     // stable across re-projection
  sessionId String; workDate DateTime @db.Date
  startAt DateTime; endAt DateTime; minutes Int
  taskId String?; note String? @db.VarChar(140)
  reviewerId String               // resolved PL
  status ClaimStatus @default(PENDING)
  decidedById String?; decidedAt DateTime?; comment String?
  timesheetId String?
  @@index([tenantId, reviewerId, status])
  @@index([tenantId, userId, workDate])
}
```

### 3. State machines

**Device engine** (main process; the UI mirrors it over IPC). "Engine" below means the tracker's state machine.
```
READY(Not punched in) --PunchIn[eligible, no conflict]--> WORKING
WORKING --StartBreak--> ON_BREAK --EndBreak--> WORKING
WORKING --idle>=threshold | LOCK/SUSPEND (then duration>=threshold)--> IDLE_PROMPT
IDLE_PROMPT --choice(work|break|idle)--> WORKING
WORKING|ON_BREAK --PunchOut--> READY (tab=summary)
IDLE_PROMPT --PunchOut--> blocked (must choose)
any --device.revoked--> SIGNED_OUT (session closed server-side at revokedAt)
any --session.updated{closed by WEB/AUTO}--> READY + toast
APP_START with open session & gap>=threshold --> IDLE_PROMPT(cause=APP_NOT_RUNNING)
```
Orthogonal flags: `online|offline`, `updatePending`.

**Event semantics**
- `IDLE_START{at=lastInputAt, cause}`.
- `IDLE_END{at=firstInputAt | unlockAt | resumeAt}`: the idle interval is `[IDLE_START.at, IDLE_END.at)`.
- `IDLE_RESOLVED{startEventId, resolution, note?}` is emitted on the click.
- Time after `IDLE_END` counts as ACTIVE on the current task. The timer display stays frozen until the choice, then catches up.
- The screenshot clock is paused from `IDLE_START` until the choice.
- Unresolved at punch-out, auto-close, or 23:59 of `workDate + 1` → AUTO_DEDUCTED.

**Server ingestion pipeline** (per batch):
1. Authenticate the device and check its status.
2. Validate each event with zod.
3. Verify the hash chain and the batch signature.
4. Insert with `ON CONFLICT DO NOTHING` (→ DUPLICATE).
5. Apply session rules (PUNCH_IN opens or attaches; PUNCH_OUT closes).
6. Enqueue `tracker-project{sessionId}`, debounced 3 s.
7. The job reruns `reduceDay` over all accepted events for the user's workDate, then upserts segments, deletes stale segment ids, upserts IdleClaims (for `CLAIMED_WORK`) and recomputes `TrackerDaySummary` (T6).

**Idle claim states**
- PENDING → APPROVED / REJECTED, by the reviewer (`tracker.idleclaim.review` and in scope) or implicitly by L1 timesheet approval (pending claims → APPROVED unless rejected).
- A REJECTED claim is counted as deducted idle.
- An RM at L2 may override a claim decision (audit logged).

### 4. API
| Method / path | Auth / permission |
|---|---|
| POST `/api/v1/tracker/punches` `{clientEventId, type:PUNCH_IN\|PUNCH_OUT\|ATTACH_SESSION, clientTs, monoMs, seq, taskId?, prevHash, hash}` | device token; synchronous validation → `{session, dayState}` (also appended to the event log) |
| POST `/api/v1/tracker/events:batch` `{deviceId, bootId, events[≤500], headHash, signature}` | device token (or sync-only) → `{results[{clientEventId,status,reason?}], ackSeq, serverTime, dayState}` |
| POST `/api/v1/tracker/heartbeat` `{status, sessionId, lastSeq, queueDepth, appVersion, displays}` | device token, every 60 s → `{serverTime, policyVersion, commands[]}` |
| GET `/api/v1/tracker/tasks` | device token (ETag) |
| POST `/api/v1/tracker/sessions/switch-device` | device token (takes over tracking from another device) |
| GET `/api/v1/tracker/today` | device token → DayState |
| GET `/api/v1/activity/timeline?userId&date` | self: `tracker.activity.view.self`; others: `.team` / `.reports` / `.all` |
| GET `/api/v1/idle-claims?status&reviewer=me&userId&weekStart` | `tracker.idleclaim.review` (self can list own) |
| POST `/api/v1/idle-claims/:id/decide` `{decision, comment?}` | `tracker.idleclaim.review` + scope |
| POST `/api/v1/idle-claims/bulk-decide` `{ids[], decision, comment?}` | same |

Socket tracker → server: none (REST only; socket is server → device). Server → device: `session.updated`, `tasks.updated`, `command.syncNow`, `command.stopTracking{reason:'SWITCHED_DEVICE'}`. Server → web (`/app`): `tracker.status{userId,status,taskId,since}` to rooms `lead:{id}` and `manager:{id}` (P2 presence), `idleClaim.created|decided`.

### 5. Business rules and calculations
- **Idle detection:** poll `powerMonitor.getSystemIdleTime()` every 5 s while WORKING. When `idleSec ≥ idleThresholdSec` → `IDLE_START.at = now − idleSec`. `lock-screen` / `suspend` → `IDLE_START.at = min(lastInputAt, eventAt)` immediately (no dialog yet). On `unlock-screen` / `resume`: if the interval is shorter than the threshold, it is voided back to ACTIVE; otherwise → IDLE_PROMPT. No idle detection during ON_BREAK.
- **Activity sampling:** each 5-s poll is one sample; active if `idleSec < 5`. `ACTIVITY_TICK{activeSamples, samples}` every 60 s. Activity% is informational only; it is never used for pay. No keystrokes, window titles or URLs are captured (privacy by design; open question Q6).
- **Totals per day** (the same formula on device and server):
  - `worked_display = ΣACTIVE + ΣIDLE[CLAIMED_WORK ∧ claim∈{PENDING,APPROVED}]`
  - `worked_payable = ΣACTIVE + ΣIDLE[CLAIMED_WORK ∧ APPROVED]`
  - `break = ΣBREAK + ΣIDLE[AS_BREAK]`
  - `idle_deducted = ΣIDLE[DEDUCTED ∪ AUTO_DEDUCTED] + ΣIDLE[CLAIMED_WORK ∧ REJECTED]`
  - `idle_pending = ΣIDLE[PENDING]`, shown as "idle" in the subline until resolved.
  - Invariant: `span(punchIn..punchOut) = worked + break + idle_deducted + idle_pending` (to the second; tested).
- **Per-task:** ACTIVE time goes to `taskId` at the segment start. `TASK_SWITCH` splits segments. Approved claims go to the task active at `IDLE_START`, or to `INT Meetings & stand-up` if the user picked it in the note step.
- **Task defaults:** at punch-in, the last task used today, else the first WIP task, else the tenant's "General / unallocated" internal activity. A task must always be active.
- **Session and day:**
  - `workDate` = punch-in date in the employee's timezone (default Asia/Kolkata).
  - Several sessions per day are allowed. Attendance "In" = the first punch-in and "Out" = the last punch-out.
  - Only one OPEN session per user across channels. Web punch-in → the tracker attaches (`ATTACH_SESSION`). Web punch-out closes the session → the tracker gets `session.updated`.
  - One tracking device at a time: switching sends `command.stopTracking` to the other device, which closes its active segment at the switch time.
- **Auto-close:**
  - At `shiftEnd + autoCloseAfterShiftEndMin` (default 18:30 + 6 h = 00:30), punch-out is set to `lastActiveAt` (the end of the last ACTIVE segment). Pending idle becomes AUTO_DEDUCTED. `closeReason=AUTO_SHIFT_END`. The employee is alerted so they can regularize.
  - Hard cap: `punchIn + maxSessionHours` (16 h).
  - No shift allocated → auto-close uses 23:59 local.
- **Break allowance:** from the shift (General: 60 min). When `break ≥ allowance` → tracker toast "You've used your 60-min break allowance". Excess break is simply not worked. Attendance applies status rules (see contracts).
- **Claim reviewer:** the task's `project.leadId`; for internal tasks, the employee's team lead; failing that, the reporting manager. A claim cannot be self-reviewed (a lead whose own claims need review → routes to their RM).
- **Office-hours rules** (late mark, half-day) are *not* computed here. See the Attendance contract.

### 6. Jobs, notifications, audit
- **Jobs:**
  - `tracker-project` (debounced per session)
  - `session-auto-close` (every 15 min)
  - `idle-auto-resolve` (run with auto-close and at `workDate + 1` 23:59)
  - `idleclaim-digest` (daily 10:00 IST to reviewers: "4 idle claims awaiting review")
  - `raw-event-retention` (monthly: drop TrackerEvent partitions older than 180 days, except PUNCH_*, IDLE_RESOLVED, CLOCK_CHANGE; segments and summaries are kept 7 years)
- **Alerts:**
  - Employee: "Auto punched-out at 18:42 — regularize if wrong"; "Idle claim 11:42–12:10 approved/rejected by Arjun".
  - Reviewer: "Priya marked 28 min idle as working (AT-101)".
- **Email:** auto punch-out notice.
- **Audit events:** `tracker.punch{type, source:DESKTOP, sessionId}` (punches are also written to the Attendance audit), `tracker.session.auto_closed`, `tracker.session.device_switched`, `idle.claim.decided{by, decision}`, `idle.claim.overridden`.

### 7. Integrations
Device-side interfaces (Windows implementation + mock driven by a simulated clock; this is the "prototype controls" debug panel in dev builds):
```ts
interface InputActivityProvider { getIdleSeconds(): number; on(e:'lock'|'unlock'|'suspend'|'resume'|'shutdown', cb): Unsub }
interface ClockProvider { wallNow(): number; monoNow(): number; bootId(): string }
interface TaskSource { list(): Promise<TrackerTask[]> }  // server; mock: fixture AT-101/103/110/INT
```
Windows: `powerMonitor` (`getSystemIdleTime`, `lock-screen`, `unlock-screen`, `suspend`, `resume`, `shutdown`), plus `session-end` via `app.on('session-end')`.

### 8. Validation and edge cases
- Punch-in rejected when:
  - the user is ineligible;
  - there is a biometric punch today (Hybrid);
  - an approved leave covers the full day ("You're on Earned leave today" → allowed with a confirm dialog; Attendance marks it a conflict);
  - the device is revoked;
  - the app version is below the minimum.
- A punch-out with an open break closes the break at the punch-out time.
- A task unassigned mid-session (`tasks.updated` no longer contains it): the current segment continues, the row shows "(unassigned)", and switching away removes it.
- A task from a closed period: the server keeps `taskId`; the timesheet flags it.
- Idle during a claim note entry: the note step times out after 2 min, and the resolution defaults to "Mark as idle".
- Long idle across auto-close → AUTO_DEDUCTED.
- The same event arriving twice → DUPLICATE, no double counting (the projection is recomputed from the set, not incrementally).
- Sequence gap (e.g. a missing seq 120–125) → accepted, integrity flag `SEQ_GAP` (T8), projection proceeds.
- Events with `correctedTs` outside `[punchInAt − 60 s, serverNow + 300 s]` → REJECTED `TS_OUT_OF_RANGE`.
- Events for a payroll-locked date → REJECTED `PERIOD_LOCKED` → an automatic Attendance regularization request is created with the evidence.

### 9. Phase
**P1** (P2: live presence and activity% analytics). Depends on Attendance (punch recording, sessions, shift, locking), Projects (tasks, project lead), Timesheets (L1 review UI hosts the claims), Org (team lead, RM chain), Notifications.

### 10. Acceptance scenarios
1. Punch in 09:28 on AT-101 → switch to AT-103 at 11:00 → break 13:00–13:55 → punch out 18:42. The summary shows AT-101 1h32m, AT-103 6h47m, break 55m, worked 8h19m, and span = worked + break + idle to the second. Attendance row: `Mon 28 Sep · 09:28 · 18:42 · Desktop · 55m · 0m`.
2. No input from 11:42; the dialog appears at 11:47; the mouse moves at 11:50; the user clicks "Mark as idle & resume" at 11:51. The idle segment is 11:42–11:50 (8 min, DEDUCTED), 11:50–11:51 is ACTIVE, and the timesheet "Auto-idle deducted" for that day increases by 0:08.
3. "I was working" for 28 min → the timer includes it immediately → Arjun rejects it in L1 → payable worked −28 min, idle_deducted +28 min, and Priya gets an Alert.
4. Screen locked 13:05–13:52 → on unlock the dialog says "Your PC was locked from 13:05 to 13:52" → "Count it as a break" → break +47 min, no screenshots taken 13:05–13:52.
5. The tracker is punched in and the laptop is left on overnight with no input → auto-close at 00:30 sets Out = the last active time (18:10); pending idle is AUTO_DEDUCTED; the employee gets the Alert and email.
6. Web punch-in at 09:30, then tracker opened → "Continue tracking here" → no second Attendance punch. Web punch-out at 18:30 → the tracker flips to "Not punched in" with the toast "Punched out from web".

---

## Module T4: Screenshots

### 1. Screens and UX
- **Tracker: Screenshot toast.** A frameless, non-focusable, always-on-top window at the bottom-right, 3 s. It shows a thumbnail and the text "Screenshot captured · {HH:mm} · mapped to {taskKey} · Visible to your Project Lead". When blurred: "(blurred)". It is suppressed while the tray widget is open (matches the wireframe `shotOn && !tray`); the capture is then shown in the widget as "Last shot 10:10".
- **Web: Timesheet approvals L1 detail.** Header "Screenshots mapped to tasks · every {N} min". A 4-column grid, each cell showing a thumbnail and `{HH:mm} · {taskKey}`. Filters: day chips Mon–Sun, a task select, and "Only during idle/flagged".
  - Clicking a cell opens a lightbox with the full image (presigned), prev/next, capture metadata (displays, blurred, device) and a `!Captured before idle detected` tag when `inIdle`.
  - The count KPI "Screenshots" equals the number of screenshots in the week.
- **Web: My timesheet / Attendance (self).** A "My screenshots" drawer per day (employee sees own; read-only).
- **Admin:** "Legal hold" toggle in the lightbox (`tracker.screenshot.legalhold`).

### 2. Data model
```prisma
enum ScreenshotStatus { PENDING_UPLOAD UPLOADED PROCESSED FAILED LOST PURGED }
model Screenshot {
  id String @id @default(uuid())
  tenantId String; userId String; deviceId String; sessionId String
  clientEventId String
  capturedAt DateTime           // corrected
  workDate DateTime @db.Date
  taskId String?; projectId String?
  inIdle Boolean @default(false) // set by projection if inside an IDLE segment
  storageKey String             // t/{tenantId}/shots/{yyyy}/{mm}/{userId}/{id}.webp
  thumbKey String?
  sha256 String; bytes Int; width Int; height Int; displays Int
  blurred Boolean; mime String @default("image/webp")
  status ScreenshotStatus @default(PENDING_UPLOAD)
  uploadedAt DateTime?; processedAt DateTime?
  purgeAfter DateTime           // capturedAt + retentionDays (policy at capture)
  legalHold Boolean @default(false)
  @@unique([tenantId, deviceId, clientEventId])
  @@index([tenantId, userId, workDate])
  @@index([tenantId, taskId, workDate])
  @@index([status, purgeAfter])
}
model ScreenshotView { id String @id @default(uuid()); tenantId String; screenshotId String; viewerId String; viewedAt DateTime @default(now()); @@index([tenantId, screenshotId]) }
```

### 3. Workflow
1. Capture happens on the device when `activeSecSinceLastShot ≥ intervalSec`. The counter only advances in WORKING without an idle prompt, and persists across restarts.
2. `desktopCapturer.getSources({types:['screen'], thumbnailSize: per-display native size scaled to max 1920 px})` for all displays (or the primary only, per policy).
3. Frames are composited horizontally (max 3840×1080 downscale) with `sharp` in the main process. If blur is on, blur is applied on the device (sigma 8 at 1280 px equivalent). Encode WebP q=60 and compute sha256.
4. Write the encrypted blob (AES-256-GCM) to `%APPDATA%/Lexisora Tracker/shots/`. Emit the `SCREENSHOT{clientEventId, meta}` event. Show the toast.
5. Upload (online): `presign` → PUT to S3 (checksum header) → `complete`.
6. Server: HEAD check of size and checksum → UPLOADED → `screenshot-process` job: decode, strip metadata, 320 px WebP thumbnail, server-side blur if `policy.blur` and `!blurred` (defense in depth) → PROCESSED.
7. Failed PUT: retried with backoff; 3 server-side failures → FAILED. After the local TTL → LOST (metadata only).

### 4. API
| Method / path | Auth / permission |
|---|---|
| POST `/api/v1/tracker/screenshots/presign` `{clientEventId, capturedAt, sha256, bytes, width, height, displays, blurred, taskId, sessionId}` | device token → `{screenshotId, putUrl (5 min), headers}`; idempotent on `clientEventId` (returns the existing row, or `alreadyUploaded:true`) |
| POST `/api/v1/tracker/screenshots/:id/complete` | device token |
| POST `/api/v1/tracker/screenshots/:id/lost` | device token |
| GET `/api/v1/screenshots?userId&from&to&taskId&inIdle` | `tracker.screenshot.view.self\|team\|reports\|all` → metadata + thumbnail URLs (presigned, 60 s) |
| GET `/api/v1/screenshots/:id/image` | same scope → 302 presigned GET (60 s); writes a ScreenshotView row and an audit event |
| PUT `/api/v1/screenshots/:id/legal-hold` `{on}` | `tracker.screenshot.legalhold` |

**Scopes**
- self = own.
- team = the task's project is led by the viewer, or the user is in a team led by the viewer.
- reports = the viewer is in the user's RM chain.
- all = tenant-wide.
- The platform super-admin has **no** grant. Screenshots are classed as personal data, and P3 adds per-tenant key encryption.

### 5. Rules
- Interval counts active time only. The first shot comes `interval` after punch-in.
- No capture in: ON_BREAK, IDLE_PROMPT, lock screen, READY.
- `inIdle` is set retroactively for shots taken between `lastInputAt` and the idle detection.
- Retention: `purgeAfter = capturedAt + policy.screenshotRetentionDays`. A shorter retention set later applies to existing rows at the next purge (the minimum of the old and new values). A longer retention applies to new captures only.
- Expected volume: about 250 KB per shot, 6 shots/h, about 12 MB per user per workday. At 128 users × 22 days × 3 months that is about 100 GB. MinIO lifecycle is set as a backstop.

### 6. Jobs, notifications, audit
- **Jobs:** `screenshot-process` (concurrency 4), `screenshot-retention` (daily 02:00 IST; batch delete; `PURGED`), `screenshot-orphan-sweep` (daily; objects without a row, or rows stuck in `PENDING_UPLOAD` for more than 8 days → LOST).
- **Audit events:** `screenshot.viewed{viewerId}` (sampled into ScreenshotView, not the main audit log, to limit volume; the main audit gets a per-day aggregate), `screenshot.legal_hold.set`, `screenshot.purged{count}`.
- **Integrity:** `SCREENSHOT_MISSING` when the expected count (`floor(activeSec/interval)`) minus actual is ≥ 3 per day (T8).

### 7. Integrations
```ts
interface ObjectStorage { presignPut(key, {contentType, bytes, sha256, ttlSec}): Promise<{url, headers}>;
  presignGet(key, ttlSec): Promise<string>; head(key): Promise<{bytes, sha256?}|null>; delete(keys: string[]): Promise<void>; put(key, buf, ct) }
// impl: MinIO/S3 (aws-sdk v3); mock: local FS
interface ImageProcessor { thumbnail(buf, width): Promise<Buffer>; blur(buf, sigma): Promise<Buffer>; strip(buf) }  // sharp
interface ScreenCaptureProvider { captureAll(opts:{allMonitors:boolean}): Promise<{frames: Buffer[], displays:number}> } // desktopCapturer; mock: generated image
```

### 8. Edge cases
- DRM/protected windows appear black; this is accepted.
- The display count changes → `DISPLAY_CHANGE` info event.
- Capture failure (GPU) → retry once after 10 s, else log `capture_failed` (no penalty).
- Disk cap for unsynced blobs is 1 GB. Oldest first → LOST.
- The screenshot arrives after the session was re-projected → `taskId` comes from the device (the device knows the active task).
- A viewer loses scope later → access denied (the check runs per request).

### 9. Phase
**P1** (P3: per-tenant envelope encryption of objects via SSE-C/KMS key per tenant). Depends on Platform storage, Timesheet approvals UI, Org scopes.

### 10. Acceptance scenarios
1. Work 60 active minutes with a 10-min interval → 6 screenshots, each mapped to the task active at capture time; toast shown each time.
2. An idle prompt from 11:42 → no capture until the choice. The shot taken at 11:45 (before detection) is tagged `inIdle`.
3. Blur policy on → the stored image is blurred, and the device-side SHA of the blurred image matches the S3 object.
4. Retention 90 days → the day-91 purge deletes the object, the row stays PURGED, and the lightbox shows "Removed per retention policy". A legal-hold shot survives.
5. Arjun (lead of Atlas) views Priya's AT-101 shots → allowed and ScreenshotView recorded. Arjun requests a shot on another project's task → 403.

---

## Module T5: Offline store, sync, idempotency, clock skew

### 1. Screens and UX
- **Offline banner** (dark, under the title bar): "Offline · tracking locally" · "{N} entries queued". N = unsynced punches and state events (excluding ticks) plus pending screenshots.
- Back online: toast "Back online · {N} entries synced". Events are logged in the local diagnostic log.
- Offline too long (> `offlineMaxDays` since the last successful sync): Punch in is disabled with "Connect to the internet to sync {N} days of tracking before punching in". An ongoing session continues.
- "Add to weekly timesheet" while offline → "Summary queued (offline)".
- Settings "Offline storage · Encrypted, syncs on reconnect · Up to 7 days".

### 2. Local data model (SQLCipher via `better-sqlite3-multiple-ciphers`; key = 256-bit random, wrapped by `safeStorage`)
| Table | Columns |
|---|---|
| `kv` | key, value (deviceId, workspace, tokens, privateKey, lastSyncAt, clockOffsetMs, lastHash, seq, activeSinceLastShot, settings) |
| `outbox` | seq PK, clientEventId UNIQUE, type, payload JSON, clientTs, monoMs, bootId, prevHash, hash, createdAt, sentAt, ackStatus (null/ACCEPTED/DUPLICATE/REJECTED), rejectReason |
| `shots` | clientEventId PK, path, sha256, meta JSON, uploadState (PENDING/PRESIGNED/UPLOADED/DONE/LOST), attempts, createdAt |
| `policy_cache`, `tasks_cache`, `day_cache` | reducer snapshot, used for fast start |

Acknowledged rows are pruned after 48 h. Unacknowledged rows are kept until synced (screenshots are dropped only at the disk cap or after 7 days, sending `lost`).

### 3. Workflow
- **Connectivity:** online = the last request succeeded. Offline after 2 consecutive network errors or 5xx responses, or `net.isOnline()==false`. Retries use exponential backoff 2 s → 5 min with ±20% jitter. Socket reconnect or a successful heartbeat → flush.
- **Flush order:** events in `seq` order, batches of 500 or 1 MB, one batch in flight. Then screenshots, oldest first, 2 concurrent, at most 2 Mbps when on battery.
- **Ack handling:** ACCEPTED / DUPLICATE → mark acknowledged. REJECTED → keep the reason and show it in the summary ("3 entries rejected: period locked — raised regularization"). The engine does not roll back the UI; it re-bootstraps `today` from the server after the flush.
- **Offline punch-in:** allowed if the cached policy and eligibility are ≤ `offlineMaxDays` old and the device was ACTIVE at the last contact. On sync the server validates. A conflict (a biometric punch the same day, or revoked before the event) → session `REJECTED_CONFLICT`, segments kept but excluded from totals, and an Attendance regularization is auto-raised with the evidence.

### 4. API
Uses T3 `events:batch`, T4 presign/complete, and `heartbeat`. Headers: `Idempotency-Key: {deviceId}:{firstSeq}-{lastSeq}` on batches (24 h Redis cache of the response). Every response carries `serverTime` (ms) for offset sampling.

### 5. Rules and calculations
- **Idempotency:** `clientEventId` is a UUIDv7 generated before the local write. The server enforces `UNIQUE(tenantId, deviceId, clientEventId)`. Projections are recomputed from the full accepted set, so replays and reordering are harmless.
- **Clock offset (NTP-style):** `offset = serverTime − (t_send + t_recv)/2`. Keep the median of the last 5 samples. Every event stores `clientTs`, `offsetMs` (the last known value), `monoMs` and `bootId`. The server computes `correctedTs = clientTs + offsetMs`.
  - `|offset| > 120 s` → `CLOCK_SKEW` flag (info).
  - `|offset| > 15 min` → the tracker shows the banner "Your PC clock is wrong; times are being corrected".
- **Clock change detection** (every 5-s tick): `drift = (Δwall) − (Δmono)`. If `|drift| > 30 s` and there was no SUSPEND/RESUME between ticks → emit `CLOCK_CHANGE{drift}`. From then until the next server sync, event timestamps are derived as `anchorWall + (mono − anchorMono)`, where the anchor is the last server-verified point.
- **Across reboot** (new `bootId`): the first event is compared with the last persisted `clientTs`. Going backwards → `CLOCK_CHANGE`.
- **Server acceptance window:** `correctedTs ≤ serverReceivedAt + 300 s`. For offline batches, events must also be monotonic within `(bootId, seq)`. Violations → the event's `correctedTs` is clamped to the neighbouring bound and flagged `CLOCK_ADJUSTED`; it is not dropped, so a punch is never lost.

### 6. Jobs, notifications, audit
- Device-side jobs: sync loop, blob GC.
- Server: `offline-over-limit` alert to the employee and HR when a device's `lastSyncAt` is more than `offlineMaxDays` ago with an open session.
- Audit `tracker.sync.rejected{count, reasons}`.

### 7. Integrations
`LocalStore` interface (`append(event)`, `pending(limit)`, `ack(results)`, `putShot`, `getShot`) with SQLCipher and in-memory mock implementations. `Transport` (fetch with retries) with a mock that can simulate offline, used for "Go offline / Reconnect" in dev.

### 8. Edge cases
- Crash mid-write: the SQLite WAL makes the write atomic, and the hash chain continues from the last committed row.
- Token expired while offline: refresh on reconnect. Refresh token expired (30 days offline) → re-login required, but the queue is kept and flushed after re-login when it is the same user and device.
- A different user logs in on the same machine → the queue flushes with the old device token first; if that is impossible, the queue is exported encrypted and HR is alerted (rare).
- Uninstall with an unsynced queue: the uninstaller warns "N unsynced entries will be lost". App data is kept by default.

### 9. Phase
**P1.** Depends on T3, T4.

### 10. Acceptance scenarios
1. Go offline at 10:00, work until 12:00 (with a 30-min idle claim and 12 shots), reconnect → banner count drops to 0, and the server totals equal the device totals exactly.
2. Replay the same batch 3× (network flake) → no duplicate segments or shots, and all results after the first are DUPLICATE.
3. The user sets the PC clock back 2 h mid-session → `CLOCK_CHANGE` flagged, and segment times on the server stay continuous (anchored to monotonic time).
4. 8 days offline → Punch in disabled with the message. After reconnect and sync, it is enabled.
5. Offline punch-in on a day with a biometric punch → on sync, session `REJECTED_CONFLICT` and a regularization request is created.

---

## Module T6: Daily summary, attendance and timesheet feed

### 1. Screens and UX

**Tracker: Daily summary tab**
- Title: "Today so far" while punched in, or "Day complete" after the last punch-out with worked > 0.
- Three KPIs: Worked / Break / Idle (Cormorant 22px, accent top rule).
- **Timeline bar** (18px) from first punch-in to now or last punch-out. Colors: Active `accent-300`, Break `neutral-400`, Idle `neutral-200`; gaps between sessions are shown blank. Hover shows `09:28–11:00 Active · AT-101`.
- **By task** list (taskKey, title, time).
- "Screenshots captured {n}".
- **Add to weekly timesheet** (primary). Success: "Summary synced to timesheet"; offline: "Summary queued (offline)". If the week is submitted: disabled with the tooltip "Week already submitted — changes go to your Project Lead as an update".

**Web: My timesheet.** The tracker fills task rows automatically: `task`, `project · module`, Mon–Sun `H:MM`, Total. The "Auto-idle deducted" row per day comes from `idle_deducted`. Pending idle claims show as italic "+0:28 pending" in the cell. Each tracker-sourced cell shows a ⓘ with its breakdown (active / claimed).

**Web: Attendance.** The rows and Today's timeline come from summaries and segments. KPIs "Active hours" = Σ worked_payable this month; "Idle (auto)" = Σ idle_deducted this month. Profile → Attendance tab "Idle" column: same source.

**Web: Timesheet approvals** KPIs Worked / Auto-idle / Screenshots come from the week's summaries.

### 2. Data model
```prisma
model TrackerDaySummary {
  id String @id @default(uuid())
  tenantId String; userId String; workDate DateTime @db.Date
  firstInAt DateTime?; lastOutAt DateTime?; sessions Int
  activeSec Int; claimPendingSec Int; claimApprovedSec Int; claimRejectedSec Int
  workedDisplaySec Int; workedPayableSec Int
  breakSec Int; idleDeductedSec Int; idlePendingSec Int
  screenshotCount Int; activityPct Int?
  perTask Json      // [{taskId, projectId, sec, claimedSec}]
  timeline Json     // [{kind, startAt, endAt, taskId?}] compacted
  integrityFlagCount Int @default(0)
  confirmedAt DateTime?        // "Add to weekly timesheet"
  lastProjectedAt DateTime
  @@unique([tenantId, userId, workDate])
  @@index([tenantId, workDate])
}
```
The Timesheet domain's `TimesheetEntry` must have `source (TRACKER|MANUAL|OUTSIDE_HOURS)`, `trackerSec`, `adjustedSec?`, `adjustReason?`, `pendingClaimSec` (a contract field).

### 3. Workflows
- Projection (T3) → upsert the summary → emit the internal domain event `tracker.day.updated{userId, workDate, totals, perTask}` (outbox table, delivered in-process via an EventEmitter plus a BullMQ fan-out).
- **Attendance consumer** updates the AttendanceDay tracker columns: `in, out, source='DESKTOP', breakMin, idleMin, workedMin`.
- **Timesheet consumer:**
  - Week DRAFT: upsert `(user, week, date, task)` entries, set `trackerSec`, and keep manual `adjustedSec`.
  - Week SUBMITTED or PENDING_PL: apply the change, mark the week `changedAfterSubmit`, and alert the PL.
  - Week APPROVED or locked: create a `TimesheetDelta` / regularization for the RM instead of editing.
- **"Add to weekly timesheet"** = `SUMMARY_CONFIRMED` event → sets `confirmedAt` and forces an immediate sync of that day. It is idempotent: repeated clicks change nothing. Nightly 00:30 IST the job also syncs all days (confirmation is optional; the timesheet shows "Not confirmed" days in a muted tone).

### 4. API
| Method / path | Auth / permission |
|---|---|
| GET `/api/v1/tracker/days/:date/summary` | device token |
| POST `/api/v1/tracker/days/:date/confirm` `{clientEventId}` | device token (also accepted as an event in a batch) |
| GET `/api/v1/activity/days?userId&from&to` | `tracker.activity.view.*` scoped |
| GET `/api/v1/activity/month?userId&month` → `{activeHours, idleDeductedMin, presentDaysFromTracker}` | same |
| Internal (in-process service) `TrackerReadService.getPayrollIdle(userId, month) → {idleDeductedMin, fromApprovedTimesheetsOnly:true}` | none |

### 5. Rules and calculations
- **Timesheet minutes per (day, task)** = `round(sec/60)` with **largest-remainder** rounding so that Σ tasks equals `round(workedPayable/60)` for the day. Pending claims are displayed but excluded until approved.
- **Idle deduction handed to payroll** (Payroll owns the money formula): `idleDeductedMin(month) = Σ idleDeductedSec/60` over days in RM-approved timesheets, only if `deductIdleFromPayroll` was true in the policy version at event time.
  - Suggested payroll formula (for the Payroll domain): `amount = round(idleMin × monthlyGross / (workingDays × netShiftMin))`, with `netShiftMin = shiftMin − breakAllowanceMin` (General: 540 − 60 = 480).
  - Example: gross ₹84,000, 23 working days, 147 idle min → `84000/(23×480) = ₹7.61/min` → ₹1,118.
- **Summary title rule:** "Day complete" iff no OPEN session and `workedDisplaySec > 0`.

### 6. Jobs, notifications, audit
- **Jobs:** `timesheet-sync-nightly` (00:30 IST), `summary-reconcile` (weekly, Sunday 03:00: recompute the last 14 days from events and compare checksums).
- **Alerts:**
  - Employee Friday 17:00 "Timesheet for {week} awaiting your submission" (the existing Alerts row; Timesheet domain).
  - PL: "Priya's submitted week changed after late sync (+1h10m)".
- **Audit event:** `tracker.summary.confirmed`.

### 7. Integrations
None external.

### 8. Edge cases
- A task deleted in Projects → the entry keeps its snapshot title.
- A session crossing midnight → stays on the punch-in date.
- A week spanning a month boundary: payroll uses per-day values.
- An attendance day with both a web punch and tracker data → Source "Desktop" if the tracker contributed any ACTIVE segment, else "Web".

### 9. Phase
**P1.** Depends on Timesheets (entry model, submit/approval, deltas), Attendance (AttendanceDay columns), Payroll (consumes idle).

### 10. Acceptance scenarios
1. After punch-out, "Add to weekly timesheet" → the My timesheet Monday cells equal the per-task times from the summary (after rounding) and the "Auto-idle deducted" Monday cell equals the summary idle.
2. A submitted week plus a late offline sync of +40 min → the week is flagged changed and the PL gets an Alert. The L1 KPI updates.
3. September payroll run → Priya's idle deduction minutes = Σ idle_deducted of the approved weeks. With `deductIdleFromPayroll=false` → 0.
4. The weekly reconcile finds a mismatch (injected) → it is re-projected and logged.
5. Four tasks at 20 min 20 s each (total 81 min 20 s) → task minutes sum to 81 (20 + 20 + 20 + 21), not 80.

---

## Module T7: Desktop shell (window, tray widget, settings, notifications, update, installer, signing, crash reporting)

### 1. Screens and UX
- **Main window:** 400×620, frameless, custom 34 px title bar "Lexisora Tracker" with – ▢ ✕. ✕ hides to the tray; the first time, the toast "Still tracking in the tray" is shown. Tabs: Tracker | Daily summary | Settings. Styling: port of the Classical tokens (shared CSS package with the web).
- **Tray icon:** 16/32 px icon with a status dot overlay generated per state:

  | State | Dot color |
  |---|---|
  | Working | `accent-400` |
  | Idle | `neutral-400` |
  | Break | `neutral-100` |
  | Out | `neutral-500` |

  Windows tray icons cannot show text, so the wireframe's "{trayText}" ("Tracker" or "4h 00m") becomes the **tooltip**: `Working · 4h 00m · AT-101 Invoice PDF export`.
  - Left-click toggles the widget. Right-click menu: Open, Start/End break, Punch in/out, Settings, Check for updates, Quit.
- **Tray widget:** 260 px frameless always-on-top window anchored above the tray (`tray.getBounds()` / `screen.getDisplayNearestPoint().workArea`). Contents: status tag, ✕, timer (36px), `{taskKey} · {title}`, **Start/End break**, **Open**. When "Show tray widget" is on, it auto-opens on punch-in and stays pinned (draggable; position remembered). When off, it only opens on tray click.
- **Settings** user toggles (tag `tag-accent` On / `tag-neutral` Off; click toggles):
  - "Launch at Windows start-up · Recommended" (`app.setLoginItemSettings({openAtLogin, args:['--hidden']})`)
  - "Show tray widget · Mini timer near the clock"
  - "Break reminders · Nudge after {policy.breakReminderMin/60} hours of work"
- **Settings** info row: "Device · {hostname} · paired {d MMM} · v{x.y.z}". Clicking it copies diagnostics.
- **Sign out & unpair** (secondary):
  - If punched in → confirm "Punch out and unpair?".
  - If the queue is not empty and online → flush first, with a progress indicator.
  - If offline with a queue → blocked: "{N} entries not synced — connect first", with a "Unpair anyway (discard)" escape that requires typing UNPAIR.
- **Break reminder:** Windows toast "You've worked 2 hours without a break" with the action button "Start break". Once per continuous block. The block resets on any break of at least 5 min or an idle resolution.
- **Update UI:** a badge on Settings, "Update v1.4.3 ready · Restart" (only while not punched in; while punched in it is deferred to punch-out with the prompt "Restart to update now?"). Mandatory (below `minAppVersion`): Punch in is disabled with "Update required", plus a progress bar.
- **Single-instance lock:** a second launch focuses the existing window.
- Dev builds only: a "Prototype controls" debug panel (simulate idle, screenshot, offline, 60× clock).

### 2. Data model (server)
```prisma
model TrackerRelease {   // platform-level (no tenantId; managed by Lexisora operator)
  id String @id @default(uuid())
  version String; channel String  // stable|beta
  platform String @default("win32-x64")
  fileKey String; sha512 String; size Int; blockmapKey String?
  releaseNotes String; rolloutPct Int @default(100)
  mandatory Boolean @default(false)  // sets minAppVersion when published
  publishedAt DateTime?; createdById String
  @@unique([platform, channel, version])
}
model TrackerCrashReport { id String @id @default(uuid()); tenantId String?; deviceId String?; appVersion String; processType String; storageKey String; signature String?; createdAt DateTime @default(now()); @@index([appVersion, createdAt]) }
model TrackerClientError { id String @id @default(uuid()); tenantId String; deviceId String; appVersion String; message String; stack String?; count Int; firstAt DateTime; lastAt DateTime; @@unique([tenantId, deviceId, appVersion, message]) }
```

### 3. Workflows
- **Auto-update** (`electron-updater`, generic provider):
  - Check on start and every 4 h.
  - Feed: `GET /api/v1/tracker/updates/win32-x64/{channel}/latest.yml`. The server selects the version by channel, tenant pin (`TenantTrackerSettings.pinnedVersion`) and a staged rollout bucket (`hash(deviceId) % 100 < rolloutPct`).
  - Differential download via blockmap. Verify sha512 and Authenticode publisher (`verifyUpdateCodeSignature`). Install on quit or at punch-out.
- **Installer:** electron-builder **NSIS**, oneClick, per-user (`%LOCALAPPDATA%\Programs\Lexisora Tracker`), no admin needed. Creates a Start-menu shortcut and registers autostart per the user toggle (default on). Uninstaller warns about the unsynced queue. P2: per-machine NSIS/MSI for IT deployment with a silent install flag and a pre-configured workspace.
- **Code signing:** Authenticode (OV/EV cert or Azure Trusted Signing), RFC3161 timestamp. Signed: app exe, helper exes, installer, uninstaller. CI (GitLab) signs on tag. Dev builds are unsigned, and signature verification is off in dev.
- **Electron hardening:**
  - `contextIsolation`, `sandbox`, `nodeIntegration:false`, strict CSP, no remote URLs in the renderer.
  - A typed IPC allowlist validated with zod. Tokens and keys never reach the renderer.
  - Fuses: `RunAsNode=off`, `EnableNodeOptionsEnvironmentVariable=off`, `EnableNodeCliInspectArguments=off`, `EnableEmbeddedAsarIntegrityValidation=on`, `OnlyLoadAppFromAsar=on`.
  - TLS to the tenant domain only.
- **Crash reporting:** `crashReporter.start({submitURL: https://{workspace}/api/v1/tracker/crash, uploadToServer:true, compress:true, globalExtra:{appVersion, deviceHash}})`. Main-process and renderer JS errors go to `POST /tracker/client-errors` (deduplicated, max 20/h). `electron-log` rolling files (5 MB × 3). P2: "Send diagnostics" button.

### 4. API
| Method / path | Auth / permission |
|---|---|
| GET `/api/v1/tracker/updates/:platform/:channel/latest.yml` and `/files/:name` | device token, or anonymous for first install from `https://{workspace}/download/tracker` |
| GET `/download/tracker` (landing page: "Download for Windows") | authenticated web user with `tracker.use` |
| POST `/api/v1/tracker/crash` (multipart minidump) | device token or anonymous with rate limit |
| POST `/api/v1/tracker/client-errors` | device token |
| PATCH `/api/v1/tracker/devices/current/settings` `{launchAtStartup, showTrayWidget, breakReminders}` | device token |
| POST/GET `/api/platform/tracker/releases`, PATCH `/:id` (rolloutPct, publish) | `platform.tracker.release.manage` (super-admin; no tenant data access) |
| PUT `/api/v1/tracker/tenant-settings` `{updateChannel, pinnedVersion}` (P3) | `tracker.policy.manage` |

Socket: `update.available{version, mandatory}`.

### 5. Rules
- Never restart or install while punched in, unless the user explicitly consents.
- A mandatory update blocks new punch-ins only. The server accepts events from old versions for 72 h after a mandatory publish (`UPGRADE_GRACE`).
- Launch at startup starts hidden in the tray, restores the state and resumes an open session (with the gap prompt, T3).
- Quit while punched in: confirm "Punch out before quitting?" with options [Punch out & quit] / [Quit (tracking stops)] / [Cancel]. "Quit" emits `APP_QUIT` (no integrity penalty, but the gap is prompted on the next start).

### 6. Jobs, notifications, audit
- **Jobs:** `crash-retention` (90 days), `release-rollout-monitor` (crash rate per version over 2% in 24 h → auto-pause the rollout and alert the platform operator).
- **Audit events:** `tracker.release.published|paused`, `tracker.device.settings.changed`.

### 7. Integrations
```ts
interface CrashSink { store(minidump: Buffer, meta): Promise<{id}> }      // S3 impl (default); SentryAdapter (self-hosted, optional)
interface UpdateFeed { latest(platform, channel, ctx:{tenantId, deviceId}): Promise<ReleaseYml|null> }  // S3 generic
interface CodeSigner { sign(path): Promise<void> }                         // CI only; AzureTrustedSigning | signtool+PFX | NoopSigner(dev)
interface Notifier { toast(title, body, actions?): void }                  // Electron Notification (AppUserModelId set); mock
```

### 8. Edge cases
- Windows Focus Assist suppresses toasts → the idle prompt still appears in the window with `flashFrame`, and the tray dot changes.
- High-DPI and multiple taskbars → anchor the widget to the display containing the tray.
- Auto-hidden taskbar → use `workArea`.
- The auto-update download fails → retry, and fall back to the full installer.
- The user deletes the autostart registry key → the Settings toggle reflects the real OS state via `getLoginItemSettings()` on open.

### 9. Phase
**P1** for installer, signing, auto-update (stable channel), crash reporting, tray, widget, settings. P2: MSI, staged rollout UI, diagnostics upload. P3: tenant channel pinning, white-label (tenant logo and accent in the tracker from `/.well-known/hrms-tenant`), macOS build.

### 10. Acceptance scenarios
1. A fresh install from `/download/tracker` without admin rights → runs at the next logon hidden in the tray, and the Settings "Launch at start-up" toggle shows On.
2. Publish v1.4.3 while Priya is punched in → the download completes, no restart happens, and at punch-out the prompt appears; after restart the version is v1.4.3 and the session history is intact.
3. A tampered update file (sha512 mismatch or wrong signer) → the install is refused and a client-error is logged.
4. A renderer crash → a minidump arrives at `/tracker/crash`, and the window reloads with the timer state preserved (state lives in main).
5. Tray states: Working → accent dot and tooltip "Working · 4h 00m · AT-101…"; Break → white dot; widget Start/End break updates the main window in under 200 ms.
6. Two hours of continuous work with reminders on → one toast; "Start break" in the toast starts a break.

---

## Module T8: Integrity and tamper resistance

### 1. Screens and UX
- **Web: Timesheet approvals L1/L2 detail.** An "Integrity" strip of badges: `!Clock changed ×1`, `!Tracker closed while punched in 45m`, `-Offline 2h (synced)`, `!Screenshots missing 4`. Clicking a badge shows the detail list (time, type, details) with an **Acknowledge** button (`tracker.integrity.view`) and a comment.
- **Web: Employee profile → Attendance (HR/RM view).** Monthly integrity count.
- The tracker itself shows only neutral notices (e.g. "Your PC clock is wrong; times are being corrected"). It never shows accusatory copy.

### 2. Data model
```prisma
enum IntegrityType { CLOCK_CHANGED CLOCK_SKEW APP_KILLED APP_QUIT_WHILE_PUNCHED_IN SHUTDOWN_WHILE_PUNCHED_IN
  HASH_CHAIN_BROKEN SIGNATURE_INVALID SEQ_GAP TOKEN_REUSE OFFLINE_OVER_LIMIT SCREENSHOT_MISSING
  DISPLAY_CHANGE CONCURRENT_DEVICE INPUT_PATTERN_SUSPECT /*P2*/ OUTDATED_CLIENT }
enum IntegritySeverity { INFO WARN HIGH }
model TrackerIntegrityEvent {
  id String @id @default(uuid())
  tenantId String; userId String; deviceId String; sessionId String?; workDate DateTime @db.Date
  type IntegrityType; severity IntegritySeverity
  occurredAt DateTime; details Json
  acknowledgedById String?; acknowledgedAt DateTime?; comment String?
  @@index([tenantId, userId, workDate])
  @@index([tenantId, severity, acknowledgedAt])
}
```

### 3. Detection rules
| Signal | Detection | Severity | Effect |
|---|---|---|---|
| Clock changed | `\|Δwall−Δmono\| > 30 s` without suspend/resume; wall clock backwards across reboot | WARN (HIGH if more than 3/day or more than 1 h) | times anchored to monotonic/server time (T5) |
| Clock skew | `\|offset\| > 120 s` | INFO | corrected |
| App killed while punched in | on start: open session, last tick more than 90 s ago, no `APP_QUIT`/`SHUTDOWN`/`SUSPEND` | WARN | gap → IDLE(APP_NOT_RUNNING) prompt; unresolved → deducted |
| Quit / shutdown while punched in | `APP_QUIT` / `SHUTDOWN` / `session-end` events | INFO | gap prompt on next start; if no restart that day → auto-close at the event time |
| Lock / sleep | powerMonitor `lock-screen`, `suspend`, `resume`, `unlock-screen` | none (normal) | idle rules (T3) |
| Multiple monitors | display count at each capture; `display-added/removed` | INFO | all monitors captured per policy |
| Hash chain / signature | `hash ≠ sha256(prevHash‖canonical(event))`, or batch Ed25519 signature invalid | HIGH | batch still accepted if the device token is valid (avoid data loss); flagged for HR |
| Sequence gap | `seq` not contiguous after the flush completes | WARN | none |
| Concurrent device | two devices sending ACTIVE segments overlapping by more than 60 s | WARN | the later device's overlap is excluded from totals |
| Screenshot missing | `expected − actual ≥ 3`/day, expected = `floor(activeSec/interval)` | WARN | none |
| Outdated client | events from a version below `minAppVersion` after the grace period | WARN | rejected `UPGRADE_REQUIRED` |
| Input pattern (P2) | input at perfectly regular intervals (e.g. variance < 50 ms over 30 min, the jiggler signature) from 1-s samples of `getSystemIdleTime` | WARN | flag only |

Additional hardening: Electron fuses and asar integrity (T7); SQLCipher-encrypted local DB (editing it breaks the chain); a device-bound private key under DPAPI; every token refresh signed.

### 4. API
| Method / path | Auth / permission |
|---|---|
| GET `/api/v1/tracker/integrity-events?userId&from&to&severity&unacknowledged` | `tracker.integrity.view` + scope |
| POST `/api/v1/tracker/integrity-events/:id/acknowledge` `{comment}` | `tracker.integrity.view` |

Web socket: `integrity.flagged` (HIGH only) to the RM and HR rooms.

### 5. Rules
Integrity flags **never** change pay on their own. Only idle resolutions and claim decisions do. Flags inform the L1/L2 reviewers. Flags with HIGH severity block L2 approval until acknowledged, as a confirmation step: "1 unacknowledged integrity flag".

### 6. Jobs, notifications, audit
- **Jobs:** `integrity-daily` (00:45 IST: screenshot-missing and concurrent-device checks over the previous day).
- **Alerts:** HIGH → the employee's RM and HR ("Integrity flag: clock changed by −2h on 28 Sep · Priya Sharma").
- **Audit events:** `tracker.integrity.flagged`, `tracker.integrity.acknowledged`.

### 7. Integrations
None beyond T3/T5 providers (`ClockProvider` is essential for deterministic tests).

### 8. Edge cases
- Legitimate DST or timezone travel: time zone changes are not clock changes, because UTC timestamps are unaffected. Only a wall-time jump relative to monotonic time is flagged.
- Windows automatic time sync corrections (under 30 s) are ignored.
- Hibernate: the gap is bracketed by SUSPEND/RESUME and not flagged.
- A BSOD looks like APP_KILLED → WARN, and the employee can explain it via the gap prompt.

### 9. Phase
**P1** for detection and badges. **P2** for input-pattern heuristics and an integrity dashboard.

### 10. Acceptance scenarios
1. Kill `Lexisora Tracker.exe` from Task Manager at 17:10 while punched in and restart at 17:55 → the "Tracker wasn't running from 17:10 to 17:55" prompt appears, and an `APP_KILLED` WARN badge shows in L1.
2. Change the system clock −2 h → `CLOCK_CHANGED` HIGH; segments stay correct; L2 approve requires acknowledgement.
3. Edit a local DB row (outside the app, with the key) → the server reports `HASH_CHAIN_BROKEN`; data is accepted and flagged.
4. Sleep the laptop 20 min → idle prompt on resume, no integrity flag.
5. Punch in on two devices → the second gets a "switch" prompt. Forcing overlap via offline sync → `CONCURRENT_DEVICE`, and the overlap is counted once.

---

## RBAC seed (permission keys owned by this domain)
| Permission | employee | lead | manager | hr | admin |
|---|---|---|---|---|---|
| `tracker.use` (subject to policy eligibility) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tracker.device.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tracker.device.manage` |  |  |  | ✓ | ✓ |
| `tracker.policy.manage` |  |  |  | ✓ | ✓ |
| `tracker.activity.view.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tracker.activity.view.team` |  | ✓ |  |  |  |
| `tracker.activity.view.reports` |  |  | ✓ |  |  |
| `tracker.activity.view.all` |  |  |  | ✓ | ✓ |
| `tracker.screenshot.view.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tracker.screenshot.view.team` |  | ✓ |  |  |  |
| `tracker.screenshot.view.reports` |  |  | ✓ |  |  |
| `tracker.screenshot.view.all` |  |  |  | (Q2) | ✓ |
| `tracker.screenshot.legalhold` |  |  |  |  | ✓ |
| `tracker.idleclaim.review` |  | ✓ | ✓ |  | ✓ |
| `tracker.integrity.view` |  | ✓ (team) | ✓ | ✓ | ✓ |
| `platform.tracker.release.manage` | (Lexisora super-admin only; no tenant data grants) | | | | |

The seed follows the "Approve timesheets" row of the Roles & access screen: lead, manager, admin.

## Cross-domain contracts

**Consumed**
- **Identity/Auth:** `verifyPassword(tenantId, email, pw)`, lockout, `hasPermission(userId, key, scopeCtx)`, offboarding event `user.deactivated` → revoke devices.
- **Org/Employees:** `employee{id, empId, name, officialEmail, workMode, workLocationId, reportingManagerId, teamLeadId, timezone, employmentStatus}`, and `isInReportingChain(viewer, user)`.
- **Attendance:** `getPunchChannels(userId, date) → {group, biometric, web, desktop, hasBiometricPunchToday}`, `getShift(userId, date) → {start, end, graceMin, breakAllowanceMin, tz}`, `recordPunch({userId, type, at, source:'DESKTOP', deviceId, clientEventId}) → attendanceSessionId`, `closeSession(...)`, `isPeriodLocked(userId, date)`, `createRegularization({userId, date, evidence})`. Attendance applies the status rules from the tracker totals (suggested: Late if firstIn > shiftStart + grace; Half-day if workedPayable < 4 h; Absent if < 2 h; these are theirs to confirm). The Attendance policy screen hosts the T2 fields. The web punch emits `attendance.session.opened|closed` for tracker attach/close.
- **Projects/Tasks:** `listAssignedOpenTasks(userId) → [{taskId, key, title, projectId, projectName, module, column}]` + tenant internal activities, `getProjectLead(projectId)`, event `task.assignment.changed` → `tasks.updated` push.
- **Timesheets:** `upsertTrackerEntries(userId, date, [{taskId, trackerSec, pendingClaimSec}])`, week status lookup, `TimesheetDelta` creation, L1/L2 detail UI slots (screenshots grid, idle claims, integrity strip). Approval events `timesheet.l1.approved` (→ bulk-approve pending claims) and `timesheet.l2.approved`.
- **Payroll:** reads `TrackerReadService.getPayrollIdle(userId, month)`.
- **Notifications:** `Alerts.create(userId, {title, from, link})`, `Mailer.send(template, to, vars)`.
- **Platform:** tenancy resolution by host, RLS session variable, audit log `audit.write(event)`, Socket.IO gateway with Redis adapter, ObjectStorage, BullMQ, rate limiter, per-tenant KMS (P3).

**Exposed**
- Domain events: `tracker.day.updated`, `tracker.session.opened|closed|auto_closed`, `idle.claim.created|decided`, `tracker.integrity.flagged`, `device.paired|revoked`.
- Read APIs: `/activity/*`, `/screenshots*`, `/idle-claims*`.
- The shared reducer package `@lexisora/shared/tracker` (types, zod event schemas, `reduceDay`), used by the web to render timelines too.

## Open questions
1. **Office staff tracking-only mode:** the Attendance policy grid ticks "Auto-idle" and "Screenshot every 10 min" for **Office** employees, yet the tracker login blocks office staff. Should office staff run the tracker in a tracking-only mode after a biometric punch (no desktop punch)? The spec supports it via `trackingEnabled` without `desktopPunchAllowed`, but the default is blocked.
2. **HR screenshot access:** should HR view screenshots (`tracker.screenshot.view.all`), or only lead, manager and admin? The toast copy says "Visible to your Project Lead".
3. **Idle deduction grace:** is there an idle grace allowance before payroll deduction (e.g. 60 min/month)? The sample payslips show ₹0 deduction despite recorded idle.
4. **Deleting accidental screenshots:** may employees delete or flag an accidental screenshot (e.g. a personal banking screen) within N minutes, with that interval deducted? Not in the wireframe.
5. **Hybrid employees:** "WFH day" determination. Is the absence of a biometric punch enough, or is there a pre-declared WFH schedule or request?
6. **App/URL usage tracking:** is capture of app or website usage (active window titles) wanted, or explicitly excluded? The spec excludes it for privacy.
7. **Code-signing certificate:** who procures it (OV vs EV vs Azure Trusted Signing), and the legal publisher name.

### Critical files for implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html (L317–517: all tracker screens and state logic)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (L440–517 attendance/timesheet/approvals markup; L815 Attendance policy GEN; L895–928 PROF tabs, approvals state, timeline, attRows)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (L352–363: journey #2 "Desktop tracker day", #3 "Timesheet approval")
- Planned: packages/shared/tracker/reducer.ts (shared event reducer; single source of truth for totals)
- Planned: apps/api/src/tracker/ingest (events:batch, projection job) and apps/tracker/src/main/engine (state machine, idle monitor, outbox)