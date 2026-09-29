# Lexisora HRMS: Attendance, Shifts, Locations, Timesheets and Approvals (Domain Build Spec)

Conventions for this whole spec:
- Every model below has `tenantId String @db.Uuid`, `createdAt` and `updatedAt`. Row-Level Security uses `tenant_id = current_setting('app.tenant_id')::uuid`. Composite uniques always start with `tenantId`.
- Instants are stored as `timestamptz` (UTC). An attendance "date" is a Postgres `date` in the location's timezone (default `Asia/Kolkata`). Durations are integer minutes (or seconds where noted). The UI shows `H:MM` or `Xh YYm`.
- A permission key looks like `module.action[.scope]`. Scope is enforced in a service guard, and can be SELF, TEAM (direct and indirect reports), PROJECT (members of projects I lead) or TENANT.
- The API prefix is `/api/v1`. Tracker endpoints are `/api/v1/tracker/v1/*` and use device-token auth.

---

## 0. Seeded permissions (default roles)

| Permission key | employee | lead | manager | hr | admin |
|---|---|---|---|---|---|
| attendance.self.read / attendance.self.punch | x | x | x | x | x |
| attendance.read.team (direct reports) | | | x | | x |
| attendance.read.project (members of led projects) | | x | | | |
| attendance.read.all | | | | x | x |
| attendance.manage (override a day, recompute) | | | | x | x |
| attendance.regularize.request | x | x | x | x | x |
| attendance.regularize.approve (team scope; HR tenant scope) | | | x | x | x |
| attendance.lock / attendance.unlock | | | | x (lock) | x (both) |
| location.read | x | x | x | x | x |
| location.manage | | | | x | x |
| shift.read | x (self) | x | x | x | x |
| shift.manage, shift.allocate | | | | x | x |
| holiday.read | x | x | x | x | x |
| holiday.manage | | | | x | x |
| attendance_policy.read | x (effective, self) | x | x | x | x |
| attendance_policy.manage | | | | x | x |
| idcheck.log | | | | x | x (+ seeded custom role "Security desk") |
| idcheck.read | | | | x | x |
| idcheck.self.read | x | x | x | x | x |
| biometric.device.manage | | | | x | x |
| tracker.device.pair.self | x | x | x | x | x |
| tracker.device.manage | | | | x | x |
| timesheet.self.read / .write / .submit | x | x | x | x | x |
| timesheet.approve.l1 | | x | x | | x |
| timesheet.approve.l2 | | | x | | x |
| timesheet.approve.override (act at any level) | | | | | x |
| timesheet.read.all (hours only, for payroll) | | | | x | x |
| screenshot.view.project (L1 scope) | | x | | | |
| screenshot.view.team (L2 scope) | | | x | | |
| screenshot.view.all | | | | | x |
| screenshot.delete | | | | | x |

Default for the roles matrix row "Approve timesheets": lead, manager and admin are on; HR is off.

NAV visibility follows the wireframe. Attendance, My timesheet and Time off: ALL. Timesheet approvals: lead, manager and admin. Shifts, Work locations, Attendance policy and ID card compliance: hr and admin. At runtime, NAV is derived from permissions, not role names. For example, the Timesheet approvals nav item is shown if the user has `timesheet.approve.l1` or `timesheet.approve.l2`.

The platform super-admin has no tenant permissions. Screenshot and ID-photo object keys are only ever signed through tenant-scoped endpoints.

---

## Module A: Work Locations

### A1. Screens and UX
- **Work locations** (GEN `locations`, hr and admin only).
  - Subtitle: "Offices and their punch rules. Biometric-only locations block web punch for employees assigned there."
  - Primary action: **Add location**.
  - Table columns: Location | Address | Geo radius ("150 m", or "—") | Punch mode (tag "Biometric only" = accent; "Web / desktop" = outline) | Employees (count of active employees whose `workLocationId` is this location).
  - Row click opens an edit drawer with the same fields plus: assigned employees list, biometric devices at this location, holiday calendar and timezone.
- **Add work location form**: Name (text, full width), Address (textarea, full width), Geo radius (m), Punch mode (Biometric only / Web / desktop allowed).
  - Additions needed for real behavior: a map-pin picker or manual Latitude/Longitude, Location type (Office / Remote / Client site), Enforce geo-fence for web punch (toggle), Timezone, Holiday calendar.
- **Seeded rows**:
  - Ahmedabad HQ: Biometric only, 150 m.
  - Pune studio: Biometric only, 100 m.
  - "Remote": system row, type REMOTE, no address, radius "—", Web / desktop. It cannot be deleted.

### A2. Data model
```prisma
enum LocationType { OFFICE REMOTE CLIENT_SITE }
enum PunchMode { BIOMETRIC_ONLY WEB_DESKTOP_ALLOWED ANY }
model WorkLocation {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  name String
  code String            // e.g. AHD-HQ
  type LocationType
  address String?
  city String?
  stateCode String?      // IN state code, used for holiday import
  latitude Decimal? @db.Decimal(9,6)
  longitude Decimal? @db.Decimal(9,6)
  geoRadiusM Int?        // 25..5000
  geoFenceWebPunch Boolean @default(false)
  punchMode PunchMode
  timezone String @default("Asia/Kolkata")
  holidayCalendarId String? @db.Uuid
  isSystem Boolean @default(false)
  archivedAt DateTime?
  @@unique([tenantId, name])
  @@unique([tenantId, code])
}
```
The employee's location is `Employee.workLocationId`, which is owned by the People domain. This module owns the assignment endpoint.

### A3. Workflow
Lifecycle is Active, then Archived (archive is soft delete). Hard delete is only allowed when there are 0 employees, 0 devices and 0 punches.

Changing `punchMode` or the geo-fence has these side effects:
- Recompute the web/desktop permission for affected employees.
- Push `attendance.state` to their sessions and `tracker.policy.updated` to their devices.
- Write an audit entry.

### A4. API
| Method and path | Permission |
|---|---|
| GET /locations?includeCounts=true | location.read |
| POST /locations | location.manage |
| GET /locations/:id | location.read |
| PATCH /locations/:id | location.manage |
| DELETE /locations/:id (archives, or hard-deletes when allowed) | location.manage |
| GET /locations/:id/employees | location.manage |
| POST /locations/:id/assign {employeeIds[], effectiveFrom} | location.manage (emits `employee.location.changed`) |

### A5. Business rules
- **Geo-fence check** (web punch; mobile punch in P2). It applies when `geoFenceWebPunch && lat/lng != null`.
  - Distance uses haversine: `d = 2R·asin(√(sin²(Δφ/2)+cosφ1·cosφ2·sin²(Δλ/2)))`, with R = 6,371,000 m.
  - Allowed if `accuracyM <= 200 && d - min(accuracyM, 50) <= geoRadiusM`.
  - Result is stored as `geoStatus` (INSIDE, OUTSIDE, LOW_ACCURACY, UNAVAILABLE or NOT_REQUIRED).
- A REMOTE-type location never geo-fences. Coordinates are still captured (if the browser grants them) and stored for audit.
- The effective punch rule is `policy[effectiveMode]` AND the location's `punchMode`. A BIOMETRIC_ONLY location always blocks web and desktop punch-in, even if the policy allows it.

### A6. Jobs, notifications and audit
- No jobs.
- Audit: `location.created`, `location.updated` (field diff), `location.archived`, `location.employees.assigned`.

### A7. Integrations
- `GeocoderAdapter { geocode(address): Promise<{lat,lng}|null> }`.
- The stub returns null, and the UI falls back to manual lat/lng or a map pin. An optional real adapter is a self-hosted Nominatim.

### A8. Validation and edge cases
- Radius must be between 25 and 5000.
- An OFFICE location with `geoFenceWebPunch` requires lat/lng.
- A REMOTE location cannot have BIOMETRIC_ONLY.
- An archived location cannot be assigned.
- Archiving a location that still has employees is blocked with 409 LOCATION_IN_USE.

### A9. Phase
**P1.** Depends on People (Employee), RBAC and Audit.

### A10. Acceptance scenarios
1. HR adds "Ahmedabad HQ" (Biometric only, 150 m). A remote-mode employee reassigned there sees "Web punch disabled. Use the fingerprint sensor…", and `POST punch` returns 403 PUNCH_BLOCKED_BIOMETRIC.
2. HR adds a CLIENT_SITE with geo-fence at 100 m. A web punch 80 m away (accuracy 20) is accepted with INSIDE. A punch 400 m away returns 403 GEOFENCE_OUTSIDE, and a REJECTED punch row is stored.
3. Deleting a location that has employees returns 409.
4. The Employees column matches the count of active employees assigned to the location.
5. An employee without `location.manage` gets 403 on POST.

---

## Module B: Shifts, Allocation and Late-Mark Rules

### B1. Screens and UX
- **Shifts** (GEN `shifts`, hr and admin only).
  - Tabs: **Shift master** | **Allocation**.
  - Actions: **Add shift** (primary) and **Allocate shift** (secondary).
- **Shift master** columns: Shift | Timing ("09:30 – 18:30") | Grace ("15 min") | Break ("60 min") | Weekly off ("Sat, Sun") | Employees (current allocation count).
  - Seeded shifts: General 09:30–18:30 / 15 / 60 / Sat, Sun (tenant default); Early 07:00–16:00 / 10 / 60 / Sun; US overlap 13:00–22:00 / 15 / 45 / Sat, Sun.
- **Allocation tab** (spec addition). Columns: Employee | Department | Shift | From | To | Allocated by. Filters: shift, department, location, date.
- **Add shift form**: Shift name, Start (time), End (time), Grace (min), Break (min), Weekly off (multi-select Mon–Sun).
  - Advanced section: Min minutes for a full day (default 450), Min for a half day (240), Early-out grace (15), Half day if late by more than (120), Alternate Saturday pattern (P2).
- **Allocate shift form**: Employees (multi-select with department/location filters), Shift, From date. Optional To date.
- Employee views (read-only):
  - Dashboard "Today" card meta: "Shift 09:30 – 18:30 · {modeNote}".
  - Tracker header: "Shift 09:30 – 18:30".
  - Profile Overview: "Shift · General · 09:30–18:30".

### B2. Data model
```prisma
model Shift {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  name String
  code String
  startMinute Int            // minutes from 00:00 local, 570 = 09:30
  endMinute Int              // may be < start => crosses midnight
  graceMinutes Int @default(15)
  breakMinutes Int @default(60)
  weeklyOffDays Int[]        // ISO 1=Mon..7=Sun
  weeklyOffPattern Json?     // P2: {"6":[2,4]} = 2nd & 4th Saturday off
  minFullDayMinutes Int @default(450)
  minHalfDayMinutes Int @default(240)
  earlyOutGraceMinutes Int @default(15)
  halfDayIfLateByMinutes Int? @default(120)
  isDefault Boolean @default(false)   // exactly one per tenant (partial unique index)
  archivedAt DateTime?
  @@unique([tenantId, name])
}
model ShiftAssignment {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  shiftId String @db.Uuid
  effectiveFrom DateTime @db.Date
  effectiveTo DateTime? @db.Date
  assignedById String @db.Uuid
  @@index([tenantId, employeeId, effectiveFrom])
  // raw SQL: EXCLUDE USING gist (tenant_id WITH =, employee_id WITH =, daterange(effective_from, coalesce(effective_to,'infinity'), '[]') WITH &&)
}
model ShiftOverride {   // P2 roster: a single-day swap or extra weekly off
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  date DateTime @db.Date
  shiftId String? @db.Uuid
  isWeeklyOff Boolean @default(false)
  reason String
  @@unique([tenantId, employeeId, date])
}
```

### B3. Workflow
- Allocation with From date D:
  - The open-ended current assignment is closed at D−1, and the new one is inserted, in one transaction.
  - If D is at or before today, enqueue a recompute of AttendanceDays from D to today. The lock date bounds this (dates at or before the lock are refused).
- Editing a shift's timing or grace applies only to future dates by default. The UI offers "Recompute from date X" as an explicit HR action (audited).
- A shift can only be archived when it has no current or future assignments.

### B4. API
| Method and path | Permission |
|---|---|
| GET /shifts?includeCounts=true | shift.read |
| POST /shifts | shift.manage |
| PATCH /shifts/:id | shift.manage |
| DELETE /shifts/:id (archive) | shift.manage |
| GET /shift-assignments?employeeId&shiftId&date&departmentId | shift.read (TENANT scope needs shift.manage) |
| POST /shift-assignments {employeeIds[], shiftId, effectiveFrom, effectiveTo?} | shift.allocate |
| DELETE /shift-assignments/:id (future-dated only) | shift.allocate |
| GET /me/shift?date= (resolved shift + window) | attendance.self.read |

### B5. Business rules
- **Resolve shift(employee, date)**, first match wins: ShiftOverride, then the ShiftAssignment covering the date, then the tenant default shift.
- **Shift window** for date D:
  - `expectedStart = D + startMinute`.
  - `expectedEnd = expectedStart + ((endMinute - startMinute + 1440) % 1440)`.
  - The punch-capture window is `[expectedStart − 4h, expectedEnd + 8h)`, clipped so it does not overlap the next day's window. A punch belongs to the attendance date whose window contains it, so night shifts belong to their start date.
