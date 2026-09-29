# Build Spec: Projects, Task Boards, GitLab, Interns + Finance

Lexisora HRMS: People & Operations Suite. Domain owner: Work and Finance.

Sources read: Flow Map `FLOWS` (flow 01 "Employee daily start", flow 06 "Project delivery", flow 07 "Finance back office"); Web App markup for `kanban` (lines 539-560) and the generic template (lines 725-735); Web App `NAV`, `GEN` (`projects`, `archive`, `interns`, `invoices`, `purchases`, `ledger`, `filing`, `roles`), `FORMS` (`project`, `task`, `interntask`, `invoice`, `purchase`, `voucher`, `upload`), `COLS` and the `moveTo`/`allowedDepts` logic; the Desktop Tracker "Working on" list (lines 367-371, `TASKS` at 465).

Conventions used throughout:
- Every model has `tenantId String` with PostgreSQL RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`, plus `createdAt`, `updatedAt`, and `deletedAt?` where soft-delete is noted.
- IDs are `uuid`. Money is `Decimal(14,2)` INR. Dates are `@db.Date` in Asia/Kolkata. The financial year (FY) runs April to March, labelled "2026-27".
- Permission keys follow `module.action[.scope]`. "Scoped" means the service layer filters rows to the ones the user is related to.
- Every mutation writes an audit entry through `AuditService.log(event, entityType, entityId, before, after)`.

---

## 0. Seeded permissions for this domain (defaults; editable in Roles & access)

| Permission key | employee | lead | manager | hr | admin |
|---|---|---|---|---|---|
| `project.view` (scoped: member/lead) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.view_all` | | | ✓ | | ✓ |
| `project.create` | | ✓ | ✓ | | ✓ |
| `project.manage` (own-led projects) | | ✓ | ✓ | | ✓ |
| `project.manage_all` | | | ✓ | | ✓ |
| `client.view` | | ✓ | ✓ | | ✓ |
| `client.manage` | | | ✓ | | ✓ |
| `task.create` (on boards the user can edit) | ✓ | ✓ | ✓ | | ✓ |
| `task.move_own` | ✓ | ✓ | ✓ | | ✓ |
| `task.manage` (any task on boards the user leads) | | ✓ | ✓ | | ✓ |
| `board.allocate` (boards where the user is board lead) | | ✓ | ✓ | | ✓ |
| `board.view_all` ("View all task boards" row) | | | ✓ | | ✓ |
| `archive.view` | | ✓ | ✓ | | ✓ |
| `archive.view.shared` (ALL_DEVELOPERS items only) | | | | | |
| `archive.manage` | | | ✓ | | ✓ |
| `intern.task.assign` (mentees) | | ✓ | | ✓ | ✓ |
| `intern.task.view_all` | | | | ✓ | ✓ |
| `integration.gitlab.manage` | | | | | ✓ |
| `finance.invoice.*` (view, create, issue, payment, cancel) | | | | | ✓ |
| `finance.purchase.*` | | | | | ✓ |
| `finance.ledger.view` / `finance.voucher.post` / `finance.voucher.reverse` / `finance.period.lock` / `finance.coa.manage` | | | | | ✓ |
| `finance.voucher.hr` (HR vouchers tab only) | | | | ✓ | ✓ |
| `finance.gst.returns` | | | | | ✓ |
| `finance.filing.view` / `finance.filing.upload` / `finance.filing.delete` | | | | | ✓ |
| `finance.settings.manage` | | | | | ✓ |

Rules:
- NAV items are visible when the user holds the listed key: projects and kanban → `project.view`; archive → `archive.view` or `archive.view.shared`; interns → `intern.task.assign` or `intern.task.view_all`; ledger, invoices, purchases, filing → the `finance.*` view keys.
- The wireframe NAV shows the Ledger to admin only. That is why HR only gets `finance.voucher.hr`, which shows the Ledger screen limited to the HR vouchers tab (see open questions).
- The platform super-admin gets no tenant permissions here, and RLS blocks access to finance and filing rows.
- A seeded custom role "Accountant" (all `finance.*` except `finance.settings.manage` and `finance.period.lock`) is offered as a template but not assigned.

---

## MODULE A: Clients master (P1)

### 1. Screens & UX
- **Clients list** (derived; the wireframe only has the Client select). Route `/clients` under Work, visible with `client.view`.
  - Columns: Client, GSTIN, State, Active projects, Unbilled hours, Outstanding ₹, Status.
  - Buttons: "Add client"; clicking a row opens the client detail.
- **Client detail** tabs:
  - Overview: legal name, GSTIN, PAN, billing address, place-of-supply state, payment terms, default rate/hour, billing emails.
  - Contacts.
  - Projects.
  - Invoices (admin only).
  - Vault: client-level documents such as MSA, NDA and SOW (feeds the archive's client vault).
- **Add/Edit client form**: Name*, Legal name*, Internal (toggle), GST registration type (Regular / Composition / Unregistered / SEZ / Overseas), GSTIN, PAN (auto-filled from GSTIN), Address line 1/2, City, State* (Indian state list with GST codes), Pincode, Country (default IN), Default rate/hour, Payment terms (days, default 15), Billing emails (multi).
- A single system client "Internal" (`isInternal=true`) is seeded per tenant. It cannot be deleted or invoiced.

### 2. Data model
```prisma
enum GstRegType { REGULAR COMPOSITION UNREGISTERED SEZ OVERSEAS }
model Client {
  id String @id @default(uuid()); tenantId String
  code String            // CL-0001 auto
  name String; legalName String; isInternal Boolean @default(false)
  gstRegType GstRegType @default(REGULAR)
  gstin String?; pan String?
  addressLine1 String?; addressLine2 String?; city String?; pincode String?
  stateCode String?      // 2-digit GST state code, e.g. "24" Gujarat
  countryCode String @default("IN")
  defaultRatePerHour Decimal? @db.Decimal(12,2)
  paymentTermsDays Int @default(15)
  billingEmails String[]
  receivableAccountId String?   // Account (sub-ledger) auto-created
  status ClientStatus @default(ACTIVE)   // ACTIVE | INACTIVE
  contacts ClientContact[]; projects Project[]
  @@unique([tenantId, code]); @@unique([tenantId, name]); @@index([tenantId, gstin])
}
model ClientContact { id; tenantId; clientId; name; email; phone?; designation?; isBilling Boolean @default(false) }
```

### 3. Workflows
ACTIVE ↔ INACTIVE. An inactive client cannot receive new projects or invoices; existing records stay readable.

### 4. API
- `GET /clients` (`client.view`)
- `POST /clients`, `PATCH /clients/:id` (`client.manage`)
- `GET /clients/:id` (`client.view`)
- `POST|PATCH|DELETE /clients/:id/contacts[/:cid]` (`client.manage`)
- `GET|POST /clients/:id/documents`, `DELETE /clients/:id/documents/:docId` (`client.manage`; GET needs `archive.view`)

### 5. Business rules
- GSTIN regex `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` plus the mod-36 checksum.
- The GSTIN prefix must equal `stateCode`. PAN is GSTIN characters 3-12.
- Creating a client auto-creates a debtor sub-ledger `Sundry Debtors › <name>` (party CLIENT).

### 6. Jobs, notifications, audit
Audit events: `client.created`, `client.updated`, `client.deactivated`, `client.document.added`.

### 7. Integrations
None.

### 8. Validation & edge cases
- REGULAR and SEZ require a GSTIN. OVERSEAS forces country ≠ IN and no state.
- A client cannot be deactivated while it has ACTIVE projects (409).
- A duplicate GSTIN raises a warning, not a block, because branches can share one.

### 9. Phase
P1. Depends on Identity/RBAC.

### 10. Acceptance scenarios
1. Creating a client with GSTIN `24AAACN1234F1Z5` and state 27 is rejected with "GSTIN state mismatch".
2. Creating a client auto-creates its debtor account, and that account appears in the chart of accounts under Sundry Debtors.
3. "Internal" cannot be deleted and is absent from the invoice client select.
4. An employee calling `GET /clients` gets 403.

---

## MODULE B: Projects, modules, members (P1)

### 1. Screens & UX
**Projects** (`GEN.projects`), NAV: ALL roles.
- Title "Projects". Subtitle "Every client and internal project, with its modules, team and estimate."
- KPIs, all for the selected month (default current):
  - "Active": count of status ACTIVE; subtext "N due this month" (deadline in the current IST month).
  - "Billable hours (Sep)": Σ billable net hours on billable projects in the month (time entries not rejected); subtext "₹ X billable" = Σ hours × effective rate, formatted in lakh ("19.2 L").
  - "On track": count of ACTIVE with health ON_TRACK; subtext "N at risk" (AT_RISK + OFF_TRACK).
  - KPIs cover only the projects the viewer can see.
- Table columns:
  - Project, Client, Lead.
  - Progress (%).
  - "Estimated vs logged" (`820h / 540h`); red text when logged > estimated.
  - Status tag: Planning = neutral, On track = accent, At risk = outline, Off track = outline, On hold = neutral, Completed = accent.
- Row click opens the Task board for that project (`to:'kanban'`). A secondary icon opens Project detail.
- Toolbar (added): search, filters (status, client, lead, billable).
- Primary button "Create project" appears only with `project.create`.

**Create project form** (`FORMS.project`, submit "Create"):
- From the wireframe: Project name*, Client* (active clients + Internal), Project lead* (employees with the lead role or `project.manage`), Start*, Deadline*, Billable (Yes/No; forced No and disabled for Internal), Git repository (URL, optional), Requirement documents (multi-file).
- Added:
  - Project key (2-6 A-Z, auto-suggested from the name, e.g. "Atlas CRM" → "AT", editable until the first task exists).
  - Category (Web / Mobile / Desktop / Data / Other; drives the archive tabs).
  - Tech stack (tags).
  - Rate/hour (default from the client).
  - Estimated hours (budget).
  - Team boards (multi-select of departments, default the lead's department).
  - Modules (inline list).
- Toast "Project created". On success it navigates to the board.

**Project detail** (derived; the wireframe says "with its modules, team and estimate"). Tabs:
- Overview: dates, budget, progress bar, health reason, burn chart.
- Modules: name, estimate, tasks, logged. Buttons "Add module", "Edit", "Archive".
- Members: name, project role, department, allocation %, joined. Buttons "Add member", "Remove".
- Boards: department, board lead, member count. Button "Add team board".
- Documents (requirement/scope/design/asset). Button "Upload".
- Git: repo link status, target branch, recent MRs, "Re-link", "Test connection".
- Billing (admin): unbilled approved hours, invoices.
- Buttons: "Change status" (Planning / Active / On hold / Completed / Cancelled) and "Archive" (completed projects, `archive.manage`).

Per-role behavior:
- employee: sees only projects where they are a member; read-only; no Create.
- lead: sees member and led projects; can create; can manage projects they lead.
- manager and admin: see all and manage all.
- hr: sees projects they are a member of (no `view_all`).

### 2. Data model
```prisma
enum ProjectStatus { PLANNING ACTIVE ON_HOLD COMPLETED ARCHIVED CANCELLED }
enum ProjectHealth { NA ON_TRACK AT_RISK OFF_TRACK }
enum ProjectCategory { WEB MOBILE DESKTOP DATA OTHER }
enum ArchiveAccess { LEADS_ONLY ALL_DEVELOPERS }
enum GitLinkStatus { UNLINKED LINKED ERROR }
enum QaHandoff { LINKED_TASK SAME_CARD }
model Project {
  id; tenantId; clientId String; key String; name String; description String?
  category ProjectCategory @default(WEB); techStack String[]
  leadId String            // User.id
  startDate DateTime @db.Date; deadline DateTime @db.Date
  billable Boolean @default(true); ratePerHour Decimal? @db.Decimal(12,2)
  estimatedHours Decimal? @db.Decimal(8,2)
  status ProjectStatus @default(PLANNING)
  health ProjectHealth @default(NA); healthReason String?; healthComputedAt DateTime?
  progressPct Decimal @default(0) @db.Decimal(5,2)   // cached
  loggedMinutes Int @default(0)                      // cached, net of idle
  taskEstimateMinutes Int @default(0)                // cached Σ task estimates
  gitRepoUrl String?; gitProjectId Int?; gitDefaultBranch String?; gitTargetBranch String?
  gitLinkStatus GitLinkStatus @default(UNLINKED); gitLinkError String?
  qaHandoff QaHandoff @default(LINKED_TASK)
  taskSeq Int @default(0)
  archiveAccess ArchiveAccess @default(LEADS_ONLY)
  closedAt DateTime?; archivedAt DateTime?; archivedById String?
  createdById String; deletedAt DateTime?
  @@unique([tenantId, key]); @@unique([tenantId, name]); @@index([tenantId, status]); @@index([tenantId, leadId]); @@index([tenantId, clientId])
}
model ProjectModule { id; tenantId; projectId; name; estimatedHours Decimal? @db.Decimal(8,2); sortOrder Int; isArchived Boolean @default(false)
  @@unique([projectId, name]) }
enum ProjectRole { LEAD MEMBER QA DESIGNER VIEWER }
model ProjectMember { id; tenantId; projectId; userId; projectRole ProjectRole @default(MEMBER)
  allocationPct Int?; fromDate DateTime @db.Date; toDate DateTime? @db.Date
  @@unique([projectId, userId]); @@index([tenantId, userId]) }
enum DocKind { REQUIREMENT SCOPE DESIGN ASSET CONTRACT NDA SOW OTHER }
model ProjectDocument { id; tenantId; projectId String?; clientId String?; fileId String  // Files domain
  kind DocKind; title String; version Int @default(1); supersededById String?; uploadedById String
  @@index([tenantId, projectId]); @@index([tenantId, clientId]) }   // CHECK projectId or clientId not null
model TenantWorkSettings { tenantId @id; progressWeights Json  // {"OPEN":0,"ALLOTTED":0,"WIP":0.25,"DEV_COMPLETED":0.7,"QA":0.9,"DONE":1}
  atRiskBurnGap Decimal @default(0.10); autoWipOnFirstLog Boolean @default(true)
  invoiceHoursApprovalLevel String @default("L1") }  // L1 | L2
```

### 3. Workflow: project status

| From | To | Who | Side effects |
|---|---|---|---|
| PLANNING | ACTIVE | project.manage | health computation starts; `project.activated` |
| ACTIVE | ON_HOLD | project.manage | tracker hides its tasks; time logging blocked |
| ON_HOLD | ACTIVE | project.manage | reverses the above |
| ACTIVE / ON_HOLD | COMPLETED | project.manage | requires 0 tasks in OPEN…QA, or a bulk "cancel remaining" with reason; sets `closedAt`; boards read-only |
| COMPLETED | ARCHIVED | archive.manage (manager per flow) | appears in Archive; `archivedAt`; chat channel archived (event) |
| ARCHIVED | COMPLETED | project.manage_all | unarchive |
| PLANNING / ACTIVE / ON_HOLD | CANCELLED | project.manage_all | tasks cancelled; unbilled time stays reportable |

Creating a project, in one transaction:
1. Insert the project.
2. Insert a ProjectMember (LEAD) for the lead.
3. Create a TeamBoard per selected department. The board lead is `Department.leadUserId`, falling back to the project lead.
4. Insert modules and documents.

After commit: emit `project.created` (Comms creates channel `#<key-lower-name>`; Notices registers the audience), then enqueue `gitlab.link-project` if a repo URL is set.

### 4. API
- `GET /projects?status&clientId&leadId&billable&q&page` (`project.view`, scoped)
- `GET /projects/kpis?month=YYYY-MM` (`project.view`)
- `POST /projects` (`project.create`). The body takes `documentFileIds[]` from a prior `POST /files/presign`.
- `GET /projects/:id` (`project.view`, member or `view_all`)
- `PATCH /projects/:id` (`project.manage` as lead, or `manage_all`)
- `POST /projects/:id/status {status, reason?}` (`project.manage`)
- `GET|POST /projects/:id/modules`, `PATCH|DELETE /projects/:id/modules/:mid` (`project.manage`)
- `GET|POST /projects/:id/members`, `PATCH|DELETE /projects/:id/members/:uid` (`project.manage`)
- `GET|POST /projects/:id/documents`, `DELETE /projects/:id/documents/:docId` (view: member; write: `project.manage`)
- `GET /projects/:id/burn?from&to` (daily logged vs planned)
- Realtime room `t:{tenant}:project:{id}`, events `project.updated` and `project.health_changed`.

### 5. Business rules & calculations
- **Effective rate**: invoice override > `project.ratePerHour` > `client.defaultRatePerHour`. Missing → billable KPI ₹ excludes the project and flags "rate missing".
- **Estimated hours shown** = `project.estimatedHours` if set, else `taskEstimateMinutes/60`.
- **Logged** = Σ TimeEntry.netMinutes for the project where status ≠ REJECTED (net = tracked − auto-idle).
- **Progress** = Σ(taskEst × weight[status]) / Σ taskEst over non-cancelled, non-standing tasks.
  - If Σ taskEst = 0, use a count-based fraction with the same weights.
  - Rounded to an integer %.
- **Health** (recomputed on task/time events, debounced 60 s, plus nightly). For ACTIVE projects only:
  - `burn = logged / estimated`
  - `timeElapsed = (today − start)/(deadline − start)`
  - OFF_TRACK if today > deadline, or (burn > 1.0 and progress < 0.9).
  - AT_RISK if burn − progress > 0.10, or (timeElapsed − progress > 0.15 and deadline ≤ 30 days away), or overdue open tasks > 20% of open tasks.
  - Otherwise ON_TRACK.
  - `healthReason` stores the triggering rule, e.g. "Logged 93% of estimate vs 82% progress". Check against the sample: Kestrel 372/400 = 93% burn vs 82% progress → AT_RISK.
  - PLANNING, ON_HOLD, COMPLETED → NA, and the Status column shows the status label.
- **Project key**: `^[A-Z]{2,6}$`, unique per tenant, immutable once `taskSeq > 0`.
- Adding a member does not grant board access. Board membership is separate (Module C). Removing a member revokes all their board memberships in that project.

### 6. Jobs, notifications, audit
- Jobs:
  - `project.health.recompute` (debounced per project; nightly 02:00 IST for all).
  - `project.deadline.reminder` daily 09:00: deadline in 7 days and progress < 90% → alert the lead and the manager.
- Notifications:
  - Member added → in-app "You were added to Atlas CRM".
  - Health to AT_RISK or OFF_TRACK → lead and manager, in-app plus email.
- Audit: `project.created`, `project.updated` (diff), `project.status_changed`, `project.member.added`, `project.member.removed`, `project.module.*`, `project.document.added`, `project.document.removed`.

### 7. Integrations
GitLab link (see Module D).

### 8. Validation & edge cases
- Deadline ≥ start.
- A lead who is not an active employee → 422.
- A billable project with an Internal client → forced false.
- Duplicate name or key → 409.
- Files: max 25 MB each, 20 per project form; pdf/docx/xlsx/png/jpg/zip/md.
- Changing the client after an invoice has been issued → 409.
- The lead cannot be removed as a member; change the lead first.
- An ON_HOLD or ARCHIVED project rejects new time entries (Timesheet calls `GET /internal/projects/:id/loggable`).

### 9. Phase
P1. Depends on People (Department.leadUserId, Employee), Files, Comms (channel), Timesheet (time events).

### 10. Acceptance scenarios
1. A lead creates "Atlas CRM" (key AT, client Nimbus, Development + QA boards, 2 docs). The project, 2 boards and a lead membership exist; the `#atlas-crm` channel event is emitted; the documents are listed.
2. An employee who is not a member does not see the project in `GET /projects`, and `GET /projects/:id` returns 404.
3. Tasks est 10h DONE + 10h WIP → progress = (10×1 + 10×0.25)/20 = 62.5% → "63%".
4. Estimate 400h, logged 372h, progress 82% → health AT_RISK with a reason; the KPI "On track" excludes it; the subtext shows "1 at risk".
5. Completing a project with 2 WIP tasks → 409, unless `cancelRemaining=true` with a reason.
6. KPI billable ₹ = Σ(hours × rate). With Atlas 540h at ₹1,250, "₹ 6.75 L" contributes.

---

## MODULE C: Task board / Kanban with department-isolated team boards (P1)

### 1. Screens & UX
**Task board** (`kanban`), NAV: ALL.
- Header "Task board · <Project>" with a project switcher over projects the user can see.
- Subtitle "Drag cards between columns. Moving to Dev Completed pushes the branch to GitLab."
- Primary button "Add task" (`task.create` and edit rights on at least one board of the project).
- **Team board selector**: buttons for every TeamBoard of the project (Development / QA / Design). Boards the user cannot view get the 🔒 suffix.
- **Lock screen** for a locked board: "This board is private to the {Dept} team" / "Team-level access control: only members allocated by the {Dept} lead can view or edit these tasks." The API returns 403 `BOARD_PRIVATE {department}` and never returns task data.
- **Columns** (header shows name and count): Open → Alloted → WIP → Dev Completed → QA.
  - DONE is hidden by default. A toggle "Show done (14 days)" adds a Done column.
  - CANCELLED is never shown.
- **Card**:
  - `<KEY> · <Module>`, Title, Assignee short name ("Priya S." or "—"), estimate tag ("8h").
  - Added: logged/est micro-bar; overdue badge; git badge (branch ✓ / MR !12 open / merged / sync failed ⚠); pipeline dot.
  - Card button: "Move to <next> →"; on QA it reads "Mark done".
  - Drag-and-drop between columns and reordering within a column.
  - Clicking a card opens the task drawer: fields, description (markdown), comments, activity/transition history, time logged by person, git panel (branch, MR link, commits, "Retry sync").
- **Board members panel** (board lead or `board.view_all` + manage): list members, "Allocate member" (from department employees and project members), "Revoke".

**Add task form** (`FORMS.task`, submit "Add task", toast "Task added"):
- Title*
- Project* (defaults to the current one)
- Module (project modules, plus inline "New module" if `project.manage`)
- Assignee (members of the selected team board; optional → status OPEN, else ALLOTTED)
- Estimated hours (0.25-200, step 0.25)
- Due date (warning if after the project deadline)
- Team board* (boards the user can edit)
- Description

Also reachable from the Dashboard "Pending to-do" card via its "Add task" button.

Per-role behavior:
- employee and lead: see boards where they are BoardMember or board lead.
- manager and admin (`board.view_all`): see all boards; manager/admin moves are allowed via `task.manage` on any board.
- hr: no `board.view_all` by default (follows the roles matrix; the wireframe code's `allowedDepts` shows HR all boards; see open questions).

### 2. Data model
```prisma
model TeamBoard { id; tenantId; projectId; departmentId String; name String; leadUserId String; isArchived Boolean @default(false)
  @@unique([projectId, departmentId]); @@index([tenantId, leadUserId]) }
model BoardMember { id; tenantId; boardId; userId; allocatedById String; allocatedAt DateTime @default(now()); revokedAt DateTime?
  @@unique([boardId, userId]); @@index([tenantId, userId]) }
enum TaskStatus { OPEN ALLOTTED WIP DEV_COMPLETED QA DONE CANCELLED }
enum TaskType { FEATURE BUG CHORE DESIGN QA_VERIFICATION STANDING }
enum TaskPriority { LOW MEDIUM HIGH URGENT }
enum GitSyncStatus { NONE PENDING SYNCED FAILED SKIPPED }
enum MrState { OPENED MERGED CLOSED }
model Task {
  id; tenantId; projectId; boardId; moduleId String?
  number Int; key String                    // "AT-101"
  title String; description String?; type TaskType @default(FEATURE); priority TaskPriority @default(MEDIUM)
  status TaskStatus @default(OPEN); rank String   // LexoRank within (boardId,status)
  assigneeId String?; reporterId String
  estimatedMinutes Int?; loggedMinutes Int @default(0)   // cached, net of idle
  dueDate DateTime? @db.Date
  parentTaskId String?                      // QA_VERIFICATION → dev task
  isStanding Boolean @default(false)        // e.g. "Meetings & stand-up", "Code review"
  gitBranch String?; gitMrIid Int?; gitMrUrl String?; gitMrState MrState?
  gitSyncStatus GitSyncStatus @default(NONE); gitSyncError String?; pipelineStatus String?
  startedAt DateTime?; devCompletedAt DateTime?; qaAt DateTime?; doneAt DateTime?; statusChangedAt DateTime
  version Int @default(0)                   // optimistic concurrency
  deletedAt DateTime?
  @@unique([tenantId, key]); @@unique([projectId, number])
  @@index([tenantId, boardId, status, rank]); @@index([tenantId, assigneeId, status]); @@index([tenantId, projectId, status])
}
model TaskTransition { id; tenantId; taskId; fromStatus TaskStatus?; toStatus TaskStatus; byId String; reason String?; at DateTime @default(now())
  @@index([taskId, at]) }
model TaskComment { id; tenantId; taskId; authorId; body String; createdAt; editedAt DateTime?; deletedAt DateTime? }
model TaskAttachment { id; tenantId; taskId; fileId; uploadedById }
```
The Internal client's standing project "INT · Internal activities" is seeded with standing tasks: `INT-1 Meetings & stand-up`, `INT-2 Code review`, `INT-3 Training`, `INT-4 Internal support`. Every employee is an implicit member of it, and its board is non-isolated.

### 3. Workflow: task state machine

Columns in order: OPEN(0), ALLOTTED(1), WIP(2), DEV_COMPLETED(3), QA(4), DONE(5).

| Transition | Who | Guard | Side effects |
|---|---|---|---|
| OPEN → ALLOTTED | board lead / task.manage, or self-assign by a board member | assignee set and a board member | notify assignee |
| ALLOTTED → WIP | assignee, board lead | — | `startedAt`; GitLab `ensureBranch` if `createBranchOn=WIP`; tracker list refresh |
| (auto) ALLOTTED → WIP | system | first time entry logged on the task and `autoWipOnFirstLog` | same as above |
| WIP → DEV_COMPLETED | assignee, board lead | repo linked → sync job (not blocking) | `devCompletedAt`; job `gitlab.dev-completed` (ensure branch, verify commits ahead, create/reuse MR); card git badge PENDING |
| DEV_COMPLETED → QA | board lead, QA board member | — | `qaAt`; if `qaHandoff=LINKED_TASK`: create a `QA_VERIFICATION` task `<QAKEY>` on the project's QA board (OPEN, parent = this task); notify the QA board lead |
| QA → DONE ("Mark done") | board lead, or QA assignee of the linked task | linked QA task DONE (if LINKED_TASK) | `doneAt`; tracker drops the task |
| QA → WIP (bounce) | board lead / QA | reason required | notify assignee |
| any backward move | board lead / task.manage | reason required | TaskTransition with reason |
| any → CANCELLED | board lead / task.manage | reason | removed from tracker; time stays |
| DONE → WIP (reopen) | board lead | reason | clears `doneAt` |

Rules for the linked QA task:
- When it reaches DONE, the parent auto-transitions QA → DONE.
- When it is CANCELLED with the result "failed" (action "Fail QA" with a reason), the parent moves QA → WIP.

Move rules:
- An employee with `task.move_own` may move only their own assigned tasks, forward by exactly one column.
- Drag-drop skipping columns needs `task.manage`. Otherwise the drop is rejected and the card snaps back with toast "Move one column at a time".

### 4. API
- `GET /projects/:id/boards` → `[{id, department, locked:boolean, leadName}]` (`project.view`). Locked boards carry no counts.
- `GET /boards/:id` and `GET /boards/:id/tasks?includeDone=` (board access). Returns 403 `{code:'BOARD_PRIVATE', department}`.
- `GET|POST /boards/:id/members`, `DELETE /boards/:id/members/:uid` (`board.allocate` as board lead, or `project.manage_all`)
- `POST /tasks` (`task.create` and board edit)
- `GET /tasks/:id` (board access), `PATCH /tasks/:id` (`task.manage`, or assignee for description/estimate before WIP)
- `POST /tasks/:id/move {toStatus, beforeId?, afterId?, reason?, version}`: 409 on version conflict; 422 `SKIP_NOT_ALLOWED` or `REASON_REQUIRED`.
- `POST /tasks/:id/reorder {beforeId?, afterId?}`
- `POST /tasks/:id/assign {assigneeId|null}`
- `DELETE /tasks/:id`: soft delete; only OPEN/ALLOTTED with `loggedMinutes=0`, else CANCELLED.
- `GET|POST /tasks/:id/comments`, `GET /tasks/:id/activity`
- `POST /tasks/:id/git/retry` (`task.manage` or assignee)
- `GET /me/tasks?status=&dueBefore=` (self; used by the Dashboard to-do and the intern dashboard)
- Tracker (device token scope `tracker`): `GET /tracker/tasks` → `[{taskId,key,title,projectName,moduleName,status,estimatedMinutes,loggedMinutes}]`. It returns the user's tasks in ALLOTTED, WIP and QA (for linked QA tasks), plus INT standing tasks, excluding ON_HOLD and ARCHIVED projects.
- Realtime (Socket.IO room `t:{tenant}:board:{boardId}`; the server checks board access on join):
  - `task.created`, `task.updated`, `task.moved {id,from,to,rank,version}`, `task.deleted`, `task.git_status`.
  - User room `t:{tenant}:user:{id}` gets `tracker.tasks_changed`.

### 5. Business rules
- Task number: `UPDATE project SET taskSeq = taskSeq+1 RETURNING taskSeq`, run in the same transaction as the insert. Key = `${project.key}-${n}`.
- Estimate is stored in minutes. The card shows `Xh` (or `Xh Ym`).
- A time entry on a task (Timesheet event) updates `loggedMinutes += delta` and the project caches.
- Overrun flag when `loggedMinutes > estimatedMinutes × 1.2` → notify the board lead once.
- Due today or tomorrow → in the assignee's Dashboard to-do list.
- Revoking a BoardMember:
  - Their ALLOTTED tasks on the board return to OPEN (assignee null).
  - WIP and later tasks keep the assignee, flagged "assignee lost access", and the board lead is notified.
- The board lead is always an implicit member. Project lead has no implicit access to other departments' boards (matches the wireframe: the lead sees Development only).
- Standing tasks (INT-*) are not shown on kanban columns. They appear only in the tracker and timesheet.

### 6. Jobs, notifications, audit
- Jobs:
  - `task.due.digest` daily 09:15 IST: per board lead, overdue plus due-today tasks (in-app, and email if > 0).
  - `task.overrun.check` runs on the time event.
- Notifications:
  - Assigned → assignee.
  - Moved to QA → QA lead.
  - Bounced → assignee.
  - Git sync failed → assignee and board lead.
- Audit: `task.created`, `task.updated`, `task.moved`, `task.assigned`, `task.cancelled`, `task.deleted`, `board.member.allocated`, `board.member.revoked`, `board.created`.

### 7. Integrations
GitLab (Module D).

### 8. Validation & edge cases
- Concurrent drags: optimistic version. The loser gets 409 and the UI refetches the column.
- A task moved to DONE while the tracker is running on it → the tracker receives `tracker.tasks_changed` and prompts "Task closed — pick another" (time is kept up to that moment).
- Board of an archived project → read-only (all mutations 423 `PROJECT_LOCKED`).
- Assignee must be a board member (422).
- Changing a task's module to another project's module → 422.
- Estimate > 200h → 422 "split the task".
- A LINKED_TASK QA handoff with no QA board → fall back to SAME_CARD with a warning in the audit log.

### 9. Phase
P1. Depends on People (departments, department leads), Timesheet/Tracker (time events, `/tracker/tasks` consumer), Comms (none), Notifications.

### 10. Acceptance scenarios
1. Priya (Development member) opens the Atlas board. Development is open; QA and Design show 🔒. `GET /boards/{qa}/tasks` → 403 BOARD_PRIVATE. The manager sees all three.
2. The QA lead allocates Priya to the QA board → Priya's QA button unlocks in realtime. Revoke → locked again and her ALLOTTED QA tasks return to OPEN.
3. An employee drags her own card from Alloted to Dev Completed (skipping WIP) → rejected. "Move to WIP →" works. Two users move the same card concurrently → one gets 409.
4. Priya logs the first tracker minutes on an ALLOTTED task → it auto-moves to WIP, and the board room receives `task.moved`.
5. A card goes to QA → linked QA-board task created. The QA lead marks it Done → parent is DONE, hidden from the board and absent from Priya's `/tracker/tasks`.
6. A backward move without a reason → 422. With a reason → a TaskTransition row is stored.

---

## MODULE D: GitLab integration (P1; real adapter + mock)

### 1. Screens & UX
- **Admin › Integrations › GitLab** (derived; `integration.gitlab.manage`) fields:
  - Base URL (default https://gitlab.com), Access token (masked, last4).
  - Default target branch (`develop`), Branch pattern (`feature/{key}`, lowercased → `feature/at-101`).
  - MR title pattern (`{KEY}: {title}`).
  - Create branch on (WIP | Dev Completed; default WIP).
  - Require commits before Dev Completed (default on).
  - Buttons "Test connection" and "Save".
  - Shows the webhook URL and secret (copy; regenerate).
- **Project › Git tab**: repo URL, link status, target branch override, "Re-link", last 10 MRs.
- **Card and drawer git badge**: Branch created ✓, MR !n (opened/merged/closed), pipeline status, "Retry sync" on FAILED, toast "AT-101 → Dev Completed · branch feature/at-101 · MR !42 opened".

### 2. Data model
```prisma
model GitIntegration { id; tenantId; provider String @default("GITLAB"); baseUrl String
  tokenCiphertext Bytes; tokenLast4 String; webhookSecretHash String
  defaultTargetBranch String @default("develop"); branchPattern String @default("feature/{key}")
  mrTitlePattern String @default("{KEY}: {title}"); createBranchOn String @default("WIP")
  requireCommits Boolean @default(true); status String @default("ACTIVE"); lastCheckedAt DateTime?
  @@unique([tenantId, provider]) }
model GitWebhookDelivery { id; tenantId; integrationId; eventUuid String; eventType String; payload Json
  receivedAt DateTime @default(now()); processedAt DateTime?; error String?
  @@unique([integrationId, eventUuid]) }
model GitCommitLink { id; tenantId; taskId; sha String; message String; authorEmail String; committedAt DateTime; url String
  @@unique([taskId, sha]) }
model GitSyncJob { id; tenantId; taskId; action String; attempts Int; lastError String?; status String; createdAt }  // mirror of BullMQ for UI
```
Project git fields are listed in Module B. The token is encrypted with the tenant data key (AES-256-GCM; KMS envelope in P3).

### 3. Workflows
- **Link project** (job `gitlab.link-project`):
  1. Parse the repo URL to a namespace/path.
  2. `GET /projects/:urlencoded`, then store `gitProjectId`, `defaultBranch`, `gitTargetBranch` (= integration default if that branch exists, else the repo default).
  3. Create the project webhook (push, merge_request, pipeline events; token = secret) if absent.
  4. Set `gitLinkStatus` = LINKED, or ERROR with a message.
- **Ensure branch** (on WIP or Dev Completed): `GET /repository/branches/:name`; if 404, `POST /repository/branches {branch, ref: targetBranch}`. Set `task.gitBranch`.
- **Dev Completed** (job `gitlab.dev-completed`, idempotent per taskId + devCompletedAt):
  1. Ensure the branch.
  2. If `requireCommits`: `GET /repository/compare?from=target&to=branch`; with 0 commits → FAILED "No commits on feature/at-101 — push your work and retry". The task stays in DEV_COMPLETED, flagged, and the board lead may "Accept without MR" (sets SKIPPED).
  3. Look for an open MR with source = branch; else `POST /merge_requests {source_branch, target_branch, title, description: task link + description, remove_source_branch:true, labels:[project key]}`.
  4. Store the iid, url and state; set SYNCED; emit `task.git_status`.
- **Webhooks** `POST /webhooks/gitlab/:integrationId`:
  - Verify `X-Gitlab-Token` with a constant-time compare against the hash.
  - Dedupe on `X-Gitlab-Event-UUID`; respond 202 and process async.
  - Push hook: for each commit, find task keys with regex `\b([A-Z]{2,6})-(\d+)\b` in the message, or derive from the branch name `feature/<key>`. Upsert GitCommitLink.
  - Merge Request hook: update `gitMrState` and the task activity. On `merged` while the task is in DEV_COMPLETED or QA, add an activity entry "MR merged" (no auto-status change; configurable later).
  - Pipeline hook: `pipelineStatus` for the task whose branch matches.
  - Tenant is resolved from `integrationId` via a SECURITY DEFINER lookup, then `SET app.tenant_id`.

### 4. API
- `GET|PUT /integrations/gitlab` and `POST /integrations/gitlab/test` (`integration.gitlab.manage`)
- `POST /integrations/gitlab/webhook-secret/rotate` (`integration.gitlab.manage`)
- `POST /projects/:id/git/link` (`project.manage`)
- `POST /tasks/:id/git/retry` (assignee or `task.manage`)
- `POST /tasks/:id/git/accept-without-mr {reason}` (board lead)
- `POST /webhooks/gitlab/:integrationId` (public, token-verified, rate-limited 50 rps)

### 5. Business rules
- Branch name = pattern with `{key}` lowercased and slug-safe (`[a-z0-9._/-]`), max 100 characters.
- An existing branch or MR is reused, never duplicated.
- Git operations never block the status change (the DB transition commits first), except the optional "require commits" flag, which marks FAILED after the fact.

### 6. Jobs, notifications, audit
- Queue `gitlab`: `link-project`, `ensure-branch`, `dev-completed`, `webhook-process`.
- Retries: 5 attempts with exponential backoff (1 m, 5 m, 15 m, 1 h, 6 h). 401/403 are not retried; they mark the integration `status=AUTH_ERROR` and alert admins.
- Notifications: sync FAILED → assignee and board lead; token invalid → admins (email).
- Audit: `gitlab.integration.updated`, `gitlab.branch.created`, `gitlab.mr.created`, `gitlab.sync.failed`, `gitlab.accept_without_mr`, `gitlab.webhook.rejected` (bad token).

### 7. Integrations
```ts
interface GitProviderAdapter {
  resolveProject(repoUrl: string): Promise<{ projectId: number; defaultBranch: string; webUrl: string }>;
  ensureWebhook(projectId: number, url: string, secret: string): Promise<{ hookId: number }>;
  getBranch(projectId: number, name: string): Promise<{ name: string; commitSha: string } | null>;
  createBranch(projectId: number, name: string, ref: string): Promise<{ name: string; commitSha: string }>;
  compare(projectId: number, from: string, to: string): Promise<{ commitsAhead: number }>;
  findOpenMr(projectId: number, sourceBranch: string): Promise<MrRef | null>;
  createMr(projectId: number, i: { source: string; target: string; title: string; description: string; labels: string[] }): Promise<MrRef>;
  testConnection(): Promise<{ ok: boolean; user: string; scopes: string[] }>;
}
type MrRef = { iid: number; url: string; state: 'opened'|'merged'|'closed' };
```
- `GitLabRestAdapter`: GitLab REST v4 with a PRIVATE-TOKEN header, scope `api`, and 429/5xx backoff.
- `MockGitAdapter`: branches and MRs kept in a `mock_git_*` table. `commitsAhead` defaults to 1. A dev endpoint `POST /dev/mock-git/emit {taskKey, event}` produces synthetic webhooks.

### 8. Validation & edge cases
- Repo URL not found or no access → LINK ERROR; tasks still work (`gitSyncStatus=SKIPPED`).
- Project not linked → SKIPPED silently, with the badge "No repo".
- Target branch deleted → fall back to the repo default and log a warning.
- A webhook for an unknown key is ignored.
- Replayed webhook → deduped.
- Token rotation re-encrypts the stored token.

### 9. Phase
P1 (flow 01 step 4). Webhooks and pipeline status are P1; MR reviewer to-dos on the dashboard are P2.

### 10. Acceptance scenarios
1. With the mock adapter, moving AT-101 to WIP creates branch `feature/at-101`, and moving it to Dev Completed creates an MR. The card shows "MR !1 opened" via `task.git_status`.
2. `commitsAhead=0` → FAILED badge plus a notification. The lead's "Accept without MR" → SKIPPED and an audit row.
3. The same webhook UUID posted twice → one processing. A bad token → 401 and the audit entry `gitlab.webhook.rejected`.
4. A push hook with commit message "AT-101 fix pdf" → a GitCommitLink on AT-101 shown in the drawer.
5. GitLab returns 503 three times, then 201 → the job succeeds on attempt 4 and the status ends SYNCED.

---

## MODULE E: Project archive & client vault (P2)

### 1. Screens & UX
**Project archive & client vault** (`GEN.archive`), NAV: lead, manager, admin.
- Subtitle "Completed projects with original requirements, assets and scope documents, searchable for future reference."
- Tabs:
  - All.
  - Web (category WEB).
  - Mobile (MOBILE).
  - Internal (client `isInternal`).
  - DESKTOP, DATA and OTHER appear only under All.
- Full-text search over name, client, tech, document titles and tags.
- Columns: Project, Client, Closed (`closedAt` as "Mar 2026"), Documents (count of project documents plus inherited client docs, e.g. "14 files"), Tech (`techStack` joined), Access tag (Leads only / All developers).
- Row → Archive detail:
  - Read-only project summary: final estimate vs logged, team, modules, task stats.
  - Documents grouped by kind, with download.
  - Client vault section: client-level MSA, NDA and SOW.
  - Board snapshot (read-only).
  - Buttons "Change access" (`archive.manage`), "Add document" (`archive.manage`), "Unarchive" (`project.manage_all`).

Access rules:
- LEADS_ONLY: holders of `archive.view`.
- ALL_DEVELOPERS: also holders of `archive.view.shared` (not seeded; a tenant may grant it to employee, and NAV then shows Archive filtered to shared items).

### 2. Data model
Reuses `Project` (status ARCHIVED, `archiveAccess`, `closedAt`, `archivedAt`) and `ProjectDocument`. Add:
```prisma
model ArchiveSnapshot { id; tenantId; projectId @unique; summary Json   // {estimatedH, loggedH, tasksByStatus, members[], modules[], invoicesTotal}
  createdAt DateTime @default(now()) }
```
Search: Postgres `tsvector` column on Project (name, client name, tech) plus a GIN index; document titles are indexed in ProjectDocument.

### 3. Workflow
COMPLETED → ARCHIVED (Module B). The snapshot is written at that moment. Documents stay in object storage, with the storage class tag `archive`.

### 4. API
- `GET /archive?tab=all|web|mobile|internal&q&page` (`archive.view` or `archive.view.shared`, filtered)
- `GET /archive/:projectId`
- `PATCH /archive/:projectId/access {archiveAccess}` (`archive.manage`)
- `POST /archive/:projectId/documents` (`archive.manage`)
- `GET /archive/:projectId/documents/:docId/download` → signed URL with a 5-minute TTL (audited)
- `POST /projects/:id/archive`, `POST /projects/:id/unarchive`

### 5. Business rules
- Documents column = count of non-superseded project documents + client documents.
- A download needs access to the item.
- Archived projects are excluded from project KPIs, the tracker and invoice project selects, except for unbilled hours (see Module G).

### 6. Jobs, notifications, audit
- Job `archive.snapshot` (on archive).
- Notification: archived → project members, in-app "Atlas CRM archived".
- Audit: `project.archived`, `project.unarchived`, `archive.access_changed`, `archive.document.downloaded`.

### 7. Integrations
Files/S3 only.

### 8. Validation & edge cases
- Archiving requires COMPLETED status.
- Unarchive restores COMPLETED (not ACTIVE).
- An employee with `view.shared` opening a LEADS_ONLY item → 404.

### 9. Phase
P2. Depends on Module B, Files.

### 10. Acceptance scenarios
1. The manager archives completed "Helix" → it appears under All and Web with "Closed Mar 2026", and a snapshot exists.
2. A lead downloads a document → a signed URL is returned and the audit entry `archive.document.downloaded` is written.
3. Tenant grants `archive.view.shared` to employee → the employee sees Quill LMS (All developers) but not Helix (Leads only).
4. Internal tab lists only projects whose client is Internal.
5. Search "Vue" returns Pulse analytics.

---

## MODULE F: Intern task sheets + intern dashboard (P2)

### 1. Screens & UX
**Intern task sheets** (`GEN.interns`), NAV: lead, hr, admin.
- Subtitle "Interns have a separate dashboard with daily task sheets, tracked apart from full-time staff."
- Date picker (default today); filters mentor and department.
- Columns: Intern, Mentor, Today's task (first task title, plus "+N" if more), Hours (Σ today), Status (aggregate), Week score (ISO week average, 1 decimal).
- Aggregate status: all DONE → Done (accent); any IN_PROGRESS → In progress (outline); none assigned → Not assigned (neutral); past 18:30 with NOT_DONE → Not done.
- Row → intern week view: grid Mon-Sat of tasks, status, hours, score; mentor feedback per task; a "Score" input (0-10, step 0.5) and feedback per DONE or NOT_DONE task.
- **"Assign task" form** (`FORMS.interntask`, submit "Assign"):
  - Intern (lead: their mentees; hr/admin: all active interns).
  - Date (default today; no past dates except today).
  - Task (area).
  - Added: Estimated hours, Link to board task (optional; tasks on boards the intern is on).
- Per role: lead sees mentees only; hr and admin see all interns.

**Intern dashboard**. Replaces the standard dashboard when `Employee.employmentType = INTERN`. Cards:
- Punch (same as the regular dashboard).
- Today's tasks: each with status buttons Start → Done / Couldn't finish, hours input, note.
- This week (score trend, hours, tasks done/total).
- Mentor (name, chat link).
- Learning assignments (LMS domain).
- Notices.
- Hidden for interns: leave approvals, projects KPIs.

### 2. Data model
```prisma
enum InternTaskStatus { ASSIGNED IN_PROGRESS DONE NOT_DONE }
model InternTask { id; tenantId; internId String; mentorId String; date DateTime @db.Date
  title String; description String?; estimatedHours Decimal? @db.Decimal(4,2)
  status InternTaskStatus @default(ASSIGNED); hours Decimal? @db.Decimal(4,2); internNote String?
  mentorScore Decimal? @db.Decimal(3,1); mentorFeedback String?; scoredAt DateTime?; scoredById String?
  linkedTaskId String?; carriedFromId String?; assignedById String
  @@index([tenantId, internId, date]); @@index([tenantId, mentorId, date]) }
model InternWeekSummary { id; tenantId; internId; weekStart DateTime @db.Date; avgScore Decimal? @db.Decimal(3,1)
  hours Decimal @db.Decimal(5,2); tasksDone Int; tasksTotal Int; @@unique([internId, weekStart]) }
```
The mentor comes from People `Employee.mentorId`, defaulting to the reporting manager. Assigning copies it into `mentorId`.

### 3. Workflow
ASSIGNED → IN_PROGRESS → DONE, or NOT_DONE. The intern or mentor triggers these.

After 23:59 IST, tasks still ASSIGNED or IN_PROGRESS auto-become NOT_DONE, and the mentor may "Carry over" (creates the next-day task with `carriedFromId`).

Scoring is allowed on DONE or NOT_DONE, by the mentor, hr or admin, within 7 days.

### 4. API
- `GET /interns/sheet?date&mentorId` (`intern.task.assign` scoped, or `view_all`)
- `POST /intern-tasks` (`intern.task.assign`)
- `PATCH /intern-tasks/:id`:
  - The intern (self) may change status, hours and internNote.
  - The mentor/hr/admin may change title, description, date (future only), mentorScore and mentorFeedback.
- `POST /intern-tasks/:id/carry-over`
- `GET /interns/:id/week?weekStart`
- `GET /me/intern-dashboard`

### 5. Business rules
- Hours:
  - If `linkedTaskId` is set, hours = Σ tracker/timesheet net minutes on that task for that date.
  - Otherwise hours are self-reported (0-12).
  - Daily total > attendance worked hours → warning shown to the mentor.
- Week score = mean(mentorScore) over scored tasks in the ISO week (Mon-Sun), rounded to 1 decimal. "—" if none.
- Interns are excluded from full-time KPIs. Intern time still flows to timesheets for stipend payroll (Payroll domain).

### 6. Jobs, notifications, audit
- 10:30 IST: intern punched in with no task today → alert the mentor.
- 18:00: open tasks → reminder to the intern.
- Sunday 20:00: compute InternWeekSummary, and alert the mentor about unscored tasks.
- 00:05: auto NOT_DONE.
- Assign → intern in-app notice ("New task from Arjun Mehta").
- Audit: `intern_task.assigned`, `intern_task.updated`, `intern_task.scored`, `intern_task.carried_over`.

### 7. Integrations
None.

### 8. Validation & edge cases
- Assigning to a non-intern → 422.
- A lead assigning to a non-mentee → 403.
- Score outside 0-10 → 422.
- An intern editing someone else's task → 403.
- An intern converted to full-time → sheets stay read-only and the standard dashboard takes over.

### 9. Phase
P2. Depends on People (employmentType, mentorId), Attendance (punch status), Timesheet (linked task hours), LMS (assignments card).

### 10. Acceptance scenarios
1. Arjun assigns "Build login form validation" to Isha → she sees it on the intern dashboard; the sheet row shows Status "Not started" → she clicks Start → "In progress".
2. Isha marks Done with 4.5h → the sheet shows Hours 4.5 and Done. Arjun scores 8.5 → week score 8.5.
3. Sneha (a lead, not Isha's mentor) calling `POST /intern-tasks` for Isha → 403. HR succeeds.
4. An unfinished task at midnight → NOT_DONE; carry-over creates the next-day task linked to it.
5. Scores 7.0 and 9.0 in the week → 8.0.

---

## MODULE G: GST invoices (P2)

### 1. Screens & UX
**GST invoices** (`GEN.invoices`), NAV: admin.
- Subtitle "Invoices generated from client billable hours with GST applied, emailed from here."
- Added KPIs (optional row): Outstanding ₹, Overdue ₹ (count), Invoiced this month.
- Tabs (added): All / Draft / Emailed / Paid / Overdue.
- Columns: Invoice (number, or "Draft" for drafts), Client, Billable hours, Taxable, GST 18% (CGST+SGST or IGST total; hover shows the split), Total.
- Status tags: Draft = neutral, Emailed = outline, Partially paid = outline, Paid = accent, Cancelled = neutral, Overdue = outline in red.
- Row → invoice detail: PDF preview; actions "Edit" (draft), "Issue", "Email", "Record payment", "Download PDF", "Cancel (credit note)"; timeline (created, issued, emailed, opened?, paid); linked time entries (by employee/task, hours).

**"Generate invoice" form** (`FORMS.invoice`, submit "Generate & email", toast "Invoice emailed to client"; secondary "Save draft"):
- Client*: active, non-internal, with a billable project.
- Project*: the client's billable projects, including archived ones with unbilled hours.
- Period*: months that have unbilled approved hours, e.g. "Sep 2026". Option "Include earlier unbilled".
- Billable hours: auto = approved unbilled hours; editable. A difference needs an "Adjustment note".
- Rate / hour: auto from the effective rate.
- GST: auto-derived and shown read-only — "18% IGST" (inter-state), "9% CGST + 9% SGST" (intra-state), or "0% (Export under LUT)". Override is allowed only with `finance.invoice.override_tax` plus a reason.
- Email to: client billing emails (multi), plus Cc.
- A live preview shows Taxable / CGST / SGST / IGST / Round-off / Total.
- Guidance when hours are 0: "0 approved hours for Sep 2026 · 9 timesheets pending approval".

### 2. Data model
```prisma
model FinanceSettings { tenantId String @id
  legalName String; tradeName String?; gstin String; stateCode String; pan String; cin String?
  address Json; email String; phone String?; logoFileId String?
  invoiceNumberPattern String @default("INV-{seq:4}"); invoiceSeqResetPerFy Boolean @default(false)
  defaultSac String @default("998314"); defaultGstRate Decimal @default(18) @db.Decimal(4,2)
  defaultPaymentTermsDays Int @default(15); defaultBankAccountId String?
  bankDetailsForPdf Json   // {bank, accountName, accountNo, ifsc, branch, upiId}
  lutNumber String?; lutValidFrom DateTime? @db.Date; lutValidTo DateTime? @db.Date
  roundOffToRupee Boolean @default(true); booksLockedUpTo DateTime? @db.Date
  signatoryName String?; signatureFileId String?; eInvoiceEnabled Boolean @default(false) }
model NumberSequence { tenantId String; scope String; fy String @default(""); next Int @default(1)
  @@id([tenantId, scope, fy]) }   // scopes: INVOICE, CN, RCPT, PMT, JV, HRV, PUR, PAY
enum InvoiceStatus { DRAFT ISSUED EMAILED PARTIALLY_PAID PAID CANCELLED }
enum SupplyType { INTRA INTER EXPORT_LUT EXPORT_WITH_TAX SEZ_LUT SEZ_WITH_TAX }
model Invoice { id; tenantId; number String?; fy String?; clientId; projectId String?
  periodStart DateTime @db.Date; periodEnd DateTime @db.Date
  invoiceDate DateTime? @db.Date; dueDate DateTime? @db.Date
  placeOfSupplyState String?; supplyType SupplyType
  sellerSnapshot Json; buyerSnapshot Json          // frozen at issue: names, GSTINs, addresses
  subtotal Decimal @db.Decimal(14,2); cgst Decimal; sgst Decimal; igst Decimal
  roundOff Decimal @db.Decimal(6,2); total Decimal
  amountReceived Decimal @default(0); tdsDeducted Decimal @default(0); writtenOff Decimal @default(0); balanceDue Decimal
  status InvoiceStatus @default(DRAFT); taxOverrideReason String?
  emailTo String[]; emailCc String[]; emailedAt DateTime?; lastEmailError String?
  paidAt DateTime?; pdfFileId String?; salesVoucherId String?; irn String?; ackNo String?; signedQr String?
  notes String?; createdById; issuedById String?; issuedAt DateTime?; cancelledAt DateTime?; cancelReason String?
  version Int @default(0)
  lines InvoiceLine[]
  @@unique([tenantId, number]); @@index([tenantId, status]); @@index([tenantId, clientId]); @@index([tenantId, invoiceDate]) }
model InvoiceLine { id; tenantId; invoiceId; sortOrder Int; description String; sac String @default("998314")
  hours Decimal @db.Decimal(8,2); rate Decimal @db.Decimal(12,2); taxable Decimal @db.Decimal(14,2)
  gstRate Decimal @db.Decimal(4,2); cgst Decimal; sgst Decimal; igst Decimal; lineTotal Decimal
  projectId String?; sourceMinutes Int @default(0); adjustmentNote String? }
model InvoiceTimeEntry { id; tenantId; invoiceLineId; timeEntryId String; minutes Int
  @@unique([tenantId, timeEntryId]) }   // a time entry is billed at most once (released on cancel)
model InvoicePayment { id; tenantId; invoiceId; date DateTime @db.Date; amountReceived Decimal; tdsAmount Decimal @default(0)
  tdsSection String?; writeOff Decimal @default(0); bankAccountId String; reference String?; voucherId String; createdById }
model CreditNote { id; tenantId; number String; invoiceId; date DateTime @db.Date; reason String
  subtotal Decimal; cgst Decimal; sgst Decimal; igst Decimal; total Decimal; pdfFileId String?; voucherId String
  @@unique([tenantId, number]) }
model InvoiceEmail { id; tenantId; invoiceId; to String[]; cc String[]; messageId String?; status String; error String?; sentAt DateTime? }
```

### 3. Workflow: invoice state machine

| Transition | Trigger (`finance.invoice.*`) | Side effects |
|---|---|---|
| (new) → DRAFT | "Save draft" | lines computed; time entries soft-reserved (`InvoiceTimeEntry` rows) |
| DRAFT → ISSUED | "Issue", or the first half of "Generate & email" | locks number (`NumberSequence` FOR UPDATE); invoiceDate (default today) and dueDate = date + terms; snapshots; PDF render job; SALES voucher posted; e-invoice adapter if enabled; PDF auto-filed to Filing › Bills & receipts › Sales invoices |
| ISSUED → EMAILED | "Email", or the second half of "Generate & email" | email job with PDF; failure stays ISSUED with `lastEmailError` and a retry button |
| EMAILED / ISSUED → PARTIALLY_PAID / PAID | "Record payment" | RECEIPT voucher; status by balance |
| DRAFT → (deleted) | delete draft | reservations released |
| ISSUED+ → CANCELLED | "Cancel" with reason, only if no payments (else reverse payments first) | CreditNote CN-xxxx; CREDIT_NOTE voucher reversing sales; time entries released |

Overdue is derived: `dueDate < today` and status in (ISSUED, EMAILED, PARTIALLY_PAID).

### 4. API
- `GET /finance/invoices?status&clientId&from&to&q` (`finance.invoice.view`)
- `GET /finance/invoices/kpis?month`
- `GET /finance/invoices/billable-preview?clientId&projectId&period&includeEarlier` → `{approvedMinutes, pendingMinutes, pendingTimesheets, entriesCount, rate, supplyType, gst:{cgst,sgst,igst}, total}`
- `POST /finance/invoices {…, action:'draft'|'issue'|'issue_and_email'}` (`finance.invoice.create`; issue actions also need `finance.invoice.issue`)
- `PATCH /finance/invoices/:id` (draft only)
- `DELETE /finance/invoices/:id` (draft only)
- `POST /finance/invoices/:id/issue`
- `POST /finance/invoices/:id/email {to[],cc[],message?}`
- `GET /finance/invoices/:id/pdf` (signed URL)
- `POST /finance/invoices/:id/payments` (`finance.invoice.payment`)
- `DELETE /finance/invoices/:id/payments/:pid` (reverses its voucher)
- `POST /finance/invoices/:id/cancel {reason}` (`finance.invoice.cancel`)
- `GET|PUT /finance/settings` (`finance.settings.manage`)
- Realtime `t:{tenant}:finance` → `invoice.status_changed`.

### 5. Business rules & calculations
- **Billable time source**: TimeEntry where `projectId`, `billable=true`, date in period, `approvalLevelReached ≥ settings.invoiceHoursApprovalLevel` (default L1 = Project Lead approved, per flow "Log & approve hours · Billable hours confirmed"), not rejected, and not already in `InvoiceTimeEntry`.
- `hours = round(Σ netMinutes / 60, 2)`.
- **Supply type**:
  - Client country ≠ IN → EXPORT_LUT if the tenant LUT is valid on the invoice date, else EXPORT_WITH_TAX (IGST 18%).
  - Client SEZ → SEZ_LUT / SEZ_WITH_TAX (IGST).
  - `client.stateCode == settings.stateCode` → INTRA (CGST 9 + SGST 9).
  - Otherwise INTER (IGST 18).
  - Place of supply = client state code (B2B services), or "96-Other country" for exports.
- **Per line**:
  - `taxable = round2(hours × rate)`
  - INTRA: `cgst = sgst = round2(taxable × rate/2 /100)`
  - INTER: `igst = round2(taxable × rate/100)`
  - LUT: all 0.
- **Invoice**:
  - `subtotal = Σ taxable`; `taxTotal = Σ taxes`; `raw = subtotal + taxTotal`
  - `roundOff = round(raw) − raw` (if `roundOffToRupee`); `total = raw + roundOff`
  - Check: 320h × ₹1,250 = ₹4,00,000; IGST ₹72,000; total ₹4,72,000.
- **Number**: pattern tokens `{seq:n}`, `{FY}` (e.g. 26-27), `{YYYY}`, `{MM}`. Assigned only at issue, so there are no gaps from deleted drafts. Must be ≤ 16 characters, `[A-Za-z0-9/-]` (GST Rule 46). Unique per FY; with reset on, the sequence key includes the FY.
- **Line description default**: "Software development services — {Project} — {Mon YYYY} ({hours} hrs @ ₹{rate})", SAC 998314.
- **PDF contents**:
  - "TAX INVOICE". Seller legal name, address, GSTIN, PAN, logo (from Branding).
  - Invoice no/date, due date, place of supply (state name + code).
  - Buyer name, address, GSTIN.
  - Table: SAC, description, hours, rate, taxable, CGST%/amount, SGST%/amount or IGST%/amount, total.
  - Total in words (Indian numbering: "Rupees Four Lakh Seventy-Two Thousand Only"); "Tax payable on reverse charge: No".
  - LUT statement for exports: "Supply meant for export under LUT No. … without payment of IGST".
  - Bank details and UPI QR; signatory. IRN/QR if e-invoice.
- **Payment**:
  - `settled = amountReceived + tdsAmount + writeOff`; `balanceDue = total − Σ settled`
  - Balance 0 → PAID (`paidAt` = last payment date); 0 < balance < total → PARTIALLY_PAID.
  - TDS default suggestion: 10% of taxable under section 194J (client-deducted), editable.
- **Postings** (Module I):
  - Issue: Dr Debtor:{client} total; Cr Sales–IT Services subtotal; Cr Output CGST / Output SGST / Output IGST; Dr/Cr Round Off.
  - Payment: Dr Bank amountReceived; Dr TDS Receivable tdsAmount; Dr Bad debts writeOff; Cr Debtor:{client} settled.

### 6. Jobs, notifications, audit
- Queue `finance`:
  - `invoice.render-pdf`: HTML template → PDF via the PdfRenderer adapter (Gotenberg in dev); stores `pdfFileId`; idempotent per invoice version.
  - `invoice.email`: SMTP adapter with the PDF attachment; 3 retries.
  - `invoice.overdue.scan` daily 09:00 IST: marks overdue; alerts admins in-app; optional client reminder email at due+1 and due+7 (off by default).
  - `invoice.unbilled.reminder` on the 3rd of each month: "₹X unbilled approved hours for Sep across N projects" → admin.
- Emits `invoice.issued`, `invoice.paid`, `invoice.cancelled` (for ledger, filing and project billing tab).
- Audit: `invoice.created`, `invoice.updated`, `invoice.issued`, `invoice.emailed`, `invoice.email_failed`, `invoice.payment.recorded`, `invoice.payment.reversed`, `invoice.cancelled`, `invoice.tax_overridden`, `invoice.hours_adjusted`.

### 7. Integrations
```ts
interface PdfRenderer { render(html: string, opts?: { format: 'A4'; margin?: string }): Promise<Buffer> }   // Gotenberg (self-hosted) | Playwright
interface MailAdapter { send(m: { from: string; to: string[]; cc?: string[]; subject: string; html: string; attachments?: {filename:string; content:Buffer}[] }): Promise<{ messageId: string }> } // SMTP (Mailpit dev)
interface EInvoiceAdapter { generateIrn(inv: EInvoicePayload): Promise<{ irn: string; ackNo: string; ackDate: string; signedQr: string }>;
  cancelIrn(irn: string, reason: string): Promise<void> }   // stub: returns deterministic fake IRN, marked "SANDBOX" on PDF
interface EsignAdapter { signPdf(pdf: Buffer, signer: string): Promise<Buffer> }  // stub: stamps signatory image
```
`EInvoiceAdapter` is P3 (needed when aggregate turnover exceeds ₹5 Cr). `PaymentLinkAdapter` (Razorpay) is a P3 stub that adds a "Pay online" link.

### 8. Validation & edge cases
- Issuing is blocked when: FinanceSettings has no GSTIN or state; the client has no state (domestic); the rate is ≤ 0; hours are ≤ 0; or the invoice date falls in a locked period.
- Two drafts cannot reserve the same time entries; the unique `timeEntryId` makes the second draft recalculate.
- A time entry unapproved or sent back after reservation → draft recalc warning; issuing is blocked until the user recalculates.
- Issued invoices are immutable; corrections go through a credit note.
- Overpayment → 422 (advances are P3).
- A client whose GSTIN was changed after issue → the invoice keeps its snapshot.
- Invoice date in the future → 422. More than 30 days back → warning.
- An email bounce reported by SMTP → `InvoiceEmail.status=FAILED` and an alert.

### 9. Phase
P2. Depends on Timesheet (approved, billable TimeEntry with an `approvalLevelReached` field and an "is billed" lock), Clients, Projects, Ledger (Module I), Files, Notifications/Mail, Branding (logo).

### 10. Acceptance scenarios
1. Zephyr (state 27, Maharashtra) and tenant (24) → IGST. 186h × ₹1,250 → taxable ₹2,32,500, IGST ₹41,850, total ₹2,74,350. PDF shows SAC 998314 and POS "27-Maharashtra".
2. A Gujarat client → CGST ₹X/2 + SGST ₹X/2, and the total equals the IGST case.
3. Issuing two invoices gives consecutive numbers INV-0413, INV-0414. A deleted draft consumes no number. Time entries of the issued invoice are excluded from the next preview.
4. "Generate & email" with Mailpit → the email with the PDF arrives; status EMAILED; SALES voucher balanced (Dr = Cr = total).
5. Record payment ₹4,48,800 received + ₹23,200 TDS on ₹4,72,000 → PAID. Receipt voucher RCPT-n posted Dr Bank / Dr TDS Receivable / Cr Debtor.
6. Cancel an issued unpaid invoice → CN-0001, reversing voucher; the preview for that period again shows the hours.

---

## MODULE H: Purchases & input GST (P2)

### 1. Screens & UX
**Purchases & input GST** (`GEN.purchases`), NAV: admin.
- Subtitle "Company purchases with Input GST captured automatically from uploaded invoices."
- KPIs (month selector):
  - "Purchases (Sep)" = Σ amount of RECORDED purchases with billDate in the month; subtext "N bills".
  - "Input GST claimable" = Σ inputGstTotal where `itcEligible` and vendor GSTIN is present, in that month; subtext "for GSTR-3B".
- Columns: Date, Vendor, Invoice no., Category, Amount (gross), Input GST (a warning tag if ITC is ineligible), Bill ("PDF" tag → preview).
- Filters: category, vendor, ITC eligible.

**"Record purchase" form** (`FORMS.purchase`):
- The user uploads the Bill first (drop zone at the top). The OCR job runs and fills fields, which show a "from bill" badge and a confidence level.
- Fields: Vendor* (autocomplete from the Vendor master or "create new"), Invoice no.*, Amount* (total incl. GST), Input GST (auto), Category*, Bill* (file).
- Added: Bill date*, Vendor GSTIN, GST rate, CGST/SGST/IGST split (read-only, derived), ITC eligible (default from category), Paid via (Unpaid / Bank / Cash / Card / UPI) plus From account, Quantity (asset categories).
- Low-confidence fields (< 0.8) are highlighted and need confirmation.

**Masters** (a tab or settings drawer):
- Vendors: name, GSTIN, PAN, state, email.
- Purchase categories: name, expense ledger, default GST rate, ITC eligible default, creates asset.
- Seeded categories: Stationery (Office supplies, 18%, ITC yes), Peripherals (Computer peripherals, 18%, yes, asset), Laptops (Fixed assets–Computers, 18%, yes, asset), Software & SaaS (18%, yes), Internet & telecom (18%, yes), Rent (18%, yes), Staff welfare / Food (5/18%, ITC no, Sec 17(5)), Travel (5/12%, ITC no by default), Professional fees (18%, yes), Repairs (18%, yes).

### 2. Data model
```prisma
model Vendor { id; tenantId; name String; gstin String?; pan String?; stateCode String?; email String?
  payableAccountId String?; isActive Boolean @default(true)
  @@unique([tenantId, name]); @@index([tenantId, gstin]) }
model PurchaseCategory { id; tenantId; name String; expenseAccountId String; defaultGstRate Decimal @db.Decimal(4,2)
  itcEligibleDefault Boolean; createsAsset Boolean @default(false); isActive Boolean @default(true)
  @@unique([tenantId, name]) }
enum PurchaseStatus { DRAFT RECORDED CANCELLED }
enum OcrStatus { NONE PENDING DONE FAILED }
enum GstSource { OCR COMPUTED MANUAL }
enum PayMode { UNPAID BANK CASH CARD UPI }
model Purchase { id; tenantId; vendorId; vendorInvoiceNo String; billDate DateTime @db.Date; fy String
  categoryId; quantity Int @default(1)
  amount Decimal @db.Decimal(14,2)           // gross incl. GST
  taxable Decimal; gstRate Decimal @db.Decimal(4,2); cgst Decimal; sgst Decimal; igst Decimal; inputGstTotal Decimal
  inputGstSource GstSource; itcEligible Boolean; itcPeriod String   // 'YYYY-MM' (defaults to billDate month)
  paymentMode PayMode @default(UNPAID); paidFromAccountId String?
  billFileId String; ocrStatus OcrStatus @default(NONE); ocrResult Json?; ocrConfidence Decimal? @db.Decimal(3,2)
  status PurchaseStatus @default(RECORDED); voucherId String?; createdById; notes String?
  @@unique([tenantId, vendorId, vendorInvoiceNo, fy]); @@index([tenantId, billDate]); @@index([tenantId, itcPeriod]) }
model BillExtraction { id; tenantId; fileId; status OcrStatus; result Json?; confidence Decimal?; error String?; createdById; createdAt }
```

### 3. Workflow
1. Upload the bill → `POST /extract` → BillExtraction PENDING → worker → DONE or FAILED. The UI polls, or receives the socket event `bill.extracted`.
2. The user confirms → Purchase RECORDED, which posts a voucher and auto-files the bill.
3. Edit → allowed while the period is unlocked. Posting reverses the old voucher and posts a new one.
4. Cancel → reverse the voucher; status CANCELLED.

### 4. API
- `GET /finance/purchases?from&to&categoryId&vendorId` (`finance.purchase.view`)
- `GET /finance/purchases/kpis?month`
- `POST /finance/purchases/extract {fileId}` → `{extractionId}`, then `GET /finance/purchases/extract/:id`
- `POST /finance/purchases`, `PATCH /finance/purchases/:id` (`finance.purchase.create`)
- `POST /finance/purchases/:id/cancel` (`finance.purchase.create`)
- `GET|POST|PATCH /finance/vendors`
- `GET|POST|PATCH /finance/purchase-categories` (`finance.purchase.manage`)

### 5. Business rules & calculations
- Default when OCR provides no tax: `inputGstTotal = round2(amount × r / (100 + r))`, `taxable = amount − inputGstTotal`. Check: ₹8,460 at 18% → ₹1,290.51, shown as ₹1,290; ₹1,42,000 → ₹21,661.
- Split:
  - vendor.stateCode == tenant stateCode → CGST = SGST = total/2 (round, with the paisa remainder on SGST).
  - Otherwise IGST.
  - Missing vendor state → derive from the GSTIN prefix.
  - Unregistered vendor (no GSTIN) → inputGst 0, `itcEligible` false.
- If OCR values are present, use OCR `cgst/sgst/igst` (`inputGstSource=OCR`). A user edit makes it MANUAL, audited with the OCR value.
- Sanity: `|taxable + taxes − amount| ≤ ₹1` else 422. `inputGstTotal ≤ amount × 28/128`.
- ITC eligibility: category default; Sec 17(5) categories are false. Claim deadline: 30 Nov after the FY end. Past it, flag "ITC time-barred" and exclude from the KPI.
- Posting (voucher type PURCHASE, or PAYMENT when paid now):
  - Dr Expense/Asset account (category) = taxable (+ taxes if ITC ineligible).
  - Dr Input CGST / SGST / IGST (if eligible).
  - Cr Vendor payable (UNPAID) or Cr Bank/Cash (paid) = amount.
  - Voucher number: PMT-xxx when paid, PUR-xxx otherwise.
- `createsAsset` → emit `purchase.asset_candidate {purchaseId, item: category/vendor desc, quantity, billDate, amountPerUnit}`. The Assets domain creates "In stock" items with warranty default = billDate + 1 year (editable).

### 6. Jobs, notifications, audit
- `purchase.ocr-extract` (queue `ocr`; timeout 60 s; 2 retries).
- Auto-file the bill to Filing › "Bills & receipts" with tags [vendor, category, FY].
- Alert: OCR failed → the uploader.
- Audit: `purchase.recorded`, `purchase.updated`, `purchase.cancelled`, `purchase.gst_overridden` (OCR value → manual value), `vendor.*`, `purchase_category.*`.

### 7. Integrations
```ts
interface BillOcrAdapter { extract(file: { buffer: Buffer; mime: string }): Promise<{
  vendorName?: string; vendorGstin?: string; invoiceNo?: string; invoiceDate?: string;
  taxable?: number; cgst?: number; sgst?: number; igst?: number; total?: number;
  lines?: { description: string; qty?: number; amount?: number }[]; confidence: number; rawText: string }> }
```
- Local implementation: PDF text layer (pdf-parse); for image or scanned PDFs, Tesseract via `tesseract.js`, or an `ocrmypdf` container.
- Rule-based parser:
  - GSTIN regex; invoice number labels (Invoice No / Bill No / Order No).
  - Date formats dd/mm/yyyy and dd-MMM-yyyy.
  - Amount labels (Grand Total / Total Amount / Invoice Value); CGST/SGST/IGST lines.
  - Confidence = fields found / expected.
- Mock: returns a fixture keyed by the file hash.

### 8. Validation & edge cases
- Duplicate vendor + invoice number in the same FY → 409 with a link to the existing record.
- Bill date in the future → 422. Bill date in a locked period → 422.
- Amount ≤ 0 → 422.
- Unsupported file (not pdf/png/jpg/jpeg/heic) → 422. Max 15 MB.
- An OCR vendor GSTIN that matches an existing vendor → auto-select that vendor.
- An OCR GSTIN that fails the checksum → the field is left blank, with a warning.

### 9. Phase
P2. Depends on Ledger, Filing, Files, Assets (asset candidate event).

### 10. Acceptance scenarios
1. Uploading the Amazon bill fixture → OCR fills vendor, IN-8843, ₹8,460, input GST ₹1,290 (IGST if the vendor state ≠ 24) → saved. The KPI increases by ₹1,290; the voucher is balanced; the bill appears in Filing › Bills & receipts.
2. Staff welfare purchase ₹11,800 at 18% → ITC ineligible; the KPI is unchanged; the expense is debited ₹11,800 in full.
3. Recording the same vendor + invoice number twice → 409.
4. Editing input GST from the OCR value 1,290 to 1,300 → the sanity check fails (> ₹1 mismatch) unless taxable is also adjusted. A valid manual edit produces the audit entry `purchase.gst_overridden`.
5. Laptops category, qty 2 → the `purchase.asset_candidate` event is consumed and 2 "In stock" assets are created.

---

## MODULE I: Ledger (double-entry) (P2)

### 1. Screens & UX
**Ledger** (`GEN.ledger`), NAV: admin. HR, with `finance.voucher.hr` only, sees just the HR vouchers tab.
- Subtitle "Income, expenses and internal HR vouchers in a double-entry ledger."
- KPIs (month):
  - "Income (Sep)" = Σ(credit − debit) on INCOME accounts; subtext "N invoices" (issued in the month).
  - "Expenses (Sep)" = Σ(debit − credit) on EXPENSE accounts; subtext "incl. payroll".
  - "Balance" = Income − Expenses; subtext "Current month".
- Tabs:
  - Day book: all vouchers by date desc.
  - Income: lines on INCOME accounts.
  - Expenses: lines on EXPENSE accounts.
  - HR vouchers: type HR.
  - Trial balance: per account Opening, Debit, Credit, Closing for the range; totals Dr = Cr; group roll-up; export CSV/XLSX.
- Columns (day book): Date, Voucher (number; click opens the voucher detail with all lines and a source link to the invoice/purchase/payroll run), Ledger (the primary counter-account; "Multiple" if more than 2 lines), Narration, Debit, Credit.
- Filters: date range, account, type, source.
- Buttons: "New voucher"; secondary "Chart of accounts" (tree with codes, types, balances; add/edit account); "Lock books up to…" (`finance.period.lock`); account statement drill-down.

**"New voucher" form** (`FORMS.voucher`):
- Type* (Payment / Receipt / Journal / HR voucher), Date*, Ledger*, Amount*, Narration*.
- Added:
  - Payment and Receipt: "Bank/Cash account" (default bank).
  - HR voucher: Employee (optional) and "Paid from / Payable".
  - Journal: switches to a multi-line grid (Account, Debit, Credit) with a running difference that must reach 0.
  - Attachment.
- Toast "Voucher PMT-311 posted".

### 2. Data model
```prisma
enum AccountType { ASSET LIABILITY EQUITY INCOME EXPENSE }
enum PartyType { CLIENT VENDOR EMPLOYEE BANK CASH }
model Account { id; tenantId; code String; name String; type AccountType; parentId String?; isGroup Boolean @default(false)
  systemKey String?; partyType PartyType?; partyId String?; isSystem Boolean @default(false); isActive Boolean @default(true)
  openingBalance Decimal @default(0) @db.Decimal(14,2); openingSide String @default("DR"); openingDate DateTime? @db.Date
  @@unique([tenantId, code]); @@unique([tenantId, systemKey]); @@unique([tenantId, partyType, partyId]) }
enum VoucherType { PAYMENT RECEIPT JOURNAL HR SALES PURCHASE CONTRA CREDIT_NOTE PAYROLL }
enum VoucherSource { MANUAL INVOICE INVOICE_PAYMENT PURCHASE CREDIT_NOTE PAYROLL_RUN PAYROLL_PAYMENT REVERSAL }
model Voucher { id; tenantId; number String; type VoucherType; date DateTime @db.Date; fy String; narration String
  sourceType VoucherSource @default(MANUAL); sourceId String?; employeeId String?; attachmentFileId String?
  status String @default("POSTED")   // POSTED | REVERSED
  reversalOfId String?; reversedById String?; postedById String; postedAt DateTime @default(now())
  lines VoucherLine[]
  @@unique([tenantId, number]); @@unique([tenantId, sourceType, sourceId, reversalOfId]); @@index([tenantId, date]); @@index([tenantId, type, date]) }
model VoucherLine { id; tenantId; voucherId; accountId; debit Decimal @default(0) @db.Decimal(14,2); credit Decimal @default(0) @db.Decimal(14,2)
  lineNarration String?
  @@index([tenantId, accountId]) }   // DB CHECK: (debit>0) <> (credit>0); deferred constraint trigger: Σdebit = Σcredit per voucher
```

Seeded chart of accounts (codes; `systemKey` in brackets):
- 1000 Assets
  - 1100 Current assets
    - 1110 Bank accounts [BANK_DEFAULT: "HDFC Current A/c"]
    - 1120 Cash [CASH]
    - 1130 Sundry debtors (group; client sub-ledgers)
    - 1140 Input CGST [INPUT_CGST], 1141 Input SGST [INPUT_SGST], 1142 Input IGST [INPUT_IGST]
    - 1150 TDS receivable [TDS_RECEIVABLE]
    - 1160 Advances to employees
  - 1200 Fixed assets
    - 1210 Computers & laptops
    - 1220 Furniture
- 2000 Liabilities
  - 2100 Sundry creditors (group; vendor sub-ledgers)
  - 2110 Output CGST [OUTPUT_CGST], 2111 Output SGST [OUTPUT_SGST], 2112 Output IGST [OUTPUT_IGST]
  - 2120 Salary payable [SALARY_PAYABLE]
  - 2121 PF payable [PF_PAYABLE], 2122 ESI payable [ESI_PAYABLE], 2123 Professional tax payable [PT_PAYABLE], 2124 TDS payable – salary (192) [TDS_192_PAYABLE], 2125 TDS payable – vendors [TDS_VENDOR_PAYABLE]
  - 2130 Employee reimbursements payable [REIMB_PAYABLE]
- 3000 Equity
  - 3100 Capital
  - 3200 Retained earnings
- 4000 Income
  - 4100 Sales – IT services [SALES_SERVICES]
  - 4200 Other income
  - 4900 Round off [ROUND_OFF]
- 5000 Expenses
  - 5100 Salaries & wages [SALARY_EXP]
  - 5110 Employer PF [EMPLOYER_PF_EXP], 5111 Employer ESI [EMPLOYER_ESI_EXP]
  - 5120 Intern stipend [STIPEND_EXP]
  - 5200 Rent
  - 5210 Office supplies
  - 5220 Staff welfare
  - 5230 Software & subscriptions
  - 5240 Internet & telephone
  - 5250 Travel
  - 5260 Repairs
  - 5270 Professional fees
  - 5280 Bank charges
  - 5290 Bad debts [BAD_DEBTS]
  - 5300 Depreciation

Round off is posted to 4900 whether it is a debit or a credit.

### 3. Workflows
- A voucher is created POSTED; drafts are not supported for manual vouchers.
- Reverse → a new voucher with swapped Dr/Cr, `reversalOfId`; the original becomes REVERSED. It needs `finance.voucher.reverse` and an open period.
- Auto-posting consumers (idempotent via the unique `(sourceType, sourceId)`):
  - `invoice.issued` → SALES
  - `invoice.payment.recorded` → RECEIPT (RCPT-)
  - `invoice.cancelled` → CREDIT_NOTE
  - `purchase.recorded` → PURCHASE or PAYMENT; `purchase.updated` → reversal + new voucher
  - `payroll.run.finalized` → PAYROLL: aggregated, never per employee.
    - Dr SALARY_EXP (gross full-time) and Dr STIPEND_EXP (interns).
    - Dr EMPLOYER_PF_EXP and EMPLOYER_ESI_EXP.
    - Cr SALARY_PAYABLE (net), Cr PF_PAYABLE (employee + employer), Cr ESI_PAYABLE (employee + employer), Cr PT_PAYABLE, Cr TDS_192_PAYABLE, Cr other deductions.
  - `payroll.run.paid` → PAYMENT: Dr SALARY_PAYABLE, Cr Bank.
- Manual form mapping:
  - Payment: Dr Ledger, Cr Bank/Cash.
  - Receipt: Dr Bank/Cash, Cr Ledger.
  - HR voucher: Dr Ledger (expense), Cr Bank or REIMB_PAYABLE (with employee).
  - Journal: free lines.

### 4. API
- `GET /finance/accounts?tree=1`; `POST|PATCH /finance/accounts` (`finance.coa.manage`)
- `GET /finance/accounts/:id/statement?from&to` (`finance.ledger.view`)
- `GET /finance/vouchers?type&from&to&accountId&source&q&page` (`finance.ledger.view`; with only `finance.voucher.hr`, forced to `type=HR`)
- `GET /finance/vouchers/:id`
- `POST /finance/vouchers` (`finance.voucher.post`; HR type allowed with `finance.voucher.hr`)
- `POST /finance/vouchers/:id/reverse {reason}` (`finance.voucher.reverse`)
- `GET /finance/ledger/kpis?month`
- `GET /finance/trial-balance?from&to&format=json|csv|xlsx`
- `POST /finance/periods/lock {upTo}` (`finance.period.lock`)
- Internal (service-to-service): `LedgerService.post(sourceType, sourceId, lines[], meta)`, exposed to Payroll.

### 5. Business rules
- Per voucher Σdebit = Σcredit; at least 2 lines; amounts > 0 with 2 decimals.
- Voucher date ≤ today and > `booksLockedUpTo`.
- Numbering: `{PREFIX}-{seq:3}` with prefixes RCPT, PMT, JV, HRV, PUR, PAY, CN. SALES vouchers use the invoice number. Sequence per tenant, continuous.
- Group accounts cannot be posted to. System accounts cannot be deleted or have their type changed. Accounts with postings can be deactivated but not deleted.
- Closing balance = opening ± Σ lines (Dr positive for ASSET/EXPENSE, Cr positive for LIABILITY/EQUITY/INCOME).
- The trial balance must net to 0. An invariant check runs nightly and alerts admin on mismatch.
- Balance KPI is the P&L for the month. Bank balance is shown separately in the account statement.
- Salary privacy: payroll postings are aggregated per run, and the narration is "Payroll Sep 2026 (119 employees)".

### 6. Jobs, notifications, audit
- Queue `ledger-posting` consumers with 5 retries.
- A posting failure (e.g. a missing systemKey account) alerts admin, and the source record shows "Not posted — fix & retry".
- Nightly `ledger.invariant.check`.
- Audit: `voucher.posted`, `voucher.reversed`, `account.created`, `account.updated`, `period.locked`, `ledger.export`.

### 7. Integrations
Export only (CSV/XLSX; Tally XML export P3 stub `AccountingExportAdapter`).

### 8. Validation & edge cases
- Unbalanced journal → 422 with the difference.
- A posting to an inactive account → 422.
- Duplicate auto-post event → no-op (unique key).
- Reversing a reversal → 409.
- Locking the period while a draft invoice is dated inside it → warning listing the drafts.
- Payroll event before the CoA is seeded → retry and alert.

### 9. Phase
P2. Depends on Payroll (events `payroll.run.finalized {runId, month, totals:{grossFT, stipend, employerPf, employerEsi, empPf, empEsi, pt, tds192, otherDeductions, net}}` and `payroll.run.paid {runId, paymentDate, amount, bankAccountId?}`), Modules G and H.

### 10. Acceptance scenarios
1. New Payment voucher "Office supplies ₹8,460 from HDFC" → PMT-001 with Dr Office supplies / Cr Bank; the day book row matches the wireframe row format.
2. A journal with Dr 1,000 / Cr 900 → 422 "Difference ₹100".
3. Issue invoice ₹4,72,000 + record payment → Income KPI +₹4,00,000 and the trial balance still balances. The debtor sub-ledger is 0 after full payment.
4. Payroll finalize event replayed twice → a single PAYROLL voucher; expenses KPI includes the payroll gross.
5. HR user: `GET /finance/vouchers` returns only HR type; `POST` Payment → 403; `POST` HR voucher "Team dinner ₹12,000, Staff welfare" → HRV-001.
6. Lock books up to 31 Aug; posting dated 30 Aug → 422 PERIOD_LOCKED.

---

## MODULE J: Filing cabinet + GST returns & compliance calendar (P2)

### 1. Screens & UX
**Filing cabinet** (`GEN.filing`), NAV: admin.
- Subtitle "Folders for bills, tax documents, vendor receipts and corporate files."
- Folder tiles (kicker "Folder", title, "N files"). Six are seeded as system folders:
  - Bills & receipts, with a system subfolder "Sales invoices" (added)
  - GST returns
  - Income tax
  - Contracts & NDAs
  - Company registration
  - Vendor agreements
- Clicking a tile opens the folder view:
  - Breadcrumb, subfolders.
  - Table: Name, Tags, FY, Date, Uploaded by, Size, Linked to (Purchase PUR-012 / Invoice INV-0412).
  - Search (title, tag), filter by FY and tag.
  - Actions: Download, Preview, Edit tags, Move, New version, Delete (soft).
  - Buttons "New folder" (custom) and "Upload".
- **Upload form** (`FORMS.upload`, submit "Upload", toast "Uploaded"): Folder / category* (tree select), File* (multiple allowed), Tags (chips).
  - Added: Document date, FY (auto from date), Expires on (contracts/NDAs; renewal reminder).
- **GST returns sub-screen** (inside the GST returns folder, header card "Returns"): table Period, GSTR-1 status, GSTR-3B status, Output tax, ITC, Net payable. Actions "Prepare", "Download JSON/CSV", "Mark filed (ARN, date)".
- **Compliance calendar** card (top of the Filing cabinet): upcoming due dates with status.

### 2. Data model
```prisma
model FilingFolder { id; tenantId; name String; parentId String?; systemKey String?; isSystem Boolean @default(false)
  @@unique([tenantId, parentId, name]); @@unique([tenantId, systemKey]) }
model FilingDocument { id; tenantId; folderId; fileId String; title String; tags String[]; fy String?; docDate DateTime? @db.Date
  expiresOn DateTime? @db.Date; linkedEntityType String?; linkedEntityId String?
  version Int @default(1); previousVersionId String?; isLatest Boolean @default(true)
  uploadedById String; uploadedAt DateTime @default(now()); deletedAt DateTime?; deletedById String?
  @@index([tenantId, folderId]); @@index([tenantId, linkedEntityType, linkedEntityId]) }   // GIN index on tags
enum ReturnType { GSTR1 GSTR3B }
enum ReturnStatus { DRAFT PREPARED FILED }
model GstReturn { id; tenantId; period String; type ReturnType; status ReturnStatus @default(DRAFT); summary Json
  fileId String?; arn String?; filedOn DateTime? @db.Date; preparedById String?; preparedAt DateTime?
  @@unique([tenantId, period, type]) }
model ComplianceItem { id; tenantId; key String; label String; dueDate DateTime @db.Date; period String
  status String @default("PENDING"); completedAt DateTime?; linkedReturnId String?; @@unique([tenantId, key, period]) }
```

### 3. Workflows
- Upload: the file is scanned by the Files domain (ClamAV adapter); while `scanStatus=PENDING` the document is not downloadable.
- Documents: new version → the old one gets `isLatest=false`.
- Delete: soft delete with 90-day retention, then a purge job. Documents linked to a posted purchase or issued invoice cannot be deleted (409) because of the 8-year GST record retention (Sec 36 / Rule 56).
- GST return: DRAFT (auto-generated on the 1st for the previous month) → PREPARED (admin reviews, clicks Prepare → JSON/CSV file saved into GST returns/<FY>) → FILED (ARN + date; the ComplianceItem completes).

### 4. API
- `GET /finance/filing/folders` (tree with counts), `POST /finance/filing/folders`, `PATCH|DELETE /finance/filing/folders/:id` (custom folders only, when empty)
- `GET /finance/filing/folders/:id/documents?q&tag&fy`
- `POST /finance/filing/documents {folderId, fileIds[], tags[], docDate?, expiresOn?}` (`finance.filing.upload`)
- `PATCH /finance/filing/documents/:id` (tags, title, move)
- `POST /finance/filing/documents/:id/versions`
- `GET /finance/filing/documents/:id/download` (signed URL, audited) (`finance.filing.view`)
- `DELETE /finance/filing/documents/:id` (`finance.filing.delete`)
- `GET /finance/gst/returns?fy`, `GET /finance/gst/:period/gstr1`, `GET /finance/gst/:period/gstr3b` (live computation)
- `POST /finance/gst/:period/:type/prepare`, `POST /finance/gst/:period/:type/filed {arn, filedOn}` (`finance.gst.returns`)
- `GET /finance/compliance?from&to`, `POST /finance/compliance/:id/done`

### 5. Business rules
- **GSTR-1** (from ISSUED+ invoices dated in the period, and credit notes):
  - 4A B2B: per invoice with buyer GSTIN (GSTIN, number, date, value, POS, rate, taxable, IGST/CGST/SGST).
  - 5 B2CL: inter-state, unregistered, value > ₹1,00,000.
  - 7 B2CS: other unregistered, aggregated by POS and rate.
  - 6A exports (LUT / with tax).
  - 9B credit notes.
  - 12 HSN/SAC summary (998314: quantity in hours, taxable, taxes).
  - 13 documents issued (first/last number, cancelled count).
- **GSTR-3B**:
  - 3.1(a) outward taxable (taxable, IGST, CGST, SGST).
  - 3.1(b) zero-rated.
  - 4(A)(5) all other ITC = Σ eligible purchase ITC with `itcPeriod` = period.
  - 4(D)(2) ineligible ITC (Sec 17(5)).
  - Net payable per head = output − ITC, using the utilisation order: IGST credit → IGST, then CGST, then SGST; CGST credit → CGST, then IGST; SGST credit → SGST, then IGST.
- The seeded compliance calendar (monthly regular filer) is regenerated monthly:
  - GSTR-1: 11th.
  - GSTR-3B: 20th.
  - TDS deposit: 7th (30 Apr for March).
  - PF ECR: 15th.
  - ESI: 15th.
  - Gujarat PT: 15th.
  - TDS returns 24Q/26Q: 31 Jul / 31 Oct / 31 Jan / 31 May.
  - Advance tax: 15 Jun / 15 Sep / 15 Dec / 15 Mar.
  - GSTR-9: 31 Dec.
  - ITR (company): 31 Oct.
  - Due dates are configurable per tenant, since QRMP filers differ.
- Auto-filing:
  - Purchase bills → Bills & receipts (tags vendor, category).
  - Invoice PDFs → Bills & receipts › Sales invoices.
  - Prepared returns → GST returns (tags period, type).
  - Payroll challans (event from Payroll) → Income tax.
- Folder counts exclude deleted and non-latest documents.

### 6. Jobs, notifications, audit
- `gst.return.draft` at 00:30 on the 1st.
- `compliance.reminder` daily 09:00: items due in 3 days or overdue → admin in-app plus email.
- `filing.contract.expiry` daily: `expiresOn` within 30 days → admin.
- `filing.purge` weekly.
- Audit: `filing.folder.*`, `filing.document.uploaded`, `filing.document.downloaded`, `filing.document.deleted`, `filing.document.versioned`, `gst.return.prepared`, `gst.return.filed`.

### 7. Integrations
```ts
interface GstFilingAdapter { pushGstr1(gstin: string, period: string, payload: object): Promise<{ refId: string }>;
  fileGstr3b(gstin: string, period: string, payload: object, otp?: string): Promise<{ arn: string }> }   // stub: P3 GSP; P2 = offline JSON export only
interface VirusScanAdapter { scan(key: string): Promise<'CLEAN'|'INFECTED'> }   // ClamAV container (Files domain)
```

### 8. Validation & edge cases
- Allowed types: pdf, png, jpg, xlsx, xls, csv, docx, doc, zip, json. Max 25 MB.
- A duplicate sha256 in the same folder → warning with "Upload anyway".
- Tags are lowercased and trimmed; max 10 per document, 32 characters each.
- System folders cannot be renamed or deleted.
- Moving a linked document out of its system folder is allowed; the link is kept.
- Preparing a return for a period with draft invoices → warning. Marking FILED needs an ARN of 15 alphanumeric characters.
- An invoice cancelled after GSTR-1 was filed → the next period's return shows it in amendments or credit notes (the 9B credit note is reported in the month it is issued).

### 9. Phase
P2 (GSP push is P3). Depends on Files (storage, scan, per-tenant encryption in P3), Modules G, H and I, Payroll (challan event, optional).

### 10. Acceptance scenarios
1. Uploading 2 files with tags "FY26-27, rent" into Contracts & NDAs → the tile count increases by 2 and tag search finds them.
2. Recording a purchase auto-creates a document in Bills & receipts linked to it. Deleting that document → 409.
3. The Sep GSTR-3B draft shows 3.1(a) = Σ invoice taxable and taxes, and 4(A)(5) = the "Input GST claimable" KPI value exactly.
4. Prepare GSTR-1 → the JSON file is stored in GST returns; Mark filed with an ARN → the compliance item "GSTR-1 Sep 2026" is completed.
5. A downloaded document produces an audit row. The platform super-admin session gets 0 rows (RLS) and 403.

---

## Flow coverage

**Flow 06 "Project delivery"**:

| Step | Covered by |
|---|---|
| Create project (lead) | B |
| Team board (lead) | C |
| Log & approve hours (lead) | Timesheet domain; L1 approval confirms billable (the L1 review can toggle `billable` per entry) |
| GST invoice (admin) | G |
| Ledger entry (admin; receipt recorded) | G payment → I RECEIPT |
| Archive (manager) | E |

**Flow 07 "Finance back office"**:

| Step | Covered by |
|---|---|
| Record purchase | H |
| Ledger & vouchers | I |
| Filing cabinet | J |

**Flow 01, step 4** ("Drag card to WIP; Dev Completed pushes to GitLab"): C + D.

**Tracker flow, "Work on task"**: C `GET /tracker/tasks`.

---

## Cross-domain contracts

**Consumed**
- **Identity/RBAC**: `can(userId, perm, ctx)`, role seeding API, user basic profile. Tracker device tokens carry the `tracker` scope.
- **People**:
  - `Employee {userId, departmentId, designation, employmentType (FULL_TIME|INTERN), mentorId?, reportingManagerId, status}`
  - `Department {id, name, leadUserId}`
  - Events `employee.exited` (revoke board memberships; reassign ALLOTTED tasks to OPEN) and `employee.department_changed`.
- **Timesheet/Tracker**:
  - `TimeEntry {id, tenantId, userId, projectId, taskId, date, grossMinutes, idleMinutes, netMinutes, billable, source, approvalLevelReached: NONE|L1|L2, status: DRAFT|SUBMITTED|APPROVED|SENT_BACK}`
  - Events `time.entry.upserted {entryId, taskId, projectId, deltaNetMinutes}` and `timesheet.approval_changed {entryIds[], level, status}`.
  - Lock API `markBilled(entryIds[], invoiceLineId)` and `releaseBilled(entryIds[])`. Billed entries are immutable for edits.
- **Payroll**: `payroll.run.finalized` (aggregated totals), `payroll.run.paid`, `payroll.challan.generated {fileId, type}`.
- **Files**: presign upload, FileObject, scan status, signed download URL, per-tenant encryption (P3).
- **Notifications/Mail**: `notify(userIds[], templateKey, data, channels)`, `sendEmail` (MailAdapter).
- **Audit**: `AuditService.log`.
- **Branding/Tenant settings**: logo, legal profile (seeds FinanceSettings), timezone.
- **Assets**: consumes `purchase.asset_candidate`.
- **Comms/Notices**: consume `project.created` and `project.member.added/removed` (project channel and audience). Consume `project.archived` to archive the channel.
- **LMS**: `GET /me/learning/assigned` (intern dashboard card).

**Exposed**
- `GET /tracker/tasks`; event `tracker.tasks_changed` (user room).
- `ProjectService.getLevel1Approver(projectId)` → project leadId (Timesheet L1 routing).
- `ProjectService.isLoggable(projectId)`.
- `GET /me/tasks?dueBefore=` (Dashboard to-do).
- `ProjectService.membersOf(projectId)` (notice audiences, chat).
- Events:
  - `project.created`, `project.updated`, `project.status_changed`, `project.archived`, `project.member.added`, `project.member.removed`
  - `task.created`, `task.moved`, `task.assigned`, `task.closed`
  - `invoice.issued`, `invoice.paid`, `invoice.cancelled`
  - `purchase.recorded`, `purchase.asset_candidate`
  - `voucher.posted`
- `LedgerService.post()` (idempotent) for other domains, e.g. a future reimbursements module.
- Tenant-lifecycle seeding hook `seedWorkAndFinance(tenantId)`: INT project and standing tasks, Internal client, CoA, purchase categories, folders, number sequences, compliance calendar.

---

## Phase summary

| Phase | Modules | Hard dependencies |
|---|---|---|
| **P1** | A Clients, B Projects/modules/members, C Kanban + team boards + tracker task feed, D GitLab (real + mock) | Identity/RBAC, People, Files, Notifications, Timesheet time events |
| **P2** | E Archive, F Interns, G GST invoices (PDF, email, payments, credit notes), H Purchases + OCR, I Ledger + CoA + auto-postings, J Filing + GST return exports + compliance calendar | P1 plus Timesheet approvals (L1/L2), Payroll events, Assets |
| **P3** | e-Invoice IRN adapter, GSP filing push, Razorpay payment links, Tally export, multi-currency/export invoicing beyond LUT, advances/on-account receipts, TDS on vendor payments (194C/194J), per-tenant envelope encryption of filing docs and git tokens, dedicated-DB tenants | Tenancy/KMS, Billing |

---

## Open questions

1. **HR finance access.** The Roles matrix gives HR "Payroll & ledger", but NAV shows the Ledger to admin only. The default here is HR = HR-vouchers only. Confirm whether HR should see the full Ledger.
2. **HR and "View all task boards".** The roles matrix leaves it unchecked for HR, while the wireframe code (`allowedDepts`) lets HR see all boards. The default follows the matrix (HR sees none).
3. **Archive "All developers" access.** NAV hides the archive from employees. Should employees be seeded `archive.view.shared` (so "All developers" is meaningful), or does it only mean "all leads/managers"?
4. **Which approval level makes hours billable.** L1 (Project Lead) per flow 06, or L2 (Reporting Manager) like payroll. The default is L1 and it is configurable.
5. **Invoice numbering.** Assign at issue (no gaps; drafts show "Draft") vs the wireframe showing a number on a Draft. Also: continuous numbering or reset per FY (e.g. `INV/26-27/0001`)?
6. **QA handoff.** Linked QA-board task (the default, keeps department isolation) vs the same card visible to QA.
7. **Git branch timing.** Create the branch at WIP (the default, so developers push to it) vs only at Dev Completed. Also the target branch name (`develop` vs `main`).
8. **Client vault contents.** Should it also store client credentials/secrets (encrypted secret items)? Currently it holds documents only.
9. **E-invoicing.** Is Lexisora's aggregate turnover above ₹5 Cr? That decides whether the IRN is mandatory, which would move the e-invoice adapter to P2.
10. **Intern hours.** Self-reported vs tracker-derived only. Do office interns use the tracker?
11. **"Sales invoices" folder.** Is a subfolder under Bills & receipts acceptable, or should it be a 7th top-level folder?

### Critical Files for Implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (NAV lines 774-782; GEN projects/archive/interns/ledger/invoices/purchases/filing lines 788-803; FORMS task/project/interntask/voucher/invoice/purchase/upload lines 822-844; kanban markup lines 539-560 and logic lines 891-893)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (FLOWS: flow 01 step 4, flow 06 "Project delivery", flow 07 "Finance back office"; line 352 onward)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html ("Working on" task list lines 367-371, TASKS line 465; consumer of `GET /tracker/tasks`)