# Lexisora HRMS: Domain Spec for Leave Management, Payroll and Payslips

**Conventions for every model below:**
- `id String @id @default(uuid()) @db.Uuid`, plus `tenantId String @db.Uuid`, `createdAt` and `updatedAt`, unless marked **GLOBAL**.
- Every table has a PostgreSQL RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`. GLOBAL reference tables have `tenantId` nullable: null means a platform default, a non-null value is a tenant override. The RLS for those is `tenant_id IS NULL OR tenant_id = current`.
- Money is `Decimal @db.Decimal(14,2)` in INR. Day counts are `Decimal @db.Decimal(6,2)`. Rates are `Decimal(12,4)`.
- Dates are `@db.Date` in Asia/Kolkata. Cron times are IST.
- Display uses Indian grouping (`₹ 1,02,880`, `₹ 86.4 L`) through a formatter in packages/shared.
- The platform super-admin gets no permission keys in this domain. The API guard rejects platform-scoped tokens on every `/leave/*`, `/payroll/*` and `/payslips/*` route, and RLS never sets `app.tenant_id` for platform sessions.
- Salaries have no GST, so the GST split does not apply to this domain.

**Wireframe facts this spec is built on (checked against the calendar):**
- Payslip working days are Jun 22, Jul 23, Aug 21 and Sep 22 in 2026. These equal weekdays minus holidays (15 Aug 2026 falls on a Saturday). So **working days = calendar days − weekly offs − holidays**, and the default pay-day divisor is `WORKING_DAYS`.
- Priya's structure: Basic ₹42,000 (50% of gross), HRA ₹21,000 (50% of Basic), Special ₹21,000 (balancing), gross ₹84,000. Employer PF ₹1,800 = 12% × ₹15,000 ceiling. CTC ₹85,800/month, ₹10,29,600/year. So **CTC = gross + employer PF (12%, ceiling applied)**.
- July shows 22.5 paid days out of 23, after a rejected 0.5-day CL. Paid days = working days − LOP. A rejected leave with a recorded absence becomes LOP.
- The "Exclude (9)" pending-timesheets option leads to "Payslips generated for 119 employees" (128 − 9). So Exclude means **these employees are left out of this run** and processed later.
- Priya's 0h 40m of idle time produced no change in net pay. The spec therefore adds a **monthly idle grace** with a default of 60 min (see open questions).

---

## PART A: LEAVE MANAGEMENT

### Module L1: Holiday and working-day calendar (P1)

**1. Screens and UX**
- Time off → "Upcoming" panel shows holidays in the next 90 days (up to 5) merged with the user's own upcoming approved or pending leave, sorted by date. Examples: "Dussehra 20 Oct", "Diwali 8 – 9 Nov", "Your earned leave 14 – 16 Oct". Consecutive holidays with the same name are shown as one range.
- Leave setup gets a 5th tab, **Holidays**. This is an addition; the wireframe keeps the "Holiday list 2026" document in Policies. Columns: Date, Holiday, Type (Public/Optional), Calendar, Locations. Actions: "Add holiday", "Import CSV", "Copy to next year", "Publish to Policies". Publishing renders a PDF into the Policies domain.
- Requires `hr` or `admin` (`holiday.manage`). Everyone can view (`holiday.view`).

**2. Data model**
```prisma
enum HolidayType { PUBLIC OPTIONAL RESTRICTED }
model HolidayCalendar { id; tenantId; name String; year Int; isDefault Boolean @default(false)
  holidays Holiday[]; locations HolidayCalendarLocation[]
  @@unique([tenantId, name, year]) }
model HolidayCalendarLocation { id; tenantId; calendarId String @db.Uuid; workLocationId String @db.Uuid; year Int
  @@unique([tenantId, workLocationId, year]) }            // one calendar per location per year
model Holiday { id; tenantId; calendarId String @db.Uuid; date DateTime @db.Date; name String; type HolidayType @default(PUBLIC)
  @@unique([calendarId, date, name]) @@index([tenantId, date]) }
```

**3. Workflow.** None beyond CRUD. Editing a holiday in a period whose payroll is finalized is blocked; the error says to raise an adjustment instead.

**4. API**
- `GET /holidays?year=&locationId=` (holiday.view)
- `GET /leave/me/upcoming` (leave.self.view)
- `POST|PATCH|DELETE /holiday-calendars[/:id]` (holiday.manage)
- `POST|PATCH|DELETE /holiday-calendars/:id/holidays[/:hid]` (holiday.manage)
- `POST /holiday-calendars/:id/import` (CSV; holiday.manage)
- `POST /holiday-calendars/:id/copy {toYear}` (holiday.manage)
- Internal `WorkCalendarService.getDays(employeeId, from, to)` returns `[{date, kind: WORKING|WEEKLY_OFF|HOLIDAY, holidayName?}]`. It is built from:
  - the employee's effective-dated shift allocation (weekly off days), from the Shifts domain;
  - the work location's holiday calendar, falling back to the tenant default calendar.

**5. Rules**
- Optional/restricted holidays count as WORKING unless the employee has chosen them (P2).
- Working days in a month = number of dates with kind WORKING.

**6. Jobs, notifications, audit**
- Cron on 1 Dec 09:00: remind HR if next year's calendar is missing.
- Audit: `holiday.created|updated|deleted|imported`.

**7. Integrations.** None.

**8. Edge cases**
- A holiday on a weekly off is stored but has no effect on counts.
- If a location has no calendar, the tenant default is used. If there is no default either, a warning appears in payroll pre-check.

**9. Phase and dependencies.** P1. Depends on Locations and Shifts (weekly offs, allocations).

**10. Acceptance**
1. With 20 Oct 2026 as a holiday on the Ahmedabad calendar, `getDays(Priya, 2026-10-19, 2026-10-21)` returns WORKING, HOLIDAY, WORKING.
2. September 2026 with the General shift (Sat/Sun off) and no holidays gives 22 working days. August 2026 with 15 Aug gives 21.
3. The Pune employee resolves to the Pune calendar and the Ahmedabad employee to the HQ calendar.
4. An employee user cannot POST a holiday (403).

---

### Module L2: Leave setup (GEN `leaveAdmin`) (P1)

**1. Screens and UX.** Route `/leave-admin`, visible to hr and admin. Header "Leave setup" with subtitle "Leave types, annual credit rules and manual credits." Actions: primary **Credit leave** (form `credit`), secondary **Add leave type** (form `leavetype`), and a gear icon for **Leave settings** (addition).

- **Tab: Leave types**
  - Columns: Leave type, Annual quota, Carry forward, Encashable, Applies to.
  - Seeded rows:
    - Casual leave: 12, No, No, Full-time
    - Sick leave: 8, No, No, Full-time + Interns
    - Earned leave: 18, "Up to 30", Yes, Full-time
    - Comp-off: "On approval", "60 days" (shown as expiry), No, Full-time
    - LWP (Leave without pay), hidden-unpaid: no quota, applies to all
  - Clicking a row opens an edit drawer with every LeaveType field. There is a Deactivate action; a type that has ledger entries cannot be deleted.
  - The **Add leave type** form shows the wireframe fields (Name, Annual quota, Carry forward) plus an "Advanced" collapsible containing the remaining LeaveType fields. Defaults apply if Advanced is left alone.
- **Tab: Basic credit**
  - Columns: Leave type, Applies to, Frequency (Yearly/Monthly/Quarterly), Days per period, Pro-rate on joining, Last run (date + status tag), Next run.
  - Row actions: Edit rule, "Run now" for a chosen period (idempotent).
- **Tab: Manual credit**
  - Ledger of MANUAL_CREDIT, MANUAL_DEBIT and manual COMP_OFF_GRANT entries.
  - Columns: Date, Employee, Leave type, Days (±), Note, Credited by.
- **Tab: Requests**
  - All leave requests. Columns: Employee, Type, Dates, Days, Approver, Applied on, Status. Filters: status, department, type, date range.
  - HR row actions (`leave.request.approve.any`): Approve / Reject on behalf (comment required), Cancel, and "Apply on behalf" as a header button.
- **Tab: Holidays.** See L1.
- **Form `credit` (Credit leave)**
  - Credit type: Manual credit or Basic (annual).
  - Leave type.
  - Days: ± in 0.5 steps; negative means debit.
  - Employees: multi-select, with a department or employment-type bulk picker.
  - Note: required, 5–500 characters.
  - If the type is Comp-off, an extra field "Worked date" appears (default today) and drives expiry.
  - Choosing "Basic (annual)" runs the credit rule for the selected employees and current period, for example late joiners. Days is taken from the rule and is read-only.
  - Toast: "Credited N days to M employees".
- **Leave settings:** leave year start month, escalation days, fallback approver, excess-balance action, comp-off thresholds.

**2. Data model**
```prisma
enum EmploymentType { FULL_TIME INTERN CONTRACT PART_TIME }   // owned by People domain, referenced
enum LeaveAccrualFrequency { YEARLY MONTHLY QUARTERLY ON_APPROVAL NONE }
enum CarryForwardMode { NONE CAP UNLIMITED }
enum Enforcement { WARN BLOCK }
enum ExcessBalanceAction { REJECT CONVERT_TO_LOP }
enum CreditBatchType { ANNUAL MONTHLY QUARTERLY JOINING_PRORATION YEAR_END MANUAL }
enum BatchStatus { RUNNING COMPLETED FAILED }
enum LeaveLedgerTx { OPENING ACCRUAL PRORATED_ACCRUAL MANUAL_CREDIT MANUAL_DEBIT COMP_OFF_GRANT AVAIL AVAIL_REVERSAL
                     CARRY_FORWARD_IN CARRY_FORWARD_OUT LAPSE EXPIRY ENCASHMENT }

model LeaveSettings { tenantId String @id @db.Uuid
  leaveYearStartMonth Int @default(1)           // 1 = Jan–Dec
  pendingReminderHours Int @default(48)
  escalateAfterDays Int @default(3)
  escalateTo String @default("RM_MANAGER")      // RM_MANAGER | HR
  fallbackApproverRoleKey String @default("hr")
  excessBalanceAction ExcessBalanceAction @default(REJECT)
  compOffHalfDayMinMinutes Int @default(240)
  compOffFullDayMinMinutes Int?                 // null = employee shift net minutes
  compOffRequestWindowDays Int @default(30)
  teamOverlapWarnPct Int @default(30) }

model LeaveType { id; tenantId
  code String; name String; shortLabel String; color String?; displayOrder Int @default(0)
  isPaid Boolean @default(true); isCompOff Boolean @default(false)
  annualQuota Decimal? @db.Decimal(6,2)                  // null => "On approval"
  accrualFrequency LeaveAccrualFrequency @default(YEARLY)
  prorateOnJoin Boolean @default(true)
  carryForwardMode CarryForwardMode @default(NONE); carryForwardCap Decimal? @db.Decimal(6,2)
  maxAccumulation Decimal? @db.Decimal(6,2)
  expiryDays Int?                                        // comp-off: 60
  encashable Boolean @default(false); maxEncashDaysPerYear Decimal? @db.Decimal(6,2); encashExcessAtYearEnd Boolean @default(false)
  applicableEmploymentTypes EmploymentType[]; applicableGender String?   // null | FEMALE | MALE
  eligibleAfterDays Int @default(0); allowDuringProbation Boolean @default(true); allowDuringNotice Boolean @default(true)
  allowHalfDay Boolean @default(true)
  sandwichWeeklyOffs Boolean @default(false); sandwichHolidays Boolean @default(false)
  allowNegative Boolean @default(false); negativeLimit Decimal @default(0) @db.Decimal(6,2)
  minNoticeDays Int @default(0); noticeEnforcement Enforcement @default(WARN)
  maxConsecutiveDays Decimal? @db.Decimal(6,2)
  backdateLimitDays Int @default(0)
  documentRequiredAfterDays Decimal? @db.Decimal(6,2)
  isActive Boolean @default(true)
  @@unique([tenantId, code]) }

model LeaveCreditRule { id; tenantId; leaveTypeId String @db.Uuid; employmentType EmploymentType
  frequency LeaveAccrualFrequency; daysPerPeriod Decimal @db.Decimal(6,2); creditDay Int @default(1)
  prorateOnJoin Boolean @default(true); effectiveFrom DateTime @db.Date; effectiveTo DateTime? @db.Date; isActive Boolean @default(true)
  @@unique([tenantId, leaveTypeId, employmentType, effectiveFrom]) }

model LeaveCreditBatch { id; tenantId; type CreditBatchType; leaveTypeId String? @db.Uuid
  periodKey String            // "2026" | "2026-09" | "manual:<uuid>" | "ye:2026"
  leaveYear Int; status BatchStatus; employeeCount Int @default(0); totalDays Decimal @default(0) @db.Decimal(10,2)
  triggeredById String? @db.Uuid; note String?; error String?; startedAt DateTime; completedAt DateTime?
  @@unique([tenantId, type, leaveTypeId, periodKey]) }

model LeaveLedgerEntry { id; tenantId; employeeId String @db.Uuid; leaveTypeId String @db.Uuid; leaveYear Int
  txType LeaveLedgerTx; days Decimal @db.Decimal(6,2)     // signed
  effectiveDate DateTime @db.Date; requestId String? @db.Uuid; compOffGrantId String? @db.Uuid; batchId String? @db.Uuid
  note String?; createdById String? @db.Uuid; createdAt DateTime @default(now())   // append-only; no updates
  @@unique([batchId, employeeId, leaveTypeId]) @@index([tenantId, employeeId, leaveTypeId, leaveYear]) }

model LeaveBalance { id; tenantId; employeeId String @db.Uuid; leaveTypeId String @db.Uuid; leaveYear Int
  opening Decimal @db.Decimal(6,2) @default(0); accrued ...; credited ...; availed ...; pending ...; lapsed ...; encashed ...
  entitlement Decimal @db.Decimal(6,2)   // card "total"
  available Decimal @db.Decimal(6,2)     // card "left"
  version Int @default(0)
  @@unique([tenantId, employeeId, leaveTypeId, leaveYear]) }
```

**3. Workflows.** LeaveCreditBatch moves RUNNING → COMPLETED or FAILED. A FAILED batch can be retried. It is idempotent through its unique key plus the per-employee ledger unique constraint.

**4. API**
- Leave types:
  - `GET /leave/types` (leave.self.view returns active applicable types; leave.admin.types.manage returns all)
  - `POST /leave/types` (leave.admin.types.manage)
  - `PATCH /leave/types/:id` (leave.admin.types.manage)
  - `POST /leave/types/:id/deactivate` (leave.admin.types.manage)
- Credit rules and runs:
  - `GET|POST|PATCH|DELETE /leave/credit-rules[/:id]` (leave.admin.rules.manage)
  - `GET /leave/credit-runs` (leave.admin.rules.manage)
  - `POST /leave/credit-runs {type, leaveTypeId, periodKey, employeeIds?}` (leave.admin.rules.manage)
- Manual credits:
  - `POST /leave/credits {leaveTypeId, days, employeeIds[], note, workedDate?}` (leave.admin.credit)
  - `GET /leave/credits?from&to&employeeId` (leave.admin.credit)
- Employee balances and ledger: `GET /leave/employees/:id/balances`, `GET /leave/employees/:id/ledger?year` (leave.admin.requests.view or self)
- Settings: `GET|PUT /leave/settings` (leave.admin.rules.manage)

**5. Rules**
- **Leave year** follows `leaveYearStartMonth`; the default is calendar year. Comp-off grants are not tied to a leave year and expire individually.
- **YEARLY credit:** on the leave-year start, credit `daysPerPeriod`.
- **MONTHLY credit:** on `creditDay` each month, credit `daysPerPeriod`, which defaults to quota / 12.
- **Joining pro-ration (YEARLY):** `round_half(quota × remainingMonthsIncludingJoinMonth / 12)`, where the join month counts only if the join date is on or before the 15th. `round_half` rounds to the nearest 0.5.
- **Joining pro-ration (MONTHLY):** the first credit is in the month after joining if joined after the 15th.
- **Eligibility:** employment type is in the applicable set; gender matches if set; `today − joinDate ≥ eligibleAfterDays`; probation and notice flags respected.
- **Balance card values:**
  - `entitlement` = opening + scheduled full-year accrual (pro-rated) + manual credits + comp-off grants still valid.
  - `available` = opening + accrued + credited − availed − lapsed − encashed − pending.
  - With monthly accrual the card meta reads "X more accruing by Dec".
- **Ledger rules:** every change is a LeaveLedgerEntry. LeaveBalance is updated in the same transaction, using `SELECT … FOR UPDATE` and a version increment. A nightly integrity job recomputes the balance from the ledger and alerts on drift.
- **Manual debit** may take a balance negative only if the type allows negatives, or if HR ticks "override" (audited).

**6. Jobs, notifications, audit**
- `leave-accrual` cron 00:30 daily. It picks up rules whose period starts today and creates one batch per rule and period.
- `leave-proration` runs on the event `employee.joined`.
- Employees get in-app and email "N days of <type> credited", batched once per employee per day.
- Audit: `leave.type.created|updated|deactivated`, `leave.rule.created|updated|deleted`, `leave.credit.batch.run`, `leave.credit.manual` (actor, target, type, days, note), `leave.settings.updated`.

**7. Integrations.** None.

**8. Edge cases**
- Changing a type's quota mid-year affects future accruals only. Past ledger entries are never rewritten.
- A deactivated type keeps its balances readable, but no new requests or credits are allowed.
- If an employee's employment type changes (intern to full-time), balances of the old type stay. New rules apply from the change date, pro-rated.
- Manual days must be a multiple of 0.5 with absolute value ≤ 365.

**9. Phase and dependencies.** P1. Depends on People (employment type, join date, gender, status), RBAC, Notifications and Audit.

**10. Acceptance**
1. A monthly EL rule of 1.5 runs on 1 Oct. Running it twice for "2026-10" creates one ledger entry per employee.
2. An employee joining 10 Sep 2026 gets pro-rated CL `round_half(12 × 4/12) = 4`. Joining on 20 Sep gives 3.
3. HR manual-credits 2 Comp-off days to 3 employees with worked date 3 Oct. Three grants are created, each expiring 2 Dec 2026, and three alerts are sent.
4. Deactivating "Casual leave" removes it from the Apply form but keeps the history visible.
5. A manager calling `POST /leave/credits` gets 403.

---

### Module L3: Time off: apply, approve, cancel (screen `leave`, dashboard cards) (P1)

**1. Screens and UX**

**Time off (`/leave`, all roles)**
- Header "Time off", subtitle "Requests route to your Reporting Manager; approved leave flows into payroll." Primary button **Apply time off**.
- **Balance cards:** one per applicable active type, in display order. Kicker is the type name. The big number is `available` with "/ entitlement" after it, and the meta reads "days available". For comp-off the meta also shows "1 expires 2 Dec". Negative balances are shown in the accent-danger colour with a minus sign.
- **History table**
  - Columns: Type, Dates ("14 – 16 Oct"; half-day shows "2 Jul · first half"), Days, Reason, Status.
  - Status tags: Pending RM (outline), Approved (accent), Rejected (neutral), Withdrawn (neutral), Cancellation pending (outline), Cancelled (neutral).
  - Filters: year and status. Paginated, 20 per page.
  - Clicking a row opens a drawer with the per-day breakdown (sandwich, holiday and LOP days labelled), approver, notify list, comments timeline, attachment, and actions: **Withdraw** (pending), **Cancel** (approved and not started), **Request cancellation** (approved and started or past).
- **Upcoming:** see L1.
- **Tab "Team requests"** (addition; shown when the user has `leave.team.view`)
  - Pending list: Employee, Type, Dates, Days, Balance after, Team overlap ("2 others off"), Reason, Applied.
  - Actions: Approve, and Reject (comment required).
  - Secondary list: team history for 90 days.

**Apply time off form (`leave`)**
- **Leave type:** select of eligible types, each labelled with its balance, e.g. "Earned leave · 11 left".
- **From** and **To** dates. To defaults to From.
- **Half day:** No / First half / Second half. Enabled only when From = To and the type allows half days. When From ≠ To, two checkboxes replace it: "Start from second half" and "End at first half". These map to `fromSession`/`toSession`.
- **Notify:** the Reporting Manager is pre-filled and locked as approver ("Neha Kapoor (RM)"). Additional CC people can be multi-selected.
- **Reason:** textarea, required, 3–500 characters.
- **Attachment:** shown when `documentRequiredAfterDays` is exceeded.
- **Live preview** from `POST /leave/requests/preview`, e.g. "3 days · balance after 8 · Dussehra (20 Oct) excluded · 2 sandwich days counted". Warnings and blocks appear inline.
- Submit button "Submit request". Toast: "Request sent to <RM name>".

**Dashboard (`/dashboard`)**
- **Leave balance** card: each type as `left / total`, plus an "Apply time off" button that opens `/leave` with the form open.
- **Leave history** list: last 4 requests, "Type · days" with status tag.
- **Awaiting your approval** card: shown to anyone who has approval permissions, which is roughly role ≠ employee in the wireframe, and only when the user has direct reportees. Rows: "Timesheets N" (timesheet domain), "Time-off requests N" (pending requests where approverId = me, plus pending comp-off requests), "Helpdesk escalations N" (helpdesk domain). **Review now** goes to `/approvals?tab=leave`.
- The approvals screen gets a third segment, "Time off · N", that renders the Team requests component. This is an addition; the wireframe only shows the two timesheet levels.

**Per-role differences**

| Role | What they get |
|---|---|
| employee | Own screen only. |
| lead | Same as employee. Gets the dashboard approval card only if the lead is also RM of someone. Can be on the CC list. |
| manager | Team requests tab plus the dashboard card. |
| hr | Everything above plus Leave setup → Requests (approve/reject on behalf, apply on behalf). |
| admin | Same as hr. |

**2. Data model**
```prisma
enum DaySession { FULL FIRST_HALF SECOND_HALF }
enum LeaveDayKind { WORKING WEEKLY_OFF HOLIDAY }
enum LeaveRequestStatus { PENDING APPROVED REJECTED WITHDRAWN CANCELLATION_PENDING CANCELLED }
enum ApproverSource { RM FALLBACK HR_ON_BEHALF ESCALATED DELEGATE }

model LeaveRequest { id; tenantId; requestNo String            // LV-2026-00042 (per-tenant sequence)
  employeeId String @db.Uuid; leaveTypeId String @db.Uuid
  fromDate DateTime @db.Date; toDate DateTime @db.Date
  fromSession DaySession @default(FULL); toSession DaySession @default(FULL)
  totalDays Decimal @db.Decimal(6,2); paidDays Decimal @db.Decimal(6,2); lopDays Decimal @db.Decimal(6,2) @default(0)
  sandwichDays Decimal @db.Decimal(6,2) @default(0)
  reason String; attachmentFileId String? @db.Uuid
  status LeaveRequestStatus @default(PENDING)
  approverId String @db.Uuid; approverSource ApproverSource @default(RM); notifyUserIds String[] @db.Uuid
  appliedById String @db.Uuid; appliedAt DateTime @default(now())
  decidedById String? @db.Uuid; decidedAt DateTime?; decisionComment String?
  cancelRequestedAt DateTime?; cancelReason String?; cancelledById String? @db.Uuid; cancelledAt DateTime?
  escalatedAt DateTime?; touchesLockedPayroll Boolean @default(false); version Int @default(0)
  days LeaveRequestDay[]
  @@unique([tenantId, requestNo]) @@index([tenantId, employeeId, fromDate]) @@index([tenantId, approverId, status]) }

model LeaveRequestDay { id; tenantId; requestId String @db.Uuid; employeeId String @db.Uuid
  date DateTime @db.Date; session DaySession; dayKind LeaveDayKind
  units Decimal @db.Decimal(3,2)   // 0 | 0.5 | 1 counted against balance
  isSandwich Boolean @default(false); isPaid Boolean @default(true); leaveYear Int
  active Boolean @default(true)    // false when request rejected/withdrawn/cancelled
  @@index([tenantId, employeeId, date]) }
```
Overlap is guarded by a per-employee advisory lock (`pg_advisory_xact_lock(hash(tenantId, employeeId))`) plus an application check over active days.

**3. State machine (LeaveRequest)**

| From | To | Trigger | Side effects |
|---|---|---|---|
| (new) | PENDING | Employee (`leave.self.apply`) or HR on behalf | Ledger: `pending += totalDays` (balance reserve, no ledger row). Notify approver and CC. Socket event `approvals.counts`. |
| PENDING | APPROVED | Approver with approverId = me and `leave.request.approve`, or HR with `.any` | Ledger AVAIL (−paidDays) for each leave year. `pending −=`. Comp-off consumption (FIFO). Emit `leave.request.approved` (Attendance marks ON_LEAVE, payroll marks affected items STALE or creates an adjustment, see P4). Notify employee. |
| PENDING | REJECTED | Same actors; comment required | `pending −=`. Days set inactive. Notify employee. |
| PENDING | WITHDRAWN | Owner | `pending −=`. Notify approver. |
| APPROVED (fromDate > today) | CANCELLED | Owner (direct) or HR | Ledger AVAIL_REVERSAL. Comp-off consumption reversed (restored only if the grant has not expired, otherwise EXPIRY is booked). Emit `leave.request.cancelled`. Notify RM. |
| APPROVED (fromDate ≤ today) | CANCELLATION_PENDING | Owner, with reason | Notify approver. |
| CANCELLATION_PENDING | CANCELLED | Approver or HR approves | Same as the direct cancel above. If the dates are in a finalized payroll, create PayrollAdjustment LOP_RECOVERY (days that become absent) or nothing (days the attendance record shows as worked). |
| CANCELLATION_PENDING | APPROVED | Approver rejects the cancellation | Notify owner. |

- An approver cannot act on their own request. If the RM is the employee (for example the CEO), the fallback approver is used.
- **Escalation:** PENDING for more than `escalateAfterDays` reassigns the approver to the RM's manager or to HR (approverSource ESCALATED), and both parties are notified.
- **RM change** (event `employee.manager_changed`): PENDING requests are rerouted to the new RM.
- **Exit** (event `employee.exited`): PENDING or APPROVED requests after the last working day are auto-cancelled.

**4. API**
- Self service (all `leave.self.*`):
  - `GET /leave/me/balances?year=`
  - `GET /leave/me/requests?year&status&page`
  - `GET /leave/me/upcoming`
  - `GET /leave/me/today`, used by tracker and attendance to show "On leave today"
  - `POST /leave/requests/preview` (body same as create) returns `{totalDays, paidDays, lopDays, sandwichDays, days[], balanceAfter, warnings[], blocks[]}`
  - `POST /leave/requests` (leave.self.apply; `Idempotency-Key` header)
  - `GET /leave/requests/:id` (owner, approver, CC or leave.admin.requests.view)
  - `POST /leave/requests/:id/withdraw` (owner)
  - `POST /leave/requests/:id/cancel {reason}` (owner; direct or creates CANCELLATION_PENDING)
- Approver actions (`leave.request.approve` scoped to approverId = me, or `leave.request.approve.any`):
  - `POST /leave/requests/:id/approve {comment?}`
  - `POST /leave/requests/:id/reject {comment}`
  - `POST /leave/requests/:id/cancellation/approve`
  - `POST /leave/requests/:id/cancellation/reject`
- Team:
  - `GET /leave/team/requests?status=PENDING` (leave.team.view; direct reportees, or reportee tree if `?depth=all`)
  - `GET /leave/team/calendar?from&to` (leave.team.view; used for the overlap figure)
  - `GET /leave/team/pending-count` (leave.team.view; feeds the dashboard aggregator `GET /approvals/counts`)
- HR:
  - `POST /leave/requests/on-behalf {employeeId, …}` (leave.request.create.any)
  - `GET /leave/admin/requests?status&dept&type&from&to` (leave.admin.requests.view)
- **Realtime (Socket.IO)**, rooms `user:{id}`:
  - `leave.request.created` to the approver
  - `leave.request.updated` to owner and approver
  - `leave.balance.updated` to the owner
  - `approvals.counts` `{leave, compOff}` to the approver

**5. Business rules and calculations**
- **Day expansion:**
  1. For each date d in [from, to], get its kind from `WorkCalendarService`.
  2. Session for d: FULL, except `fromSession` on the first day and `toSession` on the last. A single-day half is FIRST_HALF or SECOND_HALF.
  3. WORKING day: units = 1 for FULL, 0.5 for a half.
  4. WEEKLY_OFF or HOLIDAY day: units = 0, unless the sandwich rule applies.
- **Sandwich rule:** a maximal block of consecutive non-working days B is sandwiched when both of these hold:
  - The working day immediately before B is covered by leave through its second half (FULL or SECOND_HALF). This can come from the same request, or from an active approved or pending request of any sandwich-enabled type.
  - The working day immediately after B is covered from its first half (FULL or FIRST_HALF).

  Then each day in B counts as 1 unit, marked `isSandwich`, charged to the type of the current request. This applies when that type has `sandwichWeeklyOffs` (for weekly offs) or `sandwichHolidays` (for holidays).
  - Leading or trailing non-working days in a range are never counted.
  - If the other side of the block comes from an earlier request, the sandwich units are added to the **new** request only. The earlier request is never mutated.
  - Seeded settings: EL and CL have sandwichWeeklyOffs = true and sandwichHolidays = false. SL, Comp-off and LWP have both false.
- **Holiday exclusion:** non-sandwiched HOLIDAY and WEEKLY_OFF days have units = 0.
- **Rejected ranges:** a range whose total units = 0 is rejected with "No working days in range". A half-day on a non-working day is rejected.
- **Balance check** is done per leave year. A cross-year range is split, and each part is checked against that year's available balance. The next year's projected available = projected carry-forward + that year's YEARLY credit.
  - If `units ≤ available`: fully paid.
  - Otherwise, if `allowNegative` and `available − units ≥ −negativeLimit`: paid, and the balance goes negative.
  - Otherwise, if settings.excessBalanceAction = CONVERT_TO_LOP: the excess becomes LOP. Those days get `isPaid = false`, `lopDays` is set, and the UI requires ticking "I understand X days will be unpaid".
  - Otherwise: blocked.
- **Comp-off type:** available = sum of remaining units on APPROVED or PARTIALLY_USED grants with `expiresOn ≥ leave date`. Consumption is FIFO by expiresOn. A leave date after a grant's expiry cannot use that grant.
- **LWP type:** isPaid = false, no balance check, and all units are LOP.
- **Notice:** if `fromDate − today < minNoticeDays`, the result is WARN or BLOCK per the type. HR on-behalf requests bypass it.
- **Backdating:** a `fromDate < today` more than `backdateLimitDays` in the past is blocked for self-service (seed: SL 7, others 0). HR on-behalf may backdate. Backdated dates in a finalized payroll period set `touchesLockedPayroll = true`.
- **Other limits:** `maxConsecutiveDays` counts all counted units including sandwich days. `documentRequiredAfterDays` (seed SL 2) makes the attachment mandatory.
- **Overlap:** an active day on the same date for the same employee conflicts, unless the two sessions are complementary halves (FIRST_HALF + SECOND_HALF).
- **Team overlap warning:** if more than `teamOverlapWarnPct`% of the approver's direct reportees are on leave on any date in the range, the approver sees a warning. It never blocks.
- **Leave to payroll** (consumed by P3): for each date, `approvedLeaveUnits(date, paid|unpaid)` comes from active APPROVED LeaveRequestDays. PENDING leave is not paid in payroll. Pre-check flags it; see P3 rules.

**6. Jobs, notifications, audit**
- `leave-reminders` cron 10:00 daily: remind approvers of requests pending longer than `pendingReminderHours`, and escalate those older than `escalateAfterDays`.
- In-app and email notifications:
  - request submitted → approver and CC, with approve/reject deep links (authenticated)
  - approved or rejected → employee
  - cancelled or cancellation requested → approver
  - escalated → old approver, new approver, employee
- Emails go through the Notifications adapter (SMTP, Mailpit in dev).
- Audit: `leave.request.submitted|approved|rejected|withdrawn|cancel_requested|cancelled|escalated|rerouted|approved_on_behalf|applied_on_behalf`, recording before/after status, days, and the actor.

**7. Integrations.** Notifications (email and in-app) only.

**8. Validation and edge cases**
- `from ≤ to`. The range must be ≤ 366 days.
- The employee must be ACTIVE or NOTICE and the type must be applicable.
- If the employee has no RM, the fallback approver role (HR) is used.
- Concurrent approval and cancel: optimistic `version` check, with 409 on conflict.
- Approving after the payroll attendance lock for that month:
  - If the run is CALCULATED, affected items become STALE and a re-run banner appears.
  - If the run is FINALIZED or PAID, a PayrollAdjustment LOP_REVERSAL is created (see P4).
- Leave on a day attendance shows as a full present day: the approver sees a warning. It never blocks.
- A shift or holiday change after submission does not recompute approved requests. HR can use the "Recompute days" admin action (audited).

**9. Phase and dependencies.** P1. Depends on People (RM hierarchy, status), L1, L2, Notifications, the dashboard aggregator, and the approvals screen (timesheet domain) for the added tab.

**10. Acceptance**
1. Priya has EL available 14 and entitlement 18. She applies EL 14–16 Oct 2026 (Wed–Fri) "Family function". The preview shows 3 days. After submit: status Pending RM, the card shows 11 / 18, Neha's dashboard shows "Time-off requests 1" live via socket, and Neha gets an email.
2. With CL sandwich on, one request for Fri 9 Oct + Mon 12 Oct gives 4 days (Sat and Sun sandwiched). With sandwich off it gives 2. With Fri 9 approved separately, a new Mon 12 request gives 3.
3. EL 19–21 Oct with the 20 Oct holiday gives 2 days (sandwichHolidays = false). CL "7 Oct · first half" gives 0.5. A second-half CL on 7 Oct is then accepted; another first-half request on 7 Oct is rejected with 409.
4. With excessBalanceAction REJECT, a request needing 5 CL when 4 are available is blocked. With CONVERT_TO_LOP it produces paid 4 and lop 1.
5. Neha rejects with comment "Release week". Priya's balance is restored, she is notified, and the history shows Rejected. Priya calling approve on her own request gets 403.
6. An approved future leave cancelled by the employee restores the balance. For a past approved leave in finalized September, the cancellation approval creates a LOP_RECOVERY adjustment for October.

---

### Module L4: Comp-off (P1)

**1. Screens and UX**
- Time off gets a secondary button **Request comp-off** (addition). The form has Worked date, Duration (Full day / Half day), and Reason. Shown to employees whose employment type is in Comp-off's applicable set.
- Pending comp-off requests appear in the approver's Team requests tab with the label "Comp-off credit", including the attendance evidence (punch in/out and worked hours).
- HR can grant directly through Credit leave → Comp-off (L2).
- The comp-off balance card lists grants with their expiry dates.

**2. Data model**
```prisma
enum CompOffStatus { PENDING APPROVED REJECTED PARTIALLY_USED USED EXPIRED CANCELLED }
model CompOffGrant { id; tenantId; employeeId String @db.Uuid; workedDate DateTime @db.Date
  units Decimal @db.Decimal(3,2); remaining Decimal @db.Decimal(3,2); expiresOn DateTime @db.Date
  status CompOffStatus; source String   // REQUEST | MANUAL
  reason String?; workedMinutes Int?; approverId String? @db.Uuid; decidedById String? @db.Uuid; decidedAt DateTime?; comment String?
  @@index([tenantId, employeeId, status, expiresOn]) }
// partial unique: UNIQUE(tenant_id, employee_id, worked_date) WHERE status NOT IN ('REJECTED','CANCELLED')
model CompOffConsumption { id; tenantId; grantId String @db.Uuid; requestId String @db.Uuid; units Decimal @db.Decimal(3,2); reversedAt DateTime? }
```

**3. State machine**
- PENDING → APPROVED: RM with `compOff.approve`. Ledger COMP_OFF_GRANT +units.
- PENDING → REJECTED: RM with a comment.
- APPROVED → PARTIALLY_USED → USED: through leave consumption. Consumption can be reversed on cancellation.
- APPROVED or PARTIALLY_USED → EXPIRED: expiry job. Ledger EXPIRY −remaining.
- Any → CANCELLED: HR, only if nothing has been consumed.

**4. API**
- `POST /leave/comp-off/requests` (compOff.request)
- `GET /leave/comp-off/me` (leave.self.view)
- `POST /leave/comp-off/requests/:id/approve` and `/reject` (compOff.approve, RM scope; HR uses `.any`)
- `POST /leave/comp-off/grants/:id/cancel` (leave.admin.credit)

**5. Rules**
- The worked date must be WEEKLY_OFF or HOLIDAY for the employee.
- It must be within `compOffRequestWindowDays` (30) of today.
- Attendance must show `workedMinutes ≥ compOffHalfDayMinMinutes` (240) for a half day, or `≥ full-day minimum` (the shift's net minutes, 480 for General) for a full day.
- `expiresOn = workedDate + expiryDays` (60). The last usable leave date is expiresOn itself.
- Encashable = No; comp-off never carries forward past its expiry.

**6. Jobs, notifications, audit**
- `compoff-expiry` cron 00:15 daily: expire grants where `expiresOn < today`.
- `compoff-expiry-warning` cron 09:00: notify employees 7 days before expiry.
- Notifications: request → RM; decision → employee.
- Audit: `compoff.requested|approved|rejected|expired|cancelled`.

**7. Integrations.** Attendance query port for worked minutes.

**8. Edge cases**
- A worked date that is itself covered by leave is rejected.
- Duplicate worked dates are rejected.
- Worked-date evidence missing because of a biometric sync delay: the request is allowed with an "Evidence pending" flag, and the approver sees a warning.
- Cancelling a leave that consumed an expired grant books EXPIRY rather than restoring the balance.

**9. Phase and dependencies.** P1. Depends on the Attendance domain (day summary with worked minutes) and on L1 and L3.

**10. Acceptance**
1. Priya works Sat 3 Oct 2026, 09:40–18:10 (worked 480 min), and requests a full day. Neha approves. A grant of 1 is created expiring 2 Dec 2026, and the Comp-off card shows 1 / 1 "expires 2 Dec".
2. A request for Thu 1 Oct (a working day) is rejected.
3. With the job clock at 3 Dec and the grant unused, the job runs: the grant becomes EXPIRED, ledger −1, and the card shows 0.
4. Two grants (expiring 10 Nov and 2 Dec) and a 1.5-day comp-off leave on 5–6 Nov: the 10 Nov grant is consumed first, then 0.5 of the second.

---

### Module L5: Leave year-end (carry forward, lapse, encashment) (P1 carry and lapse; P2 encashment)

**1. Screens and UX**
- Leave setup → Basic credit shows a "Year-end processing · 2026" card.
- **Preview** lists per employee and type: Closing, Carry forward, Encash, Lapse.
- **Run** confirms the preview. Result: toast and batch row.
- P2: the Time off screen gets an "Encash leave" request button for types with `encashable`.

**2. Data model.** Reuses LeaveCreditBatch (type YEAR_END) and LeaveLedgerEntry. Adds:
```prisma
model LeaveEncashment { id; tenantId; employeeId String @db.Uuid; leaveTypeId String @db.Uuid; leaveYear Int
  days Decimal @db.Decimal(6,2); perDayRate Decimal @db.Decimal(12,4); amount Decimal @db.Decimal(14,2)
  source String /* YEAR_END | REQUEST | EXIT */; status String /* PENDING_APPROVAL | PENDING_PAYROLL | PAID | CANCELLED */
  payrollAdjustmentId String? @db.Uuid; approvedById String? @db.Uuid
  @@unique([tenantId, employeeId, leaveTypeId, leaveYear, source]) }