- **Weekly off**: ISO weekday is in `weeklyOffDays` (plus the P2 pattern), or the override has `isWeeklyOff`.
- **Late mark**: `lateBy = firstIn − (expectedStart + grace)`. The day is late if `lateBy > 0`, and the stored `lateByMinutes` is measured from expectedStart. Example: shift start 09:30, grace 15, in at 09:52, gives Late with lateBy = 22.
- **Half day from lateness**: if `firstIn − expectedStart > halfDayIfLateByMinutes`, the day is capped at 0.5.
- **Early out**: `lastOut < expectedEnd − earlyOutGraceMinutes` sets `isEarlyOut`. By default an early out counts as a late mark (`policy.earlyOutCountsAsLate = true`).
- **Late-mark penalty** (policy): every `lateMarksPerPenalty` (default 3) late marks in a calendar month cost `penaltyDays` (default 0.5).
  - `penaltyDays = floor(lateCount / 3) × 0.5`.
  - It is deducted from Casual leave balance first (via the Leave domain API), otherwise it becomes LOP. The deduction is applied at period lock, not in real time.
  - A late mark excused by an approved regularization (type LATE_EXCUSE) is not counted.

### B6. Jobs, notifications and audit
- Job `attendance.recompute-range` (on allocation).
- Notification to employees when their shift changes: in-app and email, "Your shift changes to Early 07:00–16:00 from 5 Oct".
- Audit: `shift.created`, `shift.updated` (diff), `shift.archived`, `shift.allocated` (employeeIds, from, to), `shift.allocation.deleted`.

### B7. Integrations
None.

### B8. Validation and edge cases
- `startMinute != endMinute`.
- Grace must be 0–120. Break must be 0–240 and less than the shift duration.
- `minHalfDay < minFullDay <= duration − break + 60`.
- At least one working day per week.
- Overlapping allocation returns 409 (the gist constraint backs this).
- Allocation into a locked period returns 409 PERIOD_LOCKED.
- Employee joining date after From date: the assignment is clipped to the joining date.
- Exited employees are excluded from the picker.

### B9. Phase
**P1** for master, allocation, late and half-day rules. **P2** for ShiftOverride roster, alternate Saturdays, rotation and overtime flags (Gujarat Shops & Establishments: daily OT = worked beyond 9 h, weekly OT beyond 48 h, flag only). Depends on People and Leave (CL deduction API at lock).

### B10. Acceptance scenarios
1. Create General and allocate it to 3 employees from tomorrow. The Employees column increments, and tomorrow's `GET /me/shift` shows 09:30–18:30.
2. Punch in at 09:44 gives Present. Punch in at 09:46 gives Late (grace 15). Punch in at 11:45 gives Late and the day is capped at half day.
3. A 3rd late mark in September: the payroll input shows `lateMarks=3, latePenaltyDays=0.5`, and at lock 0.5 CL is debited (or LOP if CL is 0).
4. US overlap 13:00–22:00 with punch out at 00:20 the next day: the out punch is attributed to the previous date.
5. Allocating an overlapping range returns 409. Backdated allocation (before today, after the lock date) recomputes the affected days.

---

## Module C: Holiday Calendar

### C1. Screens and UX
- Shifts screen, new tab **Holidays** (hr and admin; spec addition). Columns: Date | Holiday | Type (Mandatory / Optional) | Calendar (Gujarat 2026 / Maharashtra 2026) | Locations.
- Actions: Add holiday, Import national/state list, Copy from last year.
- Employee side:
  - Time off "Upcoming" list (e.g. Dussehra 20 Oct; Diwali 8–9 Nov).
  - Dashboard "Birthdays & events".
  - Attendance table: rows show Status "Holiday".
- Policies has a "Holiday list 2026" document (Policies domain). A link is generated from this calendar as a PDF (P2).

### C2. Data model
```prisma
model HolidayCalendar { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; name String; year Int; stateCode String?; optionalQuota Int @default(0); publishedAt DateTime?
  @@unique([tenantId, name, year]) }
enum HolidayType { MANDATORY OPTIONAL }
model Holiday { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; calendarId String @db.Uuid; date DateTime @db.Date; endDate DateTime? @db.Date; name String; type HolidayType
  @@unique([tenantId, calendarId, date, name]) @@index([tenantId, date]) }
model OptionalHolidayChoice { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; employeeId String @db.Uuid; holidayId String @db.Uuid; status String // PENDING|APPROVED
  @@unique([tenantId, employeeId, holidayId]) }   // P2
```
A location's calendar comes from `WorkLocation.holidayCalendarId`. The REMOTE location uses the tenant default calendar.

### C3. Workflow
- A calendar goes from Draft to Published. Publishing notifies all users of the attached locations.
- Adding or removing a holiday on or before today (and after the lock) triggers a recompute of those days.

### C4. API
| Method and path | Permission |
|---|---|
| GET /holiday-calendars?year | holiday.read |
| POST /holiday-calendars | holiday.manage |
| PATCH /holiday-calendars/:id | holiday.manage |
| POST /holiday-calendars/:id/publish | holiday.manage |
| POST /holiday-calendars/:id/copy {toYear} | holiday.manage |
| GET /holiday-calendars/:id/holidays | holiday.read |
| POST /holiday-calendars/:id/holidays | holiday.manage |
| PATCH /holidays/:id, DELETE /holidays/:id | holiday.manage |
| POST /holiday-calendars/:id/import {year, stateCode} | holiday.manage |
| GET /me/holidays?from&to | holiday.read |

### C5. Business rules
- A day is a holiday for an employee when their location on that date has a calendar with a MANDATORY holiday covering it, or an APPROVED optional choice.
- If attendance on a holiday or weekly off reaches at least `minHalfDayMinutes`, the status is HOLIDAY_WORKED / WEEKLY_OFF_WORKED and the event `attendance.compoff.eligible {employeeId, date, fraction 0.5|1}` is emitted. The Leave domain credits comp-off after RM approval; it expires in 60 days per Leave setup.
- A holiday that falls on a weekly off gives no extra credit.
- Holidays count as paid days. They are excluded from `workingDays`.

### C6. Jobs, notifications and audit
- Cron at 1 Dec 09:00 IST: remind HR to publish next year's calendar.
- 1 day before each holiday: in-app reminder to affected employees.
- Audit: `holiday.*`, `holiday_calendar.published`.

### C7. Integrations
- `HolidayProviderAdapter { list(year, stateCode): Promise<{date,name,type}[]> }`.
- The stub is a bundled static JSON of Indian national holidays plus Gujarat and Maharashtra state holidays.

### C8. Validation and edge cases
- The date must fall within the calendar year.
- A duplicate date with the same name is rejected.
- A multi-day holiday (Diwali 8–9 Nov) uses `endDate` and expands to one row per day for attendance.
- The optional choice count must not exceed `optionalQuota`.

### C9. Phase
**P1** for mandatory holidays. **P2** for optional/restricted holidays and the PDF holiday list. Depends on Leave (comp-off credit) and Policies (document link).

### C10. Acceptance scenarios
1. Import Gujarat 2026 and publish. Ahmedabad employees see Dussehra on 20 Oct in Upcoming, and 20 Oct attendance shows Holiday.
2. Pune (Maharashtra calendar) shows a different set.
3. An employee works 5 h on 20 Oct: the status is HOLIDAY_WORKED and the `compoff.eligible` event is emitted with fraction 0.5.
4. Removing a past holiday (not locked) recomputes that day to Absent or Present.

---

## Module D: Attendance Policy (rule matrix) and Policy Push to Tracker

### D1. Screens and UX
- **Attendance policy** (GEN `settings`, hr and admin only).
  - Subtitle: "Controls how and where employees can punch in, plus desktop tracker rules."
  - Table: Rule | Office employees | Remote / WFH employees. Checkbox cells save immediately. Toast: "Policy updated · pushed to N trackers".
  - Rows and defaults (Office / Remote):
    - Biometric punch mandatory: on / off.
    - Allow web punch-in: off / on.
    - Allow desktop app punch-in: off / on.
    - Auto-idle after **5** min without input: on / on (the number is editable, 1–60).
    - Screenshot every **10** min: on / on (editable, 5–60).
    - Blur screenshots: off / off.
    - Deduct idle time from payroll: on / on.
- **More rules** section (spec addition; a form below the matrix, per column):
  - Idle deduction mode: Shortfall only / All idle. Monthly idle allowance (min).
  - Late marks per penalty (3), Penalty days (0.5), Deduct penalty from (CL, then LOP / LOP / None), Early-out counts as late.
  - Missed punch auto-close after (h) (4).
  - Regularizations per month (3), Regularization window (days) (7).
  - Break reminder after (min) (120). Offline storage (days) (7). Screenshot retention (days) (90).
  - Timesheet required (on). Timesheet due (Mon 12:00). Split timesheet at month end (on). Skip duplicate approver (on).
  - Fallback approver (user picker). Tracker required for remote (on). Punch-in reminder (on).
- **Tracker Settings tab** (read-only, "HR policy" tag): shows "Auto-idle after: 5 min · HR policy", "Screenshots: Every 10 min · HR policy" and "Offline storage: Up to 7 days". The footer reads "Rules marked "HR policy" are set by your admin and can't be changed here."
- Policies-domain link: when the policy changes materially, HR can mark the "Leave & attendance policy" document as requiring acknowledgement again.

### D2. Data model
```prisma
enum PolicyAudience { OFFICE REMOTE }
enum IdleDeductionMode { SHORTFALL_ONLY ALL_IDLE }
enum LatePenaltySource { LEAVE_THEN_LOP LOP NONE }
model AttendancePolicy {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  audience PolicyAudience
  biometricMandatory Boolean
  allowWebPunch Boolean
  allowDesktopPunch Boolean
  autoIdleEnabled Boolean @default(true)
  autoIdleMinutes Int @default(5)
  screenshotsEnabled Boolean @default(true)
  screenshotIntervalMinutes Int @default(10)
  blurScreenshots Boolean @default(false)
  deductIdleFromPayroll Boolean @default(true)
  idleDeductionMode IdleDeductionMode @default(SHORTFALL_ONLY)
  monthlyIdleAllowanceMinutes Int @default(0)
  lateMarksPerPenalty Int @default(3)
  latePenaltyDays Decimal @default(0.5) @db.Decimal(3,1)
  latePenaltySource LatePenaltySource @default(LEAVE_THEN_LOP)
  earlyOutCountsAsLate Boolean @default(true)
  missedPunchAutoCloseHours Int @default(4)
  maxRegularizationsPerMonth Int @default(3)
  regularizationWindowDays Int @default(7)
  breakReminderMinutes Int? @default(120)
  offlineRetentionDays Int @default(7)
  screenshotRetentionDays Int @default(90)
  timesheetRequired Boolean @default(true)
  trackerRequired Boolean @default(false)     // Remote default true
  punchInReminder Boolean @default(true)
  version Int @default(1)
  updatedById String? @db.Uuid
  @@unique([tenantId, audience])
}
model AttendancePolicyVersion { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; audience PolicyAudience; version Int; snapshot Json; changedById String @db.Uuid; changedAt DateTime @default(now())
  @@unique([tenantId, audience, version]) }
model TenantTimesheetSettings { tenantId String @id @db.Uuid; weekStartsOn Int @default(1); splitAtMonthEnd Boolean @default(true); submitDueWeekday Int @default(1); submitDueMinute Int @default(720); skipDuplicateApprover Boolean @default(true); fallbackApproverId String? @db.Uuid; l1SlaHours Int @default(48); l2SlaHours Int @default(48) }
```
Employee fields consumed from People: `workMode` (OFFICE, REMOTE, HYBRID), `hybridOfficeDays Int[]` (ISO weekdays; required when HYBRID), `workLocationId`, `employmentType`, `reportingManagerId`, `status`, `joiningDate`, `exitDate`.

### D3. Workflow and effective policy
- **effectiveMode(employee, date)**:
  - OFFICE → OFFICE.
  - REMOTE → REMOTE.
  - HYBRID → OFFICE if the weekday is in `hybridOfficeDays`, otherwise REMOTE.
  - Override: an approved WFH regularization for that date forces REMOTE.
- **Effective location** for the day: `workLocationId` if the effective mode is OFFICE, otherwise the tenant's system REMOTE location.
- **webPunchAllowed** = `policy.allowWebPunch && location.punchMode != BIOMETRIC_ONLY && employee.status == ACTIVE && !fullDayApprovedLeave && (geo check passes, if required)`.
- **desktopPunchAllowed** = the same, using `allowDesktopPunch`, and additionally the device is ACTIVE and consent is recorded.
- **trackerMode** is pushed to the device:
  - PUNCH: desktop punch allowed.
  - MONITOR_ONLY: desktop punch not allowed, but auto-idle or screenshots are enabled. The tracker hides the punch buttons, starts tracking on the server event `attendance.state=IN` (for example, a biometric IN), and stops on OUT.
  - DISABLED: neither of the above applies.
- **Matrix constraints**, enforced server-side with 422:
  - `biometricMandatory` on forces `allowWebPunch` and `allowDesktopPunch` off. The UI auto-unchecks them with a toast.
  - Each column needs at least one punch method.
  - `blurScreenshots` requires `screenshotsEnabled`.
  - `deductIdleFromPayroll` requires `autoIdleEnabled`.
- **On save**:
  - `version++`, snapshot to AttendancePolicyVersion, audit the diff.
  - Emit `tracker.policy.updated {audience, version}` to Socket.IO room `tenant:{t}:policy:{audience}` (devices join the audience room for today).
  - Changes apply to future days. Past days are only affected by an explicit recompute.

### D4. API
| Method and path | Permission |
|---|---|
| GET /attendance-policies (both columns + TenantTimesheetSettings) | attendance_policy.read |
| PATCH /attendance-policies/:audience {partial fields, expectedVersion} | attendance_policy.manage (409 on version mismatch) |
| GET /attendance-policies/:audience/versions | attendance_policy.manage |
| PATCH /timesheet-settings | attendance_policy.manage |
| GET /me/attendance-policy?date → {effectiveMode, location, webPunchAllowed, desktopPunchAllowed, trackerMode, blockReason, rules} | attendance.self.read |
| GET /tracker/v1/policy (ETag = `"{audience}-{version}-{locationVersion}"`, 304 when unchanged) | device token |

Realtime: `tracker.policy.updated`.

### D5. Business rules
All the defaults above. The **idle deduction formula** is defined in Module E (E5).

### D6. Jobs, notifications and audit
- Job: at 00:05 IST, for each HYBRID employee, compute today's audience and emit a room re-join event to their devices.
- Notification to all affected employees on change of punch methods or screenshot/idle rules: in-app plus email, "Attendance policy updated: …". Under India's DPDP Act, monitoring changes must be disclosed.
- Audit: `attendance_policy.updated` (before/after JSON diff, version).

### D7. Integrations
None (Socket.IO internal).

### D8. Validation and edge cases
- Autoidle minutes 1–60. Screenshot interval 5–60. Retention 7–365. Allowance 0–600.
- Concurrent HR edits: optimistic `expectedVersion`.
- A device offline when the policy changes gets the new version on its next `bootstrap` or `sync` response (`policyVersion` mismatch makes the device refetch).

### D9. Phase
**P1**. P3 adds plan gating (screenshots and desktop tracker require the Growth plan; biometric requires Enterprise) and policy groups beyond Office/Remote (per department). Depends on RBAC, People (workMode) and the Tracker app.

### D10. Acceptance scenarios
1. HR unchecks "Allow web punch-in" for Remote. Within 2 s, a remote employee's Attendance card shows the blocked message, and `POST punch` returns 403 PUNCH_BLOCKED_POLICY.
2. HR changes the screenshot interval to 15. The connected tracker receives `tracker.policy.updated`, refetches (200 with a new ETag), and the Settings tab shows "Every 15 min · HR policy".
3. Checking "Biometric punch mandatory" for Remote auto-clears web and desktop, and the saved version is +1 with an audit diff.
4. A HYBRID employee with office days Mon/Wed: on Tuesday web punch is allowed; on Wednesday it is blocked (Ahmedabad HQ is biometric only).
5. PATCH with a stale `expectedVersion` returns 409.

---

## Module E: Punch, Attendance Day and Attendance Screen (incl. dashboard "Today" card)

### E1. Screens and UX
- **Header punch button** (every screen): label "Punch in" or "Punch out". Uses the same API as below.
  - If blocked, show a toast with the reason: "Office mode: punch in with the biometric sensor", "You are outside the allowed area (412 m from Client site)", or "Location permission required".
  - Success toasts: "Punched in at 09:31 · web" and "Punched out · day summary saved".
- **Dashboard "Today" card**:
  - Kicker "Today". Title: Not punched in / Punched in / On break (from tracker) / Punched out.
  - Large elapsed `HH:MM:SS`: the sum of today's closed sessions plus (serverNow − openSessionStart). It ticks on the client using the offset `serverNow − Date.now()`.
  - Meta: "Shift {start} – {end} · {modeNote}", where modeNote is "Office · biometric punch", "Remote · web punch allowed" or "Remote · desktop tracker".
  - Button: Punch in / Punch out.
- **Attendance screen**:
  - Subtitle: "Punch source follows HR policy…".
  - The "Work mode (demo)" toggle is removed in production. It is replaced by a read-only chip showing today's effective mode and location, for example "Remote / WFH · Remote".
  - **Punch card**:
    - State and live elapsed.
    - If `webPunchAllowed`, or a web/desktop session is open: the Punch in/out button.
    - If blocked: dashed notice "Web punch disabled. Use the fingerprint sensor at the office entrance."
    - For remote users with `trackerRequired`: "Punch from the desktop tracker", with a download link.
  - **This month card**:
    - Present days: sum of `presentFraction`.
    - Late marks: count of `isLate` that are not excused.
    - Active hours: sum of `activeMinutes`, shown as "142h".
    - Idle (auto): sum of `idleMinutes`, shown as "3h 40m".
    - A month selector is added.
  - **ID card check card**: data from Module G.
  - **Today's timeline**:
    - A horizontal bar with the axis from shift start to shift end, extended to the earliest in or latest out. Ticks every 90 min (09:30, 11:00, …, 18:30).
    - Segment colors: Active = accent-300, Break = neutral-400, Auto-idle = neutral-200. The tooltip shows kind, time range and task.
    - Legend: "Active · Break · Auto-idle (no input > 5 min)", where 5 is the policy value.
  - **Daily table**:
    - Columns: Date ("Mon 28 Sep") | In | Out | Source (Biometric / Web / Desktop / Regularized / Mixed / System) | Breaks ("55m") | Idle ("20m") | Status tag (Present, Late, Half day, Absent, Leave, Half-day leave, Holiday, Weekly off, Holiday worked, Missed punch, Today).
    - Row action (spec addition): "Request correction", which opens the regularization form (Module F).
  - **Team view** (spec addition) for users with `attendance.read.team`, `.project` or `.all`: an employee picker with the same screen for another employee, plus "Today" roll-up counts (Present, Late, Absent, On leave, Not yet in).
- **Profile → Attendance tab**: columns Month | Present | Leave | Idle | Late for the last 12 months.

### E2. Data model
```prisma
enum PunchSource { BIOMETRIC WEB DESKTOP MOBILE REGULARIZATION SYSTEM }
enum PunchDirection { IN OUT UNKNOWN }
enum PunchStatus { ACCEPTED REJECTED SUPERSEDED }
enum GeoStatus { INSIDE OUTSIDE LOW_ACCURACY UNAVAILABLE NOT_REQUIRED }
model AttendancePunch {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  attendanceDate DateTime @db.Date
  punchedAt DateTime
  direction PunchDirection
  source PunchSource
  status PunchStatus
  rejectReason String?          // PUNCH_BLOCKED_BIOMETRIC|PUNCH_BLOCKED_POLICY|GEOFENCE_OUTSIDE|DUPLICATE|PERIOD_LOCKED|STATE_CONFLICT
  locationId String? @db.Uuid
  latitude Decimal? @db.Decimal(9,6)
  longitude Decimal? @db.Decimal(9,6)
  accuracyM Int?
  distanceM Int?
  geoStatus GeoStatus @default(NOT_REQUIRED)
  ipAddress String?
  userAgent String?
  trackerDeviceId String? @db.Uuid
  biometricDeviceId String? @db.Uuid
  regularizationId String? @db.Uuid
  clientEventId String          // idempotency (web: Idempotency-Key; tracker: uuid; biometric: sn|pin|ts)
  clockAdjusted Boolean @default(false)
  createdById String? @db.Uuid
  @@unique([tenantId, source, clientEventId])
  @@index([tenantId, employeeId, punchedAt])
  @@index([tenantId, attendanceDate])
}
model WorkSession {                 // derived IN→OUT pair
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  attendanceDate DateTime @db.Date
  inPunchId String @db.Uuid
  outPunchId String? @db.Uuid
  startedAt DateTime
  endedAt DateTime?
  source PunchSource
  autoClosed Boolean @default(false)
  @@index([tenantId, employeeId, attendanceDate])
}
enum DayStatus { PENDING PRESENT HALF_DAY ABSENT LEAVE HALF_DAY_LEAVE HOLIDAY WEEKLY_OFF HOLIDAY_WORKED WEEKLY_OFF_WORKED MISSED_PUNCH }
model AttendanceDay {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  date DateTime @db.Date
  shiftId String @db.Uuid
  effectiveMode PolicyAudience
  locationId String @db.Uuid
  expectedStart DateTime
  expectedEnd DateTime
  firstIn DateTime?
  lastOut DateTime?
  primarySource PunchSource?
  sourcesMask Int @default(0)           // bit flags → "Mixed"
  grossMinutes Int @default(0)
  breakMinutes Int @default(0)
  activeMinutes Int @default(0)
  idleMinutes Int @default(0)            // final IDLE + undecided
  idleAsWorkMinutes Int @default(0)      // pending/accepted, counted in worked
  workedMinutes Int @default(0)          // payable work
  lateByMinutes Int @default(0)
  isLate Boolean @default(false)
  lateExcused Boolean @default(false)
  isEarlyOut Boolean @default(false)
  status DayStatus
  presentFraction Decimal @default(0) @db.Decimal(3,2)   // 0|0.5|1
  leaveFraction Decimal @default(0) @db.Decimal(3,2)
  leaveTypeCode String?
  idleDeductibleMinutes Int @default(0)
  isLocked Boolean @default(false)
  overriddenById String? @db.Uuid
  overrideReason String?
  recomputedAt DateTime
  @@unique([tenantId, employeeId, date])
  @@index([tenantId, date, status])
}
model AttendancePeriodLock { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; month String; lockedUpTo DateTime @db.Date; lockedById String @db.Uuid; lockedAt DateTime; unlockedAt DateTime?; unlockReason String?; payrollRunId String? @db.Uuid
  @@unique([tenantId, month]) }
```
ActivitySegment is defined in Module H. The timeline is served from WorkSession (for web/biometric) and ActivitySegment (for desktop).

### E3. Workflows and state machine
- **Punch state** (per employee, "now"): OUT goes to IN (punch in) and IN goes back to OUT (punch out). Break is a tracker-only sub-state (Module H). Multiple sessions per day are allowed.
- **Punch-in** (web, `POST /me/attendance/punches {intent:"IN"}`):
  1. Take an advisory lock on (tenant, employee).
  2. Resolve the date, shift, effective mode and location.
  3. Evaluate permission and geo-fence.
  4. On a block, store a REJECTED punch (audit) and return 403 with a code.
  5. If the current state is already IN, return 409 STATE_CONFLICT with the current state (the UI refreshes).
  6. Insert the ACCEPTED punch and open a WorkSession.
  7. Emit `attendance.state` to `user:{id}` (web tabs and tracker devices), then enqueue recompute.
- **Punch-out** (web): allowed only if the open session's source is WEB or DESKTOP, or `webPunchAllowed`. A session opened by biometric must be closed by biometric (403 "Punch out at the biometric sensor").
- **Cross-channel**: an IN from the desktop and an OUT from the web is allowed (same user, same allowed rule). The tracker receives `attendance.state=OUT` and stops timers.
- **Biometric direction resolution** is per device `directionMode`:
  - DEVICE_STATUS: ZK status 0 = IN, 1 = OUT.
  - ALTERNATE: the first punch of the day is IN, then OUT, IN, and so on.
  - FIRST_LAST (default): all punches are stored UNKNOWN, `firstIn = min`, `lastOut = max` (if count ≥ 2), and gaps between consecutive pairs (2–3, 4–5, …) are breaks.
  - Duplicates from the same PIN within 60 s become SUPERSEDED.
- **Auto-close** (job every 15 min). For an open session where `now > expectedEnd + missedPunchAutoCloseHours`, or the capture window has ended:
  - DESKTOP: close at the last segment end or heartbeat (source SYSTEM, `autoClosed`).
  - WEB or BIOMETRIC: leave it open. The day becomes MISSED_PUNCH and the employee is notified to regularize.
- **Absent marking** (daily at 00:30 IST for D−1): a working day with no punches and no leave becomes ABSENT.
- **Day status precedence** (`recomputeDay(employee, date)`):
  1. Holiday or weekly off with `worked < minHalf`: HOLIDAY or WEEKLY_OFF (`presentFraction = 0`, paid).
  2. Full-day approved leave: LEAVE (`leaveFraction = 1`).
  3. Any open session and the day has ended: MISSED_PUNCH (`presentFraction = 0` until regularized).
  4. `worked ≥ minFull`: PRESENT, with presentFraction 1, capped to 0.5 if late beyond the half-day threshold.
  5. `worked ≥ minHalf`: HALF_DAY (0.5). If there is also half-day leave, the status is HALF_DAY_LEAVE with `presentFraction 0.5` and `leaveFraction 0.5`.
  6. Past working day with `worked < minHalf`: ABSENT.
  7. Today: PENDING.
  8. Worked on a holiday or weekly off with `≥ minHalf`: HOLIDAY_WORKED or WEEKLY_OFF_WORKED, and emit `compoff.eligible`.
  - The UI shows PRESENT with `isLate` as "Late".

### E4. API
| Method and path | Permission |
|---|---|
| GET /me/attendance/today → {state, openSessionStart, workedSecondsClosed, serverNow, shift{name,start,end}, effectiveMode, location, webPunchAllowed, blockReason, modeNote, idCheck} | attendance.self.read |
| POST /me/attendance/punches {intent: IN\|OUT, lat?, lng?, accuracyM?} with header Idempotency-Key | attendance.self.punch |
| GET /me/attendance/days?month=YYYY-MM | attendance.self.read |
| GET /me/attendance/summary?month → {presentDays, lateMarks, activeMinutes, idleMinutes, leaveDays, workingDays} | attendance.self.read |
| GET /me/attendance/days/:date/timeline → [{kind ACTIVE\|BREAK\|IDLE, start, end, taskLabel}] | attendance.self.read |
| GET /attendance/days?employeeId&from&to&status | attendance.read.team\|project\|all (scoped) |
| GET /attendance/employees/:id/summary?months=12 (profile tab) | attendance.read.* or self |
| GET /attendance/today-rollup?locationId&departmentId | attendance.read.team\|all |
| PATCH /attendance/days/:id {status?, presentFraction?, reason} (HR override; overrides are marked) | attendance.manage |
| POST /attendance/recompute {employeeIds?, from, to} | attendance.manage |
| GET /attendance/periods, POST /attendance/periods/:month/lock {lockedUpTo} | attendance.lock |
| POST /attendance/periods/:month/unlock {reason} | attendance.unlock |
| GET /internal/attendance/payroll-input?month (service token) | internal |

Realtime (Socket.IO `/app`, room `user:{id}`): `attendance.state {state, sessionStart, source}`, `attendance.day.updated {date}`.

### E5. Business rules and calculations
Worked time by data source, per day:
- **Desktop segments exist** in the day's sessions:
  - `active` = sum of ACTIVE.
  - `idleAsWork` = IDLE with `decision=WORK` and `review != REJECTED`.
  - `break` = BREAK plus IDLE with `decision=BREAK`.
  - `idle` = IDLE with decision IDLE or PENDING.
  - `worked = active + idleAsWork`.
- **Web only** (no segments):
  - `gross` = sum of session durations.
  - `break = shift.breakMinutes` if `gross > 300`, otherwise 0 (the default "assume shift break when unrecorded").
  - `worked = active = gross − break`. `idle = 0`.
- **Biometric only**:
  - `gross = lastOut − firstIn`.
  - `break` = sum of the out→in gaps. If there are no intermediate punches and `gross > 300`, break = `shift.breakMinutes`.
  - `worked = gross − break`.
- **Biometric plus tracker in MONITOR_ONLY** (office staff): presence and gross come from biometric. Idle comes from segments inside the biometric window, and `worked = gross − break − idle`. Idle-as-work is added back after PL acceptance.
- **Idle deduction** (if `deductIdleFromPayroll`), per day:
  - SHORTFALL_ONLY (default): `deductible = min(idle, max(0, requiredMinutes − worked))`, where `requiredMinutes = shift duration − breakMinutes` (480 for General).
  - ALL_IDLE: `deductible = idle` (only idle inside the shift window).
  - Monthly: `idleDeductibleMinutes = max(0, Σ deductible − monthlyIdleAllowanceMinutes)`.
  - Only days with `presentFraction > 0` count, so an absent day is not double-penalised.
  - Payroll computes the amount (recommended): `round(monthlyGross / (workingDays × requiredMinutes/60) × idleDeductibleMinutes/60)`.
  - After timesheet approval, idle values from the approved timesheet are the final figures.
- **Monthly figures**:
  - `workingDays` = days in month − weekly offs − holidays (from the employee's joining date or to their exit date).
  - `presentDays` = Σ presentFraction.
  - `lopDays` = Σ over working days of `(1 − presentFraction − leaveFraction(paid))`, plus unpaid leave, plus `latePenaltyDays` (when the penalty source is LOP or there is no CL balance), plus unresolved MISSED_PUNCH days.
  - `paidDays = workingDays − lopDays`. Example: 23 working days with 0.5 LOP gives 22.5.

### E6. Jobs, notifications and audit
- Jobs (BullMQ):
  - `attendance.recompute-day`: debounced 5 s, key `tenant:emp:date`.
  - `attendance.auto-close`: every 15 min.
  - `attendance.mark-absent`: 00:30 IST.
  - `attendance.punch-in-reminder`: every 5 min. Targets employees with web/desktop allowed and no IN by `expectedStart + grace + 15`, once per day, in-app plus email "You haven't punched in today".
  - `attendance.missed-punch-reminder`: 09:00 next day.
  - `attendance.monthly-rollup`: nightly, a materialized per-month summary for the Profile tab.
  - `attendance.lock-apply`: on lock. Sets `isLocked` and posts late penalties to Leave.
- In-app notifications: "Late mark recorded (09:52, 22 min late)", and "3rd late mark this month · 0.5 day will be deducted".
- Audit:
  - `punch.accepted`, `punch.rejected` (with geo, IP and reason).
  - `day.overridden` (before/after, reason).
  - `attendance.period.locked` / `unlocked`, `attendance.recompute.requested`.

### E7. Integrations
- Browser Geolocation (client).
- `IpGeoAdapter { lookup(ip) }`: the stub returns null.
- Uses LeaveService (Leave domain, below) and ObjectStorage.

### E8. Validation and edge cases
- Rapid double click: the Idempotency-Key and state check return the same result.
- Punch while on full-day approved leave: 409 ON_LEAVE ("Cancel leave first"). A half-day leave is allowed.
- Exited or inactive employee: 403.
- Punch for a date on or before the lock: 409 PERIOD_LOCKED.
- Timezone: the location timezone is used for date and window. Server time is authoritative for WEB punches (client time is ignored).
- Browser denies geolocation where geo is required: 403 GEO_REQUIRED.
- A punch-out arriving before the punch-in from an offline tracker: sessions are rebuilt from events ordered by `punchedAt` on every recompute.
- Midnight session split: sessions stay attached to their capture-window date. There is no split unless the window ends.
- Employee joins mid-month: `workingDays` counts from the joining date.

### E9. Phase
**P1** for everything in this module, except the Team view roll-up and the 12-month Profile tab, which are P1 late / P2 early. Depends on People, Leave (approved leave and half day; CL deduction), Notifications, Audit, Tracker (Module H) and Biometric (Module I).

### E10. Acceptance scenarios
1. A remote employee clicks Punch in at 09:31. The punch is stored with source WEB, the header, Dashboard and Attendance card all show "Punched in" with the timer ticking, and the tracker window (if open) switches to Working within 2 s.
2. An office employee clicks Punch in and gets 403 PUNCH_BLOCKED_BIOMETRIC with the dashed notice. A biometric ATTLOG at 09:41 then makes the card show "Punched in" (source Biometric), and the web "Punch out" is hidden.
3. Desktop day: in 09:28, out 18:42, 55 m break, 20 m idle (IDLE decision). The day row shows `Mon 28 Sep | 09:28 | 18:42 | Desktop | 55m | 20m | Present`, and worked = active.
4. Web punch in with no out by 22:30 (General + 4 h): the next morning the day is MISSED_PUNCH, a reminder is sent, and payroll input counts 1 LOP unless regularized before lock.
5. Month summary equals the sums of the day rows. `POST /attendance/periods/2026-09/lock` then makes any punch/regularization for September return 409.
6. Punch while already IN (from another tab) returns 409 with the current state, and the UI refreshes without creating a duplicate.

---

## Module F: Attendance Regularization

### F1. Screens and UX
- Attendance table row action **Request correction**, and a "Regularize" button above the table.
- Form fields: Date, Type (Missed punch / Wrong time / Worked from home (forgot to punch) / On duty (client visit) / Excuse late mark), Corrected In (time), Corrected Out (time), Reason (textarea, at least 10 chars), Attachment (optional).
- The employee sees a "Pending correction" tag on the row.
- Approver UI: in the Time → Approvals area as a third tab "Attendance corrections · N" (spec addition; visible with `attendance.regularize.approve`). The Dashboard "Awaiting your approval" card gets an extra row "Attendance corrections" (spec addition).

### F2. Data model
```prisma
enum RegularizationType { MISSED_PUNCH WRONG_TIME WFH_FORGOT ON_DUTY LATE_EXCUSE }
enum RequestStatus { PENDING APPROVED REJECTED CANCELLED }
model AttendanceRegularization {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  date DateTime @db.Date
  type RegularizationType
  requestedIn DateTime?
  requestedOut DateTime?
  reason String
  attachmentKey String?
  status RequestStatus @default(PENDING)
  approverId String @db.Uuid
  decidedById String? @db.Uuid
  decidedAt DateTime?
  decisionComment String?
  @@index([tenantId, approverId, status])
  @@index([tenantId, employeeId, date])
}
```

### F3. Workflow
- PENDING moves to APPROVED, REJECTED or CANCELLED (the employee cancels while PENDING).
- The approver is the employee's `reportingManagerId`. HR (tenant scope) can also decide. Self-approval is never allowed.
- APPROVED:
  - Insert REGULARIZATION punches: the IN and/or OUT, with previously conflicting punches marked SUPERSEDED.
  - LATE_EXCUSE sets `lateExcused`. WFH_FORGOT forces the effective mode to REMOTE for the date.
  - Recompute the day and notify the employee.

### F4. API
| Method and path | Permission |
|---|---|
| POST /me/attendance/regularizations | attendance.regularize.request |
| GET /me/attendance/regularizations?month | attendance.regularize.request |
| POST /me/attendance/regularizations/:id/cancel | attendance.regularize.request |
| GET /attendance/regularizations?status=PENDING | attendance.regularize.approve (scoped) |
| POST /attendance/regularizations/:id/approve {comment?} | attendance.regularize.approve |
| POST /attendance/regularizations/:id/reject {comment} | attendance.regularize.approve |

### F5. Business rules
- Maximum `maxRegularizationsPerMonth` (3) approved or pending requests per month. LATE_EXCUSE counts toward the limit.
- The date must be within `regularizationWindowDays` (7) and after the lock date, and cannot be in the future.
- `requestedOut > requestedIn`, and the span must be at most 16 h.
- A regularized day's worked time uses the web-only rule (E5) for the corrected window.

### F6. Jobs, notifications and audit
- Notifications: to the RM on create (in-app plus email); to the employee on decision.
- Pending for more than 3 days: reminder to the RM.
- Audit: `regularization.requested`, `.approved`, `.rejected`, `.cancelled`.

### F7. Integrations
None.

### F8. Validation and edge cases
- Only one PENDING request per date.
- A request for a day with approved full-day leave returns 409.
- If a biometric punch arrives after the request is created (late device sync), the request remains valid, but the approver sees "Device punches now exist" in the detail.

### F9. Phase
**P1**. Depends on People (RM) and Module E.

### F10. Acceptance scenarios
1. The employee submits MISSED_PUNCH for 24 Sep with out 18:40. The RM approves, the day becomes Present with source "Regularized", and the day is no longer counted as LOP.
2. A 4th request in the month returns 422 REGULARIZATION_LIMIT.
3. A request for a locked date returns 409.
4. LATE_EXCUSE approved: the late mark count drops by 1.

---

## Module G: ID Card Compliance

### G1. Screens and UX
- **ID card compliance** (GEN `idcompliance`, hr and admin, plus the custom "Security desk" role with `idcheck.log`).
  - Subtitle as in the wireframe.
  - Primary action: **Start today's check**. This opens check mode, a list of "In office, not yet checked" plus the ID check form, repeated per employee with scan-to-next.
  - KPIs:
    - In office today: "86 / of 128 employees".
    - Wearing ID: "81 / 94%".
    - Missing: "5 / Reminder sent".
    - Month compliance: "96% / +2% vs Aug".
  - Table columns: Employee | Department | Checked at | Wearing ID (checkbox; editable by `idcheck.log`, audited) | Photo (Taken / Skipped tag; click opens the photo if permitted) | Logged by.
  - Filters: date (default today), department, wearing (all / yes / no), location.
- **ID card check form**:
  - Employee: "Scan badge or pick". Either a QR scan through the webcam/phone camera or a USB scanner reading the signed badge token, or a search picker.
  - Wearing ID: Yes / No.
  - Photo: optional file upload or camera capture.
  - Submit "Log check", toast "Logged".
- **Employee Attendance card "ID card check"**:
  - Title: "Verified today, 09:41", "Not checked today" or "ID missing · logged 10:02".
  - Body: "Logged by {name} · photo on file" or "no photo".
  - Meta: "Compliance this month: 17 / 18 days".

### G2. Data model
```prisma
enum IdCheckMethod { BADGE_SCAN MANUAL_PICK }
model IdCardCheck {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  date DateTime @db.Date
  locationId String @db.Uuid
  checkedAt DateTime
  wearing Boolean
  photoKey String?
  method IdCheckMethod
  loggedById String @db.Uuid
  note String?
  @@unique([tenantId, employeeId, date])
  @@index([tenantId, date, wearing])
}
```

### G3. Workflow
- The first check of the day inserts a row. Later checks on the same day update it (last write wins, with the previous values kept in the audit log).
- `wearing=false`:
  - In-app reminder to the employee: "Please wear your ID card (logged 10:02 by Security desk)". The KPI caption becomes "Reminder sent".
  - If this is the employee's 3rd miss in the month, notify the RM and HR.

### G4. API
| Method and path | Permission |
|---|---|
| GET /id-checks/summary?date&locationId → KPIs | idcheck.read |
| GET /id-checks?date&departmentId&wearing&locationId | idcheck.read (Security desk sees today only) |
| GET /id-checks/pending?date&locationId (in office, not yet checked) | idcheck.log |
| POST /id-checks {employeeId? \| badgeToken?, wearing, photoUploadId?} | idcheck.log |
| PATCH /id-checks/:id {wearing, note} | idcheck.log |
| POST /id-checks/photo-uploads → presigned PUT | idcheck.log |
| GET /id-checks/:id/photo-url (5-min signed URL; audited) | idcheck.read or self |
| GET /me/id-checks/summary?month and /me/id-checks/today | idcheck.self.read |

Realtime: `idcheck.logged` to room `tenant:{t}:idcheck`, for live KPI refresh.

### G5. Business rules
- `inOfficeToday` = distinct employees with an AttendanceDay today where `effectiveMode=OFFICE` and `firstIn` is not null. The caption "of N employees" uses the active headcount.
- `wearingToday` = count of `wearing=true`. Percent = `wearing / checked` (rounded).
- `missing` = count of `wearing=false`. The "unchecked" count (`inOffice − checked`) is shown as a secondary caption.
- `monthCompliance` = Σ wearing / Σ checked in the month. The delta is shown in percentage points against the previous month.
- Employee month figure = wearing days / checked days ("17 / 18").
- The badge token is an HMAC-signed `{tenantId, employeeId, cardSerial}` issued by the ID card designer domain. A revoked card serial returns 422 BADGE_REVOKED.

### G6. Jobs, notifications and audit
- No cron. Notifications are sent on log.
- Audit: `idcheck.logged`, `idcheck.updated`, `idcheck.photo.viewed`.

### G7. Integrations
- `BadgeTokenVerifier { verify(token): {employeeId, cardSerial} }`, provided by the ID card domain. The stub accepts `DEV:{employeeId}`.
- Object storage for photos: `tenant/{t}/idcheck/{yyyy}/{mm}/{id}.webp`, retained for 90 days.

### G8. Validation and edge cases
- The employee must be in office today. If not, a warning is shown but logging is still allowed (for example, a visitor host who has not punched).
- Photo must be at most 2 MB and jpeg/png/webp. It is converted to webp.
- An employee cannot log their own check.

### G9. Phase
**P1** for manual pick and photo. **P2** for badge QR scanning, which needs ID card designer tokens. Depends on Module E (in-office determination), ID card domain and Notifications.

### G10. Acceptance scenarios
1. The Security desk logs Vikram as Wearing = No. Vikram gets an in-app reminder, the Missing KPI goes +1 and the caption shows "Reminder sent".
2. 86 employees are in office by biometric and 81 are logged yes: Wearing ID shows "81 · 94%".
3. The employee's Attendance card shows "Verified today, 09:41 · Logged by Security desk · photo on file" and "17 / 18 days".
4. A second log on the same day updates the row, and the audit log holds both versions.
5. A user without `idcheck.log` gets 403 on POST.

---

## Module H: Desktop Tracker Ingestion (server contract, shared with the Tracker domain)

### H1. Screens and UX (web side)
- **Profile → Devices** (self): the "Pair a device" field takes the 6-digit code. It lists devices (hostname, OS, app version, paired date, last seen) with a **Revoke** action.
- **HR device list** (`tracker.device.manage`): the Employees → profile Devices tab, plus pending pairing requests with **Approve** ("or approve the request HR sent to your email").
- What the tracker UI consumes (tracker-domain screens): Tracker/Summary/Settings tabs, idle dialog, screenshot toast "mapped to AT-101 · Visible to your Project Lead", tray widget, and offline banner "Offline · tracking locally · N entries queued".

### H2. Data model
```prisma
enum DeviceStatus { PENDING ACTIVE REVOKED }
model TrackerDevice {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  hostname String
  os String
  osVersion String
  appVersion String
  machineIdHash String
  status DeviceStatus
  pairingCodeHash String?
  pairingExpiresAt DateTime?
  pairedAt DateTime?
  approvedById String? @db.Uuid
  refreshTokenHash String?
  lastSeenAt DateTime?
  lastAckSeq BigInt @default(0)
  lastPolicyVersion Int?
  consentPolicyVersion Int?
  consentAt DateTime?
  @@unique([tenantId, employeeId, machineIdHash])
}
enum SegmentKind { ACTIVE BREAK IDLE }
enum IdleDecision { NA PENDING WORK BREAK IDLE }
enum ReviewStatus { NOT_REQUIRED PENDING_PL ACCEPTED REJECTED }
model ActivitySegment {                // PARTITION BY RANGE (started_at) monthly
  id String @db.Uuid                   // client-generated
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  deviceId String @db.Uuid
  attendanceDate DateTime @db.Date
  kind SegmentKind
  startedAt DateTime
  endedAt DateTime
  durationSec Int
  projectId String? @db.Uuid
  taskId String? @db.Uuid
  activityCodeId String? @db.Uuid
  idleDecision IdleDecision @default(NA)
  idleDecidedAt DateTime?
  reviewStatus ReviewStatus @default(NOT_REQUIRED)
  reviewedById String? @db.Uuid
  reviewedAt DateTime?
  outsideShift Boolean @default(false)
  inputEvents Int?                     // keyboard+mouse count only, never keystroke content
  clientSeq BigInt
  bootId String
  clockAdjusted Boolean @default(false)
  lateSync Boolean @default(false)     // arrived after the timesheet was submitted
  @@id([tenantId, id, startedAt])
  @@index([tenantId, employeeId, startedAt])
  @@index([tenantId, taskId, attendanceDate])
}
enum ShotStatus { PENDING_UPLOAD STORED DELETED }
model Screenshot {
  id String @db.Uuid @id
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  deviceId String @db.Uuid
  capturedAt DateTime
  attendanceDate DateTime @db.Date
  segmentId String? @db.Uuid
  projectId String? @db.Uuid
  taskId String? @db.Uuid
  activityCodeId String? @db.Uuid
  objectKey String
  thumbKey String?
  width Int
  height Int
  bytes Int
  sha256 String
  blurred Boolean
  monitorIndex Int @default(0)
  status ShotStatus
  retentionUntil DateTime
  deletedById String? @db.Uuid
  deleteReason String?
  @@index([tenantId, employeeId, capturedAt])
  @@index([tenantId, projectId, capturedAt])
}
model ActivityCode { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; code String; name String; projectScoped Boolean @default(false); billable Boolean @default(false); isActive Boolean @default(true)
  @@unique([tenantId, code]) }  // seeded: INT-MTG "Meetings & stand-up", INT-CR "Code review" (projectScoped), INT-GEN "General / unallocated"
model TrackerSyncBatch { id String @db.Uuid @id; tenantId String @db.Uuid; deviceId String @db.Uuid; fromSeq BigInt; toSeq BigInt; receivedAt DateTime; accepted Int; rejected Int; rejectedDetail Json?
  @@index([tenantId, deviceId, receivedAt]) }
```

### H3. Workflows
- **Pairing**:
  1. The tracker signs in (`POST /auth/device-login` with workspace, email and password; SSO in P2) and receives a 5-minute user token.
  2. `POST /tracker/v1/devices {hostname, os, osVersion, appVersion, machineIdHash}` creates a PENDING device and returns a 6-digit code (10-minute TTL) and a `deviceId`. HR also gets an approval email.
  3. The user enters the code in Profile → Devices (`POST /me/devices/pair`), or HR approves. The device becomes ACTIVE.
  4. The device polls `GET /tracker/v1/devices/:id/status` every 3 s. When ACTIVE it receives a `deviceToken` (15-minute JWT with a `tid`/`eid`/`did` claim) and a refresh token (30 days, rotating).
  5. The consent screen ("Permissions: activity monitor, screen capture") is confirmed with `POST /tracker/v1/consent {policyVersion}`.
  - Maximum 2 ACTIVE devices per employee (configurable).
- **Device lifecycle**: PENDING, then ACTIVE, then REVOKED (user "Sign out & unpair", user revoke, HR revoke, or employee exit).
  - Revoke kills tokens and pushes `tracker.command {type:"UNPAIR"}`.
  - The device keeps unsynced data encrypted locally until a re-pair by the same employee.
- **Tracker runtime** (the server's view):
  - `bootstrap` provides the policy, trackerMode, punch state, tasks and activity codes.
  - Punch uses `POST /tracker/v1/punches`.
  - Segments stream through `/sync` every 60 s when online (batch at most 500 items).
  - Screenshots use metadata, then a presigned PUT, then complete.
  - Heartbeat every 60 s.
- **Idle decision flow**: the tracker creates an IDLE segment from `lastInputAt` when inactive time reaches `autoIdleMinutes`. The decision is recorded with `/sync` `idleDecisions[]`:
  - WORK ("I was working (meeting / call)"): counted in worked minutes provisionally, `reviewStatus=PENDING_PL`, shown as "Idle marked as work · sent for PL review".
  - BREAK: reclassified as break.
  - IDLE ("Mark as idle & resume"): deducted.
  - If still PENDING after 24 h, or at timesheet submit, it auto-resolves to IDLE.
- **"Add to weekly timesheet"** (Daily summary): `POST /tracker/v1/days/:date/confirm`. This flushes the queue, marks the day confirmed, and triggers `timesheet.build`. Aggregation also runs automatically, so the button is a confirmation, not a requirement.

### H4. API (device-token auth unless noted)
| Method and path | Purpose |
|---|---|
| POST /auth/device-login | user credentials, returns short user token (rate-limited 5/min/IP) |
| POST /tracker/v1/devices | create pairing request |
| GET /tracker/v1/devices/:id/status | poll pairing |
| POST /tracker/v1/token/refresh | rotate tokens |
| POST /tracker/v1/consent {policyVersion} | record monitoring consent |
| GET /tracker/v1/bootstrap | {employee{name,empCode}, shift, effectiveMode, trackerMode, policy{version,autoIdleMinutes,screenshotIntervalMinutes,blur,breakReminderMinutes,offlineRetentionDays,screenshotsEnabled}, punchState, tasks[{id,key:"AT-101",title,projectId,projectName}], activityCodes[], serverTime} |
| GET /tracker/v1/policy (ETag) and GET /tracker/v1/tasks (ETag) | refresh |
| POST /tracker/v1/punches {clientEventId, intent, occurredAt, monoMs, bootId} | 201 {punchState}; 403 as in web; 409 STATE_CONFLICT returns server state |
| POST /tracker/v1/sync | see payload below |
| POST /tracker/v1/screenshots {id, capturedAt, segmentId, taskId?, activityCodeId?, sha256, bytes, width, height, blurred, monitorIndex} | returns {uploadUrl (PUT, 5 min), objectKey} or 409 DUPLICATE (already stored) |
| POST /tracker/v1/screenshots/:id/complete | verify object exists and sha matches, then STORED |
| POST /tracker/v1/heartbeat {state, activeTaskId, lastInputAt, queueDepth, appVersion} | updates lastSeenAt; response carries policyVersion and a pending command |
| POST /tracker/v1/days/:date/confirm | "Add to weekly timesheet" |
| DELETE /tracker/v1/devices/self | unpair |
| POST /me/devices/pair {code} | web, tracker.device.pair.self |
| GET /me/devices, DELETE /me/devices/:id | web, self |
| GET /tracker/devices?employeeId&status, POST /tracker/devices/:id/approve, POST /tracker/devices/:id/revoke | tracker.device.manage |
| GET /me/screenshots?date | self (employee sees own) |
| GET /timesheets/:id/screenshots?date&taskId&cursor | screenshot.view.* (scoped) |
| GET /screenshots/:id/url | 5-min signed URL; audited `screenshot.viewed` |
| DELETE /screenshots/:id {reason} | screenshot.delete |

**Sync payload:**
```
{ deviceId, batchId(uuid), fromSeq, toSeq, deviceNow, monoMs, bootId,
  segments:[{id, kind, startedAt, endedAt, taskId?, activityCodeId?, inputEvents?, seq}],
  idleDecisions:[{segmentId, decision: WORK|BREAK|IDLE, decidedAt}],
  taskSwitches?:[{at, taskId}] }
→ { ackSeq, rejected:[{id, reason: TOO_OLD|PERIOD_LOCKED|OVERLAP|NO_SESSION|INVALID}], serverTime, punchState, policyVersion, tasksVersion }
```

Socket.IO namespace `/tracker` (device-token auth), rooms `device:{id}`, `user:{id}` and `tenant:{t}:policy:{audience}`. Events: `attendance.state`, `tracker.policy.updated`, `tracker.tasks.updated`, `tracker.command {FORCE_SYNC|UNPAIR|PUNCH_OUT}`.

### H5. Business rules
- **Idempotency**: segment `id` and screenshot `id` are client UUIDs. Re-sent items are upserted with no double counting. `ackSeq` is the highest contiguous seq persisted, and the device deletes local rows at or below `ackSeq`.
- **Clock**: `skew = serverNow − deviceNow` at sync.
  - If `|skew| > 120 s`, timestamps for events with the same `bootId` are shifted by `skew`, and `clockAdjusted` is set.
  - If the monotonic clock goes backwards within the same `bootId`, the batch is rejected as INVALID.
- **Session constraint**: ACTIVE, BREAK and IDLE segments must fall inside an ACCEPTED WorkSession (±2 min tolerance).
  - In MONITOR_ONLY mode, the session is the biometric window.
  - Segments outside any session are rejected as NO_SESSION, unless `outsideShift` is set and a session exists (then they are accepted, flagged, and sent to PL review).
- **Overlap**: segments of the same employee cannot overlap across devices. The later-synced overlapping portion is rejected with OVERLAP (two laptops cannot double count).
- **Age**: `startedAt < now − offlineRetentionDays` or at/before the lock date is rejected. Rejected items are listed for HR under `GET /tracker/sync-rejections`.
- **Screenshots**:
  - Taken only while the state is ACTIVE (never during break or idle).
  - Interval = `screenshotIntervalMinutes` (optional ±60 s jitter; off by default).
  - WebP, max 1920 px wide, quality 60, max 1.5 MB.
  - Blur is applied on the client before upload when the policy says so; the server never receives the unblurred image.
  - Task mapping = the segment's task at `capturedAt`.
  - A 320 px thumbnail is generated server-side.
  - Object key: `tenant/{t}/shots/{yyyy}/{mm}/{dd}/{employeeId}/{id}.webp`.
  - `retentionUntil = capturedAt + screenshotRetentionDays`.
- **Expected-shots metric** (reviewer hint): `expected = floor(activeMinutes / interval)`. A shortfall above 20% is flagged "Screenshots missing (possible tracker tamper or offline)".
- **Outside shift**: `outsideShift = startedAt < expectedStart − 30min || endedAt > expectedEnd + 30min`. Split at the boundary.
- **Screenshot visibility** (ACL resolved at request time):
  - The employee sees their own.
  - The L1 PL sees shots whose `projectId` is a project they lead, for employees in that project.
  - The RM sees their reports' shots.
  - Admin sees all.
  - HR gets none by default.
  - The super-admin gets none.

### H6. Jobs, notifications and audit
- Jobs:
  - `tracker.sync-process`: sync writes synchronously in a transaction, then enqueues `attendance.recompute-day` and `timesheet.build` for the affected dates.
  - `screenshot.thumbnail`.
  - `screenshot.retention-purge`: daily 02:00. Deletes the object and marks the row DELETED.
  - `tracker.idle-autoresolve`: hourly.
  - `tracker.offline-watch`: every 5 min. If a remote employee is IN with `trackerRequired` and there has been no heartbeat for 30 min, notify the employee "Desktop tracker is not running". At 2 h, notify the PL. The notice mentions that tracking stopped.
  - `tracker.pairing-expire`.
- Audit: `tracker.device.paired`, `.approved`, `.revoked`, `tracker.consent.recorded`, `screenshot.viewed` (viewer, screenshot, employee), `screenshot.deleted`, `tracker.sync.rejected` (summary).

### H7. Integrations
- `ObjectStorageAdapter { presignPut(key, contentType, maxBytes, ttl), presignGet(key, ttl), head(key), delete(key) }`. MinIO in dev; P3 adds SSE with a per-tenant DEK.
- `ImageProcessor { thumbnail(buffer) }` using sharp.

### H8. Validation and edge cases
- Tasks deleted or unassigned after capture: keep the `taskId` with the snapshot label (the task title is snapshotted into the TimesheetLine).
- Device paired to employee A and later signed in as B: tokens are device + employee bound, so the device must re-pair.
- Tracker running while the employee is on approved full-day leave: punch returns 409 ON_LEAVE.
- Multiple monitors: one Screenshot per monitor per tick, sharing `capturedAt`. The count KPI counts distinct ticks.
- Upload never completed: after 24 h, PENDING_UPLOAD rows are purged.

### H9. Phase
**P1**: pairing, bootstrap, punches, sync, screenshots, idle decisions, policy push. **P2**: SSO device login, remote PUNCH_OUT command, expected-shots anomaly flag. **P3**: per-tenant key encryption of screenshots, plan gating. Depends on the Tracker app (client), Projects/Tasks (assignable tasks), Storage, RBAC and Module D.

### H10. Acceptance scenarios
1. Pair: the device gets code 482719, the user enters it in Profile → Devices, the device status becomes ACTIVE, and bootstrap returns policy v1 with autoIdle 5 and interval 10.
2. Offline for 3 h: the device queues 18 segments and 18 shots. On reconnect, `/sync` returns `ackSeq` = last, re-sending the same batch creates no duplicates, and the attendance day and timesheet update.
3. Idle for 7 minutes, choose "I was working": the segment has `decision WORK` and `PENDING_PL`, it is counted in worked minutes, and it appears in the PL review list. PL rejection moves it to the idle total and the day is recomputed.
4. A screenshot at 10:10 while on AT-101 has `taskId` AT-101. The PL of Atlas CRM can open it (a view audit row is written). An HR user gets 403, and a PL of another project gets 403.
5. With blur enabled, an uploaded shot is stored with `blurred=true` (the client is responsible). The purge job deletes shots older than 90 days.
6. Segments 8 days old are rejected TOO_OLD. Segments in a locked month are rejected PERIOD_LOCKED, and the HR sync-rejections list shows them.

---

## Module I: Biometric Device Integration (ZKTeco ADMS push)

### I1. Screens and UX
- Work locations → location drawer → **Biometric devices** tab (hr and admin). Columns: Device name | Serial no. | Model / firmware | Direction mode | Last seen | Status (Online / Offline / Unregistered). Actions: Register device, Edit, Disable, View raw logs.
- Employee profile → Attendance: "Biometric PIN" field (from the People edit form) or an enrollment list.
- Unregistered devices that call in appear in "Pending devices" with Claim (enter SN and name).

### I2. Data model
```prisma
// public schema, NOT RLS — SN routing
model BiometricDeviceRegistry { serialNumber String @id; tenantId String @db.Uuid; deviceId String @db.Uuid; createdAt DateTime @default(now()) }
model UnclaimedBiometricDevice { serialNumber String @id; firstSeenAt DateTime; lastSeenAt DateTime; ip String; model String? }
enum DirectionMode { DEVICE_STATUS ALTERNATE FIRST_LAST }
model BiometricDevice {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  serialNumber String
  name String
  locationId String @db.Uuid
  model String?
  firmware String?
  directionMode DirectionMode @default(FIRST_LAST)
  timezone String @default("Asia/Kolkata")
  commKeyHash String?
  allowedIpCidr String?
  attLogStamp String? // last ATTLOG stamp acknowledged
  lastSeenAt DateTime?
  status String       // ACTIVE|DISABLED
  @@unique([tenantId, serialNumber])
}
model BiometricEnrollment { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; employeeId String @db.Uuid; pin String; deviceId String? @db.Uuid
  @@unique([tenantId, pin]) @@unique([tenantId, employeeId]) }
model BiometricRawLog {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  deviceId String @db.Uuid
  pin String
  punchedAtLocal String       // "2026-09-29 09:41:07"
  punchedAt DateTime
  statusCode Int?
  verifyCode Int?
  workCode String?
  raw String
  receivedAt DateTime @default(now())
  processed Boolean @default(false)
  punchId String? @db.Uuid
  error String?               // UNKNOWN_PIN|DUPLICATE|PERIOD_LOCKED
  @@unique([tenantId, deviceId, pin, punchedAtLocal])
  @@index([tenantId, processed])
}
```

### I3. Workflow (ADMS / iclock protocol)
Host: `adms.hrms.app` (a global host; the tenant comes from the SN registry).

| Request | Handling |
|---|---|
| `GET /iclock/cdata?SN=…&options=all` (handshake) | Unknown SN: upsert into UnclaimedBiometricDevice and return `OK` with no options (logs are ignored until claimed). Known SN: return the config text (`GET OPTION FROM: {SN}\nATTLOGStamp={stamp}\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nTimeZone=5.5`). |
| `POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…` | Body is lines `PIN\tYYYY-MM-DD HH:mm:ss\tstatus\tverify\tworkcode\t…`. Insert into BiometricRawLog (dedupe on the unique key), update the stamp, and reply `OK: {n}`. Processing: map PIN to employee, convert to UTC using `device.timezone`, create an AttendancePunch (source BIOMETRIC, `clientEventId = SN|PIN|ts`, location = device location), then recompute and push `attendance.state`. |
| `POST /iclock/cdata?table=OPERLOG` / `BIODATA` | Stored raw, ignored (P2: user sync). |
| `GET /iclock/getrequest?SN=…` | Heartbeat. Update `lastSeenAt` and return a pending command (P2: `C:{id}:DATA QUERY ATTLOG StartTime=…`, `C:{id}:REBOOT`) or `OK`. |
| `POST /iclock/devicecmd?SN=…` | Command acknowledgement. |

All responses are `text/plain`. Security:
- Optional IP CIDR allowlist and comm key.
- Rate limit 60 req/min per SN.
- Anything outside the registry is refused.

### I4. API (web admin)
| Method and path | Permission |
|---|---|
| GET /biometric/devices?locationId | biometric.device.manage |
| POST /biometric/devices {serialNumber, name, locationId, directionMode, timezone, allowedIpCidr?} (also writes the registry row, globally unique SN, else 409) | biometric.device.manage |
| PATCH /biometric/devices/:id | biometric.device.manage |
| DELETE /biometric/devices/:id | biometric.device.manage |
| GET /biometric/unclaimed | biometric.device.manage |
| GET /biometric/devices/:id/raw-logs?from&to&error | biometric.device.manage |
| POST /biometric/raw-logs/reprocess {ids[] \| deviceId, from} (after fixing a PIN mapping) | biometric.device.manage |
| GET /biometric/enrollments, PUT /biometric/enrollments/:employeeId {pin} | biometric.device.manage |
| POST /biometric/devices/:id/commands {type: RESYNC_LOGS\|REBOOT} (P2) | biometric.device.manage |
| POST /dev/biometric/simulate {serialNumber, pin, at} (dev and test builds only) | admin |

### I5. Business rules
- Direction modes as in E3.
- Duplicate taps within 60 s are SUPERSEDED.
- A device with a clock error (log time more than 10 min in the future) has the log clamped to `receivedAt` with the error flag `DEVICE_CLOCK`, and HR is alerted.
- An UNKNOWN_PIN raw log stays unprocessed. HR sees the error count and reprocesses after enrolling.

### I6. Jobs, notifications and audit
- Jobs:
  - `biometric.process-raw`: on receipt, per tenant.
  - `biometric.device-health`: every 5 min. During working hours (06:00–22:00 IST), a device silent for more than 30 min makes HR and admin get an in-app plus email "Biometric device Ahmedabad HQ – Entrance offline since 10:12".
  - Daily digest of unknown PINs.
- Audit: `biometric.device.registered`, `.updated`, `.deleted`, `biometric.enrollment.changed`, `biometric.logs.reprocessed`.

### I7. Integrations
```
interface BiometricPushAdapter {
  vendor: 'zkteco-adms' | 'mock';
  handshake(sn: string, q: Record<string,string>, device?: BiometricDevice): string;
  parseAttLog(body: string): { pin: string; localTs: string; status?: number; verify?: number; workCode?: string; raw: string }[];
  nextCommand(sn: string): Promise<string | null>;
  ackCommand(sn: string, body: string): Promise<void>;
}
interface BiometricPullAdapter { fetchLogs(device, since: Date): Promise<RawPunch[]> } // P3 (eSSL/Hikvision)
```
- The ZKTeco ADMS adapter is real.
- The mock is a CLI "device emulator" script that performs the handshake and posts ATTLOG to `/iclock`, plus the `/dev/biometric/simulate` endpoint.

### I8. Validation and edge cases
- Power loss makes the device batch-upload a backlog of old logs. They are accepted if after the lock date, otherwise marked PERIOD_LOCKED.
- The same SN claimed by two tenants: the registry has the SN as primary key, so the second claim gets 409 and platform support is needed.
- A PIN reused after an employee exits: the enrollment is deleted when the employee exits (event `employee.exited`).
- An office employee on WFH (approved regularization) who taps anyway: the punch is still accepted, and the day's effective mode becomes OFFICE.

### I9. Phase
**P1** (Lexisora HQ needs it). P2 adds commands and user sync. P3 adds plan gating (Enterprise) and pull adapters. Depends on Module A, People (PIN) and Module E.

### I10. Acceptance scenarios
1. Emulator handshake with an unregistered SN: the device appears in Unclaimed. HR claims it to Ahmedabad HQ, the next handshake returns the options text, and the stamp is persisted.
2. ATTLOG `142\t2026-09-29 09:41:07\t0\t1` for PIN 142 → Priya: an AttendancePunch is created at 04:11:07Z (source BIOMETRIC) and her web card shows "Punched in" live.
3. Re-posting the identical ATTLOG changes nothing (dedupe), and the reply is still `OK: 1`.
4. An unknown PIN produces error UNKNOWN_PIN. After HR enrolls the PIN and reprocesses, the punch is created.
5. No heartbeat for 31 min at 11:00: HR receives the offline alert.

---

## Module J: My Timesheet

### J1. Screens and UX
- **My timesheet** (ALL). Header: "Week of 21 – 27 Sep 2026 · hours come from the desktop tracker, edits need a reason."
  - Week navigator (‹ ›) and a period picker.
  - When `splitAtMonthEnd` applies, the header reads "Period 28 – 30 Sep (month-end split)" and out-of-period day columns are greyed.
- **Buttons**:
  - **Log outside-hours task** (secondary).
  - **Submit for approval** (primary). It changes to "Submitted" (disabled), "Resubmit" (when RETURNED) or "Approved".
- **Approval chain chips**: Employee → Project Lead → Reporting Manager → Payroll.
  - Tones: completed = accent, current = outline, future = neutral.
  - The Project Lead chip tooltip lists PL names per project and their states (for example "Arjun Mehta · approved").
- **Returned banner**: "Sent back by Arjun Mehta: '…comment…'".
- **Grid**:
  - Columns: Task (title "AT-101 Invoice PDF export", subtitle "Atlas CRM · Billing") | Mon…Sun (`H:MM`, "–" for 0) | Total.
  - Rows are task lines plus activity lines (for example "Code review · Atlas CRM", "Stand-up & meetings · Internal").
  - Fixed rows: **Auto-idle deducted** (read-only, per day, total "2:00") and **Total worked** (spec addition).
  - Cell markers: a dot for manual adjustment (tooltip shows tracked, adjusted and reason); a clock icon for idle-as-work (pending PL); an "OH" tag for outside-hours minutes.
  - Clicking a cell (DRAFT or RETURNED only) opens a popover: Tracked (read-only), New value (H:MM), Reason (required, at least 10 chars), Save.
  - "Add line" (spec addition): pick project → task (from my assignments) or an activity code, for manual time.
  - An "Unallocated" line appears if tracker time had no task. The employee uses "Move time" to reallocate it; a reason is required but the change is not flagged.
- **Log outside-hours task form**: Task (text), Project (select, my projects), Date, From (time), To (time), Reason (textarea). Submit "Log hours", toast "Added for PL review".
  - The entry shows in the grid on its day in the matching line (or a new line), tagged "OH · pending PL".
- **Submit toast**: "Timesheet sent to Arjun Mehta (Project Lead)". With several PLs: "Sent to 2 Project Leads".
- **Dashboard pending to-do** gets an auto item "Submit timesheet for 21–27 Sep · Today" when due.
- **Alerts row**: "Timesheet for 21–27 Sep awaiting your submission".

### J2. Data model
```prisma
enum TimesheetStatus { DRAFT SUBMITTED PENDING_RM APPROVED RETURNED LOCKED }
model Timesheet {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  weekStart DateTime @db.Date       // Monday
  periodStart DateTime @db.Date     // = weekStart unless month-split
  periodEnd DateTime @db.Date
  status TimesheetStatus @default(DRAFT)
  cycle Int @default(0)             // increments on each submit
  submittedAt DateTime?
  approvedAt DateTime?
  lockedAt DateTime?
  payrollRunId String? @db.Uuid
  trackedMinutes Int @default(0)
  adjustmentMinutes Int @default(0)
  outsideHoursMinutes Int @default(0)
  idleAsWorkMinutes Int @default(0)
  idleMinutes Int @default(0)
  totalMinutes Int @default(0)
  screenshotCount Int @default(0)
  hasLateData Boolean @default(false)
  version Int @default(1)
  @@unique([tenantId, employeeId, periodStart])
  @@index([tenantId, status])
}
model TimesheetLine {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  timesheetId String @db.Uuid
  projectId String? @db.Uuid
  taskId String? @db.Uuid
  activityCodeId String? @db.Uuid
  labelSnapshot String              // "AT-101 Invoice PDF export"
  subLabelSnapshot String           // "Atlas CRM · Billing"
  billable Boolean
  isManual Boolean @default(false)
  @@unique([timesheetId, projectId, taskId, activityCodeId])
}
model TimesheetCell {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  lineId String @db.Uuid
  date DateTime @db.Date
  trackedMinutes Int @default(0)     // ACTIVE segments
  idleAsWorkMinutes Int @default(0)  // not REJECTED
  outsideHoursMinutes Int @default(0) // accepted/pending manual OH entries
  adjustmentMinutes Int @default(0)  // signed Σ adjustments
  finalMinutes Int @default(0)       // sum of the above, >= 0
  @@unique([lineId, date])
}
model TimesheetIdleDay { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; timesheetId String @db.Uuid; date DateTime @db.Date; idleMinutes Int
  @@unique([timesheetId, date]) }
model TimesheetAdjustment {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  timesheetId String @db.Uuid
  cellId String @db.Uuid
  fromMinutes Int
  toMinutes Int
  deltaMinutes Int
  kind String       // MANUAL_INCREASE|MANUAL_DECREASE|REALLOCATION
  reason String
  reviewStatus ReviewStatus @default(NOT_REQUIRED)  // PENDING_PL for MANUAL_INCREASE
  createdById String @db.Uuid
  createdAt DateTime @default(now())
}
model OutsideHoursEntry {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  employeeId String @db.Uuid
  timesheetId String @db.Uuid
  projectId String @db.Uuid
  taskId String? @db.Uuid
  taskText String
  date DateTime @db.Date
  startAt DateTime
  endAt DateTime
  minutes Int
  reason String
  reviewStatus ReviewStatus @default(PENDING_PL)
  reviewedById String? @db.Uuid
  reviewedAt DateTime?
  reviewComment String?
  @@index([tenantId, timesheetId])
}
model TimesheetEvent { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; timesheetId String @db.Uuid; type String; actorId String @db.Uuid; level Int?; projectId String? @db.Uuid; comment String?; at DateTime @default(now()) }
```

### J3. Workflow and state machine
| From | Action (actor) | To | Side effects |
|---|---|---|---|
| (none) | first open or `timesheet.build` (system) | DRAFT | Lazily created. |
| DRAFT or RETURNED | edit cell, add line, log OH (employee) | same | Adjustment rows, recompute totals, `version++`. |
| DRAFT or RETURNED | submit (employee) | SUBMITTED | See the submit steps below. |
| SUBMITTED | recall (employee, only if no step acted yet) | DRAFT | Pending steps become CANCELLED. |
| SUBMITTED | all L1 steps approved or skipped | PENDING_RM | Notify the RM. |
| SUBMITTED or PENDING_RM | return (approver) | RETURNED | All steps of the cycle close, then notify the employee with the comment. |
| PENDING_RM | L2 approve | APPROVED | Emit `timesheet.approved`, chain "Payroll" current. |
| APPROVED | payroll run finalized (system) | LOCKED | Chain "Payroll" done. |
| APPROVED | admin reopen {reason} | RETURNED | Only if not LOCKED. |

Submit steps:
1. Validate the timesheet.
2. Auto-resolve PENDING idle decisions to IDLE.
3. Snapshot totals and increment `cycle`.
4. Create approval steps (Module K) and notify the approvers.
5. Emit `timesheet.submitted`.

Chain UI mapping:
- DRAFT: Employee chip is outline.
- SUBMITTED: Employee accent, PL outline.
- PENDING_RM: PL accent, RM outline.
- APPROVED: RM accent, Payroll outline.
- LOCKED: all accent.
- RETURNED: Employee outline with a returned banner.

### J4. API
| Method and path | Permission |
|---|---|
| GET /me/timesheets?from&to (list with status) | timesheet.self.read |
| GET /me/timesheets/by-week/:weekStart (returns 1–2 periods; creates DRAFT lazily) → {id, period, status, chain[], lines[{id,label,subLabel,cells[7]{date,final,tracked,flags}}], idleRow[7], totals, flags{pendingIdleAsWork,outsideHours,manualIncrease}, returnedComment, version} | timesheet.self.read |
| PUT /me/timesheets/:id/cells {lineId, date, minutes, reason, expectedVersion} | timesheet.self.write |
| POST /me/timesheets/:id/reallocate {fromLineId, toLineId, date, minutes, reason} | timesheet.self.write |
| POST /me/timesheets/:id/lines {projectId?, taskId?, activityCodeId?} | timesheet.self.write |
| DELETE /me/timesheets/:id/lines/:lineId (manual lines with 0 tracked) | timesheet.self.write |
| POST /me/timesheets/:id/outside-hours {taskText, projectId, taskId?, date, from, to, reason} | timesheet.self.write |
| PATCH /me/outside-hours/:id, DELETE /me/outside-hours/:id (DRAFT or RETURNED) | timesheet.self.write |
| POST /me/timesheets/:id/submit {expectedVersion} | timesheet.self.submit |
| POST /me/timesheets/:id/recall | timesheet.self.submit |
| GET /timesheets?employeeId&periodFrom&status (HR/payroll view, hours only) | timesheet.read.all |
| POST /timesheets/:id/reopen {reason} | timesheet.approve.override |
| GET /internal/timesheets/billable-hours?projectId&from&to (approved only; consumed by Invoices and Projects "Estimated vs logged") | internal |
| GET /internal/timesheets/payroll-status?month | internal |

Realtime: `timesheet.updated {id, status}` to `user:{employeeId}`.

### J5. Business rules and calculations
- **Aggregation** (`timesheet.build`, debounced 10 s per employee-week):
  - `tracked(line, date)` = Σ ACTIVE segment seconds for (task or activity) on that local date, / 60, rounded per segment to the nearest minute.
  - `idleAsWork` = Σ IDLE with `decision WORK` and `review != REJECTED`.
  - Idle row = Σ IDLE (decision IDLE or pending) on that date.
  - For employees without a tracker (biometric/web only), `tracked = 0` and lines are manual. In that case no reason is required when the day's Σ final ≤ that day's attendance `workedMinutes`; a reason is required above it.
- `final = tracked + idleAsWork + outsideHours + adjustment`, and must be ≥ 0.
- `totalMinutes` = Σ final. Worked (as shown to approvers) = totalMinutes. Idle = Σ idle row.
- **Edit classification**:
  - A day-total increase above `(tracked + idleAsWork + OH)` is MANUAL_INCREASE and goes to PENDING_PL.
  - A decrease is MANUAL_DECREASE (informational).
  - A same-day move between lines is REALLOCATION.
- **Period**: weeks run Monday to Sunday. With `splitAtMonthEnd`, a week crossing months becomes two timesheets (for example 28–30 Sep and 1–4 Oct). Grid columns outside the period are disabled.
- **Required**: `policy[audience].timesheetRequired` and `employmentType != INTERN` (interns use Intern task sheets). The CEO (no RM, with `timesheetRequired` off by the role-level override) is exempt.
- **Submit allowed** when `now ≥ periodEnd's last working day at 15:00 local` (or any time for a past period). Due: next `submitDueWeekday` at `submitDueMinute` (Mon 12:00).
- **Outside-hours entries**: minutes = `endAt − startAt`, where the range is ≥ 15 min and ≤ 12 h, not crossing midnight (the user splits it). A weekly-off or holiday entry ≥ 240 min that PL accepts emits `compoff.eligible` (subject to leave policy).

### J6. Jobs, notifications and audit
- Jobs:
  - `timesheet.build`.
  - `timesheet.reminders`: Fri 17:00 and Mon 10:00 IST, in-app plus email to employees with a DRAFT required period, "Timesheet for 21–27 Sep awaiting your submission".
  - `timesheet.overdue`: Mon 12:00. Notifies the RM with a list of overdue reports.
  - `timesheet.late-data`: segments arriving for a SUBMITTED or PENDING_RM sheet set `hasLateData` and re-aggregate. The approver sees the banner "38 min synced after submission", and the totals shown are live. For APPROVED or LOCKED sheets, the segments are stored with `lateSync` and excluded, and HR gets a digest.
- Audit: `timesheet.cell.adjusted` (from/to/reason), `timesheet.line.added`, `outside_hours.logged`, `.updated`, `.deleted`, `timesheet.submitted`, `.recalled`, `.reopened`.

### J7. Integrations
- `TaskDirectory` (Projects domain):
  - `listAssignable(employeeId, date)`
  - `getTask(id) → {key, title, projectId, moduleName, billable}`
  - `getProjectLead(projectId, atDate)`
  - `isMember(employeeId, projectId)`

### J8. Validation and edge cases
- A day's Σ final is at most 1440.
- Future dates cannot be edited.
- A cell on a LEAVE day produces a warning but is allowed. A cell on a MISSED_PUNCH day blocks submit until that day is regularized, unless the day's total is 0.
- Remaining "Unallocated" minutes block submit (422 UNALLOCATED_TIME).
- An outside-hours entry overlapping tracked segments or another entry returns 422 OVERLAP.
- The project must be one the employee is a member of on that date.
- Version conflict returns 409.
- Submitting an empty timesheet (0 minutes) requires confirmation "No hours recorded".
- Employee exits mid-week: the period ends at the exit date.

### J9. Phase
**P1**. P2 adds recall, copy-last-week for manual users, and a CSV export. Depends on Projects/Tasks, Module H, Module E and Leave.

### J10. Acceptance scenarios
1. Tracker data for 21–25 Sep (AT-101 20:30, AT-103 15:00, Code review 3:30, Stand-up 2:30, idle 2:00) matches the wireframe grid exactly, and the idle row total is 2:00.
2. Edit AT-101 Mon from 4:00 to 4:30 without a reason: 422. With a reason: saved, marked with a dot, flagged MANUAL_INCREASE for PL review.
3. Log an outside-hours task for Sat 26 Sep 10:00–12:00 on Atlas CRM: shows 2:00 on Sat tagged OH pending, and the toast is "Added for PL review".
4. Submit: status SUBMITTED, Employee chip accent, the toast names the PL, and the PL's approvals count goes +1 in real time.
5. The week 28 Sep – 4 Oct has two periods. Submitting 28–30 Sep on 30 Sep at 15:00 is allowed.
6. Remaining unallocated minutes block submit with 422.

---

## Module K: Timesheet Approvals (Level 1 PL, Level 2 RM) and Dashboard Approval Counts

### K1. Screens and UX
- **Timesheet approvals** (lead, manager and admin by permission). Subtitle as in the wireframe.
- **Segmented tabs**: "Level 1 · Project Lead · {n}" (with `timesheet.approve.l1`) and "Level 2 · Reporting Manager · {n}" (with `.l2`).
  - Admin with override also gets an "All pending" tab.
  - Spec additions: a "History" filter (Approved / Returned by me) and a week filter.
- **Left list row**:
  - Name (heading font), status tag ("Pending PL", "Pending RM", "Returned", "Approved").
  - "{week} · {hours} worked · {idle} idle", "{n} shots".
  - A flag icon with a count if there are items to review.
  - Empty state: "Nothing waiting at this level."
- **Right detail card**:
  - Kicker = week, title = name. Buttons **Send back** (secondary) and **Approve** (primary).
  - KPIs: Worked | Auto-idle | Screenshots.
  - **Per-task breakdown** (spec addition): line × day grid, same as the employee view. For L1, it is limited to the approver's project lines, and other projects' lines are collapsed as "Other projects: 12:30 (not in your review)".
  - **Items needing review**: outside-hours entries, idle marked as work, and manual increases. Each has Accept / Reject toggles (default Accept) and a hover note showing the employee's reason.
  - **"Screenshots mapped to tasks · every 10 min"** grid (4 columns):
    - Each thumbnail is captioned "10:00 · AT-101".
    - Filters: day and task. Paginated at 24 per page.
    - Click opens a lightbox with prev/next. Idle gaps are shown as "no capture (idle/break)".
  - **Comment to employee** textarea: optional on approve, required on Send back.
  - Toasts: "{name} → forwarded to Reporting Manager", "{name} → approved, sent to payroll", "{name} → sent back with comment".
- **Dashboard "Awaiting your approval" card**:
  - Shown when the user has any approval permission.
  - Rows: Timesheets = count of distinct timesheets with a PENDING step where approver = me; Time-off requests (Leave domain); Helpdesk escalations (Helpdesk domain); Attendance corrections (Module F).
  - "Review now" goes to approvals.
  - Live-updated via `approvals.counts`.

### K2. Data model
```prisma
enum StepStatus { PENDING APPROVED RETURNED SKIPPED_SELF SKIPPED_DUPLICATE SKIPPED_NO_LINES CANCELLED }
model TimesheetApprovalStep {
  id String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  timesheetId String @db.Uuid
  cycle Int
  level Int                        // 1 | 2
  projectId String? @db.Uuid       // L1 per project; null at L2
  approverId String @db.Uuid
  status StepStatus @default(PENDING)
  actedById String? @db.Uuid       // differs if admin override / delegate
  actedAt DateTime?
  comment String?
  dueAt DateTime
  escalatedAt DateTime?
  @@unique([timesheetId, cycle, level, projectId])
  @@index([tenantId, approverId, status])
}
model ApprovalDelegation { id String @id @default(uuid()) @db.Uuid; tenantId String @db.Uuid; fromUserId String @db.Uuid; toUserId String @db.Uuid; scope String; startsOn DateTime @db.Date; endsOn DateTime @db.Date }  // P2
```

### K3. Workflow
**On submit (cycle c):**
1. For each distinct `projectId` among lines with final > 0 (including OH entries): approver = PL of the project at `periodEnd`.
   - If the approver is the employee: SKIPPED_SELF.
   - Otherwise: PENDING L1 step with `dueAt = now + l1SlaHours`.
2. Lines without a project (Internal activity codes) have no L1 and are reviewed at L2.
3. If no L1 steps are PENDING, go directly to L2.

**L2 creation** (once no L1 steps are PENDING):
- Approver = `employee.reportingManagerId`, or `fallbackApproverId`, or any admin.
- If `skipDuplicateApprover` is on and the RM already approved an L1 step in this cycle: SKIPPED_DUPLICATE, and the timesheet becomes APPROVED.
- If the RM is the employee (not possible) or missing: fallback.

**Approve at L1** (`POST …/approve {comment?, decisions[]}`):
1. Apply the item decisions:
   - Outside-hours entries, idle-as-work segments and manual increases scoped to this project: ACCEPTED or REJECTED.
   - A rejected OH entry is excluded from the cell. A rejected idle-as-work segment becomes idle. A rejected manual increase is reverted (adjustment reversed).
   - Recompute totals and AttendanceDays.
2. Step becomes APPROVED.
3. If all L1 steps are done, create L2 and set status PENDING_RM (toast "forwarded to Reporting Manager").
- The RM at L2 can review items that were not project-scoped (internal lines).

**Approve at L2**: step APPROVED, timesheet APPROVED, emit `timesheet.approved {timesheetId, employeeId, period, perLine[{projectId,taskId,billable,minutes}], idleMinutes}`.

**Send back** (either level, comment required): the step is RETURNED, other PENDING steps in the cycle are CANCELLED, and the timesheet is RETURNED.
- All approvals of the cycle are discarded. On the next submit (c+1), all L1 steps are recreated.
- Items previously ACCEPTED keep their decision unless edited.

**Admin override**: can act on any PENDING step (`actedById` = admin, audited as override). An admin can never approve their own timesheet.

**SLA**: when a PENDING step passes `dueAt`, remind the approver. At `dueAt + 48h`, escalate: notify the next-level approver, who may act on the L1 step on the PL's behalf (`timesheet.approve.l2` holders can act on overdue L1 steps of their reports).

**Project lead changed** (event from Projects): reassign PENDING L1 steps of that project to the new lead.

**Approve with pending flagged items**: the UI shows "Accept all 3 flagged items and approve?" and the default decision is Accept.

### K4. API
| Method and path | Permission |
|---|---|
| GET /timesheet-approvals?level=1\|2&status=PENDING\|APPROVED\|RETURNED&weekStart&cursor → rows {stepId, timesheetId, employee{name}, period label, workedMinutes, idleMinutes, screenshotCount, flagCount, status} | timesheet.approve.l1 / .l2 (approverId = me, plus overdue-escalated for L2; admin override sees all) |
| GET /timesheet-approvals/counts → {l1, l2, total} | l1 or l2 |
| GET /timesheet-approvals/:stepId → detail {timesheet summary scoped, lines, idleRow, items[{type: OUTSIDE_HOURS\|IDLE_AS_WORK\|MANUAL_INCREASE, id, date, minutes, task, reason, status}], screenshotSummary{byTask[{taskId,count}]}, history[] of TimesheetEvent, lateDataBanner} | approver of step, or override |
| GET /timesheet-approvals/:stepId/screenshots?date&taskId&cursor (thumb signed URLs, scoped as in H5) | screenshot.view.* |
| POST /timesheet-approvals/:stepId/approve {comment?, decisions:[{type,id,decision:ACCEPT\|REJECT, note?}], expectedVersion} | approver or override |
| POST /timesheet-approvals/:stepId/return {comment} | approver or override |
| POST /timesheet-approvals/bulk-approve {stepIds[]} (only steps with 0 flagged items) | P2 |
| GET /me/approvals/summary → {timesheets, regularizations, leave?, helpdesk?} (aggregator; leave/helpdesk counts from providers) | authenticated |

Realtime: `approvals.counts {timesheets, regularizations}` to `user:{approverId}` whenever steps change; `timesheet.updated` to the employee.

### K5. Business rules
- A PL sees and decides only on their project's lines, OH entries, idle-as-work and screenshots.
- Idle-as-work segments on non-project/internal activity go to the RM.
- **Screenshot count** shown = stored screenshots in the period (for L1, in the PL's project).
- **Hours shown** = totalMinutes (for L1 the row shows full worked hours, and the detail splits them by project). Idle shown = Σ idle row.
- **Payroll feed** (payroll's run form "Pending timesheets: Exclude (n) / Wait"):
  - `/internal/timesheets/payroll-status?month` lists, per employee, whether all required periods overlapping the month are APPROVED.
  - `finalIdleMinutes` (from approved sheets) replaces the tracker idle for idle deduction.
  - `payroll.run.finalized {runId, month, employeeIds}` makes the sheets LOCKED.

### K6. Jobs, notifications and audit
- Jobs: `timesheet.sla` (hourly); `approvals.counts.broadcast` (after each change).
- Notifications (in-app plus email; email has a deep link):
  - On submit: to each PL, "Priya Sharma submitted 21–27 Sep (41h 20m, 2h idle)".
  - On forward to L2: to the RM.
  - On return: to the employee with the comment.
  - On approval: to the employee, "approved · sent to payroll".
  - On escalation: to the RM and HR.
- Audit: `timesheet.step.approved`, `.returned`, `.override`, `.escalated`, `.reassigned`, and `timesheet.item.reviewed` (type, id, decision).

### K7. Integrations
- Projects `TaskDirectory.getProjectLead`.
- Notification adapter (email via SMTP/Mailpit).
- Leave and Helpdesk `ApprovalCountProvider { countPendingFor(userId): Promise<number> }`, registered in the dashboard aggregator.

### K8. Validation and edge cases
- Acting on a non-PENDING step returns 409 STEP_NOT_PENDING (double-click or two admins).
- `expectedVersion` mismatch (late data arrived) returns 409, and the UI reloads with the banner.
- A comment is required on return (at least 5 chars).
- Approver exited or deactivated: reassign to the fallback (job on `employee.exited`).
- A timesheet with lines in 3 projects needs 3 L1 steps. A timesheet where every project is led by the employee has all L1 steps SKIPPED_SELF, so it goes straight to the RM.
- The RM also being the PL (L1 approved by them): L2 is auto SKIPPED_DUPLICATE (tenant setting).

### K9. Phase
**P1** for the two-level flow, item review, screenshots and counts. **P2** for bulk approve, delegation and the history/analytics tab. Depends on Module J, Module H, Projects, People (RM), Payroll (consumes events) and the Dashboard aggregator.

### K10. Acceptance scenarios
1. Priya submits and Arjun (PL, Atlas CRM) sees her row in the L1 tab: count 1, worked 41h 20m, idle 2h 00m, 248 shots. The screenshot grid filters to AT-101 and every thumbnail is labelled with its task.
2. Arjun rejects one idle-as-work item (30 min) and approves. The worked total drops by 0:30 and the idle total rises by 0:30. The step moves to L2 (Neha), whose Dashboard count increments live. The toast is "forwarded to Reporting Manager".
3. Neha sends back with "Please split meetings time". Priya sees the RETURNED banner, edits, resubmits (cycle 2), and new L1 steps are created.
4. Neha approves at L2. The status is APPROVED, the chain shows the Payroll chip current, and `timesheet.approved` is consumed by Payroll and Projects (logged hours update).
5. A timesheet with Atlas CRM (PL Arjun) and Orbit HR (PL Neha) lines: 2 L1 steps. After both approve, L2 (RM Neha) is SKIPPED_DUPLICATE and the timesheet is APPROVED directly.
6. An L1 step overdue by 96 h: the RM receives an escalation and can approve the L1 step (audited as escalated action). An HR user gets 403 on approve.

---

## Cross-domain contracts

**Consumed:**
- **Identity/RBAC**: tenant resolution (workspace domain), user ↔ employee link, permission checks with scopes, `auth/device-login` issuing, custom role creation (for "Security desk").
- **People**: Employee `{id, empCode, name, departmentId, designation, workMode, hybridOfficeDays, workLocationId, reportingManagerId, employmentType, status, joiningDate, exitDate, biometricPin?}`. Events: `employee.created`, `employee.updated` (workMode, location, RM), `employee.exited` (revoke devices, delete enrollments, reassign approval steps).
- **Projects/Tasks**: TaskDirectory (assignable tasks, project lead, membership, billable flag). Events: `project.lead.changed`, `task.assigned`, `task.unassigned` (triggers `tracker.tasks.updated`).
- **Leave**:
  - `LeaveService.getApprovedLeave(employeeId, from, to) → [{date, fraction, typeCode, paid}]`
  - `LeaveService.debit(employeeId, typeCode, days, reason)` (late penalty)
  - Events: `leave.approved`, `leave.cancelled` (recompute days).
  - The `compoff.eligible` event emitted here is consumed by Leave.
- **ID card designer**: BadgeTokenVerifier, card revocation.
- **Notifications**: `notify(userIds, template, payload, channels[inapp,email])`, with Alerts list integration.
- **Storage** (presign), **Audit** (`audit.log(event, actor, target, diff)`), **Dashboard** aggregator (ApprovalCountProvider).

**Exposed:**
- `GET /internal/attendance/payroll-input?month` returns, per employee: `{workingDays, weeklyOffs, holidays, presentDays, paidLeaveDays, unpaidLeaveDays, lopDays, paidDays, lateMarks, latePenaltyDays, latePenaltyAppliedTo, idleMinutes, idleDeductibleMinutes, missedPunchDays, timesheetStatus: APPROVED|PENDING, pendingPeriods[], locked}`.
- `GET /internal/timesheets/billable-hours` (Invoices: GST invoice "Billable hours"; Projects: "Estimated vs logged", KPI "Billable hours (Sep)").
- Events:
  - `attendance.state.changed`
  - `attendance.day.finalized` (at lock)
  - `attendance.period.locked {month, upTo}` (Payroll pre-condition "Lock attendance before running")
  - `timesheet.submitted`, `timesheet.approved` (per-line minutes, billable), `timesheet.returned`
  - `compoff.eligible`, `idcheck.missed`
- Consumed from Payroll: `payroll.run.finalized` (lock timesheets).
- **Tracker app contract**: all `/tracker/v1/*` endpoints, Socket.IO `/tracker` events, and policy fields as listed in Module H. The Tracker domain owns the local encrypted SQLite queue, the idle detection (`powerMonitor.getSystemIdleTime ≥ autoIdleMinutes·60`), capture and blur, and the UI.

## Open questions (real ambiguities)
1. **Office staff and the tracker.** The policy matrix enables auto-idle and screenshots for office employees, but the tracker login says "Available to Remote / WFH employees". Proposed default: MONITOR_ONLY mode, where tracking starts on the biometric IN. Confirm.
2. **HYBRID mode.** The proposal is a fixed office-days weekday pattern. The alternative is geo/biometric-based detection per day. Confirm.
3. **Idle deduction method.** Default SHORTFALL_ONLY with a 0-minute allowance, or deduct all idle? The wireframe payslip figures don't pin this down.
4. **Late-mark penalty.** Is it 3 late marks = 0.5 day, taken from CL first and then LOP? Does early-out count as a late mark?
5. **HR screenshot access.** The default here is no access. Should HR see screenshots for payroll disputes?
6. **Screenshot retention.** Is 90 days the right default? Must employees be able to view their own screenshots? (Proposed: yes, since the tracker says "Visible to your Project Lead".)
7. **Month-end split of weekly timesheets.** Default ON. Or should payroll wait for the full week?
8. **Duplicate approver.** When the RM also approved as PL, auto-skip L2 (default ON)?
9. **Mobile punch.** Mobile access is enabled only for CEO/Admin/HR. Do those roles need a geo-fenced mobile punch (proposed P2), or is mobile limited to approvals and dashboards?
10. **Interns.** Are interns exempt from weekly timesheets because they use "Intern task sheets" (default exempt), while still punching attendance?

### Critical files for implementation
These are the wireframe sources this spec was derived from; no code files exist yet.
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (attendance/timesheet/approvals markup lines 383–517; NAV, GEN shifts/locations/idcompliance/settings, FORMS shift/allocate/location/idcheck/outside, and approval state lines 771–930)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html (lines 317–517: pairing, idle dialog decisions, screenshots, offline queue, HR-locked settings)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (FLOWS lines 352–362: flows 1, 2, 3 and 9)