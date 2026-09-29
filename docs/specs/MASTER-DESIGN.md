# Lexisora HRMS (People & Operations Suite): master design

This merges the seven domain specs into one buildable design. It resolves conflicts and duplicates between them and reconciles the result with the scaffold already in `C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms`. Where a domain spec disagrees with this document, this document wins.

---

## 0. Conflict resolutions and single owners (decision log)

| # | Topic | Conflict in domain specs | Decision (owner) |
|---|---|---|---|
| D1 | Desktop device registry | Platform M2 `Device` + `DevicePairRequest`, Time H `TrackerDevice`, Tracker T1 `TrackerDevice` + `DevicePairingRequest` + `TrackerDeviceToken` | **Tracker module owns** `TrackerDevice` and `DevicePairingRequest`. The flow and the Ed25519 key come from T1; the 6-digit code rules come from M2/T1. Tokens reuse **Identity** `Session` (clientType DESKTOP, `deviceId`) and `RefreshToken`. `TrackerDeviceToken` is dropped. |
| D2 | Tracker ingestion model | Time H: the client syncs pre-built segments. Tracker T3: event-sourced. | **Event-sourced (T3).** Flow: `TrackerEvent` → shared pure `reduceDay()` → projections `ActivitySegment` and `TrackerDaySummary`. Time H's `/tracker/v1/sync` is dropped. |
| D3 | Tracker session vs work session | T3 `TrackerSession`, Time `WorkSession` | **Attendance `WorkSession` is canonical.** It gains `trackerDeviceId?`, `lastHeartbeatAt?`, `status` (OPEN/CLOSED/AUTO_CLOSED/REJECTED_CONFLICT) and `closeReason`. `TrackerSession` is dropped. Only one OPEN session per employee (partial unique index). |
| D4 | Idle "I was working" | Time: `idleDecision` + `reviewStatus` on the segment. Tracker: `IdleClaim`. | **`IdleClaim` (Tracker owns).** It is reviewed inside the L1 approval UI (Timesheet). Decisions re-project the day. |
| D5 | Tracker policy | Time D `AttendancePolicy` (OFFICE/REMOTE) vs Tracker T2 `TrackerPolicy` | **One `AttendancePolicy` per audience (Time owns)** that includes the T2 tracker fields. Policy durations are stored in **minutes**: idle 1–30, screenshot 5–60, retention 7–365, offline 1–14. |
| D6 | Office staff and the tracker | The grid ticks idle/screenshots for Office, but the tracker login blocks office staff | Default: office staff are **blocked** (`TRACKER_NOT_ALLOWED`). A tenant toggle `officeMonitorOnly` enables MONITOR_ONLY mode: tracking starts on the biometric IN event and there is no desktop punch. |
| D7 | Hybrid work-day mode | Time: fixed `hybridOfficeDays`. Tracker: office if a biometric punch exists. | Use `hybridOfficeDays`. **Override:** a biometric punch that day forces OFFICE and the tracker refuses punch-in ("You punched in at Ahmedabad HQ today"). An approved WFH regularization forces REMOTE. |
| D8 | Holiday calendar | Time C, Leave L1 and Workplace each assume a different owner | **Time `calendar` module owns** `HolidayCalendar`, `Holiday`, `HolidayCalendarLocation(year)`, `WorkCalendarService` and `BusinessCalendar`. The UI is the **Leave setup → Holidays** tab. Policies renders the holiday list. |
| D9 | Period lock | Time `AttendancePeriodLock` vs Payroll `PayrollPeriodLock`; codes `PERIOD_LOCKED` vs `PAYROLL_LOCKED` | **One `PeriodLock` (Time owns).** Payroll run creation calls `PeriodLockService.lock()`. Error code `PERIOD_LOCKED`. Override permission `attendance.lock.override`. |
| D10 | Timesheet model | Time J (Timesheet/Line/Cell), Workfin `TimeEntry`, Tracker `TimesheetEntry` | **Time J model.** Invoicing reads a `BillableTimeView` over `TimesheetCell` (billable lines whose project's L1 step is APPROVED). Billed cells are locked through `InvoiceTimeEntry(timesheetCellId)`. |
| D11 | Activity codes | Time `ActivityCode` vs Workfin INT standing tasks | **INT standing tasks (Work owns).** `ActivityCode` is dropped. Every timesheet line has a `taskId` (standing or real). |
| D12 | Idle money deduction | Three different formulas and graces | **Tracker** computes per-day `idleDeductedSec`. The **approved timesheet** final idle is authoritative. **Attendance** applies the mode (default `SHORTFALL_ONLY`) and the monthly allowance (**`AttendancePolicy.monthlyIdleAllowanceMinutes`, default 60**). That output is `payroll-input.idleDeductibleMinutes`. **Payroll** computes `amount = round(deductibleMin/60 × grossFixed/(WD × netShiftMin/60))`. `PayrollSettings.idleGrace*` is removed. |
| D13 | Money | Decimal in leave/pay/finance, paise elsewhere | **Integer paise everywhere**: DB `BigInt`, JSON `number` (safe ≤ 2^53). Rates that need sub-paise precision (hourly/per-day) use `Decimal(18,4)` paise and round half-up at line level. GST rates are basis points (`1800`). Day counts use `Decimal(6,2)`. |
| D14 | IDs | cuid (scaffold) vs uuid | **UUIDv7** via `@default(uuid(7)) @db.Uuid`. `tenant_id` is uuid so the RLS cast is exact. |
| D15 | Scope vocabulary | SELF/TENANT, OWN/ALL, … | **`OWN PROJECT TEAM DEPARTMENT ALL`**. TEAM = the reporting subtree (direct and indirect reports). |
| D16 | Approvals count aggregator | `/me/approvals/summary`, `/approvals/counts` | `GET /api/v1/approvals/counts` (workplace/dashboard) with an `ApprovalCountProvider` registry covering timesheets L1/L2, leave, comp-off, regularizations and helpdesk escalations. Socket event `approvals.counts`. |
| D17 | Notifications / mail / alerts | `Alerts.create`, `Mailer.send`, `notify(...)` | **Platform `NotificationService.notify/resolve/sendDirect`** is the only API. Email goes through `EmailAdapter`. |
| D18 | Files | `StoredFile`, `FileObject`, per-module presign | **Platform `FileObject` + `FileService`** with the purpose registry. **Exception:** screenshots, because of their volume. They use `Screenshot.storageKey` directly through the `ObjectStorage` adapter; the usage job counts their bytes. |
| D19 | Sequences | `NumberSequence` (two shapes), `TenantSequence`, `EmployeeCodeSequence` | **Platform `NumberSequence(tenantId,key,period)` + `SequenceService`.** Keys: `employee.fulltime`, `employee.intern`, `helpdesk.ticket`, `visitor`, `invoice.gst`, `credit_note`, `voucher.{receipt,payment,journal,hr,purchase,payroll,contra}`, `leave.request`, `payroll.run`, `asset.tag`, `idcard.serial`, `job.code`, `client.code`. Platform-level `PlatformSequence` covers `LXS` SaaS invoices and `SUP` tickets. |
| D20 | Rendering (PDF/PNG) | pdfkit (scaffold), Puppeteer, Playwright, Gotenberg | **Gotenberg 8** (Chromium) behind the `HtmlRenderer` adapter for both PDF and PNG (screenshot route). Used for payslips, invoices, certificates, ID cards, visiting cards and offer letters. `pdf-lib` handles e-sign stamping. **pdfkit is removed.** |
| D21 | Password hashing / JWT | bcrypt + HS256 (scaffold) | **argon2id** (`@node-rs/argon2`) and **EdDSA JWT** (`jose`, `kid` rotation). |
| D22 | Tenant isolation | App-level Prisma filter (scaffold) vs RLS | **Both.** Keep the scaffold's `tenant-scope` extension as the first layer and add **PostgreSQL RLS** with `set_config('app.tenant_id')` per transaction as the enforcing layer. |
| D23 | Ledger access for HR | Matrix: HR ✓ "Payroll & ledger". NAV: ledger is admin-only. | HR gets `payroll.*` and `ledger.hrvoucher`. The Ledger nav item appears for HR showing **only the HR vouchers tab**. The matrix cell renders **partial** for HR. This is a documented NAV deviation. |
| D24 | HR and task boards | Code: HR sees all. Matrix: no. | Follow the matrix: HR `tasks.board.view [OWN]` (boards they are allocated to). |
| D25 | Tenants nav | Wireframe gives it to every admin | Visible only in the **OPERATOR** tenant via `platform.console.link`. It hands off to the console (TOTP required). |
| D26 | Mobile | Native app or not | P1–P3 ship **responsive web only**. The mobile gate (`mobile.access`) is enforced by UA/Client-Hint detection. A native app is out of scope; `X-Client-App: hrms-mobile` is reserved. |
| D27 | Timesheet status names | `PENDING_PL`, `SENT_BACK`, `rm_approved` | Statuses: `DRAFT SUBMITTED(=pending PL) PENDING_RM APPROVED RETURNED LOCKED`. The approval event is `timesheet.approved`. Payroll's gate enum maps onto these. |
| D28 | Employee status | `NOTICE` vs `NOTICE_PERIOD` | `INVITED ONBOARDING ACTIVE NOTICE EXITED CANCELLED` (People). |
| D29 | Badge / ID tokens | HMAC badge token vs `verifyToken` | A single `IdCard.verifyToken` (random, looked up server-side). ID compliance scans it via `/idcards/scan/:token`. |
| D30 | Payroll ledger posting | `PayrollAccountMapping` vs `systemKey` accounts | Payroll posts through `LedgerService.post(sourceType=PAYROLL_RUN)` using CoA **systemKeys**. An optional `PayrollAccountMapping` override defaults to systemKeys. In P1, before the ledger exists, postings are stored `SKIPPED_NO_LEDGER` and replayed when M13 ships. |
| D31 | "Paid days" | Table vs payslip semantics | "Paid days" means **payable days including paid leave**, everywhere. |
| D32 | Key references | userId vs employeeId | HR/work records (attendance, tracker, timesheet, leave, payroll, assets, tasks-as-assignee) key on **employeeId**. Account and communication records (sessions, devices, notifications, chat, audit actor) key on **userId**. `User.employeeId` is 1:1 and nullable. |

**Open-question defaults adopted:**

| Area | Default |
|---|---|
| Idle deduction | SHORTFALL_ONLY with a 60 min/month allowance |
| Late penalty | 3 late marks = 0.5 day; deducted CL first, then LOP; early-out counts as late |
| Screenshots | HR has no access; employees see their own; retention 90 days |
| Timesheets | Month-end split ON; duplicate approver skipped |
| Interns | Timesheet-exempt (intern task sheets); no PF/ESI/PT/TDS; idle deduction applies |
| Payroll | Publish on finalize; HR can finalize alone (`requireApproval=false`) |
| Leave | EL accrues monthly at 1.5; excess requests are rejected; EL above the 30 cap lapses; approval chain is RM only |
| Seats | INVITED users and interns count |
| Invoices | Number assigned at issue, continuous `INV-{seq:4}`; hours become billable after L1 approval |
| GitLab | Branch created at WIP from `develop` |
| QA handoff | Linked QA-board task |
| Kudos | Given by lead and above |
| EOTM | One per tenant per month |
| Birthdays | Shown by default; employees can opt out |
| Wellness | Puzzles unlock at 00:00 |
| Call recordings | Banner plus notice; 90-day retention |
| Candidates | Retained 24 months |
| Exited employee documents | Retained 8 years |
| Exited employee access | Login disabled; payslips on request |
| Invites | Sent to personal email |
| Intern conversion | New staff code |
| Offer letters | Pre-signed company signature |
| Appraisals | No nav item for employees; access via to-do, alert or profile link |

---

## 1. Architecture overview

### 1.1 Apps, packages and infrastructure

**Apps**

- **apps/api**: NestJS 11 on Express. It runs in three process roles from one image, selected by `PROC_ROLE`:
  - `http`: REST `/api/v1`, public routes, webhooks, `/iclock` ADMS.
  - `ws`: the Socket.IO gateway (it can share the http process in dev).
  - `worker`: BullMQ processors, outbox relay and scheduler tick.

  The P3 console API runs as a separate Nest application (`apps/api/src/console-main.ts`) with the `platform_svc` DB role.
- **apps/web**: React 18, Vite, TanStack Router (file routes), TanStack Query, react-hook-form with zod, and the `packages/ui` Classical design system. The console lives under `/console` in the same app.
- **apps/tracker**: Electron (Windows x64 first) with a React renderer. The main process owns the engine, idle monitor, capture, the SQLCipher outbox, sync, tray and updater.

**Packages**

| Package | Contents |
|---|---|
| `packages/shared` | zod contracts, events, permissions, nav, registries, formatters, `tracker/reducer`, GST/sequence/FY calculators, brand ramp |
| `packages/ui` | tokens.css, component classes and React primitives; shared by web and the tracker renderer |
| `packages/games` | Deterministic puzzle generators and solvers |
| `packages/fixtures` | Demo personas and wireframe constants, used by seed and e2e |
| `packages/config` | eslint, tsconfig presets |

**Infrastructure (Docker Compose)**

| Profile | Services |
|---|---|
| default | postgres:16 (5433), redis:7 (6380), mailpit (1025/8025), **minio** (9000/9001), **gotenberg** (3001) |
| `scan` | clamav (3310); default `SCANNER=mock` |
| `rtc` | livekit, livekit-egress |
| `cctv` | mediamtx |
| `p3` | openbao (Vault-compatible) and caddy (on-demand TLS) |
| `obs` (optional) | otel-collector, jaeger or grafana-lgtm |

### 1.2 Request flow

```
Browser/Tracker → (Caddy/ingress) → api http
  1 RequestId middleware (uuidv7, X-Request-Id)
  2 TenantResolver middleware: Host / X-Forwarded-Host (trusted) / X-Workspace → Redis domain:{host} → TenantDomain → CLS.tenantId
     retired host → 308 (web) or X-Workspace-Moved; unknown → 404 WORKSPACE_NOT_FOUND
  3 AuthGuard: EdDSA JWT (aud tenant-api) → assert jwt.tid == CLS.tenantId → Redis sess:{sid} active → CLS {userId, employeeId, sessionId, clientType, pv}
     rejects aud=platform-api; DeviceGuard for tracker routes (did claim + device ACTIVE)
  4 TenantStatusGuard: READ_ONLY → 423 on writes except auth/billing/support/punch/tracker-ingest/notification-read; SUSPENDED → billingOnly
  5 PermissionGuard @RequirePermission(key) → effective perms (Redis perm:{tenant}:{user}:{rbacVersion}) ∧ entitlement ∧ status
  6 ZodValidationPipe (shared schema) → controller → service
  7 Prisma: tenant-scope extension (app filter) + RLS transaction (set_config('app.tenant_id', $1, true))
  8 Domain writes + DomainEventOutbox row + AuditEvent row in the SAME transaction
  9 AuditInterceptor (for @Audit metadata) / ErrorFilter → standard error envelope
```

### 1.3 Tenancy and RLS enforcement

**Schemas**

- `platform`: tenants, domains, plans, subscriptions, SaaS invoices, platform users, support tickets, usage, keys, the permission and notification catalogues, statutory reference tables, the biometric SN registry and tracker releases. No RLS.
- `tenant`: every tenant-owned table. Each has `tenant_id uuid NOT NULL`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, and the policy `tenant_isolation USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (same)`.
- `audit`: `audit_event`, partitioned by month; RLS applies where `tenant_id` is not null.

Prisma uses `multiSchema` with `@@schema(...)`.

**DB roles**

| Role | Rights |
|---|---|
| `migrator` | Owns all schemas |
| `app_user` | NOBYPASSRLS. CRUD on `tenant`; SELECT on selected `platform` tables; INSERT/SELECT on `audit` |
| `platform_svc` | Full `platform`; INSERT on `audit`; **no grants on `tenant`**; EXECUTE only on `SECURITY DEFINER` count functions such as `platform.fn_tenant_usage` and `platform.fn_resolve_git_integration` |
| `audit_sealer` | May only set `seq/prevHash/hash` where they are null |

**Prisma RLS pattern**

- Single operations: the extension wraps each operation as `$transaction([set_config, op])` (batch transaction, compatible with pgbouncer transaction mode).
- Service-level work: `tx(fn)` opens an interactive transaction and runs `set_config` first.
- Workers restore CLS from the job payload `tenantId`. A job without a tenant is rejected by the worker wrapper.
- Unscoped system code (login lookup by host, the `/iclock` SN registry, webhooks) uses explicit, narrowly granted security-definer lookups and then enters the tenant context.

**CI gates**

1. A migration check fails if any `tenant.*` table lacks RLS, FORCE, the policy, or a leading-`tenant_id` composite index/unique.
2. For every table, a query with no context returns 0 rows.
3. A test asserts `platform_svc` gets `SELECT tenant.payroll_item` → permission denied.

Cross-row foreign keys use composite `(tenant_id, id)`.

**Dedicated DB (P3):** `TenantConnectionResolver` holds an LRU pool of at most 20 Prisma clients from `dbConnectionRef`. RLS stays on in dedicated databases.

### 1.4 Authentication and sessions

**Clients.** Client type is detected from `X-Client-App` (`lexisora-tracker/<v>` plus device signature → DESKTOP), then `Sec-CH-UA-Mobile`/UA (→ MOBILE), else WEB. It is fixed for the life of the session.

**Tokens**

- Access JWT: 15 min, held in memory. Claims `{iss, aud, sub, tid, sid, cli, pv, did?}`.
- Refresh token: rotating, family-tracked, with reuse detection. On the web it lives in the `__Host-rt` httpOnly SameSite=Strict cookie with path `/api/v1/auth`, and requests need `X-Requested-With`.
- Desktop refresh must carry `X-Device-Sig = Ed25519(refreshTokenHash|ts)` within ±5 min.
- A 10 s rotation grace allows parallel tabs.

**TTLs**

| Client | Idle | Absolute |
|---|---|---|
| WEB | 12 h | 7 days |
| MOBILE | 30 days sliding | 90 days |
| DESKTOP | 30 days sliding | none while the device is ACTIVE |

**Protections:** lockout after 5 failures in 15 min (15 min lock); password rules ≥10 characters plus a breached-password list; invite TTL 7 days; reset TTL 30 min. A reset revokes all sessions but devices stay paired.

**Gates:** MOBILE requires `mobile.access`. DESKTOP requires `tracker.use` and `Attendance.canUseDesktopTracker`.

**Later phases:** P2 adds OIDC SSO and TOTP MFA. P3 adds SAML. Platform console tokens use a different issuer and audience (`platform-api`) and always require TOTP; there is no impersonation.

### 1.5 Permission model

- `Permission` catalogue: code-defined in `packages/shared/src/permissions/*.ts` and synced to `platform.permission` on deploy.
- `Role` (5 seeded system roles plus custom), `RolePermission(roleId, key, scopes[])`, `UserRole` (a user can hold several roles).
- `effective(user) = ∪ role perms → Map<key, Set<Scope>>`, cached in Redis and keyed by `TenantSettings.rbacVersion`.
- `can(key) = held ∧ Entitlements.has(feature) ∧ tenantStatusAllows`.
- `authz.scopeFilter(key, kind)` ORs over `ScopeResolver`s:
  - OWN: owner = me.
  - PROJECT: projects I lead or am a member of (Work).
  - TEAM: my reports tree via recursive CTE (People).
  - DEPARTMENT: my departments (People).
  - ALL: no filter.

  Owning domains add relationship checks, for example "the L1 approver must be the project lead".
- Nav is computed server-side in `GET /me` from `packages/shared/nav.ts`: `{id, route, group, permissionAny[], feature?}`.
- Matrix rows are tri-state (all/some/none). Dependencies auto-enable (`requires`). A `LAST_ADMIN` guard prevents removing the last admin. Removing `mobile.access` revokes live MOBILE sessions. Socket `rbac.changed` triggers a `/me` refetch.
- Entitlements are a no-op in P1–P2 (all tenants on `INTERNAL`) and are enforced in P3.

### 1.6 Realtime

Socket.IO with the Redis adapter.

| Namespace | Auth | Rooms |
|---|---|---|
| `/app` | access token | `t:{tenantId}`, `u:{userId}`, `s:{sessionId}`, `ch:{channelId}` (chat), `board:{boardId}`, `project:{id}`, `payroll:{tenant}`, `frontdesk:{locationId}`, `cctv:{tenant}`, `feed:{tenant}`, `pair:{requestId}` |
| `/tracker` | device token | `device:{id}`, `u:{userId}`, `policy:{tenant}:{audience}` |

- A `RoomAuthorizer` hook lets domains authorise joins; chat, boards and CCTV register policies.
- Server emits: `Realtime.emitToUser / emitToRoom / emitToTenant`.
- Server-side invalidation events carry a type plus ids only. Clients refetch through TanStack Query. The exception is chat and `attendance.state`, which carry payloads.

### 1.7 Jobs and events

- **Transactional outbox:** `tenant.domain_event_outbox`. The relay uses LISTEN/NOTIFY with a 1 s poll fallback and fans out to in-process handlers and BullMQ.
- **Event envelope:** `{id (uuidv7), tenantId, type, version, occurredAt, actor{type,id,label}, payload}`. Event payloads are zod-versioned in `packages/shared/src/events/`.
- **Consumers** are idempotent. They are keyed by `eventId+handler` in `processed_event`, or by natural unique keys.
- **BullMQ queues:**

  | Queue | Used for |
  |---|---|
  | `default` | general jobs |
  | `notify` | email, WhatsApp |
  | `files` | scan, thumbnail |
  | `pdf` | Gotenberg renders |
  | `payroll` | calc, finalize |
  | `tracker` | project, auto-close |
  | `attendance` | recompute-day (debounced 5 s) |
  | `gitlab` | GitLab sync |
  | `media` | transcode |
  | `ledger` | postings |
  | `search` | indexing |
  | `messaging` | messaging |
  | `ocr` | bill OCR |
  | `platform` | provisioning, usage |

  Default retry is exponential backoff with 5 attempts, then dead-letter handling plus an admin alert.
- **Tenant-local cron:** `ScheduledJob(tenantId,key,cron,tz)` rows. One `scheduler.tick` per minute enqueues due jobs. Domains call `Scheduler.upsert()`.

### 1.8 Storage and files

- S3-compatible storage (MinIO in dev), one bucket per environment, public access denied, SSE on.
- Key layout: `q/{tenant}/…` (quarantine) → `t/{tenant}/{purpose}/{yyyy}/{mm}/{id}`. The platform bucket prefix is `p/`.
- Upload flow: upload intent → presigned PUT (15 min; multipart above 100 MB) → `complete` → magic-byte sniff → scan (`VirusScanner`) → AVAILABLE → owning domain calls `attach`.
- Downloads: purpose `FileAccessPolicy.canRead` → presigned GET (5 min). RESTRICTED downloads are audited.
- Retention per purpose: screenshots 90 days, payroll/finance 8 years, exports 7 days. Quotas per plan (P3).

### 1.9 Encryption

- **P1 seam:** `CryptoService.encrypt/decrypt/blindIndex(category, value)`, AES-256-GCM with AAD `tenantId|model|field|rowId` and versioned format `v{n}|iv|ct|tag`. `LocalKeyProvider` derives a per-tenant DEK with HKDF from the master key (`DATA_ENCRYPTION_KEY`).
- **Encrypted in P1:** PAN, Aadhaar, bank account number (with `*_last4` and a `*_bidx` HMAC blind index), salary structure line amounts, the GitLab token, SSO secrets and camera RTSP URLs.
- **P3:** `TenantKey` envelope encryption with the KEK in Vault Transit/OpenBao (AWS KMS optional, BYOK for Enterprise), a `crypto.rekey` migration, rotation, and crypto-shred on deletion. P3 also encrypts chat bodies and call recordings, screenshots (SSE-C), per-employee payroll item amounts (run aggregates stay plaintext) and RESTRICTED files via an API streaming proxy.
- **Classification registry:** `packages/shared/src/classification.ts`, backed by the Prisma doc tags `/// @classification RESTRICTED:SALARY`. A CI check verifies that every tagged field is registered.

### 1.10 Observability

- **Logs:** pino JSON with `requestId, tenantId, userId, route, latency`. Secrets and PII are redacted through the classification-aware serializer. The tracker writes rolling `electron-log` files.
- **Traces:** OpenTelemetry (HTTP, Prisma, BullMQ, Socket.IO) exported over OTLP.
- **Metrics:** Prometheus `/metrics` (prom-client) with RED metrics, queue depth, outbox lag, RLS transaction timings and tracker ingest rate.
- **Health:** `/health/live` and `/health/ready` (DB, Redis, S3).
- **Admin/dev tools:** bull-board (admin-only in dev and staging) and `/dev/outbox` (Mailpit and stub messages).
- **Errors:** Sentry-compatible SDK pointed at a self-hosted GlitchTip (optional). Tracker crash dumps go to `/tracker/crash`.

### 1.11 CI (GitLab CI; a GitHub Actions mirror is optional)

**Pipeline stages**

1. `install`: pnpm store cache.
2. `lint`: eslint with boundaries (the console cannot import tenant repositories; web cannot import api) and prettier.
3. `typecheck`.
4. `unit`: vitest across all packages.
5. `db`: `prisma migrate deploy` against a postgres:16 service, then RLS audit SQL, grant tests, and classification and catalogue consistency checks.
6. `integration`: API supertest against the real DB, Redis and MinIO services, with stub adapters.
7. `e2e`: Playwright on seeded demo data with `SEED_ANCHOR_DATE=2026-09-29`.
8. `build`: api image, web static assets, and the tracker on a **Windows runner** (electron-builder NSIS).
9. `sign`: on tag only; Authenticode via Azure Trusted Signing or signtool.
10. `release`: publish the tracker release to the S3 feed and container images.

**Gates:** merges are blocked on `lint`, `typecheck`, `unit`, `db`, `integration` and the smoke subset of e2e. The full e2e suite runs nightly.

### 1.12 Scaffold reconciliation (existing repo)

`lexisora-hrms` already contains the pnpm workspace, `apps/api` (Nest config, `request-context.ts`, a tenant-scope `PrismaService`, `env.ts`, and Prisma `base.prisma` and `core.prisma`) and `packages/shared` (`roles`, `permissions`, `nav`, `format`, `tracker`, contract stubs). Required changes before M2:

| File | Required change |
|---|---|
| `base.prisma` | Switch IDs from cuid to `uuid(7) @db.Uuid`. Money Int paise → `BigInt` paise. Enable multiSchema with `platform`/`tenant`/`audit`. |
| `core.prisma` | Split into per-domain files that follow §3. `Role.permissions String[]` → `RolePermission` with scopes. `User.roleId` → `UserRole`. Fix the `TenantStatus` enum. Move `Employee` sensitive columns into `EmployeeStatutory` and `EmployeeBankAccount` (`Bytes`). Replace `AuditLog` with `audit.AuditEvent`. Replace `FileObject` fields per §3. Replace generic `Setting` with typed `TenantSettings` plus module settings tables. |
| `request-context.ts` | Add `sessionId, clientType, permVersion, requestId, deviceId`. Change `permissions` from a Set to a `Map<key, Scope[]>`. Migrate to `nestjs-cls`, or keep the ALS wrapper with the same API. |
| `prisma.service.ts` | Keep the extension and add the RLS `set_config` batch/interactive transaction and the `tx()` helper. Nested writes must still stamp `tenantId` explicitly. |
| `env.ts` | Replace `JWT_*_SECRET` with `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEYS_DIR`. Add the keys listed in §7. Set `STORAGE_DRIVER` default to `s3` (MinIO); `fs` is for unit tests only. |
| dependencies | Remove bcryptjs and pdfkit. Add `@node-rs/argon2`, `jose`, `nestjs-cls`, `@aws-sdk/client-s3`, `pino`, `@opentelemetry/*`, `pdf-lib`, `croner`. |
| `packages/shared/permissions.ts`, `nav.ts` | Rename keys to the catalogue in §4 and add scopes, `requires`, `risk`, `feature` and `matrixRow`. Nav paths must match §2.4. |
| `docker-compose.yml` | Add minio, gotenberg and the profiles in §1.1. |

---

## 2. Monorepo layout and conventions

### 2.1 Tree

```
lexisora-hrms/
├─ apps/
│  ├─ api/
│  │  ├─ prisma/
│  │  │  ├─ schema/ base.prisma platform.prisma identity.prisma rbac.prisma tenancy.prisma notify.prisma audit.prisma files.prisma
│  │  │  │          people.prisma recruitment.prisma appraisal.prisma assets.prisma cards.prisma time.prisma tracker.prisma
│  │  │  │          timesheet.prisma leave.prisma payroll.prisma work.prisma finance.prisma workplace.prisma chat.prisma saas.prisma
│  │  │  ├─ migrations/        sql/ (roles.sql, rls.sql, audit_triggers.sql, exclusion_constraints.sql, partitions.sql, security_definer.sql)
│  │  │  └─ seed/ (catalogue-sync.ts, base/ per SeedContributor, demo/ per domain, platform-demo.ts, index.ts)
│  │  └─ src/
│  │     ├─ main.ts  console-main.ts  worker-main.ts  app.module.ts
│  │     ├─ config/ (env.ts, feature-flags.ts)
│  │     ├─ core/  context/ prisma/ tenancy/ authz/ (guards, decorators, scope-resolvers) audit/ outbox/ events/ jobs/ scheduler/
│  │     │         realtime/ crypto/ http/ (error filter, zod pipe, idempotency, pagination) sequences/ health/ observability/
│  │     ├─ adapters/  email/ whatsapp/ push/ storage/ scanner/ renderer/ image/ git/ rtc/ stream/ biometric/ payment/ payout/ bankfile/
│  │     │             ifsc/ bank-verify/ esign/ print-vendor/ ocr/ einvoice/ gst-filing/ accounting-export/ sso/ breached-pw/ kms/ dns/ tls/
│  │     │             geocoder/ ipgeo/ holiday-provider/ transcoder/ resume-parser/ job-board/ crash-sink/ update-feed/ alert-sink/
│  │     └─ modules/
│  │        ├─ platform/  identity/ rbac/ tenancy/ notifications/ audit/ files/ search/ demo/ branding/ privacy/ entitlements/
│  │        │             console/ (P3: tenants, provisioning, usage, platform-users)  billing/ (P3)  support/ (P3)
│  │        ├─ people/    masters/ employees/ profile/ vault/ onboarding/ esign/ recruitment/ appraisals/ assets/ welcome-kits/ id-cards/ vcard/
│  │        ├─ time/      locations/ shifts/ calendar/ attendance-policy/ attendance/ regularization/ period-lock/ biometric/ id-compliance/
│  │        ├─ tracker/   devices/ policy-feed/ ingest/ projection/ screenshots/ idle-claims/ integrity/ releases/
│  │        ├─ timesheet/ timesheets/ approvals/ outside-hours/
│  │        ├─ leave/     types/ credits/ requests/ comp-off/ year-end/
│  │        ├─ payroll/   settings/ salary/ statutory/ (pure engine) runs/ adjustments/ payslips/ bank-files/ postings/
│  │        ├─ work/      clients/ projects/ boards/ tasks/ gitlab/ archive/ interns/
│  │        ├─ finance/   settings/ invoices/ purchases/ ledger/ filing/ gst/
│  │        └─ workplace/ dashboard/ approvals-counts/ todos/ quotes-events/ notices/ feed/ kudos/ certificates/ chat/ calls/
│  │                      helpdesk/ lms/ facility/ policies/ wellness/ cctv/ audience/
│  ├─ web/src/
│  │  ├─ main.tsx  router.tsx  theme/ (theme.css loader)  lib/ (api client, query keys, socket, auth, format re-exports, i18n)
│  │  ├─ components/ (AppShell, Sidebar, Header, ModulePage, DataTable, FormDialog, FileDrop, Toast, Tabs, KpiStrip, Tag, Drawer, PdfViewer, …)
│  │  ├─ features/<domain>/ (hooks, forms, sub-components per module)
│  │  └─ routes/ _public/ (login, reset-password, invite.$token, sso.callback, workspace-not-found, verify.$code, pass.$token, c.$slug, verify.id.$token, sign.$envelopeId, device-approve)
│  │             _app/ dashboard feed notices chat alerts
│  │                   attendance timesheet approvals leave leave.setup id-compliance
│  │                   projects projects.$id.board board archive interns clients
│  │                   employees employees.$id onboarding shifts locations appraisals appraisals.review.$id jobs candidates interviews
│  │                   payslips payroll ledger invoices purchases filing
│  │                   vault id-cards visiting-card assets welcome-kits policies helpdesk learning kudos facility cctv wellness search
│  │                   admin.roles admin.attendance-policy admin.security admin.audit admin.integrations
│  │                   saas.subscription saas.branding saas.tenants saas.privacy saas.support
│  │             demo/ (index, flows)  console/ (P3 tree)
│  └─ tracker/src/
│     ├─ main/  engine/ (state machine, reducer host) idle/ capture/ outbox/ (SQLCipher) sync/ auth/ (pairing, keys, safeStorage)
│     │         tray/ widget/ notifications/ updater/ crash/ ipc/ (zod allowlist) providers/ (InputActivity, Clock, ScreenCapture, SecureStore, Transport, DeviceIdentity; real + mock)
│     ├─ preload/  renderer/ (React: SignIn, Pair, Tracker, Summary, Settings, IdleDialog, ShotToast, OfflineBanner, DevPanel)
│     └─ build/ (electron-builder.yml, fuses, icons)
├─ packages/
│  ├─ shared/src/ contracts/<domain>/*.ts  events/<domain>.ts  permissions/<group>.ts  nav.ts  roles.ts  notification-types.ts
│  │              files.ts (purpose registry)  classification.ts  status-tones.ts  errors.ts (codes)  api.ts (envelope, pagination)
│  │              format.ts money.ts dates.ts (tz, FY label, business calendar pure helpers) gst.ts brand.ts tracker/ (events, reducer.ts)
│  ├─ ui/ (tokens.css, classical.css, components/, fonts via @fontsource)
│  ├─ games/ (queens, sudoku6, wordladder, rng, words4.json)
│  ├─ fixtures/ (personas, org, projects, wireframe sample rows, anchor-date helpers)
│  └─ config/ (eslint, tsconfig)
├─ e2e/ (Playwright: journeys/01-…10-*.spec.ts, fixtures/, electron/ tracker smoke)
├─ infra/ (compose profiles, mediamtx.yml, livekit.yaml, caddy/, gotenberg, clamav, openbao/, grafana/)
└─ docs/ (specs/, wireframes/, adr/, runbooks/)
```

### 2.2 API conventions

- **Base path and versioning:** `/api/v1/...`. Public routes are `/api/v1/public/*`. Webhooks are `/api/v1/webhooks/*`. ADMS is `/iclock/*` on host `adms.<root>`. Internal service calls are in-process services; there are no HTTP internal routes except `/internal/cctv/auth` and `/internal/tls/allowed`, which are network-restricted.
- **Contracts:** each endpoint has `XRequest`, `XResponse` and query zod schemas in `packages/shared/contracts/<domain>`. The API validates with `ZodValidationPipe`. Web forms use the same schema with `zodResolver`. Responses are serialized through the schema in dev and test, to catch drift.
- **Errors:** status code plus
  ```json
  {"error":{"code":"PERIOD_LOCKED","message":"…","details":{…},"fieldErrors":{"email":["…"]},"requestId":"…"}}
  ```
  Codes are listed in `shared/errors.ts`:

  | Status | Meaning |
  |---|---|
  | 400 | malformed |
  | 401 | unauthenticated / DEVICE_CLOCK_SKEW |
  | 402 | FEATURE_NOT_IN_PLAN / SEAT_LIMIT |
  | 403 | FORBIDDEN {permission} / BOARD_PRIVATE / PUNCH_BLOCKED_* |
  | 404 | not found (also used for out-of-scope rows) |
  | 409 | STATE_CONFLICT / VERSION_CONFLICT / PERIOD_LOCKED / LAST_ADMIN |
  | 410 | gone |
  | 413 | STORAGE_QUOTA |
  | 415 | mime mismatch |
  | 422 | validation / business rule |
  | 423 | TENANT_READ_ONLY / locked |
  | 429 | rate limit / KUDOS_LIMIT |
  | 503 | dependency down |
- **Pagination:** cursor based. Request `?cursor&limit` (default 25, max 100). Response `{items, nextCursor}`. Tab counts come from `…/counts` endpoints. Sorting is `?sort=field:asc` with a whitelist.
- **Idempotency:** creating POSTs that can be retried (punch, leave request, ticket, invoice issue, support request, pairing claim, tracker batches) accept `Idempotency-Key`. The response is cached in Redis for 24 h.
- **Concurrency:** mutable aggregates carry `version`. Writes send `expectedVersion` and get 409 `VERSION_CONFLICT` on mismatch.
- **Audit:** `@Audit('module.entity.verb', {entity})` on mutating handlers, or `AuditService.record()`. Written in the same transaction. RESTRICTED fields are redacted in diffs.
- **Units and time**
  - Money: integer paise, field names `*Paise`.
  - Durations: the unit is in the field name (`*Minutes`, `*Sec`).
  - Business dates: `YYYY-MM-DD` strings (tenant or location timezone).
  - Instants: ISO-8601 UTC.
  - Timezone: default `Asia/Kolkata`. All day bucketing uses the **location timezone** for attendance and the **tenant timezone** for everything else.
  - FY runs April–March, labelled `2026-27`.
- **i18n-ready:** web strings go through `i18next` keys in the `en-IN` locale. Notification and email templates use ICU MessageFormat. Formatting uses `Intl` en-IN (lakh/crore). No hardcoded English lives in shared logic other than the default locale file.
- **Status tones:** tones are centralized in `status-tones.ts` keyed by `{module,status}`: `~` accent, `!` outline, `-` neutral. Domains never hardcode tones.
- **Registries:** each module contributes, in code, its permissions, nav entries, notification types, file purposes plus access policies, search providers, seed contributors, dashboard section and to-do providers, and approval count providers.

### 2.3 Web conventions

- One `ModulePage` template renders every GEN screen: header, actions gated by permission, KPIs, tabs with counts, tiles, table, the three cell kinds, and loading/empty/error/403/plan-locked states.
- `FormDialog` is driven by the zod schema plus field metadata.
- Route guard: uses `/me.navigation`. A forbidden route shows 403, then redirects to `/dashboard` with a toast.
- Query keys: `[domain, entity, params]`. Invalidation comes from mutation `onSuccess` and socket invalidation events.
- Theme: `/api/v1/public/theme.css` is linked in `index.html`.

### 2.4 Route map (wireframe screenId → route)

| Screen IDs | Routes |
|---|---|
| login, dashboard, feed, notices, chat, notif | `/login`, `/dashboard`, `/feed`, `/notices`, `/chat`, `/alerts` |
| attendance, timesheet, approvals, leave, leaveAdmin, idcompliance | `/attendance`, `/timesheet`, `/approvals`, `/leave`, `/leave/setup`, `/id-compliance` |
| projects, kanban, archive, interns | `/projects`, `/projects/:id/board` (`/board` redirects to the last project), `/archive`, `/interns` |
| employees, profile, onboarding, shifts, locations, appraisal, jobs, candidates, interviews | `/employees`, `/employees/:id`, `/onboarding`, `/shifts`, `/locations`, `/appraisals`, `/jobs`, `/candidates`, `/interviews` |
| payslips, payroll, ledger, invoices, purchases, filing | `/payslips`, `/payroll`, `/ledger`, `/invoices`, `/purchases`, `/filing` |
| vault, idcard, vcard, assets, welcomekit, policies, helpdesk, lms, kudos, facility, cctv, wellness | `/vault`, `/id-cards`, `/visiting-card`, `/assets`, `/welcome-kits`, `/policies`, `/helpdesk`, `/learning`, `/kudos`, `/facility`, `/cctv`, `/wellness` |
| roles, settings | `/admin/roles`, `/admin/attendance-policy` |
| New admin screens | `/admin/security`, `/admin/audit`, `/admin/integrations` |
| billing, whitelabel, tenants, privacy, support | `/saas/subscription`, `/saas/branding`, `/saas/tenants`, `/saas/privacy`, `/saas/support` |

Demo deep links:
- `/demo?role=&screen=`
- The legacy `#screen=x&role=y` hash is parsed on `/` in demo mode.

---

## 3. Unified data model

Unless marked "platform", every model is in the `tenant` schema with `id uuid(7)`, `tenantId`, `createdAt` and `updatedAt`, and has RLS. `…` means the fields follow the domain spec; the relations and ownership shown here are canonical.

### 3.1 Platform, identity, RBAC and tenancy (module `platform/*`)

| Entity | Key fields / relations |
|---|---|
| **Tenant** (platform) | slug unique, name, legalName, kind(OPERATOR/CUSTOMER/DEMO), status, planCode, dbMode, dbConnectionRef, timezone, locale, currency, stateCode, lifecycle timestamps |
| **TenantDomain** (platform) | host unique, kind(SUBDOMAIN/CUSTOM), isPrimary, verificationToken, verifiedAt, tlsStatus, redirectToPrimary, retiresAt |
| **TenantSettings** | tenantId PK, companyDisplayName, legalName, gstin, pan, registeredAddress, stateCode, timezone, fyStartMonth(4), weekStart, allowedEmailDomains[], session TTLs, maxDevicesPerUser(2), rbacVersion, publishedBrandingVersion, officeMonitorOnly(false), demo flags |
| **NumberSequence** | (tenantId, key, period) PK, prefix, padding, nextValue BigInt |
| **PlatformSequence** (platform) | key, period, nextValue (LXS invoices, SUP tickets) |
| **DomainEventOutbox** | type, version, payload, actor, occurredAt, publishedAt, attempts |
| **ProcessedEvent** | (eventId, handler) PK |
| **ScheduledJob** | key unique per tenant, cron/runAt, jobName, payload, timezone, nextRunAt |
| **User** | email citext unique per tenant, displayName, avatarFileId, passwordHash, status(INVITED/ACTIVE/LOCKED/DISABLED), failedLoginCount, lockedUntil, employeeId unique (→Employee), mfaEnabled, isDemoPersona |
| **Session** | userId, clientType(WEB/MOBILE/DESKTOP), deviceId?(→TrackerDevice), ip, userAgent, idle/absolute expiry, revokedAt, revokeReason, billingOnly |
| **RefreshToken** | sessionId, familyId, parentId, tokenHash unique, scope(`full`/`tracker:sync-only`), expiresAt, usedAt, revokedAt |
| **AuthToken** | userId, purpose(INVITE/PASSWORD_RESET/EMAIL_CHANGE/DEVICE_APPROVE/CONSOLE_HANDOFF), tokenHash, expiresAt, usedAt |
| **LoginAttempt** | emailHash, ip, clientType, success, reason |
| **SsoConnection**, **SsoFailure**, **MfaFactor** | P2, per the platform M2 spec |
| **Permission** (platform, code-synced) | key PK, group, module, label, allowedScopes[], defaultScope, requires[], risk, feature, matrixRow, navItems[], seedFor |
| **Role** | key, name, isSystem, copiedFromRoleId, sortOrder, archivedAt |
| **RolePermission** | (roleId, permissionKey) PK, scopes[] |
| **UserRole** | (userId, roleId) PK, assignedById |
| **UserUiPrefs** | userId PK, sidebarCollapsed, lastRoute, density, wellnessLeaderboardOptIn, showBirthdayPublicly (mirrors Employee) |
| **NotificationType** (platform, code-synced) | key, module, category, default/mandatory channels, sourceLabel, templates |
| **Notification** | userId, typeKey, category, title, body, sourceLabel, actorUserId, link Json, eventAt, priority, dedupeKey (unique per user), readAt, resolvedAt, expiresAt |
| **NotificationPreference** | (userId, typeKey), inApp/email/whatsapp/push (P2) |
| **OutboundMessage** | channel, to, templateKey, status, providerMessageId, attempts, notificationId |
| **EmailSuppression** | P2 |
| **AuditEvent** (audit schema, monthly partitions) | tenantId?, seq, occurredAt, actorType(USER/PLATFORM_USER/SYSTEM/DEVICE/API), actorId, actorLabel, action, module, entityType, entityId, summary, changes (redacted), result(SUCCESS/DENIED/FAILURE), ip, ua, requestId, sessionId, prevHash, hash |
| **AuditAnchor** (platform) | tenantId, date, seq, hash |
| **FileObject** | purpose, classification, ownerType/ownerId, uploadedById, fileName, mime, sizeBytes, sha256, bucket, objectKey, status(PENDING_UPLOAD/UPLOADED/SCANNING/AVAILABLE/INFECTED/SCAN_ERROR/DELETED/PURGED), scan fields, encryption(SSE/TENANT_DEK), keyVersion, retentionUntil, legalHold |
| **SearchDocument** | (tenantId, entityType, entityId) PK, title, subtitle, keywords, body (P2), tsv, route, isPublic, requiredPermission, allowUserIds[], allowDeptIds[], allowProjectIds[], classification |
| **BrandingVersion** | version, status(DRAFT/PUBLISHED/ARCHIVED), presetKey, primaryHex, secondaryHex, logoFileId, faviconFileId, productName, tokens, contrastReport. Default theme in P1; editor P3. |
| **SupportAccessGrant**, **DataExportRequest** | P3 |
| **TenantKey**, **KeyRotation** (platform) | P3 |
| **PlatformUser**, **PlatformSession**, **TenantProvisioning**, **TenantUsageDaily**, **MrrSnapshot** (platform) | P3 |
| **Plan**, **PlanPrice**, **Subscription**, **SubscriptionChange**, **BillingProfile**, **PromoCode**, **PromoRedemption**, **SaasInvoice**, **SaasInvoiceLine**, **Payment**, **GatewayWebhookEvent**, **SalesLead** (platform) | P3; amounts in paise |
| **SupportTicket**, **SupportMessage** (platform) | P3; number from PlatformSequence `SUP` |
| **Statutory reference** (platform, read-only to app_user) | `StatutoryPfConfig`, `StatutoryEsiConfig`, `PtSlab`, `TaxRegimeConfig` (effectiveFrom/fy) |
| **StatutoryOverride** (tenant) | kind, effectiveFrom, payload; audited |
| **BiometricDeviceRegistry**, **UnclaimedBiometricDevice** (platform) | SN routing |
| **TrackerRelease**, **TrackerCrashReport**, **TrackerClientError** | platform / nullable tenant |

### 3.2 People (module `people/*`)

| Entity | Key fields / relations |
|---|---|
| **Department** | name citext unique, code unique, headEmployeeId, parentId, isActive |
| **Designation** | name, departmentId?, level |
| **Branch** | name, city, state, stateCode (GST/PT establishment), address, gstin |
| **Employee** | userId unique, empCode unique, first/last/fullName, preferredName, officialEmail unique, personalEmail, phone, gender, dateOfBirth, showBirthdayPublicly, bloodGroup, maritalStatus, photoFileId, photoStatus, pendingPhotoFileId, departmentId, designationId, branchId, managerId (self relation), mentorId?, employmentType, workMode, hybridOfficeDays Int[], workLocationId (→WorkLocation), status, joiningDate, probationEndDate, confirmedAt, noticePeriodDays, addresses Json, emergency*, resignationDate, lastWorkingDay, exitType, exitReason, exitedAt, sourceApplicationId, previousEmployeeId, searchVector |
| **EmployeeJobHistory** | employeeId, effectiveFrom/To, departmentId, designationId, managerId, employmentType, workMode, branchId, reason |
| **EmployeeCodeHistory** | employeeId, code unique, validFrom/To |
| **EmployeeStatutory** | employeeId unique, panEnc, panLast4, panBidx, aadhaarEnc, aadhaarLast4, uan, esicNo |
| **EmployeeBankAccount** | employeeId, holderName, accountNoEnc, accountLast4, ifsc, bankName, proofDocumentId, status(PENDING_VERIFICATION/VERIFIED/REJECTED/SUPERSEDED), verifiedBy/At. Partial unique: one VERIFIED and at most one PENDING. |
| **ExitCase**, **ExitChecklistItem** | per People M2 |
| **EmployeeImport** | fileId, status, options, counts, rowErrors, errorFileId |
| **EmployeeDocument** | employeeId, category, docType, title, fileId, version, isCurrent, supersedesId, source, verificationStatus, verifiedBy/At, rejectionReason, esignEnvelopeId, tags, expiresOn, visibility |
| **DocumentTypeRule** | (tenantId, docType) PK |
| **OnboardingTemplate**, **Onboarding** (employeeId unique, templateSnapshot, status, invite fields), **OnboardingStep** | per People M5 |
| **DocumentTemplate** | key, version, bodyHtml, mergeFields, signatureFields, status |
| **EsignEnvelope**, **EsignSigner**, **EsignEvent** | local provider in P1 |
| **Job**, **Candidate** (email unique), **Application** (candidateId+jobId unique, stage, score), **ApplicationStageEvent**, **CandidateDocument**, **InterviewRoundType**, **Interview**, **InterviewPanelist**, **Scorecard**, **Offer** | P2 |
| **KraTemplate**, **KraItem**, **AppraisalCycle**, **AppraisalParticipant**, **AppraisalRating** | P2 |
| **AssetCategory**, **Asset** (assetTag, serialNo unique, status, warrantyTill, currentAssigneeId → Employee, financePurchaseId?), **AssetAssignment**, **AssetRepair** | P1 |
| **WelcomeKitItem**, **WelcomeKitIssue** (employeeId unique), **WelcomeKitIssueLine** | P1 |
| **IdCardTemplate**, **IdCard** (serial, status, missingFields, png/pdf fileIds, dataSnapshot, verifyToken unique, printBatchId), **IdCardPrintBatch**, **IdCardSettings** | P1 |
| **VCardTemplate**, **VCardProfile** (publicSlug), **VCardShare** | P1 |

### 3.3 Time and attendance (module `time/*`)

| Entity | Key fields / relations |
|---|---|
| **WorkLocation** | name, code, type(OFFICE/REMOTE/CLIENT_SITE), branchId, address, stateCode, lat/lng, geoRadiusM, geoFenceWebPunch, punchMode(BIOMETRIC_ONLY/WEB_DESKTOP_ALLOWED/ANY), timezone, isSystem ("Remote"), archivedAt |
| **Shift** | name, code, startMinute, endMinute, graceMinutes, breakMinutes, weeklyOffDays[], weeklyOffPattern (P2), minFullDayMinutes(450), minHalfDayMinutes(240), earlyOutGraceMinutes, halfDayIfLateByMinutes, isDefault (partial unique) |
| **ShiftAssignment** | employeeId, shiftId, effectiveFrom/To; gist exclusion prevents overlaps |
| **ShiftOverride** | P2 |
| **HolidayCalendar** | name, year, stateCode, isDefault, optionalQuota, publishedAt |
| **Holiday** | calendarId, date, endDate?, name, type(MANDATORY/OPTIONAL) |
| **HolidayCalendarLocation** | calendarId, workLocationId, year; unique (location, year) |
| **OptionalHolidayChoice** | P2 |
| **BusinessCalendarSettings** | workdays, hours; used by helpdesk and support SLAs |
| **AttendancePolicy** | audience(OFFICE/REMOTE) unique. Fields: biometricMandatory, allowWebPunch, allowDesktopPunch, autoIdleEnabled, autoIdleMinutes, screenshotsEnabled, screenshotIntervalMinutes, blurScreenshots, screenshotAllMonitors, screenshotRetentionDays, deductIdleFromPayroll, idleDeductionMode, monthlyIdleAllowanceMinutes(60), idleClaimsAllowed, lateMarksPerPenalty, latePenaltyDays, latePenaltySource, earlyOutCountsAsLate, missedPunchAutoCloseHours, autoCloseAfterShiftEndMinutes(360), maxSessionHours(16), maxRegularizationsPerMonth, regularizationWindowDays, breakReminderMinutes, offlineRetentionDays(7), timesheetRequired, trackerRequired, punchInReminder, requireHrDeviceApproval, version |
| **AttendancePolicyVersion** | snapshot per version |
| **TenantTimesheetSettings** | weekStartsOn, splitAtMonthEnd, submitDue, skipDuplicateApprover, fallbackApproverId, l1/l2SlaHours |
| **TrackerTenantSettings** | consentVersion, consentText, updateChannel, pinnedVersion (P3) |
| **AttendancePunch** | employeeId, attendanceDate, punchedAt, direction, source(BIOMETRIC/WEB/DESKTOP/MOBILE/REGULARIZATION/SYSTEM), status(ACCEPTED/REJECTED/SUPERSEDED), rejectReason, geo fields, trackerDeviceId, biometricDeviceId, regularizationId, clientEventId (unique per source), clockAdjusted |
| **WorkSession** | employeeId, attendanceDate, inPunchId, outPunchId, startedAt, endedAt, source, trackerDeviceId?, lastHeartbeatAt, status(OPEN/CLOSED/AUTO_CLOSED/REJECTED_CONFLICT), closeReason, autoClosed. Partial unique: one OPEN per employee. |
| **AttendanceDay** | employeeId+date unique, shiftId, effectiveMode, locationId, expected window, firstIn, lastOut, primarySource, sourcesMask, gross/break/active/idle/idleAsWork/worked minutes, lateBy, isLate, lateExcused, isEarlyOut, status(DayStatus), presentFraction, leaveFraction, leaveTypeCode, idleDeductibleMinutes, isLocked, override fields |
| **AttendanceRegularization** | type, requested in/out, reason, attachmentFileId, status, approverId, decision fields, autoRaisedFrom(TRACKER_CONFLICT/PERIOD_LOCKED)? |
| **PeriodLock** | month unique, lockedUpTo, lockedById, payrollRunId?, unlockedAt, unlockReason |
| **BiometricDevice** | serialNumber, name, locationId, model, firmware, directionMode, timezone, commKeyHash, allowedIpCidr, attLogStamp, lastSeenAt, status |
| **BiometricEnrollment** | employeeId unique, pin unique |
| **BiometricRawLog** | deviceId, pin, punchedAtLocal, punchedAt, codes, raw, processed, punchId, error |
| **IdCardCheck** | employeeId+date unique, locationId, checkedAt, wearing, photoFileId, method(BADGE_SCAN/MANUAL_PICK), loggedById |

### 3.4 Desktop tracker (module `tracker/*`)

| Entity | Key fields / relations |
|---|---|
| **TrackerDevice** | userId, employeeId, hostname, osPlatform, osVersion, arch, appVersion, machineIdHash, publicKey (Ed25519), status(ACTIVE/REVOKED/UNPAIRED), approvalMethod, approvedById, pairedAt, consentVersion, consentAt, displays, settings Json, lastSeenAt, lastSyncAt, queueDepth, revoke fields, syncGraceUntil. Partial unique (user, machine) WHERE ACTIVE. |
| **DevicePairingRequest** | userId, codeHash, status(PENDING/AWAITING_HR/APPROVED/CLAIMED/REJECTED/EXPIRED/CANCELLED), device descriptors, publicKey, permissions[], emailTokenHash, attempts, expiresAt, approval fields, deviceId |
| **TrackerEvent** (monthly partitions) | employeeId, deviceId, workSessionId, clientEventId (unique per device), seq, bootId, monoMs, type(TrackerEventType), clientTs, offsetMs, correctedTs, payload, prevHash, hash, policyVersion, status, rejectReason |
| **ActivitySegment** (projection) | deterministic id, employeeId, workSessionId, deviceId, workDate, kind(ACTIVE/BREAK/IDLE), idleCause, idleResolution(PENDING/CLAIMED_WORK/AS_BREAK/DEDUCTED/AUTO_DEDUCTED), taskId, projectId, startAt, endAt, durationSec, samples, outsideShift, flags[] |
| **IdleClaim** | employeeId, startEventId unique, workSessionId, workDate, start/end, minutes, taskId, projectId, note, reviewerId, status(PENDING/APPROVED/REJECTED), decision fields, timesheetId |
| **Screenshot** | employeeId, deviceId, workSessionId, clientEventId unique, capturedAt, workDate, taskId, projectId, inIdle, storageKey, thumbKey, sha256, bytes, width, height, displays, blurred, status(PENDING_UPLOAD/UPLOADED/PROCESSED/FAILED/LOST/PURGED), purgeAfter, legalHold |
| **ScreenshotView** | screenshotId, viewerId, viewedAt |
| **TrackerDaySummary** | employeeId+workDate unique, firstInAt, lastOutAt, sessions, activeSec, claim*Sec, workedDisplaySec, workedPayableSec, breakSec, idleDeductedSec, idlePendingSec, screenshotCount, activityPct, perTask Json, timeline Json, integrityFlagCount, confirmedAt, lastProjectedAt |
| **TrackerIntegrityEvent** | type, severity, occurredAt, details, acknowledged fields |

### 3.5 Timesheets and approvals (module `timesheet/*`)

| Entity | Key fields / relations |
|---|---|
| **Timesheet** | employeeId, weekStart, periodStart unique per employee, periodEnd, status, cycle, submittedAt, approvedAt, lockedAt, payrollRunId, minute totals, screenshotCount, hasLateData, version |
| **TimesheetLine** | timesheetId, projectId, taskId (standing tasks included), labelSnapshot, subLabelSnapshot, billable, isManual |
| **TimesheetCell** | lineId+date unique, trackedMinutes, idleAsWorkMinutes, outsideHoursMinutes, adjustmentMinutes, finalMinutes, billedInvoiceLineId? (lock) |
| **TimesheetIdleDay** | timesheetId+date, idleMinutes (deducted and pending) |
| **TimesheetAdjustment** | cellId, from, to, delta, kind(MANUAL_INCREASE/MANUAL_DECREASE/REALLOCATION), reason, reviewStatus |
| **OutsideHoursEntry** | timesheetId, projectId, taskId, taskText, date, start/end, minutes, reason, reviewStatus |
| **TimesheetEvent** | history |
| **TimesheetApprovalStep** | timesheetId, cycle, level(1/2), projectId?, approverId, status(StepStatus), actedById, actedAt, comment, dueAt, escalatedAt; unique (timesheet, cycle, level, project) |
| **ApprovalDelegation** | P2 |

### 3.6 Leave (module `leave/*`)

| Entity | Key fields / relations |
|---|---|
| **LeaveSettings** | tenantId PK; fields per Leave L2 |
| **LeaveType** | code unique; fields per Leave L2 |
| **LeaveCreditRule** | leaveTypeId, employmentType, frequency, daysPerPeriod, prorate, effective dates |
| **LeaveCreditBatch** | unique (type, leaveTypeId, periodKey) |
| **LeaveLedgerEntry** | append-only; employeeId, leaveTypeId, leaveYear, txType, days signed, requestId, compOffGrantId, batchId |
| **LeaveBalance** | employee/type/year unique, opening, accrued, credited, availed, pending, lapsed, encashed, entitlement, available, version |
| **LeaveRequest** | requestNo, employeeId, leaveTypeId, from/to + sessions, total/paid/lop/sandwich days, reason, attachmentFileId, status, approverId, approverSource, notifyUserIds, decision/cancel/escalation fields, touchesLockedPeriod, version |
| **LeaveRequestDay** | date, session, dayKind, units, isSandwich, isPaid, leaveYear, active |
| **CompOffGrant**, **CompOffConsumption** | per Leave L4 |
| **LeaveEncashment** | P2 |

### 3.7 Payroll (module `payroll/*`)

| Entity | Key fields / relations |
|---|---|
| **PayrollSettings** | payDayDivisor, idleDeductionDefault, idleReducesStatutoryWages, rounding, requireApproval, publishPayslipsOn, PF/ESI/TAN/PT registrations, applyWageCode50Rule, internStatutory, encashmentDivisor, bankFileFormat, debit account (encrypted), payslipTemplateKey. There is **no idle grace** here (D12). |
| **SalaryComponent**, **SalaryTemplate**, **SalaryTemplateLine** | per Payroll P1 |
| **EmployeeSalary** | employeeId+effectiveFrom unique, ctcAnnualPaise, grossMonthlyPaise, payType, templateId, status, reason, sourceRef |
| **EmployeeSalaryLine** | componentCode, monthlyPaiseEnc (encrypted), annualPaiseEnc |
| **EmployeePayrollProfile** | employeeId unique, payType, pf/esi/pt settings, taxRegime, taxRegimeLockedFy, paymentMode, payrollHold, idleDeductionExempt. Bank details and PAN are **read from People** (`EmployeeBankAccount` VERIFIED, `EmployeeStatutory`) and not duplicated. |
| **TaxDeclaration** | employee+fy unique |
| **EsiCoverage** | per ESI contribution period |
| **EmployeeTaxYtd** | per employee, fy, month, run |
| **PayrollRun** | runNo, period, runType(REGULAR/SUPPLEMENTARY/OFF_CYCLE), parentRunId, status, attendanceLockDate, includeIdleDeduction, pendingTimesheetMode, paymentDate, calcVersion, KPI totals in paise. Partial unique on active REGULAR per period. |
| **PayrollItem** | runId+employeeId unique, calcVersion, status, timesheetGate, day counts, idle minutes, rates, amounts (paise; encrypted in P3), trace, errors, holdReason |
| **PayrollItemLine** | componentCode, label, kind, fullAmountPaise, amountPaise, arrearForPeriod, adjustmentId |
| **PayrollAdjustment** | unique (sourceType, sourceId, type, forPeriod) |
| **Payslip** | itemId unique, status(DRAFT/PUBLISHED/VOID), version, fileId, sha256, summary figures, timestamps |
| **BankTransferFile**, **BankTransferEntry** | per Payroll P6 |
| **PayrollLedgerPosting** | runId, kind(ACCRUAL/PAYMENT/REVERSAL), idempotencyKey, payload, voucherId, status(PENDING/POSTED/FAILED/SKIPPED_NO_LEDGER) |
| **PayrollAccountMapping** | optional override |

### 3.8 Work (module `work/*`)

| Entity | Key fields / relations |
|---|---|
| **Client** | code, name, legalName, isInternal, gstRegType, gstin, pan, address, stateCode, countryCode, defaultRatePerHourPaise, paymentTermsDays, billingEmails, receivableAccountId, status |
| **ClientContact** | clientId |
| **Project** | clientId, key unique (2–6 A–Z), name, category, techStack, leadEmployeeId, start, deadline, billable, ratePerHourPaise, estimatedMinutes, status, health, healthReason, progressPct, cached minutes, git fields, qaHandoff, taskSeq, archiveAccess, closedAt, archivedAt |
| **ProjectModule**, **ProjectMember** (employeeId, projectRole, allocationPct, from/to) | |
| **ProjectDocument** | projectId or clientId, fileId, kind, version |
| **TenantWorkSettings** | |
| **TeamBoard** | projectId+departmentId unique, leadEmployeeId |
| **BoardMember** | boardId+employeeId |
| **Task** | key unique, projectId, boardId, moduleId, number, title, type, priority, status, rank (LexoRank), assigneeEmployeeId, reporterId, estimatedMinutes, loggedMinutes, dueDate, parentTaskId, isStanding, git fields, status timestamps, version |
| **TaskTransition**, **TaskComment**, **TaskAttachment** | |
| **GitIntegration** | tokenCiphertext, patterns, etc. |
| **GitWebhookDelivery**, **GitCommitLink**, **GitSyncJob** | |
| **ArchiveSnapshot** | P2 |
| **InternTask**, **InternWeekSummary** | P2 |

### 3.9 Finance (module `finance/*`, P2)

| Entity | Key fields / relations |
|---|---|
| **FinanceSettings** | seeded from TenantSettings; bank details for PDF, LUT, booksLockedUpTo, invoiceNumberPattern |
| **Invoice** | number, fy, clientId, projectId, period, dates, placeOfSupply, supplyType, seller/buyer snapshots, subtotal/cgst/sgst/igst/roundOff/total/received/tds/writtenOff/balance (paise), status, email fields, pdfFileId, salesVoucherId, IRN fields, version |
| **InvoiceLine** | sac, minutes, ratePaise, taxable, gstRateBp, taxes, lineTotal |
| **InvoiceTimeEntry** | invoiceLineId, **timesheetCellId unique**, minutes |
| **InvoicePayment**, **CreditNote**, **InvoiceEmail** | |
| **Vendor**, **PurchaseCategory** | |
| **Purchase** | vendorId, vendorInvoiceNo+fy unique, billDate, categoryId, amounts in paise, gstRateBp, itcEligible, itcPeriod, paymentMode, billFileId, OCR fields, status, voucherId |
| **BillExtraction** | |
| **Account** | code, name, type, parentId, isGroup, systemKey unique, partyType/partyId unique, opening |
| **Voucher** | number, type, date, fy, narration, sourceType, sourceId (unique with reversalOfId), employeeId, status, reversal links |
| **VoucherLine** | accountId, debitPaise, creditPaise; CHECK one side, deferred Σ trigger |
| **FilingFolder**, **FilingDocument** | |
| **GstReturn**, **ComplianceItem** | |

### 3.10 Workplace and culture (module `workplace/*`)

| Entity | Key fields / relations |
|---|---|
| **AudienceRule** (embedded as child rows per owner) | `NoticeAudience`, `EventAudience`, `PolicyAudience`, `CourseAssignment` |
| **Quote**, **PersonalTodo**, **CompanyEvent**, **EventAudience** | |
| **Notice**, **NoticeAudience**, **NoticeAttachment**, **NoticeRecipient** | |
| **Post**, **PostImage**, **PostLike**, **PostComment** | |
| **Badge**, **Kudos**, **EotmAward** (month unique) | |
| **Certificate** | type(EOTM/COURSE), verificationCode unique, fileId, sha256, status, source |
| **Channel** | kind, name, linkedType/linkedId unique, dmKey unique, postingPolicy, lastMessageSeq |
| **ChannelMember** | lastReadSeq, role, muted, notifyLevel, managedBy |
| **Message** | channelId+seq unique, senderId+clientMsgId unique, body (encrypted in P3), bodyTsv, mentions |
| **MessageAttachment** | |
| **Call**, **CallParticipant**, **CallRecording**, **ChatSettings** | |
| **SupportGroup**, **SupportGroupMember**, **TicketCategory**, **SlaPolicy** | |
| **Ticket** | number HD-, SLA fields, escalation fields |
| **TicketComment**, **TicketAttachment** | |
| **Course**, **Lesson**, **CourseAssignment**, **Enrollment**, **LessonProgress** | |
| **Room**, **RoomBooking** (gist no-overlap), **Visitor**, **VisitorPass**, **PassDelivery** | |
| **Policy**, **PolicyAudience**, **PolicyVersion**, **PolicyAckRequirement** | |
| **WellnessSettings**, **GameSession**, **LeaderboardWeek** | |
| **Camera** (rtspUrlEnc), **CameraViewSession** | |

### 3.11 Canonical enums (in `packages/shared/src/enums.ts`, mirrored in Prisma)

**Roles and identity**
- `RoleKey`: employee, lead, manager, hr, admin (seeded; custom roles use slugs).
- `PlatformRole`: OWNER BILLING SUPPORT ENGINEER.
- `Scope`: OWN PROJECT TEAM DEPARTMENT ALL.
- `UserStatus`: INVITED ACTIVE LOCKED DISABLED.
- `ClientType`: WEB MOBILE DESKTOP.

**Tenancy and billing**
- `TenantStatus`: PROVISIONING PROVISION_FAILED ACTIVE READ_ONLY SUSPENDED CANCELLED DELETED.
- `TenantKind`: OPERATOR CUSTOMER DEMO.
- `SubStatus`: FREE ACTIVE PENDING_PAYMENT PAST_DUE READ_ONLY SUSPENDED CANCELLED.

**People**
- `EmployeeStatus`: INVITED ONBOARDING ACTIVE NOTICE EXITED CANCELLED.
- `EmploymentType`: FULL_TIME INTERN CONTRACT PART_TIME CONSULTANT.
- `WorkMode`: OFFICE REMOTE HYBRID.

**Time and attendance**
- `PolicyAudience`: OFFICE REMOTE.
- `PunchSource`: BIOMETRIC WEB DESKTOP MOBILE REGULARIZATION SYSTEM.
- `DayStatus`: PENDING PRESENT HALF_DAY ABSENT LEAVE HALF_DAY_LEAVE HOLIDAY WEEKLY_OFF HOLIDAY_WORKED WEEKLY_OFF_WORKED MISSED_PUNCH.
- `RequestStatus` (regularizations): PENDING APPROVED REJECTED CANCELLED.

**Tracker**
- `TrackerMode`: PUNCH MONITOR_ONLY DISABLED.
- `SegmentKind`: ACTIVE BREAK IDLE.
- `IdleResolution`: PENDING CLAIMED_WORK AS_BREAK DEDUCTED AUTO_DEDUCTED.
- `ClaimStatus`: PENDING APPROVED REJECTED.

**Timesheets**
- `TimesheetStatus`: DRAFT SUBMITTED PENDING_RM APPROVED RETURNED LOCKED.
- `StepStatus`: PENDING APPROVED RETURNED SKIPPED_SELF SKIPPED_DUPLICATE SKIPPED_NO_LINES CANCELLED.
- `ReviewStatus` (items): NOT_REQUIRED PENDING_PL ACCEPTED REJECTED.

**Leave**
- `LeaveRequestStatus`: PENDING APPROVED REJECTED WITHDRAWN CANCELLATION_PENDING CANCELLED.

**Payroll**
- `PayrollRunStatus`: DRAFT CALCULATING CALCULATED PENDING_APPROVAL APPROVED FINALIZING FINALIZED PAID CANCELLED FAILED.
- `PayrollItemStatus`: READY TIMESHEET_PENDING EXCLUDED ON_HOLD ERROR STALE FINALIZED PAID PAYMENT_FAILED.
- `TimesheetGate`: NOT_REQUIRED APPROVED SUBMITTED PENDING_RM RETURNED NOT_SUBMITTED.
- `PayslipStatus`: DRAFT PUBLISHED VOID.

**Work and finance**
- `TaskStatus`: OPEN ALLOTTED WIP DEV_COMPLETED QA DONE CANCELLED.
- `ProjectStatus`: PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED CANCELLED.
- `ProjectHealth`: NA ON_TRACK AT_RISK OFF_TRACK.
- `InvoiceStatus`: DRAFT ISSUED EMAILED PARTIALLY_PAID PAID CANCELLED (overdue is derived).
- `SupplyType`: INTRA INTER EXPORT_LUT EXPORT_WITH_TAX SEZ_LUT SEZ_WITH_TAX.
- `VoucherType`: PAYMENT RECEIPT JOURNAL HR SALES PURCHASE CONTRA CREDIT_NOTE PAYROLL.

**Workplace**
- `TicketStatus`: OPEN IN_PROGRESS WAITING_ON_REQUESTER RESOLVED CLOSED CANCELLED.
- `SlaState`: ON_TRACK AT_RISK BREACHED MET.
- `NoticeStatus`: DRAFT SCHEDULED PUBLISHED EXPIRED ARCHIVED.
- `PostStatus`: DRAFT PENDING_REVIEW PUBLISHED ARCHIVED.

**Files and data**
- `FileStatus`: PENDING_UPLOAD UPLOADED SCANNING AVAILABLE INFECTED SCAN_ERROR DELETED PURGED.
- `DataClass`: PUBLIC_BRANDING INTERNAL CONFIDENTIAL RESTRICTED.
- Restricted categories: CHAT SALARY PERSONAL_DOC.

**Notifications and audit**
- `NotifCategory`: APPROVAL REMINDER INFO SECURITY BILLING SYSTEM CELEBRATION.
- `Channel`: IN_APP EMAIL WHATSAPP PUSH.
- `ActorType`: USER PLATFORM_USER SYSTEM DEVICE API.
- `AuditResult`: SUCCESS DENIED FAILURE.

**File purposes (registry)**

| Group | Purposes |
|---|---|
| Branding and people | AVATAR, BRAND_LOGO, EMPLOYEE_DOCUMENT, OFFER_LETTER, SIGNED_DOCUMENT, ID_PHOTO, ID_CARD_RENDER, VCARD_RENDER, IDCHECK_PHOTO, RESUME, CANDIDATE_DOC |
| Payroll and finance | PAYSLIP_PDF, BANK_FILE, INVOICE_PDF, CREDIT_NOTE_PDF, PURCHASE_BILL, FILING_DOC, GST_RETURN |
| Work and content | POLICY, COURSE_VIDEO, LESSON_DOC, CERTIFICATE, PROJECT_DOCUMENT, NOTICE_ATTACHMENT, POST_IMAGE, TICKET_ATTACHMENT, CHAT_ATTACHMENT, CALL_RECORDING, VISITOR_PHOTO |
| System | IMPORT_CSV, EXPORT, SUPPORT_ATTACHMENT (platform bucket) |

Screenshots are outside the registry (D18).

---

## 4. Permission catalogue (seeded defaults)

Legend: E = employee, L = lead, M = manager, H = hr, A = admin. `[X]` is the seeded scope. Unscoped keys are boolean. The admin role holds every key with ALL scope except `platform.console.link`. The lead, manager and hr roles each start as a copy of employee plus their own grants. "Implicit own" means self-access that needs no key (own profile, documents, payslips, compensation, screenshots, badges).

### Home

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | dashboard |
| feed.view, feed.engage | ✓ | ✓ | ✓ | ✓ | ✓ | feed |
| feed.post.submit | | ✓ | ✓ | | | review queue |
| feed.post.publish, feed.moderate | | | | ✓ | ✓ | |
| notices.view | ✓ | ✓ | ✓ | ✓ | ✓ | notices |
| notices.publish.team | | [PROJECT] | [TEAM,DEPARTMENT] | [ALL] | [ALL] | **Publish team notices** |
| notices.publish.global, notices.manage | | | | ✓ | ✓ | **Publish global notices** |
| quotes.manage, events.manage | | | | ✓ | ✓ | |
| chat.use, chat.calls.start | ✓ | ✓ | ✓ | ✓ | ✓ | chat |
| chat.channel.create | | ✓ | ✓ | ✓ | ✓ | |
| chat.channel.manage, chat.announce.post, chat.calls.record | | | | ✓ | ✓ | |
| chat.retention.manage | | | | | ✓ | |

### Time

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| attendance.self (punch, view, regularize request) | ✓ | ✓ | ✓ | ✓ | ✓ | attendance, header punch |
| attendance.view | | [PROJECT] | [TEAM] | [ALL] | [ALL] | team view |
| attendance.regularize.approve | | | [TEAM] | [ALL] | [ALL] | approvals tab |
| attendance.manage (override, recompute) | | | | ✓ | ✓ | |
| attendance.lock, attendance.lock.override | | | | ✓ | ✓ | |
| attendance.unlock | | | | | ✓ | |
| attendance.policy.manage (incl. tracker policy) | | | | ✓ | ✓ | settings |
| idcompliance.view, idcompliance.log | | | | ✓ | ✓ | idcompliance (+ custom Security desk: log) |
| biometric.manage | | | | ✓ | ✓ | locations drawer |
| tracker.use (plus policy eligibility) | ✓ | ✓ | ✓ | ✓ | ✓ | desktop sign-in |
| devices.self | ✓ | ✓ | ✓ | ✓ | ✓ | profile Devices |
| devices.manage | | | | ✓ | ✓ | |
| tracker.activity.view | [OWN] | [PROJECT] | [TEAM] | [ALL] | [ALL] | timeline |
| screenshots.view | [OWN] | [PROJECT] | [TEAM] | — | [ALL] | |
| screenshots.manage (delete, legal hold) | | | | | ✓ | |
| tracker.idleclaim.review | | [PROJECT] | [TEAM] | | [ALL] | |
| tracker.integrity.view | | [PROJECT] | [TEAM] | [ALL] | [ALL] | |
| timesheet.self | ✓ | ✓ | ✓ | ✓ | ✓ | timesheet |
| timesheet.approve.l1 | | [PROJECT] | [PROJECT] | | [ALL] | approvals; **Approve timesheets** |
| timesheet.approve.l2 | | | [TEAM] | | [ALL] | approvals; **Approve timesheets** |
| timesheet.approve.override | | | | | ✓ | |
| timesheet.view.all (hours only) | | | | ✓ | ✓ | payroll |
| leave.self (apply, cancel, comp-off request) | ✓ | ✓ | ✓ | ✓ | ✓ | leave |
| leave.approve (routing by approverId) | | [TEAM] | [TEAM] | [ALL] | [ALL] | dashboard card |
| leave.setup.manage, leave.credit, holidays.manage | | | | ✓ | ✓ | leaveAdmin |

### Work

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| projects.view | [PROJECT] | [PROJECT] | [ALL] | [PROJECT] | [ALL] | projects |
| projects.create | | ✓ | ✓ | | ✓ | |
| projects.manage | | [PROJECT] | [ALL] | | [ALL] | |
| clients.view | | ✓ | ✓ | | ✓ | |
| clients.manage | | | ✓ | | ✓ | |
| tasks.board.view | [OWN] | [OWN] | [ALL] | [OWN] | [ALL] | kanban; **View all task boards** = ALL |
| tasks.create | ✓ | ✓ | ✓ | ✓ | ✓ | |
| tasks.move | [OWN] | [PROJECT] | [ALL] | [OWN] | [ALL] | |
| tasks.manage, boards.allocate | | [PROJECT] | [ALL] | | [ALL] | |
| archive.view | | ✓ | ✓ | | ✓ | archive |
| archive.manage | | | ✓ | | ✓ | |
| archive.view.shared | — | — | — | — | — | not seeded |
| interns.assign | | [TEAM] (mentees) | | [ALL] | [ALL] | interns |
| integrations.gitlab.manage | | | | | ✓ | admin/integrations |

### People

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| directory.basic | ✓ | ✓ | ✓ | ✓ | ✓ | search, mentions |
| employees.view | | | [TEAM] | [ALL] | [ALL] | employees, profile |
| employees.view.sensitive | | | | ✓ | ✓ | |
| employees.manage (create, import, lifecycle) | | | | ✓ | ✓ | |
| employees.compensation.view | | | | ✓ | ✓ | Offer & pay |
| masters.manage | | | | ✓ | ✓ | |
| roles.assign | | | | ✓ | ✓ | |
| onboarding.self | ✓ | ✓ | ✓ | ✓ | ✓ | onboarding |
| onboarding.manage, esign.send, documents.verify | | | | ✓ | ✓ | |
| shifts.manage, locations.manage | | | | ✓ | ✓ | shifts, locations |
| appraisal.self | ✓ | ✓ | ✓ | ✓ | ✓ | (no nav) |
| appraisal.view | | | [TEAM] | [ALL] | [ALL] | appraisal |
| appraisal.review | | | [TEAM] | | [ALL] | |
| appraisal.manage | | | | ✓ | ✓ | |
| recruitment.jobs.manage | | | | ✓ | ✓ | jobs |
| recruitment.candidates.view, recruitment.candidates.manage | | [DEPARTMENT] | | [ALL] | [ALL] | candidates; **Recruitment** |
| recruitment.interviews.view | | [DEPARTMENT] | [OWN] (panel) | [ALL] | [ALL] | interviews |
| recruitment.interviews.schedule | | [DEPARTMENT] | | [ALL] | [ALL] | **Recruitment** |
| recruitment.interviews.score | | [OWN] | [OWN] | [ALL] | [ALL] | |
| recruitment.offers.manage | | | | ✓ | ✓ | |

### Finance

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| payslips.self | ✓ | ✓ | ✓ | ✓ | ✓ | payslips |
| payroll.view, payroll.run, payroll.salary.manage, payroll.settings.manage, payslips.view.all | | | | ✓ | ✓ | payroll; **Payroll & ledger** |
| payroll.approve, payroll.reopen | | | | | ✓ | |
| ledger.view, ledger.post, ledger.reverse, ledger.period.lock, ledger.coa.manage | | | | | ✓ | ledger; **Payroll & ledger** |
| ledger.hrvoucher | | | | ✓ | ✓ | ledger (HR vouchers tab only; D23) |
| invoices.manage, invoices.tax.override | | | | | ✓ | invoices |
| purchases.manage | | | | | ✓ | purchases |
| filing.manage, gst.returns.manage, finance.settings.manage | | | | | ✓ | filing |

### Workplace

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| vault.self, vcard.self, idcard.self | ✓ | ✓ | ✓ | ✓ | ✓ | vault, vcard |
| vault.manage, idcard.manage, vcard.template.manage | | | | ✓ | ✓ | idcard |
| assets.view | [OWN] | [OWN] | [TEAM] | [ALL] | [ALL] | |
| assets.manage, welcomekit.manage | | | | ✓ | ✓ | assets, welcomekit |
| policies.view | ✓ | ✓ | ✓ | ✓ | ✓ | policies |
| policies.manage | | | | ✓ | ✓ | |
| helpdesk.raise | ✓ | ✓ | ✓ | ✓ | ✓ | helpdesk |
| helpdesk.work (plus group membership), helpdesk.view.all, helpdesk.admin | | | | ✓ | ✓ | |
| helpdesk.escalation.receive | | ✓ | ✓ | ✓ | ✓ | dashboard card |
| lms.learn | ✓ | ✓ | ✓ | ✓ | ✓ | lms |
| lms.manage | | | | ✓ | ✓ | |
| kudos.view | ✓ | ✓ | ✓ | ✓ | ✓ | kudos |
| kudos.give | | ✓ | ✓ | ✓ | ✓ | |
| kudos.eotm, badges.manage, certificates.manage | | | | ✓ | ✓ | |
| facility.book, facility.visitor.register | ✓ | ✓ | ✓ | ✓ | ✓ | facility |
| facility.frontdesk, facility.manage | | | | ✓ | ✓ | |
| cctv.view | | | | | ✓ | cctv; **CCTV feeds** |
| cctv.manage | | | | | ✓ | |
| wellness.play | ✓ | ✓ | ✓ | ✓ | ✓ | wellness |
| wellness.manage | | | | ✓ | ✓ | |

### Admin and SaaS

| Key | E | L | M | H | A | Nav / matrix |
|---|---|---|---|---|---|---|
| notifications.self, search.use | ✓ | ✓ | ✓ | ✓ | ✓ | notif |
| mobile.access | | | | ✓ | ✓ | **Mobile app access** |
| roles.manage, security.manage, audit.view, tenant.settings.manage | | | | | ✓ | roles, admin/security, admin/audit |
| billing.manage, branding.manage, privacy.view, privacy.manage, support.request | | | | | ✓ | billing, whitelabel, privacy, support |
| platform.console.link | — | — | — | — | — | tenants (OPERATOR tenant only; auto-granted) |

**Dependencies (`requires`):**

| Key | Requires |
|---|---|
| payroll.run | employees.compensation.view, timesheet.view.all |
| payroll.approve | payroll.view |
| invoices.manage | clients.view |
| screenshots.view | tracker.activity.view (same or wider scope) |
| cctv.manage | cctv.view |
| helpdesk.work | helpdesk.raise |

**High-risk keys** (confirm dialog; denied attempts audited): mobile.access, payroll.*, ledger.*, cctv.*, roles.manage, screenshots.*, employees.view.sensitive, privacy.manage.

**Matrix row rules**
- Rows are tri-state over their keys.
- "Approve timesheets" uses **any** mode: it shows ✓ if the role holds l1 or l2. Clicking opens a level picker.
- "Payroll & ledger" shows **partial** for HR (D23).
- "Recruitment" keys: candidates.view/manage and interviews.schedule. The manager's `interviews.view [OWN]` is not part of this row, so the M column stays empty as in the wireframe.

**Demo custom roles:**
- Security desk: employee defaults plus idcompliance.log, facility.frontdesk.
- Facility Manager: employee defaults plus facility.*, cctv.view.
- IT desk: helpdesk.work in the IT desk group.

**Entitlement features (P3):**

| Plan | Features |
|---|---|
| FREE | core.attendance_web, core.leave, core.projects, core.tasks, core.timesheet, core.people_basic, core.home, core.policies, core.helpdesk, core.vault, chat_text |
| GROWTH | FREE plus payroll, finance, tracker_desktop, whitelabel, recruitment, appraisal, assets, idcard, lms, kudos, facility, wellness, chat_calls, sso_oidc, audit_export |
| ENTERPRISE | GROWTH plus dedicated_db, cctv, biometric_integration, support_24x7, sso_saml, byok |
| INTERNAL | all features |

Each permission row carries its `feature`.

---

## 5. Cross-domain event and contract table

Transport: outbox events (async, idempotent) unless the Contract column says **sync**. A sync contract is an in-process service call made inside the caller's transaction or request.

### 5.1 Core pay chain: tracker → attendance → timesheet → approvals → payroll → ledger

| # | Producer | Event / contract | Key payload | Consumers → effect |
|---|---|---|---|---|
| 1 | Tracker ingest | **sync** `Attendance.recordPunch({employeeId, intent, at, source:DESKTOP, deviceId, clientEventId})` | — | Attendance → AttendancePunch plus WorkSession open or close. Checks are enforced here: policy, biometric-only location, leave, period lock. |
| 2 | Attendance | `attendance.state.changed` | employeeId, state, sessionStart, source | Realtime → web header, dashboard, tracker `/tracker` (attach or stop). Wellness break-only gate. |
| 3 | Tracker projection | `tracker.day.updated` | employeeId, workDate, workedPayableSec, breakSec, idleDeductedSec, idlePendingSec, perTask[], screenshotCount | Attendance → recompute-day (tracker columns, idle); Timesheet → `timesheet.build` (cells via largest-remainder rounding, idle row, late-data flag); Work → Task.loggedMinutes, first log auto ALLOTTED→WIP, project health. |
| 4 | Tracker | `idle.claim.created` / `idle.claim.decided` | claimId, reviewerId, minutes, decision | Timesheet approvals → review items count; Notifications → reviewer and employee; Tracker → re-project; Payroll → IDLE_REVERSAL/RECOVERY adjustment if the period is finalized. |
| 5 | Tracker | `tracker.integrity.flagged` (HIGH) | employeeId, type, workDate | Notifications → RM and HR; Timesheet L2 → approval blocked until acknowledged. |
| 6 | Attendance | `attendance.day.updated` | employeeId, date, status | Dashboard invalidate; Payroll → item STALE if run CALCULATED and the date is ≤ lockDate (override path only). |
| 7 | Attendance | `attendance.compoff.eligible` | employeeId, date, fraction | Leave → comp-off request prefill plus notification. |
| 8 | Timesheet | `timesheet.submitted` | timesheetId, employeeId, cycle, projectIds | Approvals → L1 steps (approver from **sync** `TaskDirectory.getProjectLead`), notify PLs, `approvals.counts`. |
| 9 | Timesheet | `timesheet.l1.approved` | timesheetId, projectId, cellIds | Tracker → pending idle claims for that project become APPROVED; Finance → cells billable in `BillableTimeView`. |
| 10 | Timesheet | `timesheet.returned` | timesheetId, comment | Employee notification; Finance → draft invoices that reserve these cells need recalculation. |
| 11 | Timesheet | `timesheet.approved` | timesheetId, employeeId, period, perLine[{projectId, taskId, billable, minutes}], idleMinutes | Payroll → WAIT-mode item auto-recalculates; Attendance → final idle drives the idle-deductible recompute; Work → logged hours confirmed. |
| 12 | Payroll | **sync** `PeriodLockService.lock(month, upTo, runId)`, then `attendance.period.locked` | month, upTo | Attendance, Timesheet, Leave and Tracker → reject dated mutations with 409 PERIOD_LOCKED (tracker events → auto regularization request). |
| 13 | Payroll | **sync** `/internal` ports: `Attendance.payrollInput(month)`, `Timesheet.gate(...)`, `Leave.getApprovedDays`, `Shift.netMinutes` | — | Payroll calc. |
| 14 | Leave | `leave.request.approved` / `leave.request.cancelled` | requestId, employeeId, days[] | Attendance → recompute days (LEAVE); Payroll → STALE (CALCULATED run) or LOP_REVERSAL/RECOVERY adjustment (finalized run); Dashboard; Tracker `/leave/me/today`. |
| 15 | Payroll | `payroll.run.finalized` | runId, period, totals (aggregated), employeeIds | Timesheet → LOCKED; Attendance → days isLocked, late penalty debit via **sync** `LeaveService.debit`; Payslips publish; Ledger → PAYROLL accrual voucher (queued SKIPPED_NO_LEDGER before M13, then replayed); Notifications. |
| 16 | Payroll | `payroll.run.paid` / `payroll.bankfile.reconciled` | runId, fileId, amountPaise | Ledger → PAYMENT voucher (Dr Salary payable / Cr Bank). |
| 17 | Payroll | `payslip.published` | payslipId, employeeId | Notification (link only, no amounts). |
| 18 | Payroll | `payroll.fnf.settled` (P2) | employeeId | People → exit checklist FNF_SETTLEMENT done. |

### 5.2 Billing chain: invoice → ledger

| Producer | Event | Consumers → effect |
|---|---|---|
| Finance | `invoice.issued` {invoiceId, cellIds} | Ledger SALES voucher; **sync** `Timesheet.markBilled(cellIds)`; Filing (PDF into Sales invoices); Project billing tab |
| Finance | `invoice.payment.recorded` | Ledger RECEIPT (Dr Bank, Dr TDS receivable, Cr Debtor) |
| Finance | `invoice.cancelled` | Ledger CREDIT_NOTE; `Timesheet.releaseBilled(cellIds)` |
| Finance | `purchase.recorded` / `purchase.updated` | Ledger PURCHASE/PAYMENT (reverse and repost on update); Filing; Assets (`purchase.asset_candidate` creates In-stock assets) |

### 5.3 People lifecycle

| Producer | Event | Consumers → effect |
|---|---|---|
| People | **sync** `Entitlements.assertSeatAvailable`, `IdentityService.inviteUser` | Billing seat gate; Identity creates User INVITED plus invite email |
| People | `employee.created` | Time → default shift allocation, location assignment; Leave → balances plus proration; People → Onboarding instance, WelcomeKitIssue PENDING, IdCard QUEUED; Chat → audience channels; Notices, Policies, LMS → recipients, ack requirements, new-joiner enrollments; Search |
| People | `employee.activated` | Billing seats; Notifications (manager, HR "onboarding incomplete") |
| People | `employee.updated` / `employee.work_mode_changed` / `employee.location.changed` | Time → policy re-evaluation, tracker eligibility, `tracker.policy.updated`; Identity → revoke DESKTOP sessions if no longer eligible; Search; ID card regenerate prompt |
| People | `employee.manager_changed` / `employee.department_changed` | RBAC TEAM/DEPT cache bust; Leave → reroute PENDING requests; Timesheet → reassign PENDING L2; Chat, Notices audiences; Boards (department move) |
| People | `employee.notice_started` | Payroll F&F prep; Appraisal exclusion |
| People | `employee.exited` | Identity → user DISABLED, sessions revoked; Tracker → devices REVOKED; Time → biometric enrollment deleted; Work → board memberships revoked, ALLOTTED tasks back to OPEN; Approvals → reassign steps; Leave → auto-cancel future requests; ID card REVOKED; vCard public page off (410); Chat deactivate; Search remove; Billing seat release |
| People | `employee.photo_approved`, `onboarding.submitted` | **ID cards → `idcard.generate` job** when `missingFields = ∅` (this is the "onboarding complete → ID card" contract); Welcome kit size; HR notification |
| People | `onboarding.bank_tax.submitted`, `bank_account.changed/verified` | Payroll precheck ("Bank unverified", exclusion from bank file) |
| People | `salary.revision.activated` | Payroll arrears job (P2); Vault compensation document regeneration |
| People (P2) | `recruitment.candidate_hired`, `appraisal.cycle_closed` | Employees conversion; future salary revision proposals |

### 5.4 Work, workplace and platform

| Producer | Event | Consumers → effect |
|---|---|---|
| Work | `project.created`, `project.member.added/removed`, `project.lead.changed`, `project.archived` | Chat project channel create, sync, archive; Notices audiences; RBAC PROJECT cache; Timesheet → reassign PENDING L1 steps; Tracker → reassign idle claim reviewer, `tasks.updated`; GitLab link job |
| Work | `task.assigned/unassigned/moved/closed` | Tracker `tasks.updated` push; Dashboard to-dos; GitLab jobs (WIP → ensure-branch; DEV_COMPLETED → MR); Search |
| Time | `attendance_policy.updated` {audience, version} | Tracker socket `tracker.policy.updated` (devices refetch by ETag); Notifications to the affected audience (DPDP disclosure) |
| Workplace | `notice.published`, `policy.published`, `policy.acknowledged`, `ticket.escalated`, `course.completed`, `certificate.issued`, `eotm.announced`, `kudos.awarded`, `visitor.checked_in` | Notifications; Dashboard invalidate plus `approvals.counts`; Onboarding (policy acks); Vault (**sync** `VaultService.addSystemDocument` for certificates); Profile badges; Feed posts |
| Platform | `file.available` / `file.rejected` | Owning domain marks its record (for example a document stuck in "Scanning" becomes Blocked) |
| Platform | `rbac.changed`, `tenant.entitlements_changed`, `branding.published`, `tenant.domain_changed`, `tenant.status_changed`, `session.revoked` | Web `/me` refetch and re-guard, theme swap, tracker workspace update, banners, forced logout |

### 5.5 Synchronous service contracts (owner → callers)

| Owner | Contract | Callers |
|---|---|---|
| Identity | `inviteUser`, `disableUser`, `setRoles`, `getUser` | People |
| RBAC | `can`, `scopeFilter`, `usersWithPermission` | all |
| People | `getEmployee`, `getManagerChain`, `getTeam`, `ScopeResolver(TEAM, DEPARTMENT)`, `isInReportingChain` | Leave, Timesheet, Helpdesk, Tracker, Notices |
| Work | `TaskDirectory.listAssignable/getTask/getProjectLead/isMember`, `ProjectService.isLoggable`, `ScopeResolver(PROJECT)` | Timesheet, Tracker |
| Time | `WorkCalendarService.getDays`, `BusinessCalendar.addMinutes`, `canUseDesktopTracker`, `getPunchChannels`, `getShift`, `PeriodLockService.isLocked` | Leave, Payroll, Helpdesk, Tracker, Identity |
| Leave | `LeaveService.getApprovedLeave/debit` | Attendance, Payroll |
| Ledger | `LedgerService.post/reverse` (idempotent on sourceType+sourceId) | Payroll, Invoices, Purchases |
| Platform | `NotificationService`, `AuditService`, `FileService.putSystemFile`, `SequenceService`, `Scheduler`, `SearchIndexer`, `CryptoService`, `Branding.tokens`, `Entitlements`, `Realtime` | all |
| Workplace | `AudienceService.resolve/matches`, `CertificateService.issue`, `HelpdeskService.createTicket`, dashboard `SectionProvider`/`TodoProvider`/`ApprovalCountProvider` registries | Notices, Policies, LMS, Chat, Payroll ("Raise a query"), all |
| Shared pure | `reduceDay()` (tracker + api + web timeline), `gst.compute()`, `fyLabel()`, `formatINR` | tracker, api, web |

---

## 6. Phased roadmap

Every milestone ends with green CI, seeded demo data for its modules, audit and permission coverage, and the listed e2e specs passing.

### Phase 1: core internal HRMS for Lexisora (tenant kind OPERATOR/DEMO, plan INTERNAL)

**M1. Monorepo and platform foundation**
- Monorepo: workspace hardening, `packages/config`, `ui`, `fixtures` skeletons, eslint boundaries.
- Infrastructure: compose additions (minio, gotenberg, clamav profile).
- Backend:
  - env schema; pino logging, OpenTelemetry, metrics, health endpoints.
  - Error filter, zod pipe, idempotency interceptor, cursor pagination helpers.
  - Prisma multiSchema with the ID and money conventions; `roles.sql`, RLS helpers and CI RLS audit.
  - CLS context, Prisma RLS extension, `tx()`.
  - Outbox table and relay, EventBus, BullMQ worker wrapper, Scheduler tick, SequenceService with FY periods, CryptoService with LocalKeyProvider.
  - Adapter registry pattern (config picks real or stub).
- Web: Vite app bootstrapped with the router and Query client.
- Tracker: electron-builder skeleton.
- CI pipeline stages 1–7.
- **Exit:** two synthetic tenants prove isolation (0 rows without context; a cross-tenant JWT gets 401); the sequence test (gap-free, FY rollover) passes; an outbox event is delivered exactly once to an idempotent handler; CI is green on an empty app.

**M2. Identity, tenancy, RBAC, design system and app shell**
- Backend:
  - Tenant resolution by host, `X-Workspace`, `*.localhost`; tenant status guard; TenantSettings.
  - Login, refresh (cookie), logout, logout-all, forgot/reset, invite accept, lockout, breached-password check, sessions, mobile gate.
  - EdDSA JWT with a Redis session-state cache.
  - Permission catalogue sync, roles, RolePermission with scopes, UserRole, Redis perm cache, guards, ScopeResolver registry (TEAM/DEPARTMENT/PROJECT stubs until M4 and M6).
  - `/me` with navigation; `/admin/roles` (Matrix, Members, All permissions, Add role/copy, undo, LAST_ADMIN); `/admin/security` (company section, sessions list).
  - Demo login `POST /auth/demo/login` behind `DEMO_MODE`, with a production boot check.
- UI: `packages/ui` port of the tokens and Classical classes with self-hosted fonts; AppShell (sidebar groups, header with search box, punch placeholder, Alerts count, avatar sign-out), ModulePage, DataTable, FormDialog, Toast, Drawer, Tabs, KpiStrip, states; routes for all screens as permission-guarded placeholders; `/demo` switcher, header role chips, legacy hash parser; default `theme.css`.
- **Exit:**
  - The platform M1/M2/M3 acceptance scenarios pass (employee sidebar, 403 redirect, lockout plus Mailpit email, reset, mobile gate, refresh reuse, matrix equals the wireframe defaults, Facility Manager custom role).
  - A Playwright smoke test logs in as each of the 5 personas and asserts NAV visibility against the wireframe NAV table.

**M3. Cross-cutting services**
- Backend:
  - Notifications (catalogue, notify/resolve/sendDirect, email job via SMTP to Mailpit, dedupe, sockets `notification.new/count`, `/alerts` screen, `/dev/outbox`).
  - Audit (capture, redaction, sealing chain, anchors, `/admin/audit` screen).
  - Files (upload intents, multipart, complete, magic-byte sniff, MockScanner/ClamAV, access policies, `<FileDrop>`, orphan sweep, retention, public assets).
  - Search (SearchDocument, indexer queue, ACL query, header dropdown, `/search`).
  - Realtime gateway with RoomAuthorizer.
  - `approvals.counts` aggregator shell and dashboard provider registries.
  - Seed framework (catalogue sync, SeedContributor ordering, deterministic faker seed 20260929, `SEED_ANCHOR_DATE`, nightly `demo.reset`).
- **Exit:** the platform M5/M6/M7/M8/M14 acceptance scenarios pass (timesheet-due alert dedupe, audit tamper detection, EICAR file INFECTED, mime spoofing gets 415, search ACL cases, seed determinism).

**M4. People core**
- Backend and web:
  - Masters (department, designation, branch).
  - Employees directory: tabs and counts, scoped lists, Add employee → invite (`assertSeatAvailable` is a no-op), CSV import with dry-run, job-change history, emp codes, lifecycle (notice, exit checklist, cancel joining, intern conversion), `people.lifecycle.daily`.
  - Profile with the 5 tabs plus Devices placeholder and visibleTabs; photo approval.
  - Vault and document service with verification.
  - Paperless onboarding: 5 steps; local e-sign with pdf-lib stamping and certificate page; public verify; IFSC adapter; bank and statutory with CryptoService; PAN/Aadhaar/IFSC validators.
  - Assets with warranty job; welcome kits with stock.
  - ID card designer (templates, drag-drop, bindings whitelist, Gotenberg PNG/PDF 300 DPI, auto-generate on events, email print vendor, QR verify page).
  - Visiting card (PNG/PDF/vcf, email share, wa.me deep link, public `/c/:slug`).
  - People ScopeResolvers (TEAM via recursive CTE, DEPARTMENT) and the people search provider.
- **Exit:** the People M1–M5 and M8–M11 acceptance scenarios pass. Playwright journey **05 part A** passes: add employee → invite in Mailpit → onboarding e-sign offer and NDA → upload docs → bank → finish → HR verifies → welcome kit → assets → ID card READY → print batch email → visiting card share.

**M5. Time and attendance**
- Backend and web:
  - Work locations with geo-fence and the system Remote row; shifts and allocation (gist exclusion); holiday calendar with import and locations per year (UI in Leave setup → Holidays); WorkCalendarService and BusinessCalendar.
  - Attendance policy matrix with the extra rules and versioning, including the tracker fields; `/me/attendance-policy`.
  - Punch API (advisory lock, state machine, geo, biometric-only block, idempotency), WorkSession, AttendanceDay recompute (precedence, late and half-day, idle fields), auto-close, absent marking, reminders.
  - Header punch and dashboard Today card wired; Attendance screen (punch card, month card, timeline, daily table, team view).
  - Regularization and its approvals tab; PeriodLock service.
  - Biometric ADMS `/iclock` with registry and unclaimed flow, raw log processing, device health, emulator CLI and `/dev/biometric/simulate`.
  - ID card compliance (manual pick plus badge scan by verifyToken, KPIs).
  - `canUseDesktopTracker`, `getPunchChannels`.
- **Exit:** the Time A–G and I acceptance scenarios pass, including emulator ATTLOG → live "Punched in", biometric-only 403 with the dashed notice, the late and half-day scenarios, and the lock returning 409. Playwright journey **09** runs without the CCTV step: roles → policy → locations → shifts → ID compliance.

**M6. Projects and task boards**
- Backend and web:
  - Clients with debtor sub-ledger placeholder (created lazily in M13).
  - Projects with KPIs, health and progress, modules, members, docs, INT internal project and standing tasks seed.
  - Team boards with isolation (`BOARD_PRIVATE`), allocation, kanban with drag-and-drop (LexoRank, one-column rule, version conflict), linked QA-task handoff, drawer, realtime board rooms.
  - GitLab integration: REST adapter plus mock, link, ensure-branch at WIP, MR at Dev Completed, webhooks with dedupe.
  - TaskDirectory and PROJECT ScopeResolver; `/me/tasks`; the Add task tab on the dashboard modal.
- **Exit:** the Workfin A–D acceptance scenarios pass. Journey **01 part** passes: the kanban drag creates a MockGit branch and MR.

**M7. Desktop tracker and ingestion**
- Tracker app:
  - Sign-in (workspace discovery `/.well-known/hrms-tenant`), pairing screen with countdown and poll, Home, Tracker tab (task list, break, punch), idle dialog with its 3 variants, lock/sleep/app-not-running handling, screenshot capture (desktopCapturer, sharp composite, device-side blur, WebP) with toast, tray icon states and widget, offline banner, SQLCipher outbox, NTP-style offset, clock-change detection, Daily summary, Settings (HR-locked rows, launch at start-up, widget, break reminders, Sign out & unpair).
  - Electron hardening (fuses, CSP, zod IPC), auto-update (stable channel), crash reporting, NSIS per-user installer, Authenticode signing in CI.
  - Dev "Prototype controls" panel backed by the mock providers.
- Backend:
  - Pairing and devices (portal code approval, email link, HR approval, max devices, Ed25519 claim, signed refresh).
  - `/tracker/policy` with ETag and socket push; bootstrap; punches through `Attendance.recordPunch`; `events:batch` ingest (hash chain, `ON CONFLICT DO NOTHING`); projection job via shared `reduceDay()`; IdleClaims; screenshots (presign, complete, thumbnail, retention, ACL, views); heartbeat, commands, auto-close, integrity detectors, day summaries feeding attendance and the timeline.
- Web: Profile → Devices; HR device views.
- **Exit:**
  - The Tracker T1–T8 acceptance scenarios pass. The reducer invariant `span = worked + break + idle_deducted + idle_pending` holds under property tests.
  - The offline 3 h replay matches server totals exactly.
  - Playwright-Electron journey **02** passes with the mock providers and a 60× clock: sign in → pair → punch → task → idle → break → shot → tray → offline → summary → settings/unpair.

**M8. Timesheets and two-level approvals**
- Backend and web:
  - Timesheet build from `tracker.day.updated` (largest-remainder rounding), month-end split, cell edits with reason classification, reallocation, outside-hours entries, submit/recall/reopen, reminders and overdue jobs, late-data handling.
  - Approvals: L1 per project (SKIPPED_SELF), L2 by RM (SKIPPED_DUPLICATE), review items (OH, idle claims, manual increases) with accept/reject, screenshot grid scoped to the approver, integrity strip gating L2, send-back with a new cycle, admin override, SLA escalation, lead-change reassignment.
  - `approvals.counts` realtime; dashboard "Awaiting your approval" (timesheets, regularizations).
  - `BillableTimeView` and markBilled/releaseBilled prepared for M13.
- **Exit:** the Time J–K acceptance scenarios pass, including the exact wireframe grid (AT-101 20:30, AT-103 15:00, Code review 3:30, Stand-up 2:30, idle 2:00; 41h 20m worked; 248 shots). Journey **01** passes end to end, and journey **03** up to "RM signs off".

**M9. Leave management**
- Backend and web:
  - Leave types (seeded CL/SL/EL/Comp-off/LWP), credit rules and batches (monthly EL 1.5, joining proration), manual credits, append-only ledger with the balance invariant job, settings.
  - Time off screen (cards, history, drawer), apply form with live preview (sandwich rules, holidays, half-day sessions, LOP conversion, notice and backdate rules), team requests tab, approvals tab "Time off", escalation and reroute.
  - Comp-off request, grant, FIFO consumption and expiry; year-end carry-forward and lapse.
  - Dashboard leave balance and history cards; LeaveService contracts.
- **Exit:** the Leave L1–L5 acceptance scenarios pass (encashment excluded). Journey **04** passes through "leave rules & credits".

**M10. Payroll and payslips**
- Backend and web:
  - Payroll settings, components and templates (Standard FT, Intern stipend), salary revisions with CTC↔gross bisection, the payroll profile reading People bank and statutory data, tax declarations.
  - Statutory engine as pure functions (PF, ESI with coverage periods, PT for Gujarat and Maharashtra, TDS for both regimes with rebate and marginal relief) with a trace.
  - Payroll run: precheck, preview, run form (lock date → PeriodLock, include idle, Exclude/Wait, payment date), chunked calc with calcVersion, item drawer, hold/release, STALE handling, WAIT listener on `timesheet.approved`, finalize (SUPPLEMENTARY run for excluded employees), reopen.
  - Adjustments: LOP reversal and recovery, idle reversal and recovery, manual, joining arrear.
  - Payslip PDFs via Gotenberg (Classical template, amount in Indian words, verify QR), publish; My payslips; "Raise a query" into a helpdesk ticket (after M11, otherwise hidden).
  - Bank transfer file (generic NEFT CSV), reconciliation, mark paid.
  - Ledger postings stored `SKIPPED_NO_LEDGER`.
- **Exit:** the Payroll P1–P7 acceptance scenarios pass: Priya's figures (Basic 42,000 / HRA 21,000 / Special 21,000 / PF 1,800 / CTC 85,800; net ₹82,000 NEW regime GJ) and the TDS worked examples. Journeys **03** and **04** pass end to end (approved timesheet → run → payslip download; leave → paid days recalculated).

**M11. Workplace core**
- Backend and web:
  - Dashboard full aggregation with section providers, 800 ms timeouts and invalidation: quotes, personal to-dos plus board tasks plus system to-do providers, company events and celebrations job.
  - Notice board (audiences, schedule, expiry, receipts, late joiners).
  - Company feed core (composer with allowlist sanitization, publish, likes, comments, mentions, sidebar placeholders).
  - Policies and rulebook (versions, re-acknowledgement, reader gating, compliance, holiday list tab and PDF from the calendar).
  - Helpdesk (groups, categories, SLA with business calendar, pause, escalation L1/L2, restricted categories, CSAT, reports, `HelpdeskService.createTicket`).
  - Comms hub text: auto channels (`#general`, `#announcements`, department and project channels), DMs and group DMs, seq ordering, unread, typing, presence, attachments, search, offline DM digest.
- **Exit:** the Workplace §1, §2, §3 (core), §5 (text), §6 and §9 acceptance scenarios pass. Journey **08 part A** passes (notices, feed, chat, helpdesk, policies).

**M12. P1 hardening and go-live for Lexisora**
- Performance: payroll for 10,000 employees in under 5 min; tracker ingest at 500 devices × 1 batch/min; kanban and chat latency under 500 ms.
- Security: OWASP ASVS L2 checklist, dependency and container scanning, pen-test of RLS and IDOR (automated "other tenant / other scope id" fuzz across every GET/PATCH route).
- Operations: backups (pgBackRest, MinIO replication), restore drill, runbooks, production compose or k8s manifests, Caddy TLS.
- Data migration: import tooling for real employees, opening leave balances and YTD tax.
- **Exit:** all P1 journeys (01, 02, 03, 04, 05A, 08A, 09 without CCTV) pass nightly; the RLS and IDOR suite is green; a DR restore is completed; UAT sign-off from HR (Kavya) and the CEO (Rohit) personas.

### Phase 2: extended modules

**M13. Finance back office**
- GST invoices from `BillableTimeView` (supply-type derivation, CGST/SGST/IGST, round-off, issue-time numbering, Gotenberg PDF with SAC 998314, email, payments with TDS, credit notes, overdue and unbilled jobs).
- Purchases and input GST (upload → OCR adapter (pdf-parse and tesseract) → confirm; vendors; categories with ITC and Sec 17(5) rules; asset candidates).
- Ledger (seeded chart of accounts with systemKeys, vouchers with deferred balance trigger, reversal, day book, income/expense/HR vouchers/trial balance, period lock, KPIs); **replay of the P1 payroll postings**.
- Filing cabinet (system folders, versions, auto-filing, retention locks) plus GST returns (GSTR-1 and 3B computation, JSON/CSV export, mark filed) plus compliance calendar.
- **Exit:** the Workfin G–J acceptance scenarios pass; the trial balance nets to 0 after the replay. Journeys **06** (steps create project → invoice → ledger; archive comes in M14) and **07** pass.

**M14. Talent and work extensions**
- Recruitment (jobs, candidates vault with dedupe and retention, interviews with ICS and LiveKit join (mock until M16), scorecards, offers, conversion into the M4 flow).
- Appraisals (templates with weights, cycles and phases, self and manager review, calibration, bands, acknowledge).
- Project archive and client vault.
- Intern task sheets and intern dashboard.
- **Exit:** the People M6–M7 and Workfin E–F acceptance scenarios pass. Journey **05** passes in full (job → candidate → interview → add employee → … → vcard) and journey **06** in full (archive).

**M15. Culture and learning**
- Kudos, EOTM and Certificates (PDF with public verify and file hash match, copied to the vault).
- Feed review workflow and image re-encoding.
- LMS (multipart video, ffmpeg HLS transcode, heartbeat progress with bitmap, assignments via AudienceService, due reminders, certificates).
- Rooms and visitors (gist no-overlap, calendar view, e-pass through the WhatsApp stub and email with ICS, front desk check-in, no-show job, PII purge).
- Wellness games (`packages/games` deterministic generators, server validation, leaderboard, break-only mode).
- **Exit:** the Workplace §4, §7, §8 and §10 acceptance scenarios pass.

**M16. Realtime media and CCTV**
- LiveKit calls: audio, video, screen share, egress recordings to MinIO, call summaries, recording playback ACL.
- CCTV through MediaMTX (paths, JWT auth hook, health poll, reconnect, view-session audit, mock testsrc streams).
- Interview video joins on LiveKit.
- **Exit:** the Workplace §5 (P2) and §11 acceptance scenarios pass. Journeys **08** and **09** pass in full.

**M17. Platform and domain P2 extensions**
- Identity: OIDC SSO (mock `/dev/sso` plus openid-client) and TOTP MFA.
- Notifications: preferences, digest, Web Push, WhatsApp template adapter (still stub without credentials).
- Audit export and verify UI; document content search (pdf-parse, non-RESTRICTED only).
- Payroll: salary-revision arrears, leave encashment, statutory exports (PF ECR, ESI, 24Q, Form 16 data), Gujarat LWF, bank-specific file stubs.
- Time and tracker: shift roster and overrides, optional holidays, tracker P2 (HR fleet list, MSI, SSO device login, remote PUNCH_OUT, input-pattern heuristic, presence).
- People: e-sign countersign and OTP, third-party e-sign adapter stubs, ID card vendor API stub; bulk approve and delegation.
- **Exit:** each feature's acceptance scenarios pass; a regression run of the P1 journeys stays green.

**M18. P2 hardening**
- Load tests for chat, LiveKit and HLS.
- Accessibility pass (WCAG AA on the core screens).
- Data retention jobs verified.
- **Exit:** journeys 01–09 pass nightly.

### Phase 3: multi-tenant SaaS commercial features

**M19. SaaS core**
- Platform console app (separate Nest app with the `platform_svc` role, TOTP login, handoff from `/saas/tenants`).
- PlatformUser roles; Tenants screen with KPIs and "Add tenant".
- Resumable provisioning pipeline running every SeedContributor's `base()`.
- Lifecycle: READ_ONLY, SUSPENDED, CANCELLED, deletion schedule and purge.
- Usage via security-definer functions; entitlement enforcement switched on; seat gate; plan-locked nav and permission tags; storage quotas.
- **Exit:** the platform M9 acceptance scenarios pass, including the `platform_svc` grant-denied test and provisioning retry idempotency.

**M20. Subscription and billing**
- Plans and prices (versioned), subscription state machine, quotes, checkout through MockGateway (`/mock-pay`) and the Razorpay adapter (enabled by keys), webhooks with signature and dedupe.
- GST SaaS invoices `LXS/26-27/####` (CGST+SGST for Gujarat, IGST elsewhere), seat proration, cycle change, downgrade, promo codes, dunning, reminders, MRR snapshots, contact sales.
- **Exit:** the platform M10 acceptance scenarios pass (₹84,394 and ₹10,983 examples, DIWALI20 promo, proration ₹4,457.75, dunning to READ_ONLY with punches still allowed).

**M21. Branding and white-label**
- Branding editor (presets, custom colours, OKLCH ramp with contrast adjustment, logo with SVG sanitization, product name), publish and restore.
- Runtime `theme.css`; emails, PDFs and tracker use tenant tokens.
- Slug change with 90-day redirect; custom domains (DnsVerifier, Caddy on-demand TLS); tracker white-label.
- **Exit:** the platform M11 acceptance scenarios pass.

**M22. Privacy, encryption and dedicated databases**
- TenantKey envelope encryption with OpenBao Transit and the `crypto.rekey` migration from HKDF v0.
- Encryption of chat bodies and recordings, screenshots, payroll item amounts and RESTRICTED files (streaming proxy).
- Key rotation and crypto-shred; support access grants and diagnostics; data export zip; privacy screen live data.
- Dedicated-DB option (resolver, per-DB migrations, provisioning steps CREATE_DATABASE and MIGRATE); SAML SSO; BYOK.
- **Exit:** the platform M12 acceptance scenarios pass (ciphertext in dumps, AAD mismatch fails, rotation with continuous reads, grant-gated diagnostics).

**M23. Lexisora support and commercial adapters**
- B2B support: SUP tickets, console queue, SLA by plan, CSAT.
- Real WhatsApp Cloud adapter; e-invoice IRN and GSP filing adapters (stub or sandbox); RazorpayX payouts; Tally export; penny drop; careers page and job board publisher; resume parser; tracker update channel pinning.
- **Exit:** the platform M13 acceptance scenarios pass. Journey **10** passes: tenants → subscription → branding → privacy → support.

**M24. P3 hardening**
- Multi-tenant pen test; noisy-neighbour limits (per-tenant rate limits and queue fairness); DR per tenant (export and restore); SOC2-style evidence from audit anchors.
- **Exit:** all 10 journeys pass on two tenants in parallel (Lexisora plus Acme), with cross-tenant fuzz green.

**Dependency check.**
- Payroll (M10) depends on M5, M8 and M9.
- Ledger (M13) replays M10 postings.
- Invoices (M13) depend on M8 `BillableTimeView`.
- ID cards (M4) depend on M3 files, the renderer and branding tokens (defaults).
- Tracker (M7) depends on M5 policy and punch, and M6 TaskDirectory.
- Recruitment (M14) reuses the M4 conversion and M16 LiveKit (mock before M16).
- SaaS (M19–M22) depends on the M2 entitlement hooks already present as no-ops.

---

## 7. Integration adapters

All adapters are selected in `adapters/<name>/index.ts` from configuration. The stub or mock is the default whenever keys are empty.

| Interface | Stub / mock (default) | Real implementation | Config keys |
|---|---|---|---|
| `EmailAdapter.send` | `LogEmailAdapter` (tests) | SMTP via nodemailer (Mailpit in dev, any SMTP in prod) | `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `MAIL_REPLY_TO_DEFAULT` |
| `WhatsAppAdapter.sendTemplate` | Stub: OutboundMessage STUBBED, `/dev/outbox`, wa.me deep link for vCard share | Meta WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATES_JSON` |
| `PushAdapter` (P2) | noop | Web Push (VAPID) | `VAPID_PUBLIC/PRIVATE_KEY` |
| `ObjectStorage` | `FsObjectStorage` (unit tests) | S3 (`@aws-sdk/client-s3`) to MinIO or S3 | `S3_ENDPOINT`, `S3_BUCKET`, `S3_PLATFORM_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE` |
| `VirusScanner.scan` | `MockScanner` (EICAR detection) | ClamAV clamd INSTREAM | `SCANNER=mock\|clamav`, `CLAMAV_HOST/PORT` |
| `HtmlRenderer.renderPdf/renderPng` | pdf-lib minimal PDF and placeholder PNG | Gotenberg 8 Chromium | `GOTENBERG_URL` |
| `ImageProcessor` | sharp (real everywhere) | sharp | — |
| `GitProviderAdapter` | `MockGitAdapter` (mock_git tables, `/dev/mock-git/emit`) | GitLab REST v4 | Tenant `GitIntegration` (baseUrl, token encrypted); `GITLAB_WEBHOOK_BASE_URL` |
| `RtcProvider` | Mock tokens, placeholder tiles, sample mp4 | LiveKit self-hosted plus Egress | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_EGRESS_S3_*` |
| `StreamGateway` | MediaMTX with ffmpeg testsrc paths and one forced-offline camera | MediaMTX API v3 (RTSP → HLS) | `CCTV_GATEWAY_URL`, `CCTV_GATEWAY_API_URL`, `CCTV_HLS_PUBLIC_BASE`, `CCTV_JWT_KEY` |
| `BiometricPushAdapter` | Device emulator CLI plus `/dev/biometric/simulate` | ZKTeco ADMS/iclock | `ADMS_HOST`, `ADMS_RATE_LIMIT`; per-device comm key and CIDR |
| `BiometricPullAdapter` (P3) | none | eSSL / Hikvision | per vendor |
| `PaymentGateway` | `MockGateway` (`/mock-pay/:orderId`, signed self-webhook) | Razorpay Orders, Payments and Webhooks | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| `PayoutAdapter` (P3) | Stub: processing, then PAID after 5 s | RazorpayX | `RAZORPAYX_*` |
| `BankFileAdapter` | HDFC/ICICI/SBI stubs | `GenericNeftCsv` (real) | `PayrollSettings.bankFileFormat` |
| `IfscLookup` | Bundled ~50-row table plus regex | Razorpay IFSC API with 30-day Redis cache | `IFSC_API_URL` |
| `BankAccountVerifier` (P3) | `{matched:null}` (manual HR check) | Razorpay or Cashfree penny drop | `PENNYDROP_*` |
| `ESignProvider` | `local` (real in-app signing) | Leegality / Digio / DocuSign (stubs until credentials) | `ESIGN_PROVIDER`, `ESIGN_*_KEY`, `ESIGN_WEBHOOK_SECRET` |
| `PrintVendorAdapter` | `api` stub | `email` (real SMTP) | `IdCardSettings.printVendorEmail` |
| `BillOcrAdapter` | Fixture by file hash | pdf-parse plus tesseract.js (or ocrmypdf container) with rule parser | `OCR_ENGINE=mock\|local` |
| `EInvoiceAdapter` (P3) | Deterministic fake IRN, "SANDBOX" stamp | IRP/GSP | `EINVOICE_*` |
| `GstFilingAdapter` (P3) | Offline JSON export only | GSP | `GSP_*` |
| `AccountingExportAdapter` (P3) | Tally XML stub | Tally XML | — |
| `SsoProvider` (P2) | `/dev/sso` persona picker | OIDC via openid-client (Google, Entra, generic); SAML in P3 | Tenant `SsoConnection` |
| `BreachedPasswordChecker` | Offline top-100k list | HIBP k-anonymity | `HIBP_ENABLED` |
| `KeyProvider` | `LocalKeyProvider` (HKDF from master key) | OpenBao/Vault Transit (P3 default), AWS KMS, BYOK | `DATA_ENCRYPTION_KEY`, `KMS_PROVIDER`, `VAULT_ADDR`, `VAULT_TOKEN`/`VAULT_ROLE`, `AWS_KMS_*` |
| `DnsVerifier` / `CertificateIssuer` (P3) | Stub (ISSUED) | DNS TXT lookup; Caddy on-demand TLS ask endpoint | `EDGE_HOST`, `CADDY_ASK_TOKEN` |
| `GeocoderAdapter` / `IpGeoAdapter` | null | Nominatim (optional) / none | `NOMINATIM_URL` |
| `HolidayProviderAdapter` | Bundled JSON (national, Gujarat, Maharashtra) | same | — |
| `VideoTranscoder` | Copy mp4 plus stub manifest | Local ffmpeg HLS worker | `FFMPEG_PATH` |
| `ResumeParser` / `JobBoardPublisher` | Empty / QUEUED | P3 vendors | — |
| `CrashSink` / `UpdateFeed` | S3 (real) | S3; Sentry/GlitchTip optional | `TRACKER_RELEASE_BUCKET`, `SENTRY_DSN` |
| `CodeSigner` (CI) | `NoopSigner` (dev) | Azure Trusted Signing / signtool with PFX | `AZURE_SIGNING_*` / `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| `PlatformAlertSink` | email to ops mailbox | email / Slack webhook | `OPS_ALERT_EMAIL`, `SLACK_WEBHOOK_URL` |
| `InboundEmailAdapter` (P3) | stub | IMAP / webhook | — |
| Tracker device providers: `InputActivityProvider`, `ClockProvider`, `ScreenCaptureProvider`, `SecureStore`, `LocalStore`, `Transport`, `DeviceIdentity`, `Notifier` | Mock providers (simulated clock, generated frames, in-memory store, offline-simulating transport) | `powerMonitor`, `desktopCapturer` with sharp, `safeStorage` (DPAPI), SQLCipher (`better-sqlite3-multiple-ciphers`), fetch with retries, `node-machine-id`, Electron Notification | `TRACKER_MOCK=1`, `TRACKER_API_BASE` (dev) |

Global flags: `DEMO_MODE`, `DEMO_ALLOWED_HOSTS`, `ROOT_DOMAIN`, `WEB_ORIGIN`, `PROC_ROLE`, `JOBS_DISABLED`, `SEED_ANCHOR_DATE`, `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEYS_DIR`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

## 8. Test and verification strategy

### 8.1 Unit tests (vitest; pure functions first)

**Shared package**
- Formatters: Indian grouping, lakh/crore, relative "When".
- FY label; GST compute (intra/inter/LUT, round-off); brand ramp and contrast.
- Status tones.
- `reduceDay()` with **fast-check property tests**:
  - span invariant;
  - idempotency under duplicate or reordered events;
  - largest-remainder rounding (e.g. 20m20s × 4 = 81 min).
- Games: determinism, and uniqueness for 365 dates.

**API calculators**
- Attendance:
  - shift window and night-shift attribution; late, half-day and early-out;
  - day status precedence; SHORTFALL idle deduction with monthly allowance;
  - geo haversine; late penalty.
- Leave: sandwich rules, proration `round_half`, carry-forward and lapse, comp-off FIFO.
- Payroll statutory engine:
  - Priya ₹84,000 → net ₹82,000;
  - ₹20,000 case → net ₹18,450;
  - ₹1.5 L/month → TDS ₹12,567;
  - marginal relief at ₹12,10,000 → ₹10,400;
  - PT Gujarat and Maharashtra including February;
  - ESI coverage periods;
  - CTC ↔ gross bisection;
  - idle amount formula;
  - proration and mid-month revision.
- SaaS billing: proration ₹4,457.75; ₹84,394 and ₹10,983 invoices; MRR formulas.
- Project progress and health; helpdesk SLA business-minute arithmetic; audit hash chain; RBAC effective-permission union and scope filters; sequence formatting.

**Tracker main process**
- Engine state machine driven by `ClockProvider` and `InputActivityProvider` mocks:
  - idle at threshold, lock/sleep voiding below threshold, app-killed gap prompt;
  - screenshot clock paused on idle and break; offset median; clock-change detection.

### 8.2 API integration (supertest against real Postgres, Redis and MinIO; stub adapters)

- **Database per worker:** a migrated template DB is cloned per vitest worker. Tests connect as **`app_user`**, so RLS is exercised for real.
- **Harness:** `asPersona('priya')` issues real tokens through `/auth/login`. Mailpit is asserted through its API and the dev outbox is read. BullMQ runs inline via a `drain()` helper. A frozen clock is used (`@sinonjs/fake-timers` for jobs, `SEED_ANCHOR_DATE`).
- **Mandatory suites:**
  - RLS audit on every table.
  - Cross-tenant and cross-scope IDOR fuzz: every route is called with another tenant's id and with an out-of-scope id, expecting 404 or 403.
  - `platform_svc` grant denial.
  - Permission matrix: for every catalogue key, a guarded route returns 403 for a role without the key.
  - Outbox idempotency: every event consumer is replayed twice.
  - Period lock enforcement across attendance, timesheet, leave and tracker.
  - The chains end to end at API level: tracker batch → day summary → timesheet cells → L1 → L2 → payroll item → payslip → ledger posting (skipped in P1, replayed in P2).
- **Contract drift:** response zod parse in test mode.

### 8.3 End-to-end (Playwright; `e2e/journeys/NN-*.spec.ts`; seeded demo tenant; anchor 2026-09-29)

Each spec follows the flow-map steps exactly, signing in as the step's role through demo login (password login for the 01 sign-in step). Each also asserts the step's route and role permission.

| # | Journey | Key assertions | Phase |
|---|---|---|---|
| 01 | Employee daily start (login → dashboard → attendance → kanban → timesheet) | Quote, leave cards, to-dos, notices; remote web punch timer; card drag to WIP creates the MockGit branch; timesheet grid values | P1 |
| 02 | Desktop tracker day (11 steps) | Playwright `_electron` with `TRACKER_MOCK=1` and a 60× clock: pairing code approved in the portal (second browser context), idle dialog outcomes, screenshot toast "mapped to AT-101", tray tooltip, offline "N entries queued" then synced, summary totals match `/activity/days`, unpair revokes the session | P1 |
| 03 | Timesheet approval (employee → lead → manager → hr payroll → employee payslip) | L1 KPIs 41h 20m / 2h / 248 shots; realtime count increments; L2 approve; run with Exclude(n); payslip PDF text contains the net amount in words | P1 |
| 04 | Time off (balance → apply → manager approves from dashboard → leave setup credit → payroll paid days) | Sandwich preview; dashboard card count; STALE re-run gives +1 paid day | P1 |
| 05 | Hire to day one (9 steps) | A: add employee → onboarding e-sign → kit → assets → ID card → vcard (P1). B: prefixed with jobs → candidates → interview scorecard 8.2 → convert (P2) | P1/P2 |
| 06 | Project delivery (create project → board → approve hours → GST invoice → ledger receipt → archive) | IGST ₹2,74,350 example; SALES and RECEIPT vouchers balanced; archive listing | P2 |
| 07 | Finance back office (purchase OCR → vouchers → filing) | Input GST KPI +₹1,290; bill auto-filed; delete blocked with 409 | P2 |
| 08 | Workplace and culture (notices → feed EOTM certificate → chat → helpdesk → LMS certificate → kudos → rooms and visitor e-pass → policies acknowledge → wellness) | Receipts "x / 127"; public certificate verify; booking conflict 409; e-pass page; puzzle scoring | P1 part A / P2 full |
| 09 | Admin controls and security (roles → attendance policy → locations → shifts → ID compliance → CCTV) | Mobile toggle revokes an HR mobile session; policy push reaches the tracker; biometric-only block; CCTV mock stream plays (P2) | P1/P2 |
| 10 | SaaS tenant lifecycle (tenants → subscription → branding → privacy → support) | Console provisioning of Acme; MockGateway upgrade invoice ₹84,394; Acme palette live swap; platform access log; SUP ticket | P3 |

Also covered by e2e: a flow-map link checker (every `#screen=…&role=…` resolves and is permitted), NAV visibility per persona against the wireframe table, and visual regression screenshots (Playwright `toHaveScreenshot`) of ModulePage and the 14 bespoke screens compared with the wireframe layout.

### 8.4 Tracker-specific verification

- **Main-process integration:** a local API with an in-process SQLCipher DB. Scenarios:
  - Offline for 3 h with an 18-segment and 18-shot backlog; replaying a batch 3 times gives DUPLICATE; ACK pruning.
  - Clock set back 2 h raises CLOCK_CHANGE with continuous server segments.
  - 8 days offline blocks punch-in.
  - Biometric conflict gives REJECTED_CONFLICT plus an auto regularization.
  - A tampered local row gives HASH_CHAIN_BROKEN.
  - Revocation mid-session: pre-revoke events still sync.
- **Simulated capture:** the `ScreenCaptureProvider` mock produces deterministic frames. Tests assert blur is applied before hashing and that `sha256` matches the S3 object.
- **Packaging smoke on the Windows CI runner:** install NSIS per-user; launch hidden; `--hidden` autostart; update from v1.4.2 to v1.4.3 via a local feed deferred until punch-out; a tampered sha512 is refused; crash minidump upload.

### 8.5 Seed and demo data (matches the wireframe; deterministic)

**Tenants**
- `lexisora`: kind DEMO in dev, OPERATOR in prod; plan INTERNAL; host `lexisora.localhost`.
- P3 platform demo: 14 tenants including Acme Logistics (Growth yearly 240), Bluepeak Studio (Free 9), Nova Clinics (Growth monthly 62, PAST_DUE, renewal 12 Oct), 3 Free and 2 Enterprise. KPIs are computed.

**Personas** (password `Demo@12345`)

| Persona | Role | Details |
|---|---|---|
| Priya Sharma | employee | LX-0142, Software Engineer · Development, Remote, RM Neha, PL Arjun, device PRIYA-LAPTOP v1.4.2 |
| Arjun Mehta | lead | Project Lead · Development; PL of Atlas CRM |
| Neha Kapoor | manager | Engineering Manager; PL of Orbit HR |
| Kavya Iyer | hr | HR Manager |
| Rohit Verma | admin | CEO |

**Named employees:** Rahul Desai LX-0118 (Office, Ahmedabad HQ biometric, PIN 118, birthday 30 Sep), Sneha Patel LX-0131 (QA Lead, 3-year anniversary), Vikram Joshi LX-0150 (Design, Hybrid Mon/Wed; Facility Manager custom role), Ananya Rao LX-0099 (Finance, notice period), interns Isha Mehra LX-I-021, Karan Shah and Divya Nair (mentor Arjun), and Meera Iyer (offered candidate, joining 6 Oct → INVITED).

**Headcount:** 128 active (119 full-time including 3 on notice, plus 9 interns). All counts are computed.

**Org and time**
- Departments: Development, QA, Design, Finance, HR, Admin.
- Locations: Ahmedabad HQ (Biometric only, 150 m, Gujarat calendar), Pune studio (Biometric only, 100 m, Maharashtra calendar), Remote (system).
- Shifts: General, Early, US overlap.
- 2026 holidays including Dussehra 20 Oct and Diwali 8–9 Nov.
- Attendance policy with the wireframe defaults; biometric devices plus raw logs; ID compliance history (86 in office, 81 wearing).

**Work and time**
- Clients: Nimbus (Gujarat, 24), Zephyr (Maharashtra, 27), Internal.
- Projects: Atlas CRM (key AT, 820h estimate / 540h logged, ₹1,250/h, Development/QA/Design boards; tasks AT-101 Invoice PDF export, AT-103, AT-110 …), Orbit HR, Kestrel (372/400h, AT_RISK), plus archived Helix (Leads only, Mar 2026), Quill LMS (All developers) and Pulse analytics (Vue).
- INT standing tasks.
- Tracker events regenerated for 21–27 Sep that reproduce the timesheet grid exactly, with 248 screenshots (generated images) and one pending idle claim.
- Priya's timesheet for 21–27 Sep: SUBMITTED, pending Arjun (L1).

**Leave and payroll**
- Balances and history per the wireframe (EL 14/18, …).
- Payroll runs Jun–Sep 2026 FINALIZED with payslips (working days 22/23/21/22; July 22.5 paid days).
- Salary structures (Priya CTC ₹10,29,600).

**Workplace**
- Alerts for Priya (timesheet due Today, policy acknowledgement Yesterday, HD-1038 resolved 26 Sep, Rahul's birthday 30 Sep); unread count is 4.
- The 4 wireframe notices with receipts; the 3 feed posts; kudos (Rahul Star Coder, Sneha Bug Hunter), EOTM September for Priya with certificate.
- Channels #general, #announcements, #atlas-crm, #qa-team with the wireframe messages.
- Tickets HD-1031/1038/1042, next number 1043.
- The 4 courses; rooms Board room, Huddle 1 and 2; 5 policies; 6 mock cameras.
- Assets: Dell Latitude 5440 DL5440-8821, MacBook with warranty Mar 2026 (expired).
- Welcome kit stock; ID card templates Classic portrait and Landscape minimal.

**P2/P3 finance and platform demo data:** invoices INV-0412/0413, purchases (Amazon IN-8843 ₹8,460), chart of accounts, filing folders, SUP-214 and SUP-221, promo DIWALI20.

**Rules**
- `pnpm db:seed:demo --anchor=2026-09-29` produces identical ids and counts on re-run. Dates are relative to the anchor, and generators skip weekends and holidays.
- `packages/fixtures` holds the persona and wireframe constants that both seed and e2e import, so the two cannot drift.

### 8.6 Non-functional verification

| Area | Check |
|---|---|
| Performance (k6) | Login, dashboard p95 < 400 ms at 200 concurrent users; payroll for 10k employees < 5 min; tracker ingest; chat fan-out |
| Accessibility | axe checks in Playwright on every route (P2 gate) |
| Security | ZAP baseline scan; dependency audit; Electron fuse verification; JWT key rotation drill |
| Backup | Nightly restore test on staging |

---

## 9. Top risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Scope size** (~100 screens, 60+ modules) threatens P1 delivery | The generic `ModulePage` and `FormDialog` drive roughly 70% of screens from config plus shared zod. Strict milestone exit criteria. P1 is limited to what the core flow journeys need. Per-module seed and acceptance tests act as done-gates. |
| 2 | **RLS with Prisma**: connection churn, missed `set_config`, nested writes not stamped, silent 0-row bugs | Two layers (app filter plus RLS). Batch-transaction `set_config` inside the extension. CI RLS audit plus a 0-rows-without-context test per table. IDOR fuzz. Worker wrapper refuses jobs without a tenant. Monitor transaction duration and pool metrics. pgbouncer in transaction mode. |
| 3 | **Tracker correctness and trust** (offline, clock tampering, double devices, pay disputes) | The event-sourced shared reducer gives one formula on device and server. Hash chain, device keys and monotonic anchoring. Property tests of the span invariant. Integrity flags inform reviewers but never change pay on their own. Weekly reconcile job. |
| 4 | **Privacy and compliance** (DPDP Act monitoring disclosure, screenshots, super-admin must not read tenant data) | Consent versioning in the tracker. Policy-change notifications. No keystrokes, window titles or URLs captured. Screenshot ACL (HR none) with every view logged. Retention jobs. `platform_svc` has no grants; separate console app; ESLint boundaries; P3 envelope keys. Classification registry drives redaction. |
| 5 | **Statutory payroll accuracy** (Income-tax Act 2025 slabs, PT, Code on Wages, ESI periods) | The engine is configuration-driven with effective-dated reference tables. A CA must verify the seed values before go-live (tracked as a blocking checklist item in M12). Worked-example unit tests. Calculation trace on every item. Parallel run against the existing payroll for 2 months before cut-over. |
| 6 | **Tight coupling across the attendance/timesheet/leave/payroll chain** (locks, STALE items, adjustments) | A single `PeriodLock` owner (D9). Every mutation after a lock takes the override path, which emits an event and creates an adjustment. Idempotent adjustment keys. Chain-level API integration tests. Payroll inputs read only through narrow ports. |
| 7 | **Money and time bugs** (BigInt JSON, rounding, IST day boundaries, night shifts, FY rollovers) | Integer paise with explicit unit suffixes in field names. Centralized `money.ts`/`dates.ts`. Location timezone for attendance. Anchored-date tests across midnight, month end, 1 Apr and leap years. |
| 8 | **Windows tracker distribution** (code-signing certificate, SmartScreen, auto-update failures, AV false positives) | Procure the Authenticode/Azure Trusted Signing certificate early (M1 action item). Staged rollout with a crash-rate auto-pause. Differential updates with a full-installer fallback. Per-user NSIS with no admin required. Signed update verification. |
| 9 | **Realtime scale and ordering** (chat seq, presence, board moves, approval counts) | Per-channel seq via `UPDATE … RETURNING`. Clients detect gaps and refetch `afterSeq`. The Redis adapter. Events are invalidation-only where possible. Load tests in M18. |
| 10 | **Self-hosted media stack operations** (LiveKit, Egress, MediaMTX, Gotenberg, ClamAV, OpenBao) | Compose profiles keep them optional in dev. Mock adapters allow full development and CI without them. Health checks with graceful 503 degradation. Runbooks. The P2/P3 phases isolate the risk. |
| 11 | **Biometric device protocol variance** (ZKTeco firmware quirks, clock drift, backlog dumps) | Store the raw log first and process it afterwards. Dedupe key. Direction modes (default FIRST_LAST). Clock-error clamping with HR alert. Emulator-based tests. Reprocess tooling. A test with Lexisora's real device in M5. |
| 12 | **Scaffold drift** (existing cuid IDs, single role, HS256, bcrypt, pdfkit, flat permission keys) | The §1.12 reconciliation is completed at the start of M1/M2, before any domain code. No migrations exist yet, so the change is cheap now and expensive later. |
| 13 | **Search and notification ACL leaks** (candidates, payroll tickets, restricted documents) | ACL columns on SearchDocument with permission and scope checks per query. Restricted helpdesk categories show escalation targets the header only. Notification bodies never carry salary amounts. Dedicated leak tests (platform M8 acceptance scenarios). |
| 14 | **Demo mode leaking into production** | `DEMO_MODE` requires tenant kind DEMO. The demo controller module is registered only when the flag is set. A boot check fails in production unless `DEMO_ALLOWED_HOSTS` is set. An e2e test asserts 404 with the flag off. |
| 15 | **Open product decisions** (the D-table defaults) that turn out wrong | Every default is tenant-configurable (policy fields, settings, the role matrix), so changing it is a configuration change rather than a code change. Decisions are recorded in `docs/adr/` so they can be revisited. |

### Critical Files for Implementation
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/apps/api/prisma/schema/base.prisma (and core.prisma, to be split per domain per §3 and §1.12)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/apps/api/src/core/prisma/prisma.service.ts (add the RLS `set_config` transaction layer to the existing tenant-scope extension)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/apps/api/src/core/context/request-context.ts (CLS shape: session, client, scoped permissions)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/packages/shared/src/permissions.ts and nav.ts (canonical catalogue from §4, and the route map from §2.4)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/packages/shared/src/tracker.ts (to become `tracker/` events plus the `reduceDay()` reducer shared by tracker, api and web)