```

**3. Workflow**
- The year-end batch runs automatically at 00:45 on leave-year start, or manually from preview.
- Within the batch, for each employee and type: `closing = available + pending` for the old year. Pending requests that cross years are already split by year.

**4. API**
- `POST /leave/year-end/preview {leaveYear}` (leave.admin.rules.manage)
- `POST /leave/year-end/run {leaveYear}` (leave.admin.rules.manage)
- P2:
  - `POST /leave/encashments` (leave.self.apply)
  - `POST /leave/encashments/:id/approve` (leave.admin.credit)

**5. Rules**
- Carry forward per mode:
  - NONE: carry = 0.
  - CAP: `carry = min(max(closing,0), carryForwardCap)`.
  - UNLIMITED: `carry = max(closing, 0)`.
- `maxAccumulation` caps opening + annual credit.
- `excess = max(closing,0) − carry`. If `encashable && encashExcessAtYearEnd`, then `encash = min(excess, maxEncashDaysPerYear ?? excess)`; the rest lapses.
- Ledger entries: old year gets CARRY_FORWARD_OUT (−carry), ENCASHMENT (−encash) and LAPSE (−rest). New year gets OPENING / CARRY_FORWARD_IN (+carry).
- A negative closing carries forward as a negative opening, and payroll pre-check flags it at exit.
- **Encashment amount** = `days × (monthly Basic + DA) / encashmentDivisor` (default 26; payroll settings), using the salary in force on the last day of the year. It becomes a PayrollAdjustment ENCASHMENT: taxable, not PF-applicable, not ESI-applicable.
- Seed: EL is CAP 30 with encashExcessAtYearEnd = false (lapse) until confirmed. CL and SL are NONE.

**6. Jobs, notifications, audit**
- `leave-year-end` cron at 00:45 on the leave-year start date.
- Each employee gets a summary alert.
- Audit: `leave.year_end.run`, `leave.encashment.created|approved`.

**7. Integrations.** None.

**8. Edge cases**
- The run is idempotent (`periodKey "ye:2026"`).
- An employee who exits in December is skipped; exit F&F handles them.
- Re-running after a correction is allowed only through a reversal batch (admin, audited).

**9. Phase and dependencies.** Carry and lapse in P1. Encashment requests and exit encashment in P2. Depends on P1 salary (for the encashment rate) and P4 adjustments.

**10. Acceptance**
1. EL closing 34 with cap 30: CF_IN 30 and LAPSE 4, and the new-year EL entitlement is 30 + 18 = 48, subject to maxAccumulation.
2. CL closing 5 → LAPSE 5, and the new year has 12.
3. Running year-end twice creates no duplicate entries.
4. (P2) With encashExcessAtYearEnd on, excess 4 and Basic ₹42,000 → ₹6,461.54 adjustment in the next payroll.

---

## PART B: PAYROLL AND PAYSLIPS

### Module P1: Salary structure and payroll profile (Profile "Offer & pay" tab) (P1)

**1. Screens and UX**
- **Profile → "Offer & pay" tab**
  - Visible to self, and to hr/admin (`payroll.salary.view`). Managers and leads do not see it (privacy matrix: salaries are HR/Admin only).
  - Table: Component, Monthly, Annual. Rows come from the active EmployeeSalary lines: Basic, HRA, Special allowance, PF (employer) and CTC. Gross shows as a subtotal.
  - Below the table:
    - "Revision history": Effective from, CTC, Reason, By.
    - "Statutory": UAN, PF on ceiling Yes/No, ESI covered, PT state, tax regime, PAN ••••1234.
    - "Bank": ••••6789, IFSC, verified tag.
  - HR actions:
    - **Revise salary** form: Effective from, Input mode (Annual CTC or Monthly gross), Amount, Template, Reason, with a live component preview.
    - **Edit statutory and bank.**
    - **Hold salary** toggle with a reason.
- **Payroll settings** (addition; opened from the Payroll run screen "Settings" secondary action, `payroll.settings.manage`). Tabs:
  - Components & templates
  - Statutory (PF establishment code, ESI code, TAN, PT registrations, ceiling default, wage-code 50% rule)
  - Pay rules (divisor, idle grace, rounding, approval requirement, payslip publish mode)
  - Bank & file format
  - Ledger mapping
- The Onboarding "Bank & tax" step (account no., IFSC, tax regime) writes into EmployeePayrollProfile through this module's API.

**2. Data model**
```prisma
enum PayType { SALARY STIPEND }
enum ComponentKind { EARNING DEDUCTION EMPLOYER_CONTRIBUTION REIMBURSEMENT INFO }
enum ComponentCalc { FIXED PERCENT_OF_GROSS PERCENT_OF_CTC PERCENT_OF_COMPONENT BALANCING STATUTORY FORMULA /*P2*/ }
enum StatutoryCode { PF_EE PF_ER_EPF PF_ER_EPS EDLI PF_ADMIN ESI_EE ESI_ER PT TDS LWF_EE LWF_ER /*LWF P2*/ }
enum TaxRegime { OLD NEW }
enum SalaryRevisionStatus { DRAFT ACTIVE SUPERSEDED CANCELLED }
enum RevisionReason { JOINING APPRAISAL PROMOTION CORRECTION OTHER }
enum PayDayDivisor { WORKING_DAYS CALENDAR_DAYS FIXED_30 FIXED_26 }

model SalaryComponent { id; tenantId; code String; name String; kind ComponentKind; statutoryCode StatutoryCode?
  taxable Boolean @default(true); pfWage Boolean @default(false); esiWage Boolean @default(true); ptWage Boolean @default(true)
  prorate Boolean @default(true); partOfGross Boolean @default(true); partOfCtc Boolean @default(true)
  showOnPayslip Boolean @default(true); payslipOrder Int; isSystem Boolean @default(false); isActive Boolean @default(true)
  @@unique([tenantId, code]) }
// seeded: BASIC(pfWage), DA(pfWage), HRA, SPECIAL, STIPEND, PF_EE, PF_ER, ESI_EE, ESI_ER, PT, TDS, IDLE_DED, LOP(INFO), ARREARS, ENCASH, ROUNDING

model SalaryTemplate { id; tenantId; name String; payType PayType; employmentTypes EmploymentType[]; isDefault Boolean @default(false)
  lines SalaryTemplateLine[]; @@unique([tenantId, name]) }
model SalaryTemplateLine { id; tenantId; templateId String @db.Uuid; componentId String @db.Uuid
  calc ComponentCalc; value Decimal? @db.Decimal(12,4); baseComponentCode String?; order Int
  @@unique([templateId, componentId]) }
// seed "Standard FT": BASIC 50% of GROSS; HRA 50% of BASIC; SPECIAL BALANCING; PF_ER STATUTORY
// seed "Intern stipend": STIPEND FIXED

model EmployeeSalary { id; tenantId; employeeId String @db.Uuid; effectiveFrom DateTime @db.Date
  ctcAnnual Decimal @db.Decimal(14,2); grossMonthly Decimal @db.Decimal(14,2); payType PayType; templateId String @db.Uuid
  status SalaryRevisionStatus @default(DRAFT); reason RevisionReason; sourceRef String?   // appraisalId / offerId
  arrearsGenerated Boolean @default(false)
  createdById String @db.Uuid; approvedById String? @db.Uuid; approvedAt DateTime?
  lines EmployeeSalaryLine[]
  @@unique([tenantId, employeeId, effectiveFrom]) @@index([tenantId, employeeId, status]) }
model EmployeeSalaryLine { id; tenantId; salaryId String @db.Uuid; componentId String @db.Uuid; componentCode String
  monthly Decimal @db.Decimal(14,2); annual Decimal @db.Decimal(14,2) }

model EmployeePayrollProfile { id; tenantId; employeeId String @db.Uuid; payType PayType @default(SALARY)
  pfEnabled Boolean @default(true); uan String?; pfMemberId String?
  pfCeilingOpted Boolean @default(true)            // PF wage capped at ₹15,000
  esiMode String @default("AUTO")                  // AUTO | FORCE_ON | FORCE_OFF
  esiIpNumber String?; isPersonWithDisability Boolean @default(false)
  ptStateCode String                               // derived from work location state (GJ, MH); override allowed
  taxRegime TaxRegime @default(NEW); taxRegimeLockedFy String?
  panEnc Bytes?; panLast4 String?; panVerified Boolean @default(false); dateOfBirth DateTime? @db.Date
  bankAccountEnc Bytes?; bankAccountLast4 String?; ifsc String?; bankName String?; accountHolderName String?
  bankVerifiedAt DateTime?; bankChangedAt DateTime?; paymentMode String @default("BANK_TRANSFER")  // | CHEQUE | CASH
  payrollHold Boolean @default(false); holdReason String?; idleDeductionExempt Boolean @default(false)
  @@unique([tenantId, employeeId]) }

model TaxDeclaration { id; tenantId; employeeId String @db.Uuid; fy String; regime TaxRegime
  items Json    // {sec80C, sec80D, hraRentMonthly, metroCity, homeLoanInterest, npsEmployee, other}
  prevEmployerGross Decimal @default(0) @db.Decimal(14,2); prevEmployerTds Decimal @default(0) @db.Decimal(14,2)
  status String @default("DRAFT")   // DRAFT | SUBMITTED | LOCKED | VERIFIED (proofs P2)
  @@unique([tenantId, employeeId, fy]) }

model PayrollSettings { tenantId String @id @db.Uuid
  payDayDivisor PayDayDivisor @default(WORKING_DAYS)
  idleDeductionDefault Boolean @default(true); idleGraceMinutesPerMonth Int @default(60); idleReducesStatutoryWages Boolean @default(true)
  netRounding String @default("NEAREST_RUPEE")
  requireApproval Boolean @default(false); publishPayslipsOn String @default("FINALIZE")   // | PAYMENT_DATE
  pfEstablishmentCode String?; pfCeilingDefault Boolean @default(true); applyWageCode50Rule Boolean @default(true)
  esiEmployerCode String?; tan String?; companyPan String?; ptRegistrations Json @default("{}")
  internStatutory Json @default("{\"pf\":false,\"esi\":false,\"pt\":false,\"tds\":false,\"idle\":true}")
  encashmentDivisor Int @default(26)
  bankFileFormat String @default("GENERIC_NEFT_CSV"); debitAccountEnc Bytes?; debitIfsc String?
  payslipTemplateKey String @default("classical"); payslipPasswordProtect Boolean @default(false) /*P2*/ }
```

**3. Workflow (salary revision)**
- DRAFT → ACTIVE: `payroll.salary.manage`. If `requireApproval` is on, an admin approves. The previous ACTIVE revision becomes SUPERSEDED.
- If `effectiveFrom` falls in a finalized period, an ARREAR_REVISION adjustment job is enqueued (P4, P2 phase).
- JOINING revisions are created from the offer letter (the Onboarding domain calls preview, then create).

**4. API**
- Settings, components and templates: `GET|PUT /payroll/settings`, `GET|POST|PATCH /payroll/components[/:id]`, `GET|POST|PATCH /payroll/templates[/:id]` (all payroll.settings.manage)
- Salary:
  - `GET /payroll/employees/:id/salary` (payroll.salary.view, or `payroll.salary.self.view` when id = me)
  - `POST /payroll/salary/preview {ctcAnnual|grossMonthly, templateId, employmentType, ptStateCode, pfCeilingOpted}` (payroll.salary.manage; also used by onboarding for offer Annexure A)
  - `POST /payroll/employees/:id/salary-revisions` (payroll.salary.manage)
  - `POST /payroll/salary-revisions/:id/activate` (payroll.salary.manage, or payroll.run.approve when requireApproval)
  - `POST /payroll/salary-revisions/:id/cancel` (payroll.salary.manage)
- Payroll profile:
  - `GET|PUT /payroll/employees/:id/profile` (payroll.salary.manage)
  - `GET /payroll/me/profile` (self; masked)
  - `PUT /payroll/me/tax-regime {regime}` (self; only while `taxRegimeLockedFy ≠ current FY`)
  - `POST /payroll/me/bank-change` (self; HR verifies, P2 self-service)
  - `POST /payroll/employees/:id/profile/verify-bank` (payroll.salary.manage)
- Tax declarations:
  - `GET|PUT /payroll/me/tax-declarations/:fy` (self)
  - `GET|PUT /payroll/employees/:id/tax-declarations/:fy` (payroll.salary.manage)
- Internal event handler `onboarding.bank_tax.submitted {employeeId, accountNo, ifsc, holder, taxRegime, pan}` upserts the profile and sets `bankVerifiedAt = null`.

**5. Rules**
- **Structure resolution** from gross G (or from CTC, solved iteratively):
  - `BASIC = 50% × G`
  - `HRA = 50% × BASIC`
  - `SPECIAL = G − BASIC − HRA`
  - `PF_ER = 12% × (pfCeilingOpted ? min(BASIC+DA, 15000) : BASIC+DA)`
  - `CTC_month = G + PF_ER (+ ESI_ER if ESI applicable)`
  - CTC to G: solve `G + pfEr(G) + esiEr(G) = CTC/12`. This is a monotonic function, so bisect to the paisa.
- **Check against the wireframe:** CTC ₹10,29,600 → G = ₹84,000, BASIC 42,000, HRA 21,000, SPECIAL 21,000, PF_ER 1,800.
- **Wage-code 50% rule** (Code on Wages, in force since 21 Nov 2025; seed to be verified by a CA): if `(BASIC+DA) < 50% × total remuneration`, the shortfall is added back to PF wages at payroll time and the preview shows a warning.
- **Stipend:** a single STIPEND component. The `internStatutory` flags govern PF, ESI, PT, TDS and idle deduction.
- **PAN/UAN checks:** PAN matches `^[A-Z]{5}[0-9]{4}[A-Z]$`; UAN is 12 digits.
- **IFSC** matches `^[A-Z]{4}0[A-Z0-9]{6}$`, and is validated through the IFSC adapter (Razorpay public IFSC dataset, self-hosted JSON; stub = regex only).
- **Bank change** sets `bankVerifiedAt = null`. Payroll then excludes the employee from the bank file ("Bank unverified") until HR verifies. The employee is emailed on any bank change (fraud control).
- **Tax regime:** NEW by default. Selected at onboarding and changeable until HR locks the FY declaration window (setting). After that only HR can change it (audited).

**6. Jobs, notifications, audit**
- Email to the employee on salary revision activation (no amounts in email body; link only) and on bank change.
- Audit: `salary.revision.created|activated|cancelled`, `payroll.profile.updated`, `payroll.profile.bank_changed` (critical), `payroll.profile.bank_verified`, `payroll.settings.updated`, `payroll.tax_regime.changed`. Audit diffs of amounts are stored encrypted, and are redacted from the super-admin audit view.

**7. Integrations.** `IfscLookupAdapter { lookup(ifsc): Promise<{bank, branch, city} | null> }`. The mock uses a bundled dataset snapshot.

**8. Edge cases**
- A mid-month revision is split in payroll (P3 rule 6).
- Two ACTIVE revisions with the same effectiveFrom are prevented by the unique key.
- Gross must be > 0. BALANCING producing a negative Special is a validation error.
- Stipend with PF enabled triggers a warning.
- Missing ptStateCode falls back to the location's state. If still unknown, a pre-check error is raised.

**9. Phase and dependencies.** P1. Depends on People (employee, location → state), Onboarding (bank and tax step), Files and Crypto (field encryption helper; per-tenant keys in P3), and Appraisals (P2 revisions).

**10. Acceptance**
1. Preview with CTC ₹10,29,600 on the Standard FT template returns Basic 42,000, HRA 21,000, Special 21,000, PF_ER 1,800, CTC month 85,800, matching the Profile tab.
2. The Offer & pay tab for Priya is visible to Priya, Kavya (hr) and Rohit (admin). Neha (manager) gets 403.
3. Invalid IFSC "HDFC123" returns 422. A valid bank change emails Priya and flags "Bank unverified" in the next payroll pre-check.
4. Activating a revision effective 1 Oct supersedes the old one, and October payroll uses the new lines.

---

### Module P2: Statutory engine (PF, ESI, PT, TDS) (P1)

**1. Screens and UX.**
- No dedicated screen. The results appear as payslip lines and in the payroll item drawer's "Calculation trace", for example "PF wage = min(31,500, 15,000) = 15,000 × 12% = 1,800".
- Rate tables are viewable read-only under Payroll settings → Statutory. A tenant override requires `payroll.settings.manage` and is audited.

**2. Data model (GLOBAL; tenantId nullable for overrides)**
```prisma
model StatutoryPfConfig  { id; tenantId String? @db.Uuid; effectiveFrom DateTime @db.Date
  eeRatePct Decimal @default(12); erRatePct Decimal @default(12); epsRatePct Decimal @default(8.33)
  wageCeiling Decimal @default(15000); edliRatePct Decimal @default(0.5); edliCeiling Decimal @default(15000)
  adminRatePct Decimal @default(0.5); adminMinMonthly Decimal @default(500)
  @@unique([tenantId, effectiveFrom]) }
model StatutoryEsiConfig { id; tenantId String? @db.Uuid; effectiveFrom DateTime @db.Date
  eeRatePct Decimal @default(0.75); erRatePct Decimal @default(3.25); wageThreshold Decimal @default(21000)
  pwdWageThreshold Decimal @default(25000); eeExemptDailyAvgWage Decimal @default(176)
  @@unique([tenantId, effectiveFrom]) }
model PtSlab { id; tenantId String? @db.Uuid; stateCode String; gender String?   // null=any
  minMonthly Decimal @db.Decimal(14,2); maxMonthly Decimal? @db.Decimal(14,2); amount Decimal @db.Decimal(10,2)
  februaryAmount Decimal? @db.Decimal(10,2); annualCap Decimal? @db.Decimal(10,2)
  effectiveFrom DateTime @db.Date; effectiveTo DateTime? @db.Date
  @@index([stateCode, effectiveFrom]) }
model TaxRegimeConfig { id; tenantId String? @db.Uuid; fy String; regime TaxRegime; ageBand String @default("BELOW_60") // | 60_80 | ABOVE_80
  standardDeduction Decimal; rebateIncomeLimit Decimal; rebateMax Decimal; marginalReliefOnRebate Boolean
  cessPct Decimal @default(4); slabs Json /* [{from,to|null,ratePct}] */; surcharge Json /* [{above,ratePct}] */; surchargeCapPct Decimal?
  allowedDeductions String[]   // OLD: ["80C","80D","HRA","24B","PT","NPS_EE"]; NEW: ["NPS_ER"]
  @@unique([tenantId, fy, regime, ageBand]) }
model EsiCoverage { id; tenantId; employeeId String @db.Uuid; periodStart DateTime @db.Date   // 1 Apr | 1 Oct
  covered Boolean; decidedOnWage Decimal @db.Decimal(14,2); @@unique([tenantId, employeeId, periodStart]) }
model EmployeeTaxYtd { id; tenantId; employeeId String @db.Uuid; fy String; month Int; runId String @db.Uuid
  taxableIncome Decimal @db.Decimal(14,2); tdsDeducted Decimal @db.Decimal(14,2); pfEe Decimal @db.Decimal(14,2); ptPaid Decimal @db.Decimal(14,2)
  @@unique([tenantId, employeeId, fy, month, runId]) }
```

**Seeds.** These must be CA-verified before go-live; the Income-tax Act 2025 applies from 1 Apr 2026, and the engine is keyed by configuration, not section numbers.

| Table | Seed values |
|---|---|
| PF | 12 / 12 / 8.33 / ceiling 15,000 / EDLI 0.5% (cap 75) / admin 0.5% (min 500 per establishment) |
| ESI | 0.75 / 3.25 / threshold 21,000 (25,000 for persons with disability) |
| PT Gujarat (GJ) | < ₹12,000 → 0; ≥ ₹12,000 → ₹200 per month (annual cap 2,500) |
| PT Maharashtra (MH), male | ≤ 7,500 → 0; 7,501–10,000 → 175; > 10,000 → 200, and 300 in February |
| PT Maharashtra (MH), female | ≤ 25,000 → 0; > 25,000 → 200, and 300 in February |
| TDS FY 2026-27, NEW regime | 0–4L 0%; 4–8L 5%; 8–12L 10%; 12–16L 15%; 16–20L 20%; 20–24L 25%; > 24L 30%. Standard deduction 75,000. Rebate up to taxable 12,00,000 (max 60,000) with marginal relief. Surcharge 10% > 50L, 15% > 1Cr, 25% > 2Cr (cap 25%). Cess 4%. |
| TDS FY 2026-27, OLD regime (below 60) | 0–2.5L 0%; 2.5–5L 5%; 5–10L 20%; > 10L 30%. Standard deduction 50,000. Rebate ≤ 5L (max 12,500). Surcharge adds 37% > 5Cr. |

**3. Workflow.** None. The engine consists of pure functions, versioned by `effectiveFrom` or `fy`.

**4. API**
- `GET /payroll/statutory/{pf|esi|pt|tax}?date|fy` (payroll.settings.manage)
- `POST /payroll/statutory/overrides` (payroll.settings.manage; audited)
- Internal: `StatutoryEngine.compute(itemContext) → {lines[], trace[]}`

**5. Calculations** (all per employee per month; the ₹ rounding rule is given with each line)
- **PF**
  - `pfWage = Σ earned pfWage components (BASIC+DA) + wageCode50Addback − (idleReducesStatutoryWages ? idleDeduction × basicShare : 0)`. Arrears add their pfWage part.
  - `ceilWage = pfCeilingOpted ? min(pfWage, 15000) : pfWage`
  - `PF_EE = round(12% × ceilWage)`
  - `EPS = round(8.33% × min(pfWage,15000))`, maximum 1,250
  - `EPF_ER = round(12% × ceilWage) − EPS`
  - `EDLI = round(0.5% × min(pfWage,15000))`
  - `PF_ADMIN = 0.5% × ceilWage`, with the establishment-level minimum of ₹500 enforced in the run totals
  - Skipped when `pfEnabled = false` or pay type is STIPEND and `internStatutory.pf = false`.
  - PF_ER in CTC excludes EDLI and admin (per the wireframe CTC).
- **ESI**
  - Coverage is decided at the contribution period start (1 Apr / 1 Oct), or on joining, from the fixed gross: `covered = grossMonthly ≤ threshold`. It stays for the whole period even if wages rise.
  - `esiWage = grossEarned + arrears(esi) − idleDeduction`
  - `ESI_EE = ceilToRupee(0.75% × esiWage)`; it is 0 if the daily average wage is ≤ 176
  - `ESI_ER = ceilToRupee(3.25% × esiWage)`
- **PT**
  - Slab lookup on `ptWageEarned` (gross earned) for the profile state, gender and month.
  - The February amount applies if defined.
  - The FY total is capped at `annualCap` using `EmployeeTaxYtd.ptPaid`.
  - Not deducted when gross earned = 0.
- **TDS** (monthly projection method)
  1. `fyMonthsRemaining` = number of months from the current month through March, inclusive.
  2. `projectedTaxableSalary = ytdTaxable (finalized months this FY) + currentMonthRegularTaxable + currentRegularTaxable × (fyMonthsRemaining − 1) + prevEmployerGross`
  3. Exemptions and deductions per regime:
     - NEW: standard deduction only (plus employer NPS if configured). PT is **not** deductible.
     - OLD: standard deduction 50,000; PT (up to 2,500); HRA exemption = min(actual HRA, rent − 10% × Basic, 50% of Basic in metro or 40% in non-metro; Ahmedabad and Pune are non-metro); 80C capped at 1,50,000 including PF_EE; 80D; 24(b) up to 2,00,000.
  4. `tax = slabs(taxable)`. Apply the rebate if `taxable ≤ rebateIncomeLimit`. Under NEW, marginal relief means `tax = min(tax, taxable − 12,00,000)` when just above the limit. Then add surcharge (with marginal relief) and 4% cess.
  5. `regularMonthlyTds = max(0, (annualTax − tdsYtd − prevEmployerTds) / fyMonthsRemaining)`
  6. One-off taxable items (arrears, encashment, bonus): `oneOffTds = tax(with one-offs) − tax(without)`, deducted fully this month.
  7. `TDS = round(regularMonthlyTds + oneOffTds)`
  8. **No valid PAN:** `TDS = max(computed, 20% × currentMonthTaxable)` and the item is flagged.
  9. Stipend: TDS only if `internStatutory.tds`.
- **Deduction cap:** if total non-statutory deductions (idle, recoveries) exceed 50% of wages earned, the excess is deferred as a PayrollAdjustment RECOVERY and the item is flagged.

**6. Jobs, notifications, audit.** No jobs. Audit: `statutory.override.created|updated`.

**7. Integrations.** `StatutoryRuleProvider` (DB-backed; a future adapter could sync from a compliance feed).

**8. Edge cases**
- An employee who joins or exits mid-FY: YTD comes only from this employer, plus declared prevEmployer values.
- Regime changes mid-FY (HR override): recompute annual tax under the new regime and true up over the remaining months.
- Negative monthly TDS after regime-change over-deduction becomes 0, and the excess stays as FY credit.
- ESI for a new joiner decides coverage on joining wage for the rest of the period.
- A PT state change mid-month uses the state as of the last day of the month.

**9. Phase and dependencies.**
- P1: PF, ESI, PT for GJ and MH, TDS for both regimes, basic declarations.
- P2: investment proofs; Form 16, 24Q, PF ECR, ESI and PT return exports; Gujarat LWF (₹6 employee / ₹12 employer in June and December); more states.

**10. Acceptance**
1. Gross 84,000 (Basic 42,000), NEW regime, GJ: PF_EE 1,800; ESI none; PT 200; annual taxable 10,08,000 − 75,000 = 9,33,000 ≤ 12L, so TDS 0; net 82,000. The wireframe's ₹5,580 deductions are illustrative only.
2. Gross 20,000 (Basic 10,000), GJ, Sep: PF_EE 1,200; ESI_EE 150; ESI_ER 650; PT 200; net 18,450.
3. NEW regime at ₹1,50,000/month from April, no other income: annual tax (17,25,000 taxable) = 1,45,000 + 4% cess = 1,50,800, so monthly TDS 12,567.
4. NEW regime with taxable exactly 12,10,000 gives tax 10,000 + 400 cess = 10,400 (marginal relief), not 63,960.
5. MH male with gross 30,000: PT 200 in Sep and 300 in Feb. GJ gross 11,999 → PT 0.
6. ESI: an employee covered in April at gross 20,500 who gets a raise to 23,000 in July is still deducted ESI through September. In October coverage becomes false.

---

### Module P3: Payroll run (GEN `payroll`) (P1)

**1. Screens and UX.** Route `/payroll`, visible to hr and admin.

- **Header:** "Payroll run", subtitle "Payroll uses RM-approved timesheets, leave and idle deductions. Lock attendance before running."
  - Period picker; default is the current month, or the earliest un-finalized month.
  - The primary action changes with state:
    - "Run payroll · Sep 2026" when there is no run (opens form `payroll`)
    - "Re-run" and "Finalize & publish" when CALCULATED
    - "Approve" when PENDING_APPROVAL
    - "Bank file" and "Mark paid" when FINALIZED
  - Secondary action: "Settings" (P1 settings).
- **Pre-run checklist** banner (addition, from `GET /payroll/runs/precheck`):
  - "9 timesheets pending RM" with a **Remind RMs** button
  - "3 leave requests pending in period"
  - "2 employees missing bank details / unverified"
  - "1 employee without salary structure"
  - "New joiners 4 · Exits 1"
  - "5 pending adjustments (₹ 12,400)"
  - "Holiday calendar missing for Pune"
- **KPIs**
  - Employees: count of items in the run, or of eligible employees in preview. Sub "9 interns on stipend" (items with payType STIPEND).
  - Timesheets approved: items whose timesheet gate is APPROVED or NOT_REQUIRED. Sub "9 pending RM" (gate PENDING_PL, PENDING_RM, SENT_BACK or NOT_SUBMITTED).
  - Gross: Σ grossEarned, shown as "₹ 86.4 L". Sub "+1.8% vs Aug" against the previous finalized REGULAR run.
  - Idle deductions: Σ idleDeduction. Sub "from 6 employees" (count > 0).
- **Table**
  - Columns: Employee, Paid days, Leave, Idle, Gross, Deductions, Net, Status.
    - Leave: `leaveSummary` such as "1 EL", "2 CL", "0.5 CL · 1 LWP".
    - Idle: deductible idle, "2h 10m" (raw idle in tooltip).
    - Status: Ready (accent); Timesheet pending (outline); Excluded (neutral); On hold; Error (outline, danger); Stale (outline, "needs re-run"); Finalized; Paid.
  - Filters: status, department, pay type. Search by name or employee ID.
  - **Before a run exists**, the table and KPIs show a non-persisted **preview**: a dry-run calc cached for 10 minutes, recomputed on demand with "Refresh preview".
  - **Row drawer** (addition):
    - inputs: working days, eligible days, present, paid leave, LOP split, holidays, weekly offs, projected days after lock, raw, grace and deductible idle, hourly rate, per-day rate;
    - earnings, deductions and employer lines;
    - calculation trace;
    - errors;
    - actions: Hold / Release (reason), Recalculate this employee, Add adjustment, View payslip draft (PDF).
- **Run form (`payroll`, "Run payroll · September 2026")**
  - **Lock attendance up to:** date. Default is the period end, or settings cutoff day. Range is from period start to period end; it can be later than today only if equal to the period end, in which case the remaining days are projected.
  - **Include idle deduction:** Yes / No. Default from `idleDeductionDefault`, and only applies where the attendance policy "Deduct idle time from payroll" is on for the employee's work-mode group.
  - **Pending timesheets:** "Exclude (N)" or "Wait", where N is the live count.
  - **Payment date:** date, ≥ lock date and ≤ period end + 15 days. Default is the last working day of the period. A weekend or bank holiday gives a warning.
  - Submit "Run & generate payslips". Toast "Payslips generated for N employees", where N = READY count. The payslips are drafts, published on finalize.
- **Per role**
  - hr: create, re-run, hold, adjust, finalize (when `requireApproval = false`), bank file.
  - admin: all of the above plus approve (when `requireApproval`) and reopen.
  - Others: 403. The super-admin has no access.

**2. Data model**
```prisma
enum PayrollRunType { REGULAR SUPPLEMENTARY OFF_CYCLE /*P2*/ }
enum PayrollRunStatus { DRAFT CALCULATING CALCULATED PENDING_APPROVAL APPROVED FINALIZING FINALIZED PAID CANCELLED FAILED }
enum PendingTimesheetMode { EXCLUDE WAIT }
enum PayrollItemStatus { READY TIMESHEET_PENDING EXCLUDED ON_HOLD ERROR STALE FINALIZED PAID PAYMENT_FAILED }
enum TimesheetGate { NOT_REQUIRED APPROVED PENDING_PL PENDING_RM SENT_BACK NOT_SUBMITTED }
enum LineKind { EARNING DEDUCTION EMPLOYER INFO }

model PayrollRun { id; tenantId; runNo String   // PR-2026-09-R, PR-2026-09-S1
  periodYear Int; periodMonth Int; periodStart DateTime @db.Date; periodEnd DateTime @db.Date
  runType PayrollRunType @default(REGULAR); parentRunId String? @db.Uuid; status PayrollRunStatus @default(DRAFT)
  attendanceLockDate DateTime @db.Date; includeIdleDeduction Boolean; pendingTimesheetMode PendingTimesheetMode; paymentDate DateTime @db.Date
  calcVersion Int @default(0)
  employeeCount Int @default(0); internCount Int @default(0); timesheetApprovedCount Int @default(0); timesheetPendingCount Int @default(0)
  grossTotal Decimal @default(0) @db.Decimal(16,2); deductionTotal ...; netTotal ...; employerContribTotal ...
  idleDeductionTotal ...; idleEmployeeCount Int @default(0); errorCount Int @default(0)
  createdById String @db.Uuid; calculatedAt DateTime?; submittedAt DateTime?; approvedById String? @db.Uuid; approvedAt DateTime?
  finalizedById String? @db.Uuid; finalizedAt DateTime?; paidAt DateTime?
  reopenCount Int @default(0); reopenReason String?; cancelReason String?
  items PayrollItem[]
  @@unique([tenantId, runNo]) @@index([tenantId, periodYear, periodMonth]) }
// raw SQL: UNIQUE(tenant_id, period_year, period_month) WHERE run_type='REGULAR' AND status <> 'CANCELLED'

model PayrollPeriodLock { id; tenantId; periodYear Int; periodMonth Int; lockedUpTo DateTime @db.Date
  runId String @db.Uuid; lockedById String @db.Uuid; lockedAt DateTime; releasedAt DateTime?
  @@unique([tenantId, periodYear, periodMonth]) }

model PayrollItem { id; tenantId; runId String @db.Uuid; employeeId String @db.Uuid; calcVersion Int
  status PayrollItemStatus; timesheetGate TimesheetGate; salaryIds String[] @db.Uuid; payType PayType; taxRegime TaxRegime?; ptStateCode String?
  workingDays Decimal @db.Decimal(5,2); eligibleDays ...; presentDays ...; paidLeaveDays ...; unpaidLeaveDays ...; absentDays ...
  policyLopDays ...; lopDays ...; paidDays ...; projectedDays ...; holidays Int; weeklyOffs Int
  leaveSummary Json          // [{code:"EL",days:1}]
  shiftNetMinutes Int; idleMinutesRaw Int; idleGraceMinutes Int; idleMinutesDeductible Int
  hourlyRate Decimal @db.Decimal(12,4); perDayRate Decimal @db.Decimal(12,4)
  grossFixed Decimal @db.Decimal(14,2); grossEarned ...; lopAmount ...; idleDeduction ...; arrearsTotal ...
  totalEarnings ...; totalDeductions ...; employerContrib ...; roundingAdj ...; netPay ...
  pfWage ...; esiWage ...; trace Json; errors Json @default("[]"); holdReason String?; lastCalculatedAt DateTime
  lines PayrollItemLine[]
  @@unique([runId, employeeId]) @@index([tenantId, employeeId]) }
model PayrollItemLine { id; tenantId; itemId String @db.Uuid; componentCode String; label String; kind LineKind
  fullAmount Decimal? @db.Decimal(14,2); amount Decimal @db.Decimal(14,2); arrearForPeriod String?; adjustmentId String? @db.Uuid; order Int }
```

**3. State machine (PayrollRun)**

| From | To | Trigger / permission | Side effects |
|---|---|---|---|
| (none) | DRAFT → CALCULATING | `POST /payroll/runs` (payroll.run.manage) | Create PayrollPeriodLock(lockedUpTo). Emit `payroll.attendance.locked`. Enqueue `payroll-calc` with calcVersion 1. |
| CALCULATING | CALCULATED | Job done | Aggregate KPIs, render draft payslip PDFs (async), socket `payroll.run.status`. |
| CALCULATING | FAILED | Job error | Alert HR. Retry allowed. |
| CALCULATED | CALCULATING | Re-run, all or selected items (payroll.run.manage); also PATCH of options (lock date, idle, mode, payment date) | calcVersion++. Superseded results replaced in a transaction. Lock date may move later but not earlier than any date already edited under the lock. |
| CALCULATED | PENDING_APPROVAL | Submit (payroll.run.manage) when requireApproval | Notify approvers. |
| PENDING_APPROVAL | APPROVED or CALCULATED | Approve / return (payroll.run.approve) | Notify. |
| CALCULATED (no approval) or APPROVED | FINALIZING → FINALIZED | Finalize (payroll.run.finalize) | Blocked if any ERROR, STALE, or (in WAIT mode) TIMESHEET_PENDING item remains. Items READY → FINALIZED. EXCLUDED items get a SUPPLEMENTARY run in DRAFT. Payslips published (or scheduled for payment date). Ledger ACCRUAL voucher posted (P7). EmployeeTaxYtd written. Pending adjustments → APPLIED. Leave encashments → PAID. |
| FINALIZED | PAID | Mark paid (payroll.run.manage), or bank reconciliation completing | Ledger PAYMENT voucher. |
| FINALIZED (no bank file SUBMITTED) | CALCULATED | Reopen (payroll.run.reopen, admin; reason required) | Payslips VOID and unpublished, employees notified "payslip withdrawn". Ledger REVERSAL voucher. Bank file VOID. reopenCount++. |
| DRAFT or CALCULATED | CANCELLED | Cancel (payroll.run.manage) | Release PayrollPeriodLock. |

- After PAID there is no reopen. Corrections go through P4 adjustments in the next run.

**Item status**
- The timesheet gate decides the starting status:
  - required and not APPROVED → TIMESHEET_PENDING, which becomes EXCLUDED at finalize in EXCLUDE mode;
  - `payrollHold` → ON_HOLD;
  - validation failure → ERROR;
  - otherwise READY.
- An input change after calculation marks the item STALE. Inputs are: leave approved or cancelled, attendance corrected under override, timesheet approved, salary activated, adjustment added.
- **WAIT mode:** on `timesheet.rm_approved` for a TIMESHEET_PENDING item, that item is auto-recalculated (to READY). Socket `payroll.run.progress` is sent.
- **Switching modes:** `POST /payroll/runs/:id/exclude-pending` switches WAIT to EXCLUDE.

**4. API**
- Read (payroll.run.view):
  - `GET /payroll/runs/precheck?period=2026-09`
  - `GET /payroll/runs/preview?period=2026-09&status&q&page`
  - `GET /payroll/runs?year=`
  - `GET /payroll/runs/:id`
  - `GET /payroll/runs/:id/items?status&dept&payType&q&page`
  - `GET /payroll/runs/:id/items/:itemId`
- Manage (payroll.run.manage):
  - `POST /payroll/runs {periodYear, periodMonth, attendanceLockDate, includeIdleDeduction, pendingTimesheetMode, paymentDate}`
  - `PATCH /payroll/runs/:id {…options}` (CALCULATED only; triggers recalc)
  - `POST /payroll/runs/:id/recalculate {itemIds?}`
  - `POST /payroll/runs/:id/items/:itemId/hold {reason}`
  - `POST /payroll/runs/:id/items/:itemId/release`
  - `POST /payroll/runs/:id/exclude-pending`
  - `POST /payroll/runs/:id/remind-rms` (notifies RMs with pending timesheets)
  - `POST /payroll/runs/:id/submit`
  - `POST /payroll/runs/:id/cancel {reason}`
  - `POST /payroll/runs/:id/mark-paid {paidOn}`
- Approve and finalize:
  - `POST /payroll/runs/:id/approve` and `/return {comment}` (payroll.run.approve)
  - `POST /payroll/runs/:id/finalize` (payroll.run.finalize)
- `POST /payroll/runs/:id/reopen {reason}` (payroll.run.reopen)
- Internal: `PayrollLockService.isLocked(tenantId, employeeId, date) → {locked, runId, runStatus}`. Attendance, Timesheet and Leave call it before mutating dated data.
- **Realtime**, rooms `tenant:{id}:payroll`:
  - `payroll.run.progress {runId, phase: CALC|PDF|FINALIZE, done, total}`
  - `payroll.run.status {runId, status}`
  - `payroll.item.updated {runId, itemId, status}`

**5. Calculation algorithm** (per item, deterministic, and replayable from stored inputs)
1. **Eligibility:**
   - `joinDate ≤ attendanceLockDate`;
   - last working day (or null) ≥ periodStart;
   - status ACTIVE, NOTICE, or EXITED within the period;
   - has an ACTIVE salary covering some day in the period;
   - SUPPLEMENTARY runs include only the employees set on the run.

   A missing structure gives an ERROR item "No salary structure".
2. **Calendar:**
   - `WD = working days in the full month` (WorkCalendarService), used as the divisor when `payDayDivisor = WORKING_DAYS`;
   - with CALENDAR_DAYS the divisor is days in the month; FIXED_30 and FIXED_26 are constants.
   - `eligibleDays` = working days within [max(join, periodStart), min(LWD, periodEnd)].
3. **Day classification** for each eligible working day d ≤ lockDate, using Attendance `daySummary(d)` and Leave `approvedLeave(d)`:
   - paid leave portion → paid, counted in paidLeaveDays;
   - unpaid leave portion (LWP or `isPaid = false`) → LOP, counted in unpaidLeaveDays;
   - PRESENT → paid;
   - HALF_DAY with no leave for the other half → 0.5 LOP;
   - ABSENT with no leave → 1 LOP (absentDays);
   - an absent day with a PENDING leave → LOP, flagged "pending leave". If the leave is later approved, the item becomes STALE, or after finalize a LOP_REVERSAL is created;
   - `policyLopDays` (late-mark rules) is taken from Attendance as given.

   Days after lockDate up to the period end are **projected paid** (`projectedDays`) and reconciled in the next run (P4 LOP_RECOVERY).
4. `lopDays = unpaidLeaveDays + absentDays + halfDayLop + policyLopDays`, and `paidDays = eligibleDays − lopDays`. With a non-working-days divisor, eligible and paid days are calendar-based, and LOP days are still counted on working dates.
5. **Proration:** for each prorate component c, `earned_c = monthly_c × paidDaysUnderStructure / divisor`.
   - A mid-month revision splits the eligible days by structure effective dates, and each part is prorated under its own structure.
   - `grossEarned = Σ earned_c`.
   - `lopAmount` (INFO) = `grossFixed × (eligibleDays − paidDays) / divisor`, plus the non-join proration, shown on the payslip as "Loss of pay (x days)".
   - Examples: G 66,000, WD 22, 1 LOP → 63,000. Intern stipend 15,000 with 1 LOP of 22 → 14,318.18.
6. **Idle deduction:**
   - Applies only if all of these hold: `run.includeIdleDeduction`, the attendance policy flag for the employee's work-mode group, `!profile.idleDeductionExempt`, and (for stipends) `internStatutory.idle`.
   - `idleMinutesRaw` = Σ over d in [periodStart, lockDate] of approved idle minutes. These come from the Timesheet domain after PL/RM review: tracker idle marked "idle" is deductible; idle marked "I was working" and accepted by the PL is not; breaks are not.
   - `deductible = max(0, raw − idleGraceMinutesPerMonth)`
   - `hourlyRate = grossFixed / (WD × shiftNetMinutes/60)`, where `shiftNetMinutes` = shift duration − break (General shift: 540 − 60 = 480).
   - `idleDeduction = round2(deductible/60 × hourlyRate)`, capped at `grossEarned`.
   - Example: G 88,000, WD 22, 8 h shift → ₹500/h; 4h raw − 60 min grace = 3 h → ₹1,500.
   - Idle minutes on days that are also LOP days are dropped (no double penalty).
7. **Adjustments:** PENDING PayrollAdjustments with `targetPeriod ≤ this period` become lines (ARREARS, LOP reversal or recovery, ENCASH, RECOVERY, MANUAL), with their tax, PF and ESI flags.
8. **Statutory** (P2 engine): PF, ESI, PT, TDS in that order.
9. **Totals:**
   - `totalEarnings = grossEarned + positive adjustments`
   - `totalDeductions = PF_EE + ESI_EE + PT + TDS + idleDeduction + recoveries`
   - `net = totalEarnings − totalDeductions`
   - Rounded to the nearest rupee, with the difference as a `ROUNDING` line.
   - `net < 0` → ERROR "Negative net". HR must defer recoveries, which become a RECOVERY adjustment for next period.
   - `employerContrib = EPF_ER + EPS + EDLI + ADMIN + ESI_ER`.
10. **Timesheet gate:**
    - `required = attendancePolicy.timesheetRequired(employee)` (default true for FULL_TIME; interns use intern task sheets and are NOT_REQUIRED unless configured).
    - The gate is APPROVED only if every weekly timesheet overlapping [periodStart, lockDate] is RM-approved.
11. **Persistence:** item, lines and trace are stored with the calcVersion. Run KPIs are recomputed from items.
12. **Idempotency:**
    - Jobs are keyed `runId:calcVersion:employeeId`, and results with an older calcVersion are discarded.
    - Calculation is chunked in groups of 50 employees; concurrency is 4 per tenant.

**Payroll lock semantics**
- While a PayrollPeriodLock exists, Attendance, Timesheet and Leave must refuse mutations for dates ≤ lockedUpTo, unless the caller holds `payroll.lock.override` (HR).
- Refusals return HTTP 409 with code `PAYROLL_LOCKED`.
- Override mutations emit an event:
  - if the run is CALCULATED, the item becomes STALE;
  - if the run is FINALIZED or PAID, a P4 adjustment is auto-created.
- Leave approval decisions on already-pending requests are allowed; they are decisions, not edits, and are handled the same way.

**6. Jobs, notifications, audit**
- Queues: `payroll-calc`, `payroll-pdf`, `payroll-finalize`, `payroll-wait-listener` (subscribes to `timesheet.rm_approved`), `payroll-preview-refresh` (nightly 02:00 for the open period).
- `payroll-cutoff-reminder` cron at 10:00, 3 days before the period end: notify RMs with pending timesheets, approvers with pending leave, and HR with the pre-check summary.
- Notifications:
  - run calculated → HR, and admin when approval is needed
  - submitted for approval → admin
  - returned → HR
  - finalized → HR, admin and Finance
  - reopen → all affected employees ("Your September payslip was withdrawn for correction")
  - WAIT mode item resolved → HR (digest)
- Audit: `payroll.run.created|locked|calculated|recalculated|options_changed|submitted|approved|returned|finalized|reopened|cancelled|paid`, `payroll.item.hold|release`, `payroll.lock.override_used` (with the date and the actor).

**7. Integrations.** Internal ports only:
- `AttendanceInputPort.getDaySummaries(employeeIds, from, to) → [{employeeId, date, status, workedMinutes, lateMark}]` plus `getPolicyLop(employeeIds, period)`, and `AttendancePolicyPort.flags(employeeId) → {deductIdleFromPayroll, timesheetRequired}`
- `TimesheetInputPort.getApprovalGate(employeeIds, from, to)` and `getDeductibleIdleMinutes(employeeIds, from, to) → per day`
- `ShiftPort.netMinutes(employeeId, date)`
- `LeaveQueryService.getApprovedDays(employeeIds, from, to)`

**8. Validation and edge cases**
- Only one active REGULAR run per period (DB partial unique; 409 on violation).
- Runs are created in period order: the previous period must be FINALIZED or PAID, unless it is the first tenant period (migration opening).
- A lock date before the latest already-overridden date is rejected.
- WD = 0 (degenerate month) → ERROR item.
- A joiner after lockDate is skipped, and next month creates a JOINING_ARREAR adjustment for the days worked.
- An exit mid-month is prorated. If F&F is pending the item is ON_HOLD (P2 F&F).
- Missing or unverified bank details: the item finalizes but is excluded from the bank file, flagged "Pay manually".
- Multi-state PT: the state as of the period end.
- Large tenants: 10,000 employees must calculate in under 5 minutes (this is a performance test).

**9. Phase and dependencies.**
- P1: REGULAR and SUPPLEMENTARY runs. P2: OFF_CYCLE (bonus, F&F).
- Depends on: Attendance (day summary, policy, lock enforcement), Timesheet (two-level approval gate and idle), Shifts, Leave, P1 and P2 of this domain, Finance Ledger (P7), Files/PDF, Notifications.

**10. Acceptance**
1. Seed 10 employees (1 intern), one with a timesheet pending RM. Precheck shows "1 pending RM". Run with Exclude and lock on 30 Sep: 9 READY and 1 TIMESHEET_PENDING; KPIs Employees 10, "1 intern on stipend", Timesheets 9 / 1 pending. Finalize: 9 payslips published, the pending item becomes EXCLUDED, and SUPPLEMENTARY run PR-2026-09-S1 is created in DRAFT containing that employee. The RM approves the timesheet; HR calculates and finalizes S1; the 10th payslip is published.
2. With WAIT mode, finalize returns 409 while 1 item is pending. Approving the timesheet via API auto-recalculates the item to READY within the job SLA (socket event observed), and finalize then succeeds.
3. Employee G 88,000, WD 22, 8 h shift, approved idle 4h00m, grace 60: idle deduction ₹1,500, and the KPI "Idle deductions ₹1,500 from 1 employee". Re-run with Include idle = No: the deduction is 0, calcVersion is 2, and the audit shows the recalculation.
4. After lock (30 Sep), an employee's attendance regularization for 15 Sep returns 409 PAYROLL_LOCKED. HR with the override succeeds, the item becomes STALE, and finalize is blocked until a re-run.
5. Run CALCULATED; the RM approves a pending CL for 10 Sep that was previously counted as absent LOP; the item becomes STALE; re-run → paid days +1 and net increases by 88,000/22 = 4,000.
6. Reopen after finalize by admin with a reason: payslips VOID, a reversal voucher is posted, and employees are notified. HR attempting reopen gets 403. Reopen after PAID gets 409.

---

### Module P4: Adjustments and arrears (P1 LOP/idle/manual; P2 salary-revision arrears)

**1. Screens and UX**
- In the Payroll run item drawer: **Add adjustment** form with Type, Amount or Days, Component, For period, Reason, and Taxable / PF flags defaulting from the type.
- Payroll run → secondary tab "Adjustments" (addition). Columns: Employee, Type, For period, Amount/Days, Source, Status (Pending / Applied / Cancelled), Created by.

**2. Data model**
```prisma
enum AdjustmentType { LOP_REVERSAL LOP_RECOVERY IDLE_REVERSAL IDLE_RECOVERY ARREAR_REVISION JOINING_ARREAR ENCASHMENT BONUS RECOVERY REIMBURSEMENT MANUAL_EARNING MANUAL_DEDUCTION }
enum AdjustmentStatus { PENDING APPLIED CANCELLED }
model PayrollAdjustment { id; tenantId; employeeId String @db.Uuid; type AdjustmentType
  days Decimal? @db.Decimal(6,2); amount Decimal? @db.Decimal(14,2)   // one of; days converted at source-period per-day rate
  componentCode String?; forPeriod String   // "2026-09" (period the correction relates to)
  targetPeriod String?                      // null = next open run
  taxable Boolean; pfApplicable Boolean; esiApplicable Boolean
  sourceType String /* LEAVE_REQUEST | ATTENDANCE | TIMESHEET | SALARY_REVISION | ENCASHMENT | MANUAL */; sourceId String?
  reason String; status AdjustmentStatus @default(PENDING); appliedRunId String? @db.Uuid; appliedItemId String? @db.Uuid
  createdById String? @db.Uuid
  @@unique([tenantId, sourceType, sourceId, type, forPeriod]) @@index([tenantId, employeeId, status]) }
```

**3. Workflow**
- Adjustments are created automatically by events, or manually by HR.
- PENDING → APPLIED when a run that includes it is finalized; PENDING → CANCELLED by HR.
- While a run is CALCULATED, a PENDING adjustment shows on the item as a line. On reopen, APPLIED adjustments revert to PENDING.

**4. API**
- `GET /payroll/adjustments?status&employeeId&period` (payroll.adjustment.manage)
- `POST /payroll/adjustments` (payroll.adjustment.manage)
- `PATCH /payroll/adjustments/:id` and `DELETE /payroll/adjustments/:id` (PENDING only; payroll.adjustment.manage)

**5. Rules**
- **LOP_REVERSAL / LOP_RECOVERY:** `amount = ±days × grossFixed(forPeriod) / divisor(forPeriod)`.
  - Component split uses the forPeriod structure.
  - PF and ESI are recomputed on the forPeriod wage basis. The delta applies only if the forPeriod PF wage was below the ceiling.
  - Triggered by: leave approved or cancelled for a finalized period; attendance override; post-lock reconciliation of projected days (absent after lock).
- **IDLE_REVERSAL / IDLE_RECOVERY:** triggered when a timesheet idle decision changes after finalize. `amount = Δminutes/60 × hourlyRate(forPeriod)`, and the grace is re-evaluated for that month.
- **ARREAR_REVISION** (P2), on activation of a revision with effectiveFrom in a finalized period:
  - For each finalized month m from effectiveFrom up to the last finalized month, recompute the item with the new structure and the stored inputs (paid days, idle, LOP).
  - `delta_c = new_c − old_c` for each component.
  - Create one adjustment per month (`arrearForPeriod` on the line). PF on the Basic delta follows the ceiling rules; ESI applies if covered in that period; TDS uses the one-off method.
- **JOINING_ARREAR:** for days worked between join and lockDate by an employee who joined after that month's lock.
- **Uniqueness:** the unique key ensures events that replay do not create duplicate adjustments.

**6. Jobs, notifications, audit**
- `payroll-arrears` job, triggered by `salary.revision.activated`.
- Notify HR of each auto-created adjustment in a daily digest.
- Audit: `payroll.adjustment.created|updated|cancelled|applied`.

**7. Integrations.** None.

**8. Edge cases**
- A forPeriod before the tenant's first payroll is rejected.
- An adjustment for an exited employee goes to F&F (P2) or an off-cycle run.
- A negative adjustment larger than net is split and deferred (50% deduction cap).

**9. Phase and dependencies.** P1 except ARREAR_REVISION (P2, needs Appraisals). Depends on L3, Attendance and Timesheet events.

**10. Acceptance**
1. September finalized with 1 absent LOP (G 66,000, WD 22). An HR-on-behalf EL approval for that date creates LOP_REVERSAL ₹3,000 for "2026-09". The October item shows "LOP reversal (Sep) ₹3,000" with PF delta 0, since the September PF wage was already capped at 15,000.
2. Replaying the same `leave.request.approved` event creates no duplicate.
3. September lock on 25 Sep with 26–30 projected; attendance later shows 29 Sep absent: LOP_RECOVERY 1 day in October.
4. (P2) A revision from 84,000 to 96,000 effective 1 Aug, activated in October, gives 2 months of arrears of 12,000 each (Basic delta 6,000; PF unchanged because capped). October TDS includes the one-off tax on ₹24,000.

---

### Module P5: Payslips (GEN `payslips`, PDF) (P1)

**1. Screens and UX**
- **My payslips (`/payslips`, all roles)**
  - Subtitle "Calculated from approved attendance, auto-idle time and leave."
  - Columns: Month ("Aug 2026"), Working days, Paid days (e.g. 22.5), Idle deduction (₹ 0 / ₹ 1,120), Net pay, Payslip ("Download" tag-button).
  - Only PUBLISHED payslips appear. FY filter, newest first.
  - Clicking a row opens an HTML detail view of the same content as the PDF, with a **Download PDF** button and a **Raise a query** button. The latter opens the Helpdesk "Raise ticket" form prefilled with category Payroll, subject "Payslip <Month>", and a payslip link.
  - A "YTD" strip shows gross, TDS and PF this FY.
- **HR/admin:** payslips are accessible from the payroll item drawer and from the Employee profile (tab "Payslips", addition) with `payslip.all.view`. Every view or download is access-logged.
- **PDF content** (template "classical" using tenant branding: logo, accent colour, Cormorant/Lora fonts):
  - Company name, address, PAN/TAN.
  - Employee name, employee ID, designation, department, date of joining, PAN (masked), UAN, bank ••••last4, IFSC.
  - Month, pay date, tax regime.
  - Working days, paid days, LOP days, leave taken by type, idle time deductible (h:m) and rate.
  - Earnings table: component, monthly (full), earned, arrears.
  - Deductions table: PF, ESI, PT, TDS, idle deduction, recoveries.
  - Employer contributions (informational).
  - Net pay in figures and in words (Indian system: "Eighty-two thousand rupees only").
  - YTD totals and the leave balance snapshot.
  - Footer "Computer-generated; no signature required" and a document hash plus a verification QR (`/verify/payslip/:hash`, showing only validity, no amounts).

**2. Data model**
```prisma
enum PayslipStatus { DRAFT PUBLISHED VOID }
model Payslip { id; tenantId; itemId String @unique @db.Uuid; runId String @db.Uuid; employeeId String @db.Uuid
  periodYear Int; periodMonth Int; status PayslipStatus @default(DRAFT); version Int @default(1)
  fileKey String?; fileSha256 String?; workingDays Decimal @db.Decimal(5,2); paidDays Decimal @db.Decimal(5,2)
  idleDeduction Decimal @db.Decimal(14,2); netPay Decimal @db.Decimal(14,2)
  generatedAt DateTime?; publishedAt DateTime?; emailedAt DateTime?; firstViewedAt DateTime?; voidedAt DateTime?
  @@index([tenantId, employeeId, periodYear, periodMonth]) }
// partial unique: one PUBLISHED payslip per (tenant, employee, period, runType REGULAR)
```

**3. Workflow**
- DRAFT: rendered after calculation, visible to HR only.
- DRAFT → PUBLISHED: on finalize, or at 09:00 on the payment date if `publishPayslipsOn = PAYMENT_DATE`.
- PUBLISHED → VOID: on reopen. The next publish is version+1.
- SUPPLEMENTARY payslips are separate rows for the same month, labelled "Supplementary".

**4. API**
- `GET /payslips/me?fy=` (payslip.self.view)
- `GET /payslips/:id` (owner, or payslip.all.view) returns JSON
- `GET /payslips/:id/pdf` (owner, or payslip.all.view) returns 302 to a pre-signed S3 URL with a 5-minute TTL and `Content-Disposition: attachment; filename=Payslip_LX-0142_2026-09.pdf`
- `GET /payroll/employees/:id/payslips` (payslip.all.view)
- `POST /payslips/:id/resend-email` (payroll.run.manage)
- `GET /verify/payslip/:hash` (public; returns valid/invalid, employer name and month only)
- Realtime: `payslip.published` to `user:{id}`

**5. Rules**
- Owners see only PUBLISHED payslips; DRAFT is visible with `payslip.all.view`.
- Managers and leads never see others' payslips.
- PDF storage key: `tenants/{tenantId}/payroll/{yyyy-mm}/{employeeId}/{payslipId}-v{n}.pdf`, with S3 server-side encryption. In P3 the envelope uses the tenant DEK.
- The PDF is regenerated only when the item's calcVersion changes.
- Amount formatting: `₹ 78,420`. The list shows Idle deduction as "₹ 0" when zero.

**6. Jobs, notifications, audit**
- `payroll-pdf` queue renders drafts, with concurrency 8.
- On publish: in-app alert and email "Your payslip for September 2026 is ready". The email contains no attachment and no amounts (privacy); P2 option: attach a password-protected PDF with password = PAN first 5 + DOB DDMM.
- Audit: `payslip.published|voided|viewed_by_other|downloaded_by_other|emailed`. Self-views are counted but not audited.

**7. Integrations**
- `PdfRenderer { render(html: string, opts: {format:'A4', margin}): Promise<Buffer> }`. The real implementation is self-hosted Gotenberg (Chromium) in Docker Compose; the mock returns a fixed PDF.
- `ObjectStorage` (MinIO).
- `WhatsAppNotifier` stub: P3 opt-in "payslip ready" template.

**8. Edge cases**
- Request for a VOID payslip returns 410.
- A deleted file triggers regeneration on demand.
- A tenant branding change does not alter already-published PDFs; they are immutable, and the hash is stored.
- An employee who has exited keeps self-service access to payslips for 8 years, or can get them by email request (P2 alumni access).

**9. Phase and dependencies.**
- P1: basic payslips.
- P2: password protection, Form 16 on the same screen.
- P3: per-tenant custom templates (matching the "Custom payslip template" support request).
- Depends on P3, White-label/branding, Files and Helpdesk.

**10. Acceptance**
1. After September finalize, Priya's `/payslips` shows "Sep 2026 · 22 · 22 · ₹ 0 · ₹ 82,000 · Download". The download returns a PDF whose text contains "Net pay ₹ 82,000" and "Eighty-two thousand".
2. Neha calling `GET /payslips/{Priya's}` gets 403. Kavya (hr) gets 200 and an audit row `payslip.viewed_by_other`. A super-admin token gets 403.
3. The signed URL is rejected after 5 minutes.
4. After reopen, Priya's list hides September (VOID) and she receives a notification. After re-finalize, v2 appears.
5. July with a 0.5 LOP and idle: the list shows "Jul 2026 · 23 · 22.5 · ₹ <idle> · ₹ <net>", consistent with the item.

---

### Module P6: Bank transfer file and payment reconciliation (P1 generic; P2 bank formats; P3 payouts)

**1. Screens and UX**
- Payroll run page, when FINALIZED: **Generate bank file** with a format select (Generic NEFT CSV; HDFC / ICICI / SBI in P2) and a preview of counts and total.
  - Excluded items are listed: no bank details, unverified bank, paymentMode ≠ BANK_TRANSFER, net 0.
- **Download** (audited).
- **Upload bank response** (CSV with UTR per row) to reconcile.
- **Mark paid**: manual, for the whole run or per item.
- Item status becomes Paid or Payment failed, the latter with a reason and a "Retry in next file" action.

**2. Data model**
```prisma
model BankTransferFile { id; tenantId; runId String @db.Uuid; format String; fileKey String; fileName String
  entryCount Int; totalAmount Decimal @db.Decimal(16,2); sha256 String
  status String /* GENERATED | DOWNLOADED | SUBMITTED | PARTIALLY_RECONCILED | RECONCILED | VOID */
  generatedById String @db.Uuid; generatedAt DateTime; downloadedById String? @db.Uuid; downloadedAt DateTime?; supersededById String? @db.Uuid }
model BankTransferEntry { id; tenantId; fileId String @db.Uuid; itemId String @db.Uuid; employeeId String @db.Uuid
  amount Decimal @db.Decimal(14,2); beneficiaryName String; accountLast4 String; ifsc String; mode String /* NEFT|RTGS|IMPS|IFT */
  narration String; status String /* PENDING|PAID|FAILED|RETURNED */; utr String?; failureReason String?; reconciledAt DateTime?
  @@unique([fileId, itemId]) }
```

**3. Workflow**
- File: GENERATED → DOWNLOADED → SUBMITTED (HR confirms upload to the bank) → PARTIALLY_RECONCILED or RECONCILED.
- Regenerating supersedes the previous file, which becomes VOID, but only before SUBMITTED.
- When all entries are PAID, the run moves to PAID (P3 state machine).
- A FAILED entry puts the item in PAYMENT_FAILED. It can go in a new file for the failed entries only.

**4. API** (all `payroll.bankfile.download` unless noted)
- `POST /payroll/runs/:id/bank-files {format}`
- `GET /payroll/bank-files/:id/download` (streams the decrypted file)
- `POST /payroll/bank-files/:id/submitted`
- `POST /payroll/bank-files/:id/reconcile` (multipart CSV)
- `POST /payroll/runs/:id/items/:itemId/mark-paid {utr?, paidOn}` (payroll.run.manage)

**5. Rules**
- Entries: FINALIZED items with netPay > 0, paymentMode BANK_TRANSFER, bankVerifiedAt not null, and not already PAID.
- Mode: IFT if the IFSC bank equals the debit bank; RTGS if amount ≥ ₹2,00,000 and the format supports it; otherwise NEFT.
- Narration `SAL <MON><YYYY> <EMPCODE>`, truncated to 30 characters, alphanumerics only.
- Control totals: `Σ amount = file total`; row count; SHA-256 stored.
- File encrypted at rest. Account numbers appear in the file only; the database stores last-4 digits and the encrypted full number.

**6. Jobs, notifications, audit**
- Notify HR and admin on file generation.
- Notify employees on PAID ("Salary credited", optional) and HR on FAILED.
- Audit: `bankfile.generated|downloaded|submitted|voided|reconciled`, `payroll.item.paid|payment_failed`.

**7. Integrations**
```ts
interface BankFileAdapter { format: string; label: string;
  generate(batch: { debitAccount: string; debitIfsc: string; valueDate: string; entries: BankEntry[] }): { fileName: string; mime: string; content: Buffer };
  parseResponse?(file: Buffer): Array<{ reference: string; status: 'PAID'|'FAILED'|'RETURNED'; utr?: string; reason?: string }>; }
```
- `GenericNeftCsv` is real. Columns: Beneficiary Name, Account Number, IFSC, Amount, Mode, Narration, Reference (item id short). Its response parser accepts Reference, UTR, Status, Reason.
- `HdfcEnet`, `IciciCib`, `SbiCmp` are stubs (P2) until the bank specifications are obtained.
- `PayoutAdapter` (RazorpayX, P3): `{ createBatch(entries): Promise<{payoutId, entryRef, status}[]>; handleWebhook(payload, signature) }`. The stub marks entries "processing" and then PAID after 5 s in dev.

**8. Edge cases**
- Duplicate generation while one is SUBMITTED returns 409.
- A reconciliation CSV with unknown references is reported but ignored.
- A partial reconciliation leaves the run FINALIZED.
- An IFSC that fails the regex excludes the entry with the reason.

**9. Phase and dependencies.** P1 generic CSV and manual reconciliation. P2 bank-specific formats. P3 RazorpayX payouts. Depends on P1 (bank details) and P3.

**10. Acceptance**
1. A run of 9 finalized items with 1 unverified bank: the file has 8 rows, its total equals Σ net of those 8, and the preview lists the 1 excluded item as "Bank unverified".
2. Download writes an audit record. A manager calling download gets 403.
3. Uploading a response with 7 PAID and 1 FAILED gives file PARTIALLY_RECONCILED and run FINALIZED. A new file for the failed entry gets that entry PAID, the run becomes PAID, and the payment voucher is posted.
4. Regenerating after SUBMITTED returns 409.

---

### Module P7: Ledger posting contract with Finance (P1 contract; posting active once the Ledger module is live)

**1. Screens and UX**
- Payroll settings → **Ledger mapping** tab: payroll account key → ledger account select (from the Finance chart of accounts).
- The Payroll run header shows "Voucher PAY-2026-09 posted" linking to Ledger.
- The Finance Ledger "Expenses" and "Day book" tabs show the payroll voucher. The KPI "Expenses (Sep) incl. payroll" includes it (Finance domain).

**2. Data model**
```prisma
enum PayrollAccountKey { SALARY_EXPENSE STIPEND_EXPENSE EMPLOYER_PF_EXPENSE EMPLOYER_ESI_EXPENSE IDLE_DEDUCTION_CONTRA
  SALARY_PAYABLE PF_PAYABLE ESI_PAYABLE PT_PAYABLE TDS_SALARY_PAYABLE OTHER_RECOVERIES BANK_SALARY_ACCOUNT }
model PayrollAccountMapping { id; tenantId; key PayrollAccountKey; ledgerAccountId String @db.Uuid; @@unique([tenantId, key]) }
model PayrollLedgerPosting { id; tenantId; runId String @db.Uuid; kind String /* ACCRUAL | PAYMENT | REVERSAL */
  idempotencyKey String @unique; payload Json; voucherId String? @db.Uuid; voucherNo String?
  status String /* PENDING | POSTED | FAILED | SKIPPED_NO_LEDGER */; attempts Int @default(0); lastError String? }
```

**3. Workflow**
- On FINALIZED, the transactional outbox records a PayrollLedgerPosting (ACCRUAL, PENDING) and the `payroll-ledger` worker posts it.
- On PAID, or partially per reconciliation batch: PAYMENT.
- On reopen: REVERSAL of the accrual, plus any unmatched payments.
- If the Ledger module is disabled for the plan (Free tier), the posting is SKIPPED_NO_LEDGER and is replayable later.

**4. API**
- Consumed from Finance: `LedgerPostingPort.postVoucher(input, idempotencyKey) → {voucherId, voucherNo}` and `reverseVoucher(voucherId, reason, idempotencyKey)`.
- Exposed:
  - `GET /payroll/runs/:id/postings` (payroll.run.view)
  - `POST /payroll/postings/:id/retry` (payroll.run.manage)
  - Event `payroll.run.finalized {runId, period, totals, postingId}` for Finance dashboards.

**5. Posting rules**

ACCRUAL journal: date = period end, type JOURNAL, source = PAYROLL / runId, narration "Salary for September 2026 (PR-2026-09-R)". Lines carry a cost-centre dimension of departmentId, aggregated per department.

| Side | Account key | Amount |
|---|---|---|
| Dr | SALARY_EXPENSE | Σ totalEarnings for SALARY items (gross earned + positive adjustments) |
| Dr | STIPEND_EXPENSE | Σ totalEarnings for STIPEND items |
| Dr | EMPLOYER_PF_EXPENSE | Σ (EPF_ER + EPS + EDLI + PF_ADMIN) |
| Dr | EMPLOYER_ESI_EXPENSE | Σ ESI_ER |
| Cr | IDLE_DEDUCTION_CONTRA | Σ idleDeduction (can be mapped to SALARY_EXPENSE so it nets off) |
| Cr | PF_PAYABLE | Σ (PF_EE + all employer PF) |
| Cr | ESI_PAYABLE | Σ (ESI_EE + ESI_ER) |
| Cr | PT_PAYABLE | Σ PT |
| Cr | TDS_SALARY_PAYABLE | Σ TDS |
| Cr | OTHER_RECOVERIES | Σ recoveries |
| Cr | SALARY_PAYABLE | Σ netPay (after rounding) |

- **Invariant:** Σ Dr = Σ Cr to the paisa. Rounding lines are absorbed into SALARY_EXPENSE.
- **PAYMENT:** Dr SALARY_PAYABLE, Cr BANK_SALARY_ACCOUNT, for Σ paid entries. One voucher per reconciliation batch; the narration carries the UTR count.
- **REVERSAL:** the mirror of the original voucher, through Finance's reverse API.
- **Idempotency keys:** `payroll:{runId}:v{calcVersion}:accrual`, `…:payment:{fileId}:{batchNo}`, `…:reversal:{voucherId}`.
- Statutory remittance vouchers (PF, ESI, PT, TDS challans) are recorded in Finance, not here (P2 hand-off: payroll exports the challan amounts).

**6. Jobs, notifications, audit**
- `payroll-ledger` worker retries with exponential backoff, up to 8 attempts, then FAILED and an HR/admin alert.
- Audit: `ledger.voucher.posted|failed|reversed` (source payroll).

**7. Integrations.** Internal port only (Finance domain).

**8. Edge cases**
- A missing account mapping blocks finalize, with a pre-check error "Map ledger accounts".
- A Finance period closed for that date: Finance returns 409 and the posting is FAILED. The admin reopens the Finance period or posts on the next open date (setting).
- A SUPPLEMENTARY run posts its own voucher.

**9. Phase and dependencies.** The contract is P1. It depends on the Finance Ledger module (`voucher` model with JOURNAL type, chart of accounts, cost centres). If the Ledger ships later, postings queue as SKIPPED_NO_LEDGER and are replayed.

**10. Acceptance**
1. Finalizing a 3-employee run posts one voucher where Σ Dr = Σ Cr and SALARY_PAYABLE = Σ netPay. The voucher appears in Ledger → Day book.
2. A worker crash after posting, followed by a retry, produces no duplicate voucher (same idempotency key returns the same voucherId).
3. Reopen posts a reversal voucher. Re-finalize (calcVersion 2) posts a new accrual voucher.
4. Reconciling 8 PAID entries posts a payment voucher of Σ those 8 nets.

---

## Permission keys (seeded role mapping)

| Key | employee | lead | manager | hr | admin |
|---|---|---|---|---|---|
| leave.self.view / leave.self.apply / compOff.request | ✓ | ✓ | ✓ | ✓ | ✓ |
| payslip.self.view / payroll.salary.self.view / holiday.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| leave.team.view / leave.request.approve / compOff.approve (scope: reportees) |  | ✓* | ✓ | ✓ | ✓ |
| leave.request.approve.any / leave.request.create.any / leave.admin.requests.view |  |  |  | ✓ | ✓ |
| leave.admin.types.manage / leave.admin.rules.manage / leave.admin.credit / holiday.manage |  |  |  | ✓ | ✓ |
| payroll.run.view / payroll.run.manage / payroll.adjustment.manage / payroll.bankfile.download |  |  |  | ✓ | ✓ |
| payroll.salary.view / payroll.salary.manage / payslip.all.view / payroll.lock.override |  |  |  | ✓ | ✓ |
| payroll.run.finalize |  |  |  | ✓ (when requireApproval = false) | ✓ |
| payroll.run.approve / payroll.run.reopen / payroll.settings.manage |  |  |  |  | ✓ (settings: hr too) |

\* Leads get the team keys only when they are someone's RM; scope is always resolved as approverId or reportee tree. This maps to the Roles and access row "Payroll & ledger" (HR, Admin). The platform super-admin gets none of these keys.

---

## Cross-domain contracts

**Consumed from other domains**
- **People / Employees:**
  - `Employee {id, empCode, fullName, gender, dateOfBirth, employmentType, status(ACTIVE|NOTICE|EXITED), joinDate, lastWorkingDay, reportingManagerId, departmentId, designation, workLocationId, workMode(OFFICE|REMOTE|HYBRID)}`
  - Events `employee.joined`, `employee.updated`, `employee.manager_changed`, `employee.employment_type_changed`, `employee.exited`
  - Reportee-tree query
- **Shifts / Locations:** effective-dated shift allocation (start, end, breakMinutes, weeklyOffDays); location → stateCode, which holiday calendar applies.
- **Attendance:**
  - `getDaySummaries` (status PRESENT, HALF_DAY, ABSENT, WEEKLY_OFF, HOLIDAY, ON_LEAVE; workedMinutes; lateMark), `getPolicyLop`
  - Attendance policy flags per work-mode group: `deductIdleFromPayroll` (wireframe row "Deduct idle time from payroll"), `timesheetRequired`
  - **Must enforce** `PayrollLockService.isLocked` and emit `attendance.corrected {employeeId, date}`
- **Timesheet** (two-level PL → RM approvals, tracker idle):
  - `getApprovalGate(employeeIds, from, to)`, `getDeductibleIdleMinutes(...)` per day, after idle-marked-as-work review
  - Events `timesheet.rm_approved`, `timesheet.sent_back`, `timesheet.idle_decision_changed`
  - Must enforce the payroll lock
- **Onboarding:** event `onboarding.bank_tax.submitted`; it calls `POST /payroll/salary/preview` for offer letter Annexure A and creates the JOINING salary revision.
- **Appraisals (P2):** `salary.revision.proposed {employeeId, newCtc, effectiveFrom, appraisalId}`.
- **Finance Ledger:** `LedgerPostingPort.postVoucher / reverseVoucher`, chart of accounts list, cost centres.
- **Platform services:** RBAC (permission guard, scopes); Notifications (in-app Alerts + email templates); Audit log; Files and ObjectStorage with the crypto helper (P3 per-tenant DEK); Tenant settings and branding (payslip template); Dashboard aggregator (`GET /approvals/counts` merges leave, timesheet and helpdesk counts); Helpdesk (prefilled Payroll ticket with a payslipId link).

**Exposed to other domains**
- `LeaveQueryService.getApprovedDays(employeeIds, from, to)` for Attendance (ON_LEAVE marking), Tracker (`/leave/me/today`) and Dashboard.
- Events `leave.request.submitted|approved|rejected|cancelled`, `compoff.approved`.
- `WorkCalendarService.getDays` and the holiday API.
- `PayrollLockService.isLocked` and event `payroll.attendance.locked {period, lockedUpTo}`.
- Events `payroll.run.finalized`, `payslip.published`.
- `POST /payroll/salary/preview`.
- Masked payroll profile read for the Profile tab.

---

## Open questions (real ambiguities)

1. **Idle grace.** The wireframe shows 0h 40m idle with no deduction. The spec assumes a monthly grace of 60 min. Confirm the value, and whether it is monthly or daily.
2. **"Paid days" in the payroll table.** Samples such as Rahul (21 paid, 1 EL) suggest the column excludes paid leave. Payslips (July: 22.5 of 23) include it. The spec uses payable days (including paid leave) everywhere. Confirm.
3. **Maker-checker.** Can HR finalize payroll alone (the default here, matching the one-click wireframe), or must Admin/CEO approve?
4. **Leave approval chain.** RM only (wireframe), or optionally Project Lead then RM like timesheets?
5. **Excess leave beyond balance.** Reject (default), or auto-convert to LOP? Is EL accrued monthly (1.5/month, the default here) or credited yearly upfront?
6. **EL above the 30-day carry-forward cap at year-end.** Lapse (default) or encash? Encashment divisor 26 or 30?
7. **Interns.** Confirm no PF, ESI, PT or TDS on stipends, and that idle deduction does apply to interns.
8. **Holiday calendar ownership.** Leave domain (as proposed, with a Holidays tab), or Attendance/Locations? The Policies "Holiday list 2026" becomes a generated document.
9. **Payslip publish timing.** On finalize (default) or on payment date? Email with a password-protected attachment, or link only (default)?
10. **Statutory seed values** must be verified by the tenant's CA before go-live: FY 2026-27 tax slabs under the Income-tax Act 2025, the Gujarat PT slab, and the labour-code wage definition.

---

### Critical Files for Implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (Time off markup at lines 519–537; dashboard cards at 401–430; GEN `leaveAdmin`, `payslips`, `payroll` at 786, 798, 799; FORMS `leave`, `credit`, `leavetype`, `payroll` at 823, 835, 836, 840; NAV at 776 and 779; PROF "Offer & pay" at 895; onboarding "Bank & tax" at 897; balances and leaveHistory at 914 and 918)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (FLOWS at 355–356: timesheet approval into payroll and payslip; time off into payroll impact)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html (idle dialog and outcomes at 407–415 and 502–504, the source of deductible idle minutes)
- Proposed build targets (not yet created): apps/api/src/modules/leave/, apps/api/src/modules/payroll/ (calc engine, statutory engine, run state machine), packages/shared/src/schemas/{leave,payroll}.ts, apps/api/prisma/schema.prisma