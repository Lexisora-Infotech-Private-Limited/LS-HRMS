# Lexisora HRMS — build conventions & cross-domain contract

This is the **binding contract** for everyone building a domain. Read it fully before writing code.

Precedence when documents disagree: **this file** > `docs/specs/COVERAGE-AUDIT.md` fixes > `docs/specs/MASTER-DESIGN.md` > `docs/specs/spec-<domain>.md` > wireframes (`docs/wireframes/*.html`, the visual + copy source of truth).

## 1. What "done" means

Every screen, tab, KPI, table column, button, form and flow step in the wireframes works end-to-end against the real API and PostgreSQL — no mock state in the web app. Layout, copy and component usage follow the wireframe markup (`docs/wireframes/web-app.html` lines ~317–768 for bespoke screens, the `GEN` / `FORMS` arrays ~784–856 for the generic screens and their forms). Business rules from the domain spec are implemented in services with unit tests. Demo seed data reproduces the wireframe's sample rows so every screen looks populated on first run.

**Pragmatic overrides of MASTER-DESIGN (the scaffold wins; do NOT implement these master-design items):**

| Master design says | We do |
|---|---|
| UUIDv7 ids | `cuid()` string ids |
| BigInt money | **`Int` paise** (max ~₹2.1 crore per row; totals are computed in JS `number`) |
| Decimal day counts / rates | `Float` for day counts (0.5 steps); rates in `Int` paise; round half-up at line level |
| argon2 + EdDSA JWT | bcrypt + HS256 (core auth already done) |
| Gotenberg / HTML renderer | **pdfkit** via core `PdfService` (PNG where needed via `sharp` or `qrcode`) |
| Postgres RLS | App-level tenant extension (already in `PrismaService`); RLS is a P3 hardening task |
| Outbox + ProcessedEvent | In-process `EventsService` (core) |
| Scoped permissions (OWN/TEAM/…) | Flat permission keys (`packages/shared/src/permissions.ts`); apply scope in service code by relationship (self, reports tree via `OrgService.reportTree`, project lead, dept lead) |
| Hash-chained AuditEvent, SearchDocument index, NotificationType registry, PlatformUser console, TOTP, per-tenant DEKs, dedicated DB | Not now. Use core `AuditService`, `SearchService`, `NotificationsService`. Platform admin = `User.isPlatformAdmin`. Show P3-only controls as disabled with a short "Available on Enterprise" note where the wireframe shows them. |
| Event-sourced tracker with server `reduceDay()` | Tracker client sends **events + computed segments** (`packages/shared/src/tracker.ts`); server validates, stores idempotently, and projects day summaries. |

## 2. Ownership (who edits what)

Each domain owns exactly these paths. **Never edit files owned by another domain.** Shared files you may append to are listed in §2.1.

| Domain | API | Prisma | Web | Shared contracts | Seed |
|---|---|---|---|---|---|
| platform | `apps/api/src/modules/platform/**` | `prisma/schema/platform.prisma` | `apps/web/src/modules/platform/**` | `packages/shared/src/contracts/platform.ts` | `prisma/seed/platform.ts` |
| people | `modules/people/**` | `people.prisma` | `modules/people/**` | `contracts/people.ts` | `seed/people.ts` |
| time (attendance + timesheets + approvals) | `modules/time/**` | `time.prisma` | `modules/time/**` | `contracts/time.ts` | `seed/time.ts` |
| tracker (Electron + ingest + devices) | `modules/tracker/**` | `tracker.prisma` | `modules/tracker/**` | `packages/shared/src/tracker.ts` | `seed/tracker.ts` |
| tracker app | — | — | **`apps/tracker/**`** | | |
| leavepay (leave + payroll) | `modules/leavepay/**` | `leavepay.prisma` | `modules/leavepay/**` | `contracts/leavepay.ts` | `seed/leavepay.ts` |
| work (clients, projects, tasks, GitLab, archive, interns) | `modules/work/**` | `work.prisma` | `modules/work/**` | `contracts/work.ts` | `seed/work.ts` |
| finance | `modules/finance/**` | `finance.prisma` | `modules/finance/**` | `contracts/finance.ts` | `seed/finance.ts` |
| workplace (dashboard, notices, feed, chat, helpdesk, LMS, kudos, facility, policies, wellness, CCTV) | `modules/workplace/**` | `workplace.prisma` | `modules/workplace/**` | `contracts/workplace.ts` | `seed/workplace.ts` |

Core (`apps/api/src/core/**`, `apps/web/src/{lib,components,layout,pages,styles}/**`, `App.tsx`, `main.tsx`, `packages/shared/src/{api,format,roles,nav}.ts`) is owned by the integrator. If you need a core change, work around it inside your module and list the request in your final report.

### 2.1 Shared files you may append to (single small Edit, never rewrite)
- `apps/api/prisma/schema/core.prisma`: add **back-relation fields** for your models on `Employee`, `User`, `Department` directly under your marker line `// @backrel:<domain>:<Model>`. Nothing else in core.prisma.
- `packages/shared/src/permissions.ts`: add new permission keys **inside your group** only if truly needed (keep existing keys; do not rename).
- `apps/api/package.json` / `apps/web/package.json`: do not add dependencies. Everything needed is installed (see §9). If something is truly missing, report it instead.

## 3. Database rules

- One schema file per domain in `apps/api/prisma/schema/`. Every tenant-owned model has `tenantId String` (plain scalar, **no relation to Tenant**) + `@@index([tenantId, …])`.
- **Relations:** you may declare Prisma relations between your own models, and to core models (`Employee`, `User`, `Department`, `Designation`, `Branch`, `FileObject` is scalar-only). For a relation to a core model add the back-relation field under your marker in core.prisma. Relation names must be prefixed with your domain when ambiguous (`@relation("time_TimesheetEmployee")`).
- **Cross-domain references between non-core domains are plain scalar ids** (e.g. `TimesheetLine.taskId String?`) with an index — no Prisma relation. Resolve them with a second query.
- The tenant extension stamps `tenantId` on top-level `create`/`createMany`/`upsert` and filters all reads/updates. **Nested creates must pass `tenantId: currentTenantId()` explicitly.** In seeds (no context) always pass `tenantId`.
- Enums: prefix enum names with your domain if generic (`LeaveRequestStatus`, `TimesheetStatus`, not `Status`).
- Validate/generate/push with the lock script: `pnpm --filter @lexisora/api db:sync` (validates, generates client, pushes). It may fail transiently if another domain's file is mid-edit — wait and retry. **Windows gotcha:** a running API process locks the Prisma engine DLL and makes `generate` fail with `EPERM` — never leave an API server running; stop it before db:sync.

## 4. The spine: cross-domain models other domains read (exact names — owners MUST create these exactly; others may read them via Prisma)

Owners may add more fields/models; these names/types must exist as written.

### work.prisma (owner: work)
```prisma
enum TaskStatus { OPEN ALLOTTED WIP DEV_COMPLETED QA DONE CANCELLED }
enum ProjectStatus { PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED CANCELLED }
enum ProjectHealth { NA ON_TRACK AT_RISK OFF_TRACK }
model Client  { id tenantId code name legalName? isInternal Boolean gstin? pan? address? stateCode? billingEmails String[] defaultRatePerHourPaise Int? paymentTermsDays Int status String createdAt }
model Project { id tenantId key String /*"AT", unique per tenant*/ name clientId String? isInternal Boolean category String /*WEB|MOBILE|INTERNAL|OTHER*/ techStack String[] leadEmployeeId String? startDate DateTime? @db.Date deadline DateTime? @db.Date billable Boolean ratePerHourPaise Int? estimatedMinutes Int loggedMinutes Int progressPct Int status ProjectStatus health ProjectHealth gitRepoUrl String? archiveAccess String /*LEADS_ONLY|ALL_DEVELOPERS*/ closedAt DateTime? createdAt }
model ProjectMember { id tenantId projectId employeeId role String /*LEAD|MEMBER|QA|DESIGN*/ }
model Task { id tenantId key String /*"AT-101" unique per tenant*/ number Int projectId moduleName String? departmentId String? /*team board*/ title description String? status TaskStatus assigneeEmployeeId String? reporterEmployeeId String? estimatedMinutes Int? loggedMinutes Int dueDate DateTime? @db.Date isStanding Boolean /*INT meetings etc.*/ gitBranch String? gitMrUrl String? createdAt updatedAt }
```
Internal project `INT` (isInternal=true) has standing tasks: `INT-1 Stand-up & meetings`, `INT-2 Training`. `AT-110 Code review` is a real Atlas task (audit G3).

### time.prisma (owner: time)
```prisma
enum PolicyAudience { OFFICE REMOTE }
enum PunchSource { BIOMETRIC WEB DESKTOP MOBILE REGULARIZATION SYSTEM }
enum DayStatus { PENDING PRESENT HALF_DAY ABSENT LEAVE HALF_DAY_LEAVE HOLIDAY WEEKLY_OFF HOLIDAY_WORKED WEEKLY_OFF_WORKED MISSED_PUNCH }
enum TimesheetStatus { DRAFT SUBMITTED PENDING_RM APPROVED RETURNED LOCKED }
model WorkLocation { id tenantId name address? lat Float? lng Float? geoRadiusM Int? punchMode String /*BIOMETRIC_ONLY|WEB_DESKTOP_ALLOWED*/ isRemote Boolean }
model Shift { id tenantId name startMinute Int endMinute Int graceMinutes Int breakMinutes Int weeklyOffDays Int[] /*0=Sun*/ isDefault Boolean }
model AttendancePolicy { id tenantId audience PolicyAudience /*@@unique([tenantId,audience])*/ biometricMandatory Boolean allowWebPunch Boolean allowDesktopPunch Boolean autoIdleEnabled Boolean autoIdleMinutes Int screenshotsEnabled Boolean screenshotIntervalMinutes Int blurScreenshots Boolean deductIdleFromPayroll Boolean monthlyIdleAllowanceMinutes Int breakReminderMinutes Int offlineRetentionDays Int screenshotRetentionDays Int updatedAt }
model Holiday { id tenantId date DateTime @db.Date name type String /*MANDATORY|OPTIONAL*/ }
model AttendanceDay { id tenantId employeeId date DateTime @db.Date status DayStatus firstInAt DateTime? lastOutAt DateTime? primarySource PunchSource? workedMinutes Int breakMinutes Int idleMinutes Int isLate Boolean lateByMinutes Int presentFraction Float leaveFraction Float idleDeductibleMinutes Int isLocked Boolean  /*@@unique([employeeId,date])*/ }
model Timesheet { id tenantId employeeId weekStart DateTime @db.Date weekEnd DateTime @db.Date status TimesheetStatus submittedAt DateTime? approvedAt DateTime? totalMinutes Int idleMinutes Int screenshotCount Int /*@@unique([employeeId,weekStart])*/ }
model TimesheetLine { id tenantId timesheetId projectId String? taskId String? label String subLabel String? billable Boolean }
model TimesheetCell { id tenantId lineId date DateTime @db.Date trackedMinutes Int adjustmentMinutes Int outsideHoursMinutes Int finalMinutes Int billedInvoiceLineId String? /*@@unique([lineId,date])*/ }
```
Employee → policy: `OFFICE` employees use the OFFICE policy; `REMOTE` and `HYBRID` use REMOTE (web + desktop punch allowed). Employee `shiftId`/`workLocationId` are scalar columns on core `Employee`.

### tracker.prisma (owner: tracker)
```prisma
model TrackerDevice { id tenantId userId employeeId hostname os appVersion status String /*PENDING|ACTIVE|REVOKED*/ pairedAt DateTime? lastSeenAt DateTime? }
model ActivitySegment { id tenantId clientId String @unique employeeId deviceId String? workDate DateTime @db.Date kind String /*WORK|BREAK|IDLE|IDLE_WORK*/ taskId String? projectId String? startAt DateTime endAt DateTime durationSec Int idleResolution String? /*for IDLE: DEDUCTED|AS_BREAK|CLAIMED_WORK*/ }
model IdleClaim { id tenantId employeeId workDate DateTime @db.Date startAt endAt minutes Int taskId String? note String? status String /*PENDING|APPROVED|REJECTED*/ reviewerEmployeeId String? decidedAt DateTime? }
model Screenshot { id tenantId clientId String @unique employeeId deviceId String? capturedAt DateTime workDate DateTime @db.Date taskId String? fileId String /*FileObject*/ thumbFileId String? blurred Boolean }
model TrackerDaySummary { id tenantId employeeId workDate DateTime @db.Date workedSec Int breakSec Int idleSec Int idleDeductedSec Int screenshotCount Int perTask Json /*[{taskId,key,title,seconds}]*/ /*@@unique([employeeId,workDate])*/ }
```

### leavepay.prisma (owner: leavepay)
```prisma
enum LeaveRequestStatus { PENDING APPROVED REJECTED WITHDRAWN CANCELLATION_PENDING CANCELLED }
model LeaveType { id tenantId code String /*EL CL SL CO*/ name annualQuota Float carryForwardMax Float? encashable Boolean appliesTo String[] /*EmploymentType values*/ isPaid Boolean active Boolean }
model LeaveBalance { id tenantId employeeId leaveTypeId year Int opening Float accrued Float credited Float availed Float pending Float lapsed Float available Float /*@@unique([employeeId,leaveTypeId,year])*/ }
model LeaveRequest { id tenantId requestNo String employeeId leaveTypeId fromDate DateTime @db.Date toDate DateTime @db.Date halfDay String /*NONE|FIRST_HALF|SECOND_HALF*/ days Float reason String? status LeaveRequestStatus approverEmployeeId String? decidedAt DateTime? decisionNote String? createdAt }
model LeaveRequestDay { id tenantId requestId employeeId date DateTime @db.Date units Float isPaid Boolean active Boolean }
model EmployeeSalary { id tenantId employeeId effectiveFrom DateTime @db.Date ctcAnnualPaise Int grossMonthlyPaise Int structureEnc String /*CryptoService.encryptJson([{code,label,monthlyPaise,annualPaise}])*/ status String /*ACTIVE|SUPERSEDED*/ }
model Payslip { id tenantId employeeId runId period String /*"2026-08"*/ workingDays Float paidDays Float lopDays Float idleMinutes Int idleDeductionPaise Int grossPaise Int deductionsPaise Int netPaise Int fileId String? status String /*DRAFT|PUBLISHED|VOID*/ publishedAt DateTime? }
```

### finance.prisma (owner: finance)
`Account`, `Voucher`, `VoucherLine` (double entry), `Invoice`, `InvoiceLine`, `InvoiceTimeEntry { timesheetCellId @unique }`, `Vendor`, `Purchase`, `FilingFolder`, `FilingDocument`. Finance posts vouchers when it receives events (§6).

### people.prisma / workplace.prisma / platform.prisma
Owned internally; other domains don't read them except: `workplace` `Notice`, `Post`, `Kudos` (people profile badges read `Kudos` by `employeeId`), `platform` `Subscription` (seat counts).

## 5. Module dependencies (API)

Reads across domains: **direct Prisma reads of spine models are allowed** (read-only). Writes to another domain's tables are **not** allowed — use its exported service or an event.

Allowed Nest module imports (to call exported services synchronously):
- `TrackerModule` imports `TimeModule` → `AttendanceService.punch(...)` (desktop punches create `AttendancePunch`/`WorkSession` owned by time).
- `LeavepayModule` imports `TimeModule` → `PeriodLockService`.
- `WorkplaceModule`, `PlatformModule`, `PeopleModule`, `WorkModule`, `FinanceModule`: import nothing from other domains.
- Time must NOT import tracker/leavepay/work.

Exported services (owners implement + export from their module):
- time: `AttendanceService.punch({ employeeId, direction: 'IN'|'OUT', source: PunchSource, at?: Date, deviceId?, geo? }) → { ok, day, session } | throws AppError(403,'PUNCH_NOT_ALLOWED', msg)`, `AttendanceService.recomputeDay(employeeId, date)`, `PeriodLockService.isLocked(date)`, `PeriodLockService.lock(month, upTo)`.

## 6. Events (core `EventsService`; emit after the write succeeds)

| Event | Payload | Producer → consumers |
|---|---|---|
| `employee.created` | `{ employeeId }` | people → leavepay (open balances), time (shift/location defaults), workplace (channel membership, LMS required courses) |
| `employee.statusChanged` | `{ employeeId, from, to }` | people → tracker (revoke devices on EXITED), leavepay |
| `onboarding.completed` | `{ employeeId }` | people (ID card generation), workplace (welcome post optional) |
| `attendance.punched` | `{ employeeId, date, direction, source }` | time → tracker (push status to device), workplace (dashboard refresh via socket) |
| `tracker.segmentsIngested` | `{ employeeId, workDates: string[] }` | tracker → time (recompute AttendanceDay + timesheet tracked minutes) |
| `idle.claimDecided` | `{ claimId, employeeId, workDate, status }` | tracker/time → time (re-project) |
| `timesheet.submitted` / `timesheet.approved` / `timesheet.returned` | `{ timesheetId, employeeId, weekStart }` | time → leavepay (payroll gate), finance (billable hours available), workplace |
| `leave.decided` | `{ requestId, employeeId, status }` | leavepay → time (mark AttendanceDay LEAVE), workplace |
| `payroll.finalized` | `{ runId, period, totals: { grossPaise, netPaise, deductionsPaise, employerPfPaise } }` | leavepay → finance (salary voucher) |
| `invoice.issued` / `invoice.paid` | `{ invoiceId }` | finance → finance ledger |
| `task.statusChanged` | `{ taskId, from, to }` | work → workplace, tracker |
| `kudos.given` / `eotm.announced` | `{ kudosId }` / `{ awardId, employeeId, month }` | workplace (feed post, certificate) |

Realtime (core `RealtimeGateway`): `toUser(userId, event, payload)`, `toTenant`, `toRoom('d:<deviceId>')`. Web: `onRealtime(event, fn)`.

## 7. API conventions

- Controllers under your module; route prefixes you own:
  - time: `/attendance`, `/shifts`, `/locations`, `/attendance-policy`, `/holidays`, `/id-compliance`, `/timesheets`, `/timesheet-approvals`, `/regularizations`, `/period-locks`
  - tracker: `/tracker/**`, `/devices/**`
  - leavepay: `/leave/**`, `/payroll/**`, `/payslips/**`, `/salary/**`
  - work: `/clients`, `/projects`, `/tasks`, `/boards`, `/archive`, `/interns`, `/git`
  - finance: `/ledger`, `/accounts`, `/vouchers`, `/invoices`, `/purchases`, `/vendors`, `/filing`
  - people: `/employees`, `/profile`, `/onboarding`, `/vault`, `/documents`, `/jobs`, `/candidates`, `/interviews`, `/appraisals`, `/assets`, `/welcome-kits`, `/id-cards`, `/vcard`, `/masters`, `/esign`
  - workplace: `/dashboard`, `/notices`, `/feed`, `/chat`, `/calls`, `/helpdesk`, `/lms`, `/kudos`, `/eotm`, `/certificates`, `/facility`, `/policies`, `/wellness`, `/cctv`, `/quotes`, `/todos`, `/events`
  - platform: `/roles`, `/audit`, `/billing`, `/branding`, `/tenants`, `/privacy`, `/support`, `/settings/security`
  - core (exists): `/auth/**`, `/notifications/**`, `/files/**`, `/lookups`, `/approvals/counts`, `/search`, `/health`
- Validate every body/query with a zod schema from `packages/shared/src/contracts/<domain>.ts` via `new ZodPipe(schema)`. Export inferred types for the web.
- Guard with `@RequirePerm('key')` (any-of). Apply relationship scope in the service (self / reports / project lead). Access helpers: `requireContext()` (tenantId, userId, employeeId, permissions), `hasPerm(ctx, key)`, `OrgService.me()/myEmployeeId()/reportTree()`.
- Errors: throw `AppError(status, CODE, message)` / `notFound()` / `forbidden()` / `badRequest()` from `core/http/errors`. Messages are user-facing copy.
- Lists: `paginationQuery` from shared; return `Paginated<T>` via `paginated()`; tabs = `?tab=` filter; counts for tab labels in a `counts` field when the wireframe shows them ("All · 128").
- Side effects: `AuditService.record({action, entity, entityId, meta})` on every state change; `NotificationsService.notify({userIds, type, title, body, link, from, email})` for alerts; `EventsService.emit`; `JobsService.register/enqueue` for heavy work (PDF batches, payslip generation, reminders); `@Cron` from `@nestjs/schedule` for schedules (wrap with `runAsTenant` per tenant).
- Registries (call in `onModuleInit`): `LookupsService.register(type, fn)` for dropdowns (types in `apps/web/src/components/lookups.ts`), `ApprovalCountsService.register(fn)` (dashboard "Awaiting your approval"), `SearchService.register(type, fn)` (header search), `fileAccessCheckers.push(fn)` (who may open a private FileObject you reference).
- Files: upload through `POST /files` (web `uploadFile(file, category)`) and store the returned id; or server-side `StorageService.save(...)` for generated PDFs. Download links: web `fileUrl(id)`; generated documents via your own `GET …/pdf` endpoint returning `application/pdf`.
- Sensitive data: `CryptoService.encrypt/decrypt(Json)` for PAN, Aadhaar, bank account, salary structures; show masked values unless the viewer holds the right permission.
- Numbers: `SequenceService.next(key, { prefix, pad, period })` (`financialYear()` helper) for HD-, INV-, RCPT-, PMT-, HRV-, SUP-, LX- codes.
- Money: `Int` paise; format on the web with `formatINR` / `formatINRCompact`. Dates: business day in IST (`istDateKey`), store `@db.Date` as UTC midnight of that IST date.
- Integrations: define an interface + a stub/real adapter inside your module (`<module>/adapters/*.ts`), choose by env (`env.GITLAB_TOKEN` etc.). Stubs must behave realistically (return ids, log, send the email through Mailpit, generate `wa.me` links).

## 8. Web conventions

- Your routes live in `apps/web/src/modules/<domain>/routes.tsx` (`export const routes: RouteObject[]`, paths relative, e.g. `'attendance'`), collected automatically. Replace the placeholders already there. Wrap each route element with `guard(permission, <Page/>)`. Pages in `modules/<domain>/pages/*.tsx`, API hooks in `modules/<domain>/api.ts`.
- Data: TanStack Query (`useQuery({ queryKey: ['<domain>', …], queryFn: () => get(...) })`), mutations via `useAction(fn, { success: 'Toast copy from wireframe', invalidate: [[…]] })`. Toast copy = the wireframe's `flash(...)` / FORMS `toast` strings (with the audit's copy fixes).
- UI kit (use it; don't restyle): `PageHeader`, `Tabs`, `Seg`, `Pills`, `Kpis`, `Card`, `Tag`, `StatusTag`/`toneFor`, `Avatar`, `Check`, `Modal`, `ConfirmDialog`, `TimelineBar`, `Loading`, `Empty`, `ErrorBlock` (`components/ui.tsx`); `DataTable`, `Pager` (`components/table.tsx`); `FormModal` + `FieldDef` (`components/form.tsx`, the wireframe FORMS as data), `FileDrop`, `MultiSelect`; `useLookups` (`components/lookups.ts`). CSS classes in `styles/design-system.css` + `styles/app.css` (`.card`, `.tag-*`, `.kicker`, `.big-num`, `.list-row`, `.kv-row`, `.grid-2-1`, `.note`, `.placeholder-media`, `.timeline`, …). Add module-specific CSS in `modules/<domain>/<domain>.css` imported by your pages.
- Session: `useMe()` (name, initials, roleKey, permissions, employeeId, workMode), `useCan()(perm)`. Files: `fileUrl(id)`, `authUrl('/payslips/…/pdf')`, `download(path)`.
- Keep `data-screen-label="<Wireframe label>"` on each screen root.
- Cross-module widgets (fixed exports; owners implement, others import):
  - `@/modules/time/punch` → `PunchButton` (header), `PunchCard` (dashboard "Today" card), `usePunch()`
  - `@/modules/leavepay/widgets` → `LeaveBalanceCard` (dashboard), `LeaveHistoryList` (dashboard), `useLeaveBalances()`
  - `@/modules/tracker/DevicesPanel` → `DevicesPanel` (profile → Devices tab)
  - `@/modules/platform/GlobalSearch` → `GlobalSearch` (header)
- Responsive: layouts must work down to ~390 px (grid collapses; tables scroll horizontally).

## 9. Installed dependencies (do not add more)

API: NestJS 11, Prisma 6.19, zod 3, bcryptjs, bullmq/ioredis, socket.io, nodemailer, multer, pdfkit, qrcode, sharp, csv-parse, livekit-server-sdk, @nestjs/schedule. Web: React 18, react-router-dom 6, TanStack Query 5, socket.io-client, livekit-client, zod. Tracker: Electron 37, electron-vite 4, electron-builder 26, React 18. Tests: vitest 3 everywhere. Use Node built-ins (`crypto`, `fs`, `zlib`) for everything else. Rich text (feed composer): `contentEditable` + a small toolbar with sanitization on the server (strip scripts/handlers; allow b,i,h2,a,img,ul,ol,li,p,br).

## 10. Seed data

- `apps/api/prisma/seed/<domain>.ts` exports `seed_<domain>(prisma, ctx)`; run order: platform → people → work → time → tracker → leavepay → finance → workplace (`pnpm --filter @lexisora/api db:reset` rebuilds everything).
- `ctx` has `tenantId`, `roles`, `emp` (keys: rohit, kavya, neha, arjun, priya, rahul, sneha, vikram, ananya, isha, karan, divya, meera), `user`, `dept`, `desig`, `branch`, and `extra` (a shared bag: put ids later domains need, e.g. `ctx.extra.projects = { AT: id }`). Seeds use `prisma` (raw client, no tenant context) → always pass `tenantId`.
- Reproduce the wireframe rows (names, figures, statuses, dates around "today" = Tue 29 Sep 2026). Where the audit notes contradictions, prefer computed values (e.g. payroll figures come from the engine) but keep them close to the wireframe.
- Seeds must not fail if a later/earlier domain's data is absent (check before using).

## 11. Verification each domain must do before finishing

1. `pnpm --filter @lexisora/api db:sync` passes (schema valid + pushed).
2. `cd apps/api && npx tsc --noEmit -p tsconfig.json` — **zero errors in your files** (filter the output by your paths; report errors you see in others' files but don't fix them).
3. `cd apps/web && npx tsc --noEmit` — zero errors in your files.
4. Unit tests for your business rules: `apps/api/src/modules/<domain>/**/*.spec.ts` (pure functions: calculators, state machines, routing) — `cd apps/api && npx vitest run src/modules/<domain>`.
5. Your seed runs: the integrator runs the full `db:reset`; you can test yours in isolation only if it doesn't depend on others.
6. Do not start long-running servers (the integrator runs the full stack + e2e). If you must smoke-test an endpoint, run the API on your own port (`PORT=41xx`), and kill it immediately after.
7. Do not commit; the integrator commits.

Final report (your return value): what you built (screens/endpoints/models), what's stubbed and why, known gaps, core change requests, and cross-domain assumptions you made.
