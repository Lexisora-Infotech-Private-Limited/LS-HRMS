# Lexisora HRMS: People Domain Build Spec

Domain: Employees, Profile, Masters, Lifecycle and Exit, Digital Vault, Paperless Onboarding and E-sign, Recruitment (Jobs, Candidates, Interviews, Offers), Appraisals, Assets, Welcome Kits, ID Cards, Visiting Card.
Flow covered: "Hire to day one" (flow 05): jobs → candidates → interviews → employees → onboarding → welcomekit → assets → idcard → vcard.

---

## 0. Cross-cutting conventions (apply to every module below)

- **Base columns** on every tenant-owned model (written as `…base` below): `id String @id @default(uuid()) @db.Uuid`, `tenantId String @db.Uuid`, `createdAt DateTime @default(now()) @db.Timestamptz`, `updatedAt DateTime @updatedAt @db.Timestamptz`, `createdById String? @db.Uuid`, `deletedAt DateTime? @db.Timestamptz` (soft delete where noted). Every list index starts with `tenantId`. RLS policy: `tenant_id = current_setting('app.tenant_id')::uuid`. The Prisma client extension runs `SET LOCAL app.tenant_id` inside each transaction.
- **Dates:** business dates use `@db.Date` in Asia/Kolkata. Instants use timestamptz. Display format is "12 Jan 2024". Money is `Decimal(14,2)` in INR.
- **Sensitive columns** (PAN, Aadhaar, bank account number): stored as `Bytes` ciphertext using app-level AES-256-GCM, plus a plaintext `…Last4` column for display and search. P1 uses one platform KEK from env/KMS. P3 uses per-tenant DEKs (envelope encryption). The platform super-admin has no People permissions, and RLS blocks every tenant table for the platform role.
- **Files** use the platform `StoredFile` model: `(…base, bucket, key, mime, sizeBytes, sha256, avStatus PENDING|CLEAN|INFECTED, encKeyId?, uploadedById)`. The key layout is `t/{tenantId}/{module}/{ownerId}/{uuid}`. Upload works like this: `POST /api/v1/files/uploads` returns a presigned PUT (5 min). The client then attaches the `fileId` to a domain record. Downloads go through a permission check, then a 302 to a presigned GET (5 min). Downloads are blocked until the file is `CLEAN`.
- **RBAC:** each permission is a key plus a scope (`OWN` | `TEAM` = reporting subtree | `DEPARTMENT` | `ALL`). The 5 seeded roles get the default grants below. "Implicit OWN" means a user always has the permission on their own record.
- **Standard list API:** `?q&page&pageSize(≤100)&sort=field:asc`. The response is `{items,total,page}`. Tabs map to a `tab=` query param. The matching counts endpoint returns `{tabKey:count}`.

### Permission keys (People) and seeded defaults

| Key | employee | lead | manager | hr | admin |
|---|---|---|---|---|---|
| people.directory.basic (search, mentions: name/designation/dept/photo/email) | ALL | ALL | ALL | ALL | ALL |
| people.employee.list (Employees screen) | – | – | TEAM | ALL | ALL |
| people.employee.read (Overview/Assets/Attendance tabs) | own | own | TEAM | ALL | ALL |
| people.employee.read_sensitive (PAN, Aadhaar, bank, address, DOB) | own | own | – | ALL | ALL |
| people.employee.create / update / import | – | – | – | ALL | ALL |
| people.employee.update_self (limited fields) | own | own | own | own | own |
| people.employee.lifecycle (notice/exit/cancel/convert) | – | – | – | ALL | ALL |
| people.masters.manage | – | – | – | ✓ | ✓ |
| payroll.compensation.view (Offer & pay tab; owned by Payroll) | own | own | own | ALL | ALL |
| vault.document.read / upload | own | own | own | ALL | ALL |
| vault.document.verify | – | – | – | ✓ | ✓ |
| onboarding.self | ✓ | ✓ | ✓ | ✓ | ✓ |
| onboarding.manage (joiner tracker, templates, doc templates) | – | – | – | ✓ | ✓ |
| esign.envelope.send | – | – | – | ✓ | ✓ |
| recruitment.job.read | – | ✓ | ✓ | ✓ | ✓ |
| recruitment.job.manage | – | – | – | ✓ | ✓ |
| recruitment.candidate.read / manage | – | DEPARTMENT | – | ALL | ALL |
| recruitment.interview.read | – | DEPARTMENT + own-panel | own-panel | ALL | ALL |
| recruitment.interview.schedule | – | DEPARTMENT | – | ALL | ALL |
| recruitment.interview.score | implicit if panelist | | | | |
| recruitment.offer.manage, recruitment.hire | – | – | – | ✓ | ✓ |
| appraisal.self | ✓ | ✓ | ✓ | ✓ | ✓ |
| appraisal.review.manager (direct reports) | – | – | TEAM | ALL(read) | ALL |
| appraisal.cycle.manage / template.manage / calibrate | – | – | – | ✓ | ✓ |
| asset.read | own | own | TEAM | ALL | ALL |
| asset.manage, welcomekit.manage | – | – | – | ✓ | ✓ |
| idcard.view | own | own | own | ALL | ALL |
| idcard.template.manage / generate / print / issue | – | – | – | ✓ | ✓ |
| vcard.self | ✓ | ✓ | ✓ | ✓ | ✓ |
| vcard.template.manage | – | – | – | ✓ | ✓ |
| tracker.device.manage (others' devices; Tracker domain) | own | own | own | ALL | ALL |

The roles matrix row "Recruitment: Lead ✓, HR ✓, Admin ✓" maps to `recruitment.*` for those roles. The manager gets interview access only for panels they sit on, following the NAV for interviews.

---

## M1. Org Masters (Departments, Designations, Branches, Asset categories, Interview rounds, Kit items)

**1. Screens & UX**
- The "Masters" tab on Jobs has sub-sections: Departments, Designations, Job types (read-only enum), Branches. Each is a table with inline add, edit, and deactivate.
- Columns:
  - Departments: Name, Code, Head, Employees count, Status.
  - Designations: Name, Department (optional), Level, Employees.
  - Branches: Name, City, State, Address, Work locations, Employees.
- The same masters feed every select: Add employee (Department, Designation), Add job (Department, Branch), filters.
- Asset categories, interview round types and welcome-kit items are edited inline from their own module screens through a "Manage categories" link.

**2. Data model**
```prisma
model Department { …base  name String; code String; headEmployeeId String? @db.Uuid; parentId String? @db.Uuid; isActive Boolean @default(true)
  @@unique([tenantId, name]) @@unique([tenantId, code]) }
model Designation { …base  name String; departmentId String? @db.Uuid; level Int? ; isActive Boolean @default(true)
  @@unique([tenantId, name, departmentId]) }
model Branch { …base  name String; city String; state String; stateCode String @db.Char(2); address String; pincode String?; gstin String?; isActive Boolean @default(true)
  @@unique([tenantId, name]) }
enum EmploymentType { FULL_TIME INTERN CONTRACT PART_TIME CONSULTANT }
enum WorkMode { OFFICE REMOTE HYBRID }
enum JobType { FULL_TIME INTERNSHIP CONTRACT PART_TIME }
```
- `WorkLocation` (geo radius, punch mode) is owned by the Time domain. It carries `branchId`.
- `stateCode` feeds Professional Tax (Payroll) and GST place of supply (Finance).

**3. Workflows:** Masters have two states, Active and Inactive. Deactivation is blocked if active employees or open jobs reference the record (409 with a count). Inactive records are hidden from selects but still display on history.

**4. API** (GET for any authenticated user; writes need `people.masters.manage`)
- `GET|POST /api/v1/masters/departments`, `PATCH|DELETE /api/v1/masters/departments/:id`
- The same pattern applies to `/masters/designations`, `/masters/branches`, `/masters/asset-categories`, `/masters/interview-rounds`, `/masters/welcome-kit-items`.

**5. Rules**
- Names are case-insensitive unique (citext).
- Department code is 2 to 6 uppercase characters.
- A department `parentId` must not create a cycle.

**6. Jobs/notifications/audit:** audit `master.created|updated|deactivated`.

**8. Edge cases**
- Renaming a department keeps historical references by id.
- CSV import can auto-create missing masters only if the importer ticks "Create missing masters".

**9. Phase:** P1. No dependencies.

**10. Acceptance**
- (a) HR creates dept "Development/DEV". A duplicate "development" returns 409.
- (b) Deactivating QA with 9 active employees returns 409 with `{activeEmployees:9}`.
- (c) An employee-role user calling `POST /masters/departments` gets 403.

---

## M2. Employees Directory and Lifecycle

**1. Screens & UX**
- **Employees** (NAV: manager, hr, admin). Subtitle: "Directory of all staff and interns…".
  - Tabs with live counts from `/employees/counts`:
    - All = status ∈ {INVITED, ONBOARDING, ACTIVE, NOTICE}
    - Full-time = FULL_TIME and not exited
    - Interns = INTERN and not exited
    - Notice period = NOTICE
    - Exited = EXITED. The Exited tab has no count, per the wireframe.
  - Columns: Name (avatar and name), Emp ID, Department, Designation, Work mode (Remote/Office/Hybrid), Manager, Status.
  - Status tag mapping: ACTIVE+FULL_TIME = "Active" (accent); ACTIVE+INTERN = "Intern" (neutral); NOTICE = "Notice period" (outline); INVITED/ONBOARDING = "Onboarding" (outline); EXITED = "Exited" (neutral).
  - Clicking a row opens the Profile.
  - Filters: department, designation, manager, work mode, branch, employment type. Search covers name, Emp ID and email. CSV export is HR only.
  - A manager sees only their reporting subtree. The tab counts are scoped the same way.
  - Buttons: **Add employee** (primary) and **Import CSV** (secondary). Both are HR/admin only; they are hidden for managers.
- **Add employee modal.** Fields:
  - Full name*, Official email*, Phone*, Department*, Designation*, Reporting manager*, Employment type* (Full-time/Intern plus Contract/Part-time), Work mode* (Office (biometric) / Remote (web + desktop) / Hybrid), Joining date*, Shift* (from Time's shift master, e.g. "General 09:30–18:30"), Photo.
  - Added fields: **Personal email** (the invite destination; defaults to official email), optional Emp ID override (collapsed under "Advanced"), "Skip onboarding (existing employee)" toggle.
  - Submit: "Add & send onboarding invite". Toast: "Invite sent · ID card queued".
- **Import CSV modal.**
  - File drop, then an immediate dry-run preview table showing row, status and errors.
  - "Download template" link, "Create missing masters" checkbox, "Send invites" checkbox.
  - Import runs as a job with a progress bar. Toast: "{n} rows imported". An errors CSV can be downloaded.
- **Exit panel** on Profile (HR): "Start exit". Fields: type (Resignation/Termination/End of internship/Absconding/Retirement), resignation date, last working day (auto-computed, editable), reason.
  - This opens the Exit checklist, which has one row per item with owner, status and a tick.
  - Buttons: "Withdraw resignation", "Complete exit".
- **Intern conversion** (HR): "Convert to full-time" on an intern's profile. Fields: effective date, new designation, new Emp ID preview.
- **Global header search** ("Search people, tasks, documents"): People contributes person hits via `/people/search`.
- **Dashboard "Birthdays & events"**: People provides `GET /people/events/upcoming`.

**2. Data model**
```prisma
enum EmployeeStatus { INVITED ONBOARDING ACTIVE NOTICE EXITED CANCELLED }
enum ExitType { RESIGNATION TERMINATION END_OF_INTERNSHIP ABSCONDING RETIREMENT DEATH }
enum BloodGroup { A_POS A_NEG B_POS B_NEG AB_POS AB_NEG O_POS O_NEG }
model Employee { …base
  userId String @db.Uuid            // Auth domain User
  empCode String                     // LX-0142 / LX-I-021
  firstName String; lastName String; fullName String; preferredName String?
  officialEmail String @db.Citext; personalEmail String? @db.Citext; phone String   // E.164
  gender String?; dateOfBirth DateTime? @db.Date; showBirthday Boolean @default(true)
  bloodGroup BloodGroup?; maritalStatus String?
  photoFileId String? @db.Uuid; photoStatus PhotoStatus @default(NONE)   // NONE|PENDING|APPROVED
  pendingPhotoFileId String? @db.Uuid
  departmentId String @db.Uuid; designationId String @db.Uuid; branchId String? @db.Uuid
  managerId String? @db.Uuid         // self-relation "reports to"
  employmentType EmploymentType; workMode WorkMode; status EmployeeStatus
  joiningDate DateTime @db.Date; probationEndDate DateTime? @db.Date; confirmedAt DateTime? @db.Date
  noticePeriodDays Int
  currentAddress Json?; permanentAddress Json?
  emergencyName String?; emergencyRelation String?; emergencyPhone String?
  resignationDate DateTime? @db.Date; lastWorkingDay DateTime? @db.Date
  exitType ExitType?; exitReason String?; exitedAt DateTime? @db.Timestamptz
  sourceApplicationId String? @db.Uuid   // recruitment link
  searchVector Unsupported("tsvector")?
  @@unique([tenantId, empCode]) @@unique([tenantId, officialEmail]) @@unique([tenantId, userId])
  @@index([tenantId, status, employmentType]) @@index([tenantId, managerId]) @@index([tenantId, departmentId]) }
model EmployeeJobHistory { …base employeeId String @db.Uuid; effectiveFrom DateTime @db.Date; effectiveTo DateTime? @db.Date
  departmentId String; designationId String; managerId String?; employmentType EmploymentType; workMode WorkMode; branchId String?
  reason JobChangeReason  // JOINING PROMOTION TRANSFER CONVERSION CORRECTION REPORTING_CHANGE
  note String?  @@index([tenantId, employeeId, effectiveFrom]) }
model EmployeeCodeHistory { …base employeeId String; code String; validFrom DateTime @db.Date; validTo DateTime? @db.Date
  @@unique([tenantId, code]) }
model EmployeeCodeSequence { tenantId String @db.Uuid; series CodeSeries /* STAFF INTERN */; format String /* "{P}-{SEQ:4}" | "{P}-I-{SEQ:3}" */
  prefix String @default("LX"); nextValue Int @default(1)  @@id([tenantId, series]) }
model EmployeeStatutory { …base employeeId String @unique @db.Uuid
  panEnc Bytes?; panLast4 String?; aadhaarEnc Bytes?; aadhaarLast4 String?; uan String?; esicNo String?
  taxRegime TaxRegime @default(NEW) /* NEW OLD */; taxRegimeFy String? /* "2026-27" */ }
model EmployeeBankAccount { …base employeeId String @db.Uuid; holderName String; accountNoEnc Bytes; accountLast4 String
  ifsc String @db.Char(11); bankName String; branchName String?; accountType String @default("SAVINGS")
  proofDocumentId String? @db.Uuid; status BankStatus /* PENDING_VERIFICATION VERIFIED REJECTED SUPERSEDED */
  verifiedById String?; verifiedAt DateTime?; rejectionReason String?
  @@index([tenantId, employeeId, status]) }   // exactly one VERIFIED + at most one PENDING per employee (partial unique idx)
model ExitCase { …base employeeId String @unique; exitType ExitType; resignationDate DateTime @db.Date; lastWorkingDay DateTime @db.Date
  noticeShortfallDays Int @default(0); waivedById String?; status ExitStatus /* OPEN WITHDRAWN COMPLETED */; exitInterviewNotes String? }
model ExitChecklistItem { …base exitCaseId String; key String /* ASSET_RETURN IDCARD_SURRENDER KT_HANDOVER ACCESS_REVOKE FNF_SETTLEMENT RELIEVING_LETTER EXIT_INTERVIEW */
  label String; ownerRole String; status ChecklistStatus /* PENDING DONE NA */; doneById String?; doneAt DateTime?; note String?; auto Boolean
  @@unique([exitCaseId, key]) }
model EmployeeImport { …base fileId String; status ImportStatus /* VALIDATED COMMITTING DONE FAILED */; options Json
  totalRows Int; validRows Int; importedRows Int @default(0); errorFileId String?; rowErrors Json }
```

**3. State machine: `Employee.status`**

| From | To | Trigger / who | Side effects |
|---|---|---|---|
| (none) | INVITED | Add employee / import (hr) | User (auth: `PENDING_INVITE`) + Employee + JobHistory(JOINING) + empCode; Onboarding instance; invite email (7-day token); WelcomeKitIssue(PENDING); IdCard(QUEUED); emit `employee.created` (Time: shift allocation, punch policy by workMode, leave balances; Tracker eligibility if REMOTE/HYBRID). Manager gets an alert. |
| INVITED | ONBOARDING | Joiner accepts the invite and sets a password | Onboarding.startedAt |
| INVITED/ONBOARDING | ACTIVE | Job at 00:05 IST on joiningDate (automatic, whether or not onboarding is finished) | `employee.activated`. If onboarding is not COMPLETED, HR gets the alert "Onboarding incomplete for X". If no verified bank account, Payroll holds salary. Billing seat count +1. |
| (import with "existing employee") | ACTIVE | Import (hr) | No onboarding instance. Invite = password set only. |
| INVITED/ONBOARDING | CANCELLED | hr "Cancel joining" (no-show / offer declined) | User disabled; ID card and kit voided; application back to OFFER_DECLINED; empCode is not reused |
| ACTIVE | NOTICE | hr "Start exit" | ExitCase + checklist generated; LWD computed; `employee.notice_started` (Payroll F&F prep, Projects, Appraisal excludes) |
| NOTICE | ACTIVE | hr "Withdraw resignation" | ExitCase WITHDRAWN; checklist voided |
| NOTICE | EXITED | hr "Complete exit" (blocking items done) or auto job at 00:05 IST on LWD+1 once blockers are done; otherwise HR is alerted daily | User disabled and sessions revoked (Auth); tracker devices unpaired; chat deactivated; ID card REVOKED; vcard public link off; seat released; `employee.exited` |
| INTERN(ACTIVE) | ACTIVE (FULL_TIME) | hr "Convert" | New STAFF empCode; old code kept in CodeHistory; JobHistory(CONVERSION); new ID card generated; probation starts |

Exit checklist items are auto-generated:
- ASSET_RETURN (auto DONE when the employee has no ASSIGNED assets).
- IDCARD_SURRENDER.
- KT_HANDOVER (manager).
- ACCESS_REVOKE (auto at exit).
- FNF_SETTLEMENT (auto DONE on `payroll.fnf.settled`).
- RELIEVING_LETTER (auto DONE when the generated letter is in the vault).
- EXIT_INTERVIEW (optional, NA allowed).

Blocking items: ASSET_RETURN, IDCARD_SURRENDER, KT_HANDOVER. For ABSCONDING or TERMINATION, HR may override with a reason.

**4. API**
- `GET /api/v1/employees?tab=all|full_time|interns|notice|exited&departmentId&designationId&managerId&workMode&branchId&employmentType&q` (people.employee.list)
- `GET /api/v1/employees/counts` (people.employee.list)
- `POST /api/v1/employees` (people.employee.create) returns `{employee, inviteSent, idCardStatus}`
- `GET /api/v1/employees/:id` (people.employee.read). Sensitive fields are included only with read_sensitive.
- `PATCH /api/v1/employees/:id` (people.employee.update)
- `PATCH /api/v1/me/profile` (people.employee.update_self). Allowed fields: phone, personalEmail, addresses, emergency*, bloodGroup, maritalStatus, showBirthday.
- `POST /api/v1/employees/:id/photo {fileId}`. For self uploads the photo becomes PENDING; HR uploads are APPROVED immediately.
- `POST /api/v1/employees/:id/photo/approve|reject` (people.employee.update)
- `POST /api/v1/employees/:id/job-change {effectiveFrom, departmentId?, designationId?, managerId?, workMode?, branchId?, reason}` (update)
- `GET /api/v1/employees/:id/job-history`
- `POST /api/v1/employees/:id/invite/resend` (create)
- `GET /api/v1/employees/import/template.csv`, `POST /api/v1/employees/import/validate` (multipart), `POST /api/v1/employees/import/:id/commit`, `GET /api/v1/employees/import/:id` (people.employee.import)
- `POST /api/v1/employees/:id/lifecycle/{start-exit|withdraw-exit|complete-exit|cancel-joining|convert}` (people.employee.lifecycle)
- `GET /api/v1/employees/:id/exit-checklist`, `PATCH /api/v1/employees/:id/exit-checklist/:key {status, note}` (lifecycle; KT item also allowed for the manager)
- `GET /api/v1/people/search?q=&limit=10` (people.directory.basic)
- `GET /api/v1/people/events/upcoming?days=14`: birthdays (respects showBirthday) and work anniversaries, formatted like "Sneha Patel · 3 years".
- `GET /api/v1/org-chart?rootId`
- Realtime: `import.progress {importId, done, total}` to the importer.

**5. Business rules**
- **Emp code:** allocated in the create transaction with a `SELECT … FOR UPDATE` on EmployeeCodeSequence. The STAFF series is used for FULL_TIME, CONTRACT, PART_TIME and CONSULTANT; the INTERN series for INTERN. Codes are never reused. An override must match `^[A-Z0-9-]{3,20}$` and be unique.
- **Probation:** FULL_TIME → probationEndDate = joiningDate + 6 months − 1 day (tenant setting). Interns and contract staff have none.
- **Notice period default** (tenant setting by type and state): FT on probation 15 days, FT confirmed 30 days, INTERN 7 days, CONTRACT per contract (default 15).
- **LWD** = resignationDate + noticePeriodDays − 1. If HR sets an earlier LWD: noticeShortfallDays = default LWD − chosen LWD (in days), unless waived. The shortfall goes to Payroll, which computes recovery.
- **Manager:** must be an ACTIVE or NOTICE employee in the tenant, must not be the employee, and must not create a cycle (checked with a recursive CTE). Managerial reach = TEAM scope; no role change is required.
- **Work mode → Time domain:** OFFICE = biometric only; REMOTE = web plus desktop; HYBRID = the Time domain's per-location rule.
- **Seats (P3):** creating an employee when active + invited ≥ plan seats gives 402 `SEAT_LIMIT` (Free plan = 10).

**6. Jobs, notifications, audit**
- Jobs:
  - `people.invite.send` (retry 5 times, exponential backoff).
  - `people.import.process` (chunks of 100, idempotent per row hash).
  - `people.lifecycle.daily` at 00:05 IST: activations, auto-exit, no-show check (INVITED and joiningDate + 3 days passed → HR alert).
  - `people.probation.reminder` at 09:00 IST, 15 days before probationEndDate, to the manager and HR.
  - `people.exit.reminder` daily at 09:00 for open blocking checklist items from LWD − 3 days.
- Notifications:

| Event | Recipients | Channel |
|---|---|---|
| Invite | joiner | email |
| New report joining | manager | in-app |
| Onboarding incomplete at joining | HR | in-app + email |
| Exit started | manager, IT/HR owners | in-app |
| LWD reminder | HR | in-app |
| Photo pending approval | HR | in-app |

- Audit events: `employee.created|updated|job_changed|photo_changed|status_changed|invite_resent|exit_started|exit_withdrawn|exited|converted|sensitive_viewed|imported`. Updates record a field-level diff. Sensitive values are masked in the audit log.

**8. Validation and edge cases**
- Validation:
  - Official email must match one of the tenant's configured email domains (warn only).
  - Phone must be +91 plus 10 digits starting 6 to 9 (other countries allowed as E.164).
  - joiningDate must not be earlier than today − 365 days unless "existing employee" is set.
  - DOB must make the person at least 18 years old (interns at least 16).
- Duplicates:
  - A duplicate officialEmail gives 409.
  - A duplicate personalEmail on an active record gives a warning.
  - Re-hire of an exited person creates a new Employee and a new empCode, linked by `previousEmployeeId`.
- Import:
  - Manager references to rows in the same file are resolved in two passes. Unresolvable references are a row error.
  - Maximum 5,000 rows and 5 MB.
  - Dates are accepted as YYYY-MM-DD or DD-MM-YYYY.
- Changing workMode mid-month emits `employee.updated` with an effective date. The Time domain applies it the next day.
- The manager of exiting reports gets a to-do: "Reassign N reports". HR cannot complete the exit while direct reports still point to the leaver.

**9. Phase:** P1.
- Depends on Auth/IAM (User invite, session revoke).
- Depends on Time (Shift, ShiftAllocation, WorkLocation, leave-balance init).
- Depends on Notifications and Files.
- P3: seat enforcement (Billing).

**10. Acceptance**
1. HR adds "Meera Iyer" (FT, Office, joining 6 Oct).
   - Status is INVITED, empCode is LX-0151 (next in sequence).
   - An invite is in Mailpit.
   - An onboarding record exists with 5 steps. WelcomeKitIssue is PENDING. IdCard is QUEUED (no photo).
   - A Time shift allocation exists from 6 Oct.
2. Adding an intern produces an LX-I-### code. Converting that intern produces LX-#### with the old code in history, and both codes resolve in search.
3. Manager Neha sees only her subtree. The counts tab shows the scoped numbers. `GET /employees/:id` outside her subtree gives 404.
4. Starting an exit for an employee with 2 ASSIGNED assets:
   - Status is NOTICE and LWD = resignation + 29.
   - "Complete exit" is blocked while ASSET_RETURN is PENDING.
   - Returning both assets auto-ticks the item. Completion gives EXITED, the user cannot log in, and the ID card is REVOKED.
5. A CSV with 42 valid rows and 3 bad ones: the dry run reports 3 errors. The commit imports 42 and emits `import.progress`. Re-committing is idempotent.
6. The daily job on joining date flips INVITED to ACTIVE and alerts HR "onboarding incomplete".

---

## M3. Employee Profile (including the Devices section)

**1. Screens & UX**
- Back link "← Employees" (only when the viewer has people.employee.list).
- **Header:**
  - Photo or initials avatar, full name.
  - Line: "{Designation} · {Department} · {empCode} · Reports to {Manager}".
  - Tags: work mode (accent), "Joined {date}", and kudos badges (distinct badge names from Engagement: latest 3 plus "+n", outline tags such as "Star Coder").
  - Buttons:
    - **ID card**: HR goes to the designer preselected on this employee; self sees "My ID card" (view and download PNG).
    - **Edit**: HR gets the full edit modal, which is the Add employee form plus personal fields. Self gets "Edit my details" limited to update_self fields.
- **Tabs and visibility:**

| Tab | Content | Visible to |
|---|---|---|
| Overview | Field/Value: Official email, Phone, Shift (Time), Work location + punch mode (Time), Blood group, Emergency contact. Plus Employment type, Joining date, Probation end, Branch. With read_sensitive: DOB, Personal email, Address, PAN (masked `XXXXX1234X`), Aadhaar (`XXXX XXXX 1234`), UAN. | self, TEAM manager, HR/admin (sensitive fields: self + HR/admin) |
| Documents | Document, Category, Status (Signed/Verified/Pending/Rejected). Row click downloads. HR gets Verify/Reject inline. | self + HR/admin only |
| Assets | Item, Serial, Assigned, Status, plus a Welcome kit row "x of y items" | self, TEAM, HR/admin |
| Offer & pay | Component, Monthly, Annual (Basic, HRA, Special allowance, PF (employer), CTC). Data from Payroll `SalaryStructure`. | self + HR/admin (not the manager) |
| Attendance | Month, Present, Leave, Idle, Late (last 6 months; Time domain summary) | self, TEAM, HR/admin |

- **Devices section** (at the bottom of Overview for self; HR sees it for anyone):
  - List: device name (e.g. PRIYA-LAPTOP), OS, paired on, last seen, status.
  - Actions: "Enter pairing code" (6 boxes), approve a pending request, Unpair.
  - Shown only when workMode is REMOTE or HYBRID. Otherwise the note reads "Office staff punch with biometric".
- Tabs a viewer cannot see are not rendered (not just disabled).

**2. Data model:** no new models.
- Reads Employee, EmployeeDocument (M4), Asset/WelcomeKitIssue (M8/M9).
- Consumes: Payroll `SalaryStructure`, Time `AttendanceMonthlySummary`, Engagement `Kudos`, Tracker `TrackerDevice {id, employeeId, name, os, status PENDING|ACTIVE|REVOKED, pairedAt, lastSeenAt}`.

**4. API**
- `GET /api/v1/employees/:id/profile` returns the header, tag badges, and a `visibleTabs[]` array computed server-side.
- `GET /api/v1/employees/:id/documents` (M4)
- `GET /api/v1/employees/:id/assets` (asset.read)
- `GET /api/v1/employees/:id/compensation` is proxied to Payroll (payroll.compensation.view)
- `GET /api/v1/employees/:id/attendance-summary?months=6` is proxied to Time
- `GET /api/v1/employees/:id/badges`
- Devices (Tracker domain contract): `GET /api/v1/employees/:id/devices`, `POST /api/v1/me/devices/pair {code}`, `POST /api/v1/devices/:id/approve`, `POST /api/v1/devices/:id/unpair` (own or tracker.device.manage)
- Realtime: `device.paired` to the desktop session and the profile page.

**5. Rules**
- Pairing code: 6 digits, TTL 10 minutes, 5 attempts, then the code is invalidated.
- Maximum 2 active devices per employee (tenant setting).
- Pairing is refused if the policy disallows the desktop tracker for the employee's workMode (Time policy).

**6. Audit:** `profile.viewed_sensitive` (with tab), `device.paired|unpaired`.

**8. Edge cases**
- Viewing an EXITED profile: HR sees read-only data with the banner "Exited on …".
- A manager changes after an exit: the TEAM scope is re-evaluated on each request (no stale cache beyond 60 s).

**9. Phase:** P1. Depends on Payroll (compensation), Time (summary), Tracker (devices), Engagement (badges; returns empty until P2).

**10. Acceptance**
1. Employee Priya on her own profile sees 5 tabs, including Offer & pay with CTC ₹85,800/month.
2. Manager Neha on Priya's profile sees Overview/Assets/Attendance only. PAN is hidden. `GET /employees/:id/documents` gives 403.
3. The desktop shows code 482913. Priya enters it under Devices, the device becomes ACTIVE, and the desktop receives `device.paired`.
4. HR unpairs the device. The next tracker API call from that device gets 401 `DEVICE_REVOKED`.

---

## M4. My Digital Vault and Document Service

**1. Screens & UX**
- **My digital vault** (NAV: ALL). Subtitle: "Visible only to you and HR."
  - Button: "Upload document". Form: Folder/category (select), File, Tags.
  - Columns: Document, Category, Uploaded, Verified by HR.
  - Status display mapping:
    - E-signed document → "Signed".
    - Compensation, current version → "Current".
    - VERIFIED → "Verified".
    - PENDING → "Pending".
    - REJECTED → "Rejected · re-upload" (with the reason as a tooltip).
    - NOT_REQUIRED → "—".
  - Row actions: Download, View versions, Delete (only own unverified uploads).
  - Groups or filters by category: Offer & compensation, Government ID, Education, Employment, Legal, Bank & tax, Career, Exit, Certificates.
- **HR verification queue:** an HR view inside Paperless onboarding (tab "Document verification", see M5), plus inline controls on the Profile Documents tab.
  - Preview pane showing the PDF or image, with a side panel of captured values (PAN number, name).
  - Actions: Verify, Reject (reason required).

**2. Data model**
```prisma
enum DocCategory { OFFER_COMPENSATION GOVERNMENT_ID EDUCATION EMPLOYMENT LEGAL BANK_TAX CAREER EXIT CERTIFICATE OTHER }
enum DocType { OFFER_LETTER NDA COMPENSATION_BREAKDOWN PAN AADHAAR PASSPORT MARKSHEET_10 MARKSHEET_12 DEGREE PREV_EMPLOYMENT
  RELIEVING_LETTER EXPERIENCE_LETTER CANCELLED_CHEQUE RESUME POLICY_ACK CERTIFICATE OTHER }
enum VerificationStatus { NOT_REQUIRED PENDING VERIFIED REJECTED }
enum DocSource { SELF_UPLOAD HR_UPLOAD GENERATED ESIGNED RECRUITMENT }
model EmployeeDocument { …base employeeId String @db.Uuid; category DocCategory; docType DocType; title String
  fileId String @db.Uuid; version Int @default(1); isCurrent Boolean @default(true); supersedesId String? @db.Uuid
  source DocSource; verificationStatus VerificationStatus; verifiedById String?; verifiedAt DateTime?; rejectionReason String?
  esignEnvelopeId String? @db.Uuid; tags String[]; expiresOn DateTime? @db.Date
  visibility DocVisibility @default(SELF_AND_HR) /* SELF_AND_HR HR_ONLY */
  @@index([tenantId, employeeId, category]) @@index([tenantId, verificationStatus]) }
model DocumentTypeRule { tenantId String; docType DocType; requiresVerification Boolean; maxSizeMb Int @default(10)
  allowedMime String[]; employeeCanUpload Boolean @default(true) @@id([tenantId, docType]) }
```

**3. States:** PENDING → VERIFIED | REJECTED (HR). REJECTED → a new version is uploaded → PENDING. Old versions get isCurrent=false. GENERATED and ESIGNED documents are NOT_REQUIRED and immutable.

**4. API**
- `GET /api/v1/me/vault?category` (vault.document.read own)
- `GET /api/v1/employees/:id/documents` (vault.document.read)
- `POST /api/v1/employees/:id/documents {fileId, docType, title?, tags?, expiresOn?}` (vault.document.upload)
- `GET /api/v1/documents/:docId/versions`
- `GET /api/v1/documents/:docId/download`: 302 to a presigned URL, and writes an audit record.
- `POST /api/v1/documents/:docId/verify {decision:"VERIFIED"|"REJECTED", reason?}` (vault.document.verify)
- `DELETE /api/v1/documents/:docId` (own PENDING/REJECTED self uploads; HR can soft-delete any, with a reason)
- `GET /api/v1/documents/verification-queue?employeeId` (verify)
- `POST /api/v1/files/uploads {purpose, mime, sizeBytes}` returns `{fileId, putUrl, headers}`

**5. Rules**
- Allowed MIME types: pdf, jpeg, png, heic (converted to JPEG). Maximum 10 MB (photos 5 MB).
- The SHA-256 must be unique per employee and docType; an identical re-upload gives 409.
- Category is derived from docType.
- The Folder/category select offers only the docTypes the employee is allowed to upload.
- Compensation breakdown is GENERATED by Payroll on each revision. The previous version keeps isCurrent=false; the newest shows "Current".
- Retention: exited-employee documents are kept for 8 years after exit (tenant setting). The purge job hard-deletes after that and keeps an audit stub.

**6. Jobs, notifications, audit**
- Jobs:
  - `files.av-scan` (ClamAV adapter; stub = CLEAN).
  - `files.thumbnail` (first-page PNG).
  - `documents.retention-purge` (monthly).
- Notifications: document rejected → employee (in-app + email); new upload pending → HR (in-app, batched hourly).
- Audit: `document.uploaded|downloaded|verified|rejected|deleted`. Every download of GOVERNMENT_ID, BANK_TAX or OFFER_COMPENSATION is logged with the viewer.

**7. Integrations:** `AntivirusScanner { scan(fileKey): Promise<{clean:boolean, signature?:string}> }`. Local = ClamAV (clamd container); stub = always clean.

**8. Edge cases**
- An INFECTED file: the record is marked infected, and the user and HR are notified.
- Leads and managers never get vault access, even with TEAM scope. This is enforced in the service and in an RLS policy that uses `app.user_id` plus a role flag.
- The super-admin gets 403 plus RLS denial. P3: files are encrypted with the tenant DEK (`encKeyId`), so storage-level access yields ciphertext only.

**9. Phase:** P1. Per-tenant DEK encryption is P3.

**10. Acceptance**
1. Priya uploads marksheets. The row shows "Pending". HR rejects with "blurred". Priya is notified, uploads v2 (Pending), HR verifies, and the vault shows "Verified" with the version history.
2. Manager Neha calls `/documents/:id/download` for Priya's PAN and gets 403. HR downloads it and an audit row exists.
3. An EICAR test file is marked INFECTED and downloads are refused.
4. The platform super-admin token on the vault endpoint gets 403. A direct SQL query as the platform role returns 0 rows.

---

## M5. Paperless Onboarding and E-sign

**1. Screens & UX**
- **Joiner view** ("Paperless onboarding", NAV: ALL; the default landing page while status is INVITED or ONBOARDING):
  - 5-step bar: Step n · Done / Now / Next. Clicking any step opens it.
  - Left pane: document preview (rendered PDF).
  - Right pane: action title, action box, consent checkbox "I have read and agree to this document", CTA.

| # | Step | Action box | CTA | Completion |
|---|---|---|---|---|
| 1 | Offer letter | Signature pad: Draw / Type tabs, clear, font choice for typed | Sign & continue | Envelope COMPLETED → vault OFFER_LETTER "Signed"; Offer ACCEPTED |
| 2 | NDA | Same | Sign & continue | Envelope COMPLETED → vault NDA (LEGAL) |
| 3 | Personal documents | Upload slots: PAN* (with PAN number field), Aadhaar* (with number field), Education marksheets* (≥1 of 10th/12th/Degree), Previous employment letters (required if template flag `experienced`). Declaration checkbox. | Upload & continue | All required docs uploaded (status PENDING is fine) and numbers valid |
| 4 | Bank & tax | Account holder, Account no., Confirm account no., IFSC (auto-lookup fills bank and branch), cancelled cheque/passbook (optional per policy), Tax regime (New default / Old), UAN (optional) | Save & continue | Bank account PENDING_VERIFICATION saved; statutory saved |
| 5 | Welcome kit | T-shirt size S/M/L/XL/XXL; delivery (Collect on day one / Ship to address, pre-filled for REMOTE) | Finish onboarding | Enabled only when steps 1 to 4 are DONE. Toast: "Onboarding complete · HR notified, ID card queued" |

  - A step with a rejected document shows "Needs attention" with the reason.
  - "Decline offer" link on step 1: asks for a reason, then HR is alerted.
- **HR view** (same NAV item, with onboarding.manage):
  - Tabs: New joiners, Document verification, Templates.
  - New joiners columns: Joiner, Emp ID, Joining date, Steps (x/5), Docs pending, Bank, Status.
  - Row → detail with per-step status, "Resend invite", "Reopen step", "Mark complete (override)".
  - Templates tab: onboarding templates per employment type, and document templates (offer letter, NDA, relieving/experience letter) edited in a WYSIWYG editor with a merge-field picker.
- **E-sign signing page** (`/sign/:envelopeId`): also used for ad-hoc HR-sent documents such as policy agreements.

**2. Data model**
```prisma
enum OnboardingStatus { NOT_STARTED IN_PROGRESS SUBMITTED COMPLETED CANCELLED }
enum StepStatus { PENDING IN_PROGRESS DONE NEEDS_ATTENTION SKIPPED }
enum StepType { ESIGN DOC_UPLOAD BANK_TAX WELCOME_KIT FORM POLICY_ACK }
model OnboardingTemplate { …base name String; employmentTypes EmploymentType[]; isDefault Boolean; steps Json
  /* [{key:"offer",type:"ESIGN",docTemplateKey:"offer_letter",order:1},{key:"nda",...},{key:"docs",type:"DOC_UPLOAD",required:["PAN","AADHAAR"],anyOf:[["MARKSHEET_10","MARKSHEET_12","DEGREE"]],optional:["PREV_EMPLOYMENT"]},{key:"bank",type:"BANK_TAX"},{key:"kit",type:"WELCOME_KIT"}] */ }
model Onboarding { …base employeeId String @unique; templateId String; templateSnapshot Json; status OnboardingStatus
  inviteTokenHash String?; inviteExpiresAt DateTime?; invitedAt DateTime?; startedAt DateTime?; submittedAt DateTime?; completedAt DateTime?
  completedOverrideById String?; overrideReason String?; declinedReason String? }
model OnboardingStep { …base onboardingId String; key String; order Int; type StepType; status StepStatus
  data Json?; completedAt DateTime?; esignEnvelopeId String?  @@unique([onboardingId, key]) }
model DocumentTemplate { …base key String /* offer_letter nda relieving_letter experience_letter */; name String; version Int
  bodyHtml String; mergeFields String[]; signatureFields Json; companySignatoryName String?; companySignatureFileId String?
  status TemplateStatus /* DRAFT PUBLISHED ARCHIVED */ @@unique([tenantId, key, version]) }
enum EnvelopeStatus { CREATED SENT VIEWED COMPLETED DECLINED EXPIRED VOIDED }
model EsignEnvelope { …base provider String @default("local"); providerRef String?; title String
  subjectEmployeeId String?; subjectApplicationId String?; documentTemplateId String?; purpose String /* OFFER NDA ADHOC */
  originalFileId String; originalSha256 String; signedFileId String?; signedSha256 String?; status EnvelopeStatus; expiresAt DateTime }
model EsignSigner { …base envelopeId String; order Int; role SignerRole /* SIGNER COUNTERSIGNER */; name String; email String
  userId String?; status SignerStatus /* PENDING VIEWED SIGNED DECLINED */; signatureType SigType? /* DRAWN TYPED */
  signatureImageFileId String?; typedName String?; typedFont String?; consentText String?; signedAt DateTime?
  ip String?; userAgent String?; otpVerifiedAt DateTime?  @@unique([envelopeId, order]) }
model EsignEvent { id String @id @default(uuid()); tenantId String; envelopeId String; type String
  /* CREATED SENT VIEWED CONSENTED SIGNED DECLINED COMPLETED VOIDED DOWNLOADED */ actorUserId String?; actorEmail String?
  ip String?; userAgent String?; at DateTime @default(now()); meta Json? @@index([tenantId, envelopeId, at]) }
```

**3. Workflows**
- **Onboarding:**
  - NOT_STARTED → IN_PROGRESS on first step action.
  - → SUBMITTED on Finish (joiner).
  - → COMPLETED automatically when every required document is VERIFIED and the bank account is VERIFIED, or by HR override with a reason.
  - Any state → CANCELLED (cancel joining).
  - SUBMITTED → IN_PROGRESS when HR rejects a document or reopens a step. The step becomes NEEDS_ATTENTION.
- **Finish side effects:**
  - HR in-app alert and email.
  - `onboarding.submitted`.
  - IdCard: if a photo is APPROVED and data is complete, a generate job is enqueued; otherwise the card stays QUEUED with missingFields.
  - WelcomeKitIssue.tshirtSize is set and the delivery mode recorded.
- **Offer letter generation:**
  - On Onboarding creation, the offer_letter template is rendered with the employee's data and Annexure A. Annexure A comes from Offer.annualCtc (recruitment path) or the Payroll SalaryStructure.
  - If neither exists: the step shows "Your offer letter is being prepared", HR gets the to-do "Set compensation for {name}", and on `payroll.salary_structure.created` the envelope is created and the joiner notified.
  - The company signature (a stored image) is pre-applied at generation. An optional COUNTERSIGNER HR signer (order 2) is a tenant setting.
- **Envelope:**
  - CREATED → SENT (signer notified) → VIEWED (first GET of the document) → COMPLETED (all signers signed; finalize job).
  - Signer declines → DECLINED.
  - expiresAt passes → EXPIRED (default 14 days; HR can resend, which creates a new envelope).
  - HR can VOID before completion.

**4. API**
- Joiner:
  - `GET /api/v1/me/onboarding`
  - `POST /api/v1/me/onboarding/steps/:key {data}` (for docs: `{documents:[{docType, fileId, number?}]}`; kit: `{tshirtSize, delivery, address?}`)
  - `POST /api/v1/me/onboarding/finish`
  - `POST /api/v1/me/onboarding/decline-offer {reason}` (all onboarding.self)
  - `PUT /api/v1/me/bank-account`, `PUT /api/v1/me/statutory` (update_self)
  - `GET /api/v1/ifsc/:code` (authenticated)
- HR:
  - `GET /api/v1/onboarding?status&joiningFrom&joiningTo`
  - `GET /api/v1/onboarding/:employeeId`
  - `POST /api/v1/onboarding/:employeeId/steps/:key/reopen {reason}`
  - `POST /api/v1/onboarding/:employeeId/complete {reason}`
  - `POST /api/v1/employees/:id/bank-account/:accId/verify {decision, reason?}`
  - `GET|POST|PATCH /api/v1/onboarding/templates`
  - `GET|POST|PATCH /api/v1/document-templates`, `POST /api/v1/document-templates/:id/publish`, `POST /api/v1/document-templates/:id/preview {employeeId}`
  - All require onboarding.manage.
- E-sign:
  - `GET /api/v1/esign/envelopes/:id` (signer or esign.envelope.send)
  - `GET /api/v1/esign/envelopes/:id/document` (PDF stream, records VIEWED)
  - `POST /api/v1/esign/envelopes/:id/sign {signatureType, drawnPng?(base64 ≤200KB), typedName?, typedFont?, consent:true}`
  - `POST /api/v1/esign/envelopes/:id/decline {reason}`
  - `GET /api/v1/esign/envelopes/:id/audit`
  - `POST /api/v1/esign/envelopes {fileId|documentTemplateId, signers[], title}` (esign.envelope.send)
  - `POST /api/v1/esign/envelopes/:id/void`
  - `POST /api/v1/esign/webhooks/:provider` (public, HMAC-verified)
  - `GET /public/esign/verify?sha256=`: tells whether a hash matches a completed envelope and its date; no PII.
- Invite acceptance: Auth domain `POST /api/v1/auth/invite/accept {token, password}`.
- Realtime: `onboarding.updated {employeeId, step, status}` to the HR room; `esign.envelope.updated` to the signer.

**5. Rules**
- **PAN:** `^[A-Z]{5}[0-9]{4}[A-Z]$`, 4th character `P` for individuals. The name mismatch check is manual by HR; the screen shows the name as captured.
- **Aadhaar:** 12 digits, first digit 2 to 9, Verhoeff checksum. Stored encrypted; displayed as the last 4. A masked-Aadhaar upload is recommended (hint text).
- **IFSC:** `^[A-Z]{4}0[A-Z0-9]{6}$`. Account number: 9 to 18 digits and must equal the confirmation field. Holder name must fuzzy-match fullName (≥0.8 Jaro-Winkler) or needs HR attention.
- **Tax regime:** default NEW. Set for the current FY (Apr to Mar). Changing it later is Payroll's rule (once per FY before the declaration lock).
- **Invite token:** 32 random bytes, stored as SHA-256. TTL 7 days. A resend invalidates the old token.
- **Signed PDF finalize** (pdf-lib):
  1. Stamp each signer's signature image or typed name at the template's signature field rectangles, with the caption "Digitally signed by {name} on {IST timestamp}".
  2. Append a "Certificate of completion" page: envelope id, signers, emails, IP, UA, event timeline, original SHA-256.
  3. Store the result, compute signedSha256, and write it to the Event table.
  4. The object is stored with S3 object lock (MinIO governance mode).

**6. Jobs, notifications, audit**
- Jobs:
  - `onboarding.reminder` at 10:00 IST on joiningDate −7, −3 and −1 for incomplete steps (email + in-app).
  - `esign.finalize`.
  - `esign.expire` (hourly).
  - `onboarding.offer.generate`.
- Notifications:
  - Joiner: invite, step needs attention, offer ready.
  - HR: submitted, offer declined, bank pending verification.
  - Manager: "{name} completed onboarding".
- Audit: `onboarding.step_completed|submitted|completed|override|reopened`, `esign.*` (mirrors EsignEvent), `bank_account.submitted|verified|rejected`, `statutory.updated`.

**7. Integrations**
```ts
interface ESignProvider {
  key: 'local'|'leegality'|'digio'|'docusign';
  createEnvelope(i:{envelopeId:string; pdf:Buffer; title:string;
    signers:{name:string;email:string;order:number;role:'SIGNER'|'COUNTERSIGNER'}[];
    fields:{signerOrder:number;page:number;x:number;y:number;w:number;h:number}[]; callbackUrl:string}):
    Promise<{providerRef:string; signingUrls?:Record<number,string>}>;
  getStatus(providerRef:string): Promise<{status:EnvelopeStatus; signers:{order:number;status:string;signedAt?:Date}[]}>;
  downloadSigned(providerRef:string): Promise<{pdf:Buffer; auditTrail?:Buffer}>;
  parseWebhook(headers:Record<string,string>, body:Buffer): Promise<{providerRef:string; event:string}>;
}
interface IfscLookup { lookup(ifsc:string): Promise<{bank:string;branch:string;city:string;state:string}|null> }
interface BankAccountVerifier { pennyDrop(acc:{number:string;ifsc:string;name:string}): Promise<{matched:boolean;nameAtBank?:string}> }
```
- E-sign: the `local` provider is fully functional (in-app signing plus the finalize job). Aadhaar eSign vendors (Leegality, Digio) are stubs that throw `ProviderNotConfigured` unless credentials exist.
- IFSC: the real adapter uses the free Razorpay IFSC API (`ifsc.razorpay.com`) with a 30-day Redis cache. The stub uses a bundled seed table of about 50 common IFSCs and falls back to regex-only validation.
- Penny drop: stub returns `{matched:null}` meaning manual HR verification. P3: Razorpay/Cashfree adapter.

**8. Edge cases**
- The joiner edits bank details after VERIFIED: a new PENDING record is created and the old one stays VERIFIED until HR approves; then the old becomes SUPERSEDED. Payroll always uses the VERIFIED record. Payroll is notified with `bank_account.changed`.
- Signing without consent gives 422.
- Signing an EXPIRED or VOIDED envelope gives 410.
- A double submit of sign is idempotent (same signer SIGNED returns 200 with no-op).
- The joiner closes the browser mid-draw: nothing is persisted until sign.
- The joiningDate passes with onboarding still open: the joiner can continue after activation. The step bar stays reachable from the dashboard to-do.

**9. Phase:** P1 (local e-sign, IFSC API). P2: countersigner, email OTP before signing, third-party e-sign adapter. P3: penny drop.
- Depends on M2, M4, Payroll SalaryStructure, Notifications, Auth invite.

**10. Acceptance**
1. A new joiner opens the invite link, sets a password, and draws a signature on the offer letter.
   - The envelope is COMPLETED.
   - The signed PDF has a stamped signature and a certificate page.
   - Its SHA-256 appears in the audit log.
   - The vault shows the Offer letter as "Signed".
2. Invalid PAN "ABCD1234F" gives 422. An Aadhaar failing Verhoeff gives 422. A mismatched account confirmation gives 422.
3. Finish before the NDA is signed gives 409 `STEPS_INCOMPLETE ["nda"]`.
4. HR rejects the Aadhaar upload after submit. Onboarding returns to IN_PROGRESS and step 3 is NEEDS_ATTENTION. A re-upload followed by HR verifying all documents and bank gives COMPLETED automatically.
5. `GET /public/esign/verify?sha256={signedSha}` returns valid with the completion date. A tampered file hash returns not found.
6. On Finish: HR has an in-app alert, the IdCard moves QUEUED → READY (photo present), and the WelcomeKitIssue size is "M".

---

## M6. Recruitment: Jobs, Candidates and Interview Vault, Interviews, Offers, Conversion

**1. Screens & UX**
- **Jobs** (NAV: hr, admin; leads read job names through selects).
  - Tabs: Open · {n} / Closed / Masters (M1).
  - Columns: Position, Department, Type, Openings, Branch, Applicants (count of applications), Status (Open / On hold / Closed / Draft).
  - "Add job" form: Position*, Department*, Job type (Full-time/Internship/Contract/Part-time), Openings*, Branch*, Description (rich text). Added: Designation, Experience (min to max years), Hiring manager, Salary range (internal), Interview rounds (ordered multi-select of round types).
  - Submit "Publish job" sets it OPEN; "Save as draft" is secondary.
  - Row → Job detail: pipeline counts per stage, candidate list, Hold/Close/Reopen.
- **Candidates and interview vault** (NAV: lead, hr, admin).
  - Tabs: All / Screening / Interview / Offered / Rejected (Rejected includes OFFER_DECLINED and WITHDRAWN).
  - Columns: Candidate, Applied for, Source, Score ("8.2 / 10" or "—"), Stage, Resume ("PDF" link).
  - Buttons: "Add candidate" (Name*, Email*, Phone*, Applied for*, Source* (LinkedIn/Referral/Naukri/Campus/Careers page/Agency/Walk-in/Other), Resume* (PDF/DOC ≤5 MB); added fields: Referred by (if Referral), Current CTC, Expected CTC, Notice period, Total experience, Location, consent checkbox) and "Schedule interview".
  - A lead sees only candidates for jobs in their department.
  - Row → Candidate drawer:
    - Profile, applications (one per job), stage history timeline, interviews with scorecards, notes, documents.
    - Actions: Move stage, Schedule interview, Reject (reason select plus note), Make offer, **Convert to employee**, "Add to another job".
  - Vault search: by name, skill tag, past job, score ≥ x. Rejected candidates stay searchable for future hiring until retention expires.
- **Interviews** (NAV: lead, manager, hr, admin).
  - Columns: Candidate, Round, Interviewer, When ("30 Sep, 11:00"), Mode (Video/In office), Result (Pending/Selected/Rejected/On hold/No-show).
  - Filters: Mine / All (scoped), date range, result.
  - "Schedule interview" form: Candidate* (application picker), Round* (Technical 1/Technical 2/HR/Portfolio/Managerial from the master), Interviewer* (plus optional panelists), Date*, Time*, Mode* (Video/In office). Added: Duration (default 60), Notes to candidate.
  - Submit "Schedule & email". Toast: "Invite emailed".
  - Row → Interview detail: Join video (LiveKit), Reschedule, Cancel, Mark no-show, **Scorecard** (criteria ratings 1 to 5 with comments, Overall 0 to 10, Recommendation, Notes; Save draft / Submit).
  - Leads and managers see only interviews where they are a panelist (plus department scope for leads).
- **Offer panel** (HR, from the candidate drawer):
  - Designation, Department, Branch, Employment type, Annual CTC, Joining date, Offer expiry, template preview.
  - Actions: "Save offer" moves the stage to OFFERED; "Convert to employee".

**2. Data model**
```prisma
enum JobStatus { DRAFT OPEN ON_HOLD CLOSED }
model Job { …base code String /* JOB-0007 */; title String; departmentId String; designationId String?; jobType JobType; openings Int
  branchId String; descriptionHtml String; experienceMinYrs Int?; experienceMaxYrs Int?; salaryMin Decimal? ; salaryMax Decimal?
  hiringManagerId String?; recruiterId String?; roundTypeIds String[]; status JobStatus; publishedAt DateTime?; closedAt DateTime?
  closeReason String? /* FILLED CANCELLED */ ; isPublic Boolean @default(false)
  @@unique([tenantId, code]) @@index([tenantId, status, departmentId]) }
enum CandidateSource { LINKEDIN REFERRAL NAUKRI CAMPUS CAREERS_PAGE AGENCY WALK_IN OTHER }
model Candidate { …base fullName String; email String @db.Citext; phone String; location String?; currentCompany String?
  currentCtc Decimal?; expectedCtc Decimal?; noticePeriodDays Int?; totalExpMonths Int?; source CandidateSource; sourceDetail String?
  referredByEmployeeId String?; tags String[]; resumeFileId String?; consentAt DateTime?; retentionUntil DateTime @db.Date
  anonymisedAt DateTime?  @@unique([tenantId, email]) @@index([tenantId, phone]) }
enum AppStage { SCREENING INTERVIEW OFFERED HIRED REJECTED OFFER_DECLINED WITHDRAWN }
model Application { …base candidateId String; jobId String; stage AppStage; stageChangedAt DateTime; score Decimal? @db.Decimal(3,1)
  rejectReason String?; rejectedAtStage AppStage?; ownerId String?; employeeId String?
  @@unique([candidateId, jobId]) @@index([tenantId, stage]) @@index([tenantId, jobId, stage]) }
model ApplicationStageEvent { …base applicationId String; from AppStage?; to AppStage; byId String; reason String? }
model CandidateDocument { …base candidateId String; kind String /* RESUME PORTFOLIO OTHER */; fileId String; version Int }
model InterviewRoundType { …base name String; order Int; defaultDurationMin Int @default(60)
  criteria Json /* [{key:"problem_solving",label:"Problem solving"},…] */ @@unique([tenantId, name]) }
enum InterviewMode { VIDEO IN_OFFICE PHONE }
enum InterviewStatus { SCHEDULED COMPLETED CANCELLED NO_SHOW }
enum InterviewResult { PENDING SELECTED REJECTED ON_HOLD }
model Interview { …base applicationId String; roundTypeId String; roundName String; sequence Int
  startsAt DateTime @db.Timestamptz; durationMin Int; mode InterviewMode; branchId String?; meetingRoom String?; notesToCandidate String?
  status InterviewStatus; result InterviewResult @default(PENDING); icsUid String; icsSequence Int @default(0); emailedAt DateTime?
  @@index([tenantId, startsAt]) }
model InterviewPanelist { interviewId String; employeeId String; role PanelRole /* LEAD PANELIST */ @@id([interviewId, employeeId]) }
enum Recommendation { STRONG_HIRE HIRE NO_HIRE STRONG_NO_HIRE }
model Scorecard { …base interviewId String; interviewerId String; ratings Json /* [{key,rating:1-5,comment}] */
  overall Decimal @db.Decimal(3,1); recommendation Recommendation; notes String?; status ScorecardStatus /* DRAFT SUBMITTED */
  submittedAt DateTime?; reopenedById String?  @@unique([interviewId, interviewerId]) }
enum OfferStatus { DRAFT ISSUED ACCEPTED DECLINED EXPIRED WITHDRAWN }
model Offer { …base applicationId String @unique; designationId String; departmentId String; branchId String
  employmentType EmploymentType; annualCtc Decimal; joiningDate DateTime @db.Date; expiresOn DateTime @db.Date; status OfferStatus
  employeeId String?; esignEnvelopeId String? }
```

**3. State machines**
- **Job:** DRAFT → OPEN (publish) ↔ ON_HOLD → CLOSED(FILLED|CANCELLED); CLOSED → OPEN (reopen). HIRED count ≥ openings gives the prompt "Close as filled?" (not automatic). Adding a candidate to a job that is not OPEN is refused.
- **Application:**
  - SCREENING (on create) → INTERVIEW (automatic when the first interview is scheduled, or manual).
  - → OFFERED (offer saved).
  - → HIRED (converted; Employee created).
  - OFFERED → OFFER_DECLINED (joiner declines in onboarding, or HR records it).
  - Any non-terminal stage → REJECTED(reason) or WITHDRAWN.
  - REJECTED → SCREENING (HR "Reconsider").
  - Who moves stages: HR, or a lead within department scope. Only HR moves to OFFERED or HIRED.
- **Interview:**
  - SCHEDULED → COMPLETED (when all panelists' scorecards are submitted, or HR marks it).
  - SCHEDULED → CANCELLED (ICS CANCEL sent).
  - SCHEDULED → NO_SHOW (after start + 15 min, by a panelist).
  - Reschedule: startsAt changes, icsSequence + 1, new emails.
  - Result: with a single panelist it is derived from the recommendation (STRONG_HIRE/HIRE → SELECTED, NO_HIRE/STRONG_NO_HIRE → REJECTED). With multiple panelists it is set by HR or the lead after all scorecards; the UI suggests the majority. A REJECTED result prompts "Reject application?" but does not do it automatically.
- **Offer:** DRAFT → ISSUED (on conversion: onboarding envelope created) → ACCEPTED (offer envelope COMPLETED) / DECLINED / EXPIRED (expiresOn passed while ISSUED) / WITHDRAWN (HR).
- **Conversion** (`POST /applications/:id/convert`, requires recruitment.hire + people.employee.create):
  - Opens the Add employee form prefilled: name, personalEmail = candidate email, phone, department, designation, branch, employmentType, joiningDate from the Offer.
  - HR supplies officialEmail, manager and shift.
  - On submit: M2 create flow with `sourceApplicationId`. The offer letter step uses the Offer's CTC for the annexure. The resume is copied to the vault (CAREER, source RECRUITMENT). Application becomes HIRED. The job's hired count increments.

**4. API**
- Jobs:
  - `GET /api/v1/recruitment/jobs?status&departmentId` (job.read)
  - `POST /api/v1/recruitment/jobs`, `PATCH /api/v1/recruitment/jobs/:id`, `POST /api/v1/recruitment/jobs/:id/status {status, reason?}` (job.manage)
  - `GET /api/v1/recruitment/jobs/:id/pipeline`
- Candidates:
  - `GET /api/v1/recruitment/candidates?tab=all|screening|interview|offered|rejected&jobId&source&minScore&q` (candidate.read)
  - `POST /api/v1/recruitment/candidates {candidate…, jobId, resumeFileId}` creates the Candidate (or matches an existing one by email) plus an Application.
  - `GET|PATCH /api/v1/recruitment/candidates/:id`
  - `POST /api/v1/recruitment/candidates/:id/applications {jobId}`
  - `POST /api/v1/recruitment/applications/:id/stage {to, reason?}`
  - `GET /api/v1/recruitment/candidates/:id/resume` (302)
  - `POST /api/v1/recruitment/candidates/:id/documents`
  - `POST /api/v1/recruitment/candidates/:id/anonymise` (candidate.manage, HR)
- Interviews:
  - `GET /api/v1/recruitment/interviews?scope=mine|all&from&to&result` (interview.read)
  - `POST /api/v1/recruitment/interviews` (interview.schedule): validates, creates, sends email and ICS, and returns conflicts as warnings.
  - `PATCH /api/v1/recruitment/interviews/:id` (reschedule)
  - `POST /api/v1/recruitment/interviews/:id/cancel {reason}`, `POST /api/v1/recruitment/interviews/:id/no-show`
  - `GET /api/v1/recruitment/interviews/:id/ics`
  - `GET|PUT /api/v1/recruitment/interviews/:id/scorecard`, `POST /api/v1/recruitment/interviews/:id/scorecard/submit` (panelist only)
  - `POST /api/v1/recruitment/interviews/:id/scorecard/:interviewerId/reopen` (HR)
  - `POST /api/v1/recruitment/interviews/:id/result {result}`
  - `GET /api/v1/recruitment/interviews/:id/join` returns a LiveKit token for the panelist.
  - Public: `GET /public/meet/:token` (candidate guest join).
- Offers:
  - `POST /api/v1/recruitment/applications/:id/offer`, `PATCH /api/v1/recruitment/offers/:id`, `POST /api/v1/recruitment/offers/:id/withdraw` (offer.manage)
  - `POST /api/v1/recruitment/applications/:id/convert` (hire)
- Masters: `/api/v1/masters/interview-rounds`.

**5. Rules**
- **Score:** Application.score = round(mean(Scorecard.overall where SUBMITTED, across all interviews of that application), 1). Shown as "8.2 / 10"; "—" when there are none.
- **Applicants** column = count of applications for the job, all stages.
- **Candidate dedupe:** email is unique per tenant. A phone match gives a "possible duplicate" warning.
- **Conflicts:** a panelist's overlapping SCHEDULED interview, or an approved leave on that date (Time API), gives a warning. The candidate cannot have two interviews within 30 minutes of each other.
- **ICS (RFC 5545):**
  - `METHOD:REQUEST` (CANCEL for cancellations), `UID:{icsUid}@{tenantDomain}`, `SEQUENCE:{icsSequence}`.
  - `DTSTART;TZID=Asia/Kolkata`, DTEND = start + duration.
  - `SUMMARY:Interview – {candidate} – {round} ({job})`.
  - LOCATION = the branch address, or the video join URL.
  - ORGANIZER = the tenant's recruiting email. ATTENDEE = candidate plus panelists.
  - `VALARM TRIGGER:-PT15M`.
  - Attached as `invite.ics` with a `text/calendar; method=REQUEST` part.
- **Video:** a LiveKit room named `intv-{interviewId}`. Candidate guest token valid from start − 15 min to end + 30 min. Recording off by default.
- **Retention (DPDP Act 2023):** Candidate.retentionUntil = last activity + 24 months (tenant setting). The monthly job anonymises the name, email, phone and files; scores are kept for analytics. Consent is required when the source is the careers page.
- **Referral:** a HIRED application with REFERRAL source and referredByEmployeeId emits `recruitment.referral_hired`. The bonus is a Payroll/Engagement concern.

**6. Jobs, notifications, audit**
- Jobs:
  - `recruitment.interview.email`.
  - `recruitment.interview.reminder`: 24 h and 1 h before, to the panelists and candidate.
  - `recruitment.scorecard.nudge`: 2 h after the interview ends, then daily until submitted.
  - `recruitment.offer.expire` (daily 00:10 IST).
  - `recruitment.retention.anonymise` (monthly).
- Notifications:
  - Panelist: assigned (in-app + email with ICS), reminder, scorecard due.
  - HR: all scorecards in, candidate declined.
  - Lead: new candidate for the department's job (in-app).
- Audit: `job.*`, `candidate.created|updated|anonymised`, `application.stage_changed`, `interview.scheduled|rescheduled|cancelled`, `scorecard.submitted|reopened`, `offer.*`, `candidate.converted`.

**7. Integrations**
- `MailService.send({to, cc, subject, html, attachments:[{filename:'invite.ics', content, contentType:'text/calendar; method=REQUEST'}]})`: SMTP, Mailpit in dev.
- `VideoRoomProvider { createRoom(name, opts):Promise<{room}>; issueToken(room, identity, {canPublish, validFrom, validTo}):Promise<string> }`: LiveKit self-hosted (Comms domain). Stub returns a Jitsi-style placeholder URL.
- `JobBoardPublisher { publish(job):Promise<{externalId}>; unpublish(id) }`: stub (P3 careers page, LinkedIn/Naukri later).
- `ResumeParser { parse(file):Promise<{name?,email?,phone?,skills?:string[]}> }`: stub returns empty (optional P3).

**8. Edge cases**
- A candidate applying to a second job gets a new Application; the Candidate is shared.
- Converting when the candidate's email already belongs to an active employee gives 409.
- Deleting a round type used by past interviews: deactivate only.
- A panelist leaves the company: their pending scorecards are reassigned by HR, and their interviews show "Panelist exited".
- A manager assigned as panelist can read that single candidate's resume and job through the interview, and nothing else.

**9. Phase:** P2.
- Depends on M1, M2, M5, Comms (LiveKit), Time (leave lookup), Facility (optional visitor e-pass for IN_OFFICE, P2).

**10. Acceptance**
1. HR publishes "React Developer" with 2 openings. It shows in the Open tab with count 4 → 5 and Applicants 0.
2. HR adds Aditya with a resume (stage SCREENING), then schedules "Technical 2" with Arjun, Video, 30 Sep 11:00.
   - The stage becomes INTERVIEW.
   - Mailpit has 2 emails, each with a valid ICS (UID, SEQUENCE 0, TZID Asia/Kolkata).
   - Rescheduling sends SEQUENCE 1.
3. Arjun submits a scorecard with overall 8.2. The Result is Selected and the Candidates Score column shows "8.2 / 10". Arjun cannot edit it after submitting (409) until HR reopens it.
4. Lead Arjun (Development) lists candidates and sees no Finance-job candidates. Manager Neha sees only interviews where she is a panelist.
5. HR makes an offer (₹9,00,000, joining 6 Oct) and converts.
   - An Employee is created with sourceApplicationId, and the application is HIRED.
   - The onboarding step 1 PDF contains ₹9,00,000 in Annexure A.
   - The resume is in the vault under CAREER.
6. A candidate with retentionUntil in the past is anonymised by the job. Their scores remain and their PII is null.

---

## M7. Appraisals

**1. Screens & UX**
- **Appraisals** (NAV: manager, hr, admin).
  - Tabs: Cycles / Templates / Employee association.
  - **Cycles:** columns Cycle ("H1 FY26-27"), Period ("Apr – Sep 2026"), Reviewers (distinct reviewer count), Self review % , Manager review %, Status (Draft / Self review / In review / Calibration / Closed).
    - "Create cycle" form: Cycle name*, From*, To*, KRA template*. Added: Self review due, Manager review due, Eligibility (min tenure days, default 90; employment types, default Full-time).
    - The name is auto-suggested from the Indian FY: H1 = Apr 1 to Sep 30, H2 = Oct 1 to Mar 31.
    - Row → Cycle detail: participant table (Employee, Reviewer, Self, Manager, Final score, Band, Status), with Launch / Advance / Close / Export CSV.
  - **Templates:** list (Name, Version, KRAs, Total weight, Used in cycles, Status). Editor: KRA rows (Title, Description, Measurement, Weight %), a live total that must equal 100, and Rating scale (1 to 5 labels). Actions: Clone and Archive.
  - **Employee association:** choose a cycle, then a table of employees (Name, Department, Reviewer, Template, Eligible?). Bulk actions: add by department or rule, change reviewer, change template, remove.
  - The manager sees Cycles (read-only) and Employee association filtered to their direct reports, with a "Review" button per report.
- **Review form** (route `/appraisals/review/:participantId`):
  - For each KRA: description, weight, self rating and comment, manager rating and comment.
  - Summary: weighted score, band.
  - Buttons: Save draft, Submit.
  - After close, the employee sees the final result and an "Acknowledge" button with a comment.
- **Employee access:** employees have no NAV item. Self-review is reached through a dashboard to-do and Alert deep link (`/appraisals/my`) and a "Performance" link on their own profile. See Open questions.

**2. Data model**
```prisma
model KraTemplate { …base name String; version Int @default(1); ratingScaleMax Int @default(5); ratingLabels Json
  status TemplateStatus /* DRAFT PUBLISHED ARCHIVED */  @@unique([tenantId, name, version]) }
model KraItem { …base templateId String; title String; description String?; measurement String?; weight Decimal @db.Decimal(5,2); order Int }
enum CycleStatus { DRAFT SELF_REVIEW MANAGER_REVIEW CALIBRATION CLOSED }
model AppraisalCycle { …base name String; periodFrom DateTime @db.Date; periodTo DateTime @db.Date; defaultTemplateId String
  selfReviewDue DateTime @db.Date; managerReviewDue DateTime @db.Date; eligibility Json; status CycleStatus
  launchedAt DateTime?; closedAt DateTime?  @@unique([tenantId, name]) }
enum ReviewStatus { NOT_STARTED IN_PROGRESS SUBMITTED }
model AppraisalParticipant { …base cycleId String; employeeId String; reviewerId String; templateId String; templateSnapshot Json
  selfStatus ReviewStatus; managerStatus ReviewStatus; selfSubmittedAt DateTime?; managerSubmittedAt DateTime?
  selfScore Decimal? @db.Decimal(4,2); managerScore Decimal? @db.Decimal(4,2); calibratedScore Decimal? @db.Decimal(4,2)
  finalScore Decimal? @db.Decimal(4,2); band String?; calibrationNote String?; acknowledgedAt DateTime?; employeeComment String?
  @@unique([cycleId, employeeId]) @@index([tenantId, reviewerId]) }
model AppraisalRating { participantId String; kraItemKey String; selfRating Int?; selfComment String?; managerRating Int?; managerComment String?
  @@id([participantId, kraItemKey]) }
```

**3. Workflow**
- **Cycle:**
  - DRAFT → SELF_REVIEW (HR "Launch"): the template is snapshotted per participant, the eligible list is frozen, and employees are notified.
  - → MANAGER_REVIEW (automatically at selfReviewDue 23:59 IST, or HR advances manually). The status label is "In review".
  - → CALIBRATION (HR, optional; can be skipped straight to CLOSED).
  - → CLOSED (HR): finalScore is locked, results are published, `appraisal.cycle_closed` is emitted, and employees are asked to acknowledge.
  - CLOSED → CALIBRATION (reopen, admin only, audited).
- **Participant:** self NOT_STARTED → IN_PROGRESS → SUBMITTED. The manager may review once self is SUBMITTED or the self due date has passed. Manager NOT_STARTED → IN_PROGRESS → SUBMITTED. HR can reopen either side before CLOSED.
- **Eligibility at launch:** status ACTIVE, employmentType ∈ eligibility.types, and joiningDate ≤ periodTo − minTenureDays. NOTICE employees are excluded by default (HR can add them). Reviewer = the reporting manager at launch.

**4. API**
- Templates: `GET|POST /api/v1/appraisals/templates`, `PATCH /api/v1/appraisals/templates/:id`, `POST /api/v1/appraisals/templates/:id/{publish|clone|archive}` (appraisal.template.manage)
- Cycles:
  - `GET /api/v1/appraisals/cycles` (appraisal.review.manager or cycle.manage)
  - `POST /api/v1/appraisals/cycles`, `PATCH /api/v1/appraisals/cycles/:id`, `POST /api/v1/appraisals/cycles/:id/{launch|advance|close|reopen}` (cycle.manage)
  - `GET /api/v1/appraisals/cycles/:id/export.csv`
- Participants:
  - `GET /api/v1/appraisals/cycles/:id/participants` (TEAM for managers)
  - `POST /api/v1/appraisals/cycles/:id/participants {employeeIds[] | rule}`
  - `PATCH|DELETE /api/v1/appraisals/participants/:id` (cycle.manage)
- Reviews:
  - `GET /api/v1/me/appraisals`
  - `GET /api/v1/appraisals/participants/:id`
  - `PUT /api/v1/appraisals/participants/:id/self`, `POST /api/v1/appraisals/participants/:id/self/submit` (appraisal.self, own)
  - `PUT /api/v1/appraisals/participants/:id/manager`, `POST /api/v1/appraisals/participants/:id/manager/submit` (reviewer only)
  - `POST /api/v1/appraisals/participants/:id/calibrate {score, note}` (calibrate)
  - `POST /api/v1/appraisals/participants/:id/acknowledge {comment?}` (own)

**5. Calculations**
- weightedScore(side) = Σ(weight_i × rating_i) / Σ(weight_i), on a 1 to 5 scale, rounded to 2 decimals. Unrated KRAs block submit.
- finalScore = calibratedScore ?? managerScore.
- Bands (tenant-configurable): ≥ 4.50 Outstanding; ≥ 3.50 Exceeds expectations; ≥ 2.50 Meets expectations; ≥ 1.50 Needs improvement; below that Unsatisfactory.
- Self review % = round(100 × count(selfStatus=SUBMITTED) / participants). Manager review % = the same for managerStatus. Reviewers = count(distinct reviewerId).
- Template validity: Σ weights = 100.00 (±0.01) and at least 1 KRA. A published template is immutable; editing creates a new version.

**6. Jobs, notifications, audit**
- Jobs:
  - `appraisal.phase.advance` (daily 00:15 IST, checks due dates).
  - `appraisal.reminders` (09:30 IST on due −3, due −1 and overdue days; self → employee, manager → reviewer).
- Notifications: launch → participants (in-app + email + dashboard to-do); self submitted → reviewer; cycle closed → participants.
- Audit: `appraisal.template.*`, `appraisal.cycle.*`, `appraisal.self_submitted|manager_submitted|calibrated|reopened|acknowledged`.

**8. Edge cases**
- The reporting manager changes mid-cycle: the reviewer stays as at launch unless HR reassigns. Any draft stays with the participant, not the reviewer.
- A participant exits mid-cycle: excluded from the percentages, with status "Withdrawn".
- A manager rating themselves is impossible (a reviewer cannot equal the employee). CEO/top-level employees without a manager get HR or admin as reviewer.
- Self ratings are never visible to peers. The manager sees self ratings after self submission.

**9. Phase:** P2. Depends on M2. Emits results for Payroll increments (future contract).

**10. Acceptance**
1. A template with weights 40+30+20 = 90 fails publish with 422. At 100 it publishes as v1.
2. Launching "H1 FY26-27" enrols only FT employees joined on or before 2 Jul 2026, sends notifications, and shows Reviewers = 8.
3. When 23 of 25 self reviews are submitted, the column shows 92%.
4. Manager ratings 5,4,3 with weights 40,30,30 give (200+120+90)/100 = 4.10, band "Exceeds expectations". Calibrating to 3.9 gives finalScore 3.9.
5. The job advances SELF_REVIEW → MANAGER_REVIEW the day after selfReviewDue.
6. Neha opening a participant who is not her direct report gets 403.

---

## M8. Assets and Inventory

**1. Screens & UX**
- **Assets and inventory** (NAV: hr, admin).
  - Tabs: All · {n} / Assigned / In stock / Under repair / Returned.
  - Columns: Item, Serial no., Assigned to, Assigned on, Warranty till ("Jan 2027"), Status.
  - Status tags: Assigned (accent), In stock (neutral), Under repair (outline), Returned (outline), Retired/Lost (neutral).
  - The **"Warranty expired"** outline tag replaces the status tag display when warrantyTill < today, but the underlying status is unchanged, so the item still appears in its status tab. An amber "Expiring in 30d" hint also shows.
  - KPI strip: Total, Assigned, In stock, Warranty expiring ≤30 days.
  - "Add asset" form: Item*, Serial no., Warranty till, Assign to, Assigned on. Added: Category*, Make/Model, Purchase date, Purchase cost, Vendor, Purchase bill (link to Finance purchase or upload), Branch, Condition.
  - Row → asset drawer: details, assignment history, repair history, and actions (Assign, Return, Send to repair, Repair complete, Inspect, Mark lost, Retire). Bulk CSV import.
- **Profile Assets tab** and **My assets** (self): items plus an "Acknowledge receipt" button on new assignments.

**2. Data model**
```prisma
enum AssetStatus { IN_STOCK ASSIGNED UNDER_REPAIR RETURNED RETIRED LOST }
enum AssetCondition { NEW GOOD FAIR DAMAGED }
model AssetCategory { …base name String; requiresSerial Boolean @default(true); @@unique([tenantId, name]) }
model Asset { …base assetTag String /* AST-0001 */; name String; categoryId String; make String?; model String?; serialNo String?
  purchaseDate DateTime? @db.Date; purchaseCost Decimal?; vendor String?; financePurchaseId String?; billFileId String?
  warrantyTill DateTime? @db.Date; status AssetStatus; condition AssetCondition; branchId String?
  currentAssigneeId String?; currentAssignmentId String?; statusBeforeRepair AssetStatus?; notes String?
  @@unique([tenantId, assetTag]) @@unique([tenantId, serialNo]) /* partial: serialNo not null */
  @@index([tenantId, status]) @@index([tenantId, warrantyTill]) @@index([tenantId, currentAssigneeId]) }
model AssetAssignment { …base assetId String; employeeId String; assignedOn DateTime @db.Date; assignedById String
  acknowledgedAt DateTime?; returnedOn DateTime? @db.Date; returnCondition AssetCondition?; returnNotes String?; receivedById String?
  @@index([tenantId, employeeId]) }
model AssetRepair { …base assetId String; vendor String; issue String; sentOn DateTime @db.Date; expectedBack DateTime? @db.Date
  cost Decimal?; completedOn DateTime? @db.Date; helpdeskTicketId String? }
```

**3. State machine**
- IN_STOCK → ASSIGNED (assign: creates an AssetAssignment; the employee must be INVITED, ONBOARDING, ACTIVE or NOTICE).
- ASSIGNED → RETURNED (return: closes the assignment and records condition).
- RETURNED → IN_STOCK | UNDER_REPAIR | RETIRED (inspect).
- IN_STOCK | ASSIGNED → UNDER_REPAIR. Sets statusBeforeRepair; the assignment stays open if it was ASSIGNED.
- UNDER_REPAIR → statusBeforeRepair (repair complete).
- Any state → LOST (note required; optional "Recover cost in F&F" flag sent to Payroll).
- IN_STOCK → RETIRED.
- Side effects:
  - Assign → the employee is notified to acknowledge.
  - Return while the employee is in NOTICE → recompute the exit checklist ASSET_RETURN item.

**4. API**
- `GET /api/v1/assets?tab=all|assigned|in_stock|under_repair|returned&categoryId&assigneeId&warrantyWithinDays&q` (asset.manage; managers get `/employees/:id/assets` only)
- `GET /api/v1/assets/counts`
- `POST /api/v1/assets` (if "Assign to" is set, create + assign in one transaction)
- `GET|PATCH /api/v1/assets/:id`
- `POST /api/v1/assets/:id/{assign|return|inspect|repair|repair-complete|lost|retire}`
- `POST /api/v1/assets/import`
- `GET /api/v1/me/assets` (asset.read own)
- `POST /api/v1/asset-assignments/:id/acknowledge` (own)

**5. Rules**
- assetTag is auto-generated as `AST-{seq:4}` per tenant.
- serialNo is required if the category requires it. It is trimmed and uppercased, and unique per tenant.
- assignedOn must not be earlier than purchaseDate, and must not be earlier than the employee's joiningDate − 30 days.
- warrantyTill must not be earlier than purchaseDate.
- Warranty alert thresholds: 30 days, 7 days, and the expiry day. The dedupe key is `asset:{id}:warranty:{threshold}`.

**6. Jobs, notifications, audit**
- Jobs: `assets.warranty.scan` daily at 09:00 IST, producing an HR digest in-app plus email "{n} assets' warranty expiring in 30 days" with deep links.
- Notifications: assign → employee (acknowledge); return overdue in notice → HR.
- Audit: `asset.created|updated|assigned|returned|inspected|repair_started|repair_completed|lost|retired`.

**7. Integrations:** optional `HelpdeskContract.createTicket({category:'IT hardware', assetId})` when sending to repair (Helpdesk domain).

**8. Edge cases**
- Assigning an already-ASSIGNED asset gives 409.
- Deleting an asset with history: soft delete only, admin only.
- Returned-but-damaged condition prompts "Send to repair".
- An exited employee who still holds assets blocks exit completion (M2).

**9. Phase:** P1. Depends on M2. Optional links: Finance purchases (P2), Helpdesk (P2).

**10. Acceptance**
1. Adding "Dell Latitude 5440" with serial DL5440-8821 assigned to Priya gives ASSIGNED, and Priya gets an acknowledgement alert. A duplicate serial gives 409.
2. The MacBook with warranty Mar 2026, viewed on 29 Sep 2026, shows the "Warranty expired" tag and still appears in the Assigned tab.
3. The warranty job on 2 Dec 2026 alerts HR once for a monitor expiring 1 Jan 2027. A re-run the same day sends no duplicate.
4. Return (condition DAMAGED), inspect, UNDER_REPAIR, then repair complete gives IN_STOCK, with the history showing all steps.
5. Tab counts equal the sums per status. "All" equals the total excluding soft-deleted assets.

---

## M9. Welcome Kits

**1. Screens & UX**
- **Welcome kits** (NAV: hr, admin).
  - Columns: New joiner, Joined, one checkbox column per active kit item (seeded: T-shirt, Mug, Notebook, Bag), Issued by.
  - Clicking a checkbox toggles that item as issued, with optimistic UI.
  - The T-shirt cell tooltip shows the size.
  - Filters: Pending / Partially issued / Issued, and joining month.
  - "Issue kit" form: New joiner*, Items* (multi-select, default all), Issued on*. Submit "Issue".
  - A "Kit items & stock" link opens the master: item, sizes, stock per size, low-stock threshold.
- The Profile Assets tab shows the row "Welcome kit · x of y items".

**2. Data model**
```prisma
model WelcomeKitItem { …base name String; sizes String[] /* ["S","M","L","XL","XXL"] or [] */; stock Json /* {"M":20} or {"_":40} */
  lowStockThreshold Int @default(5); isActive Boolean; order Int  @@unique([tenantId, name]) }
enum KitStatus { PENDING PARTIAL ISSUED VOID }
model WelcomeKitIssue { …base employeeId String @unique; status KitStatus; tshirtSize String?; delivery String /* HANDOVER SHIPPED */
  shippingAddress Json?; trackingNo String?; lastIssuedById String?; completedAt DateTime? }
model WelcomeKitIssueLine { issueId String; itemId String; size String?; issued Boolean @default(false); issuedOn DateTime? @db.Date
  issuedById String?  @@id([issueId, itemId]) }
```

**3. Workflow**
- Created PENDING on `employee.created`, with lines for all active items.
- Ticking a line sets issued=true and decrements stock. Unticking restores stock; this is allowed within 7 days and audited.
- All lines issued → ISSUED. Some issued → PARTIAL.
- The joining is cancelled → VOID.

**4. API**
- `GET /api/v1/welcome-kits?status&joinedFrom&joinedTo` (welcomekit.manage)
- `POST /api/v1/welcome-kits/issue {employeeId, itemIds[], issuedOn}`
- `PATCH /api/v1/welcome-kits/:issueId/lines/:itemId {issued, size?}`
- `PATCH /api/v1/welcome-kits/:issueId {delivery, trackingNo}`
- `/api/v1/masters/welcome-kit-items` (CRUD + `POST /:id/stock {size, delta, note}`)

**5. Rules**
- The size comes from onboarding step 5. It is required before ticking a sized item (422 `SIZE_REQUIRED`).
- Ticking when stock for that size is 0 gives 409 `OUT_OF_STOCK`, unless HR uses "force" (negative stock is flagged).
- Stock below the threshold triggers a low-stock HR alert.

**6. Jobs, notifications, audit**
- Jobs: `kits.pending.digest` daily 09:00 IST: joiners starting within 3 days with the kit not ISSUED → HR.
- Audit: `welcomekit.line_issued|line_unissued|issued|stock_adjusted`.

**9. Phase:** P1. Depends on M2 and M5.

**10. Acceptance**
1. Adding an employee creates a PENDING kit with 4 lines.
2. After onboarding size M, ticking the T-shirt decrements stock M 20 → 19 and the row shows "Issued by Kavya Iyer".
3. Ticking all 4 lines gives ISSUED and the Profile shows "4 of 4 items".
4. With T-shirt L stock 0, ticking gives 409 `OUT_OF_STOCK`.

---

## M10. ID Card Designer, Generation, Print, QR Verification

**1. Screens & UX**
- **ID card designer** (NAV: hr, admin). Subtitle: "Drag fields onto the card. Cards generate automatically when a photo and details are uploaded."
- **Header buttons:**
  - "Generate for {N} new joiners": N = count of QUEUED cards whose data is now complete. Disabled when N = 0. A popover lists "{m} waiting for photo or blood group" with links.
  - "Send to print vendor": sends all READY cards, or a selection. A confirmation dialog shows the count and vendor email.
- **Left panel:**
  - Elements: Photo, Full name, Designation, Employee ID, Blood group, QR code, Company logo, Emergency contact. Plus Static text, Image, Signature, Shape.
  - Templates: Classic portrait (seeded default), Landscape minimal (seeded), "+ New template".
- **Canvas:**
  - Front/Back segmented control. CR80 card at true aspect ratio.
  - Drag elements from the palette; move and resize with 1 mm snap; delete, layer order, align.
  - Preview data from a chosen employee (default: the first queued joiner).
- **Right panel "Properties · {element}":**
  - Data field: a binding select (whitelist below), shown like `employee.full_name`.
  - Font size, font family (brand fonts), weight, colour, alignment.
  - Background: upload an image per side.
  - Print vendor email (tenant setting).
  - Actions: "Save draft", "Publish template" (new version), "Set as default".
- **Second tab "Cards":** table of Employee, Emp ID, Template, Status, Generated, Print batch, Actions (Preview, Download PNG/PDF, Regenerate, Mark issued, Revoke, Reissue).
- **Third tab "Print batches":** Batch, Sent, Cards, Vendor, Status, Mark delivered.
- **Self view** ("My ID card", from the profile): front and back PNG preview and download. The employee cannot edit.
- **Public verification page** `https://{tenant-domain}/verify/id/{token}`: company logo, photo, name, designation, Emp ID, status (Valid / Revoked / Expired), and checked-at time. No blood group, phone or emergency contact.

**2. Data model**
```prisma
enum CardOrientation { PORTRAIT LANDSCAPE }
model IdCardTemplate { …base name String; orientation CardOrientation; widthMm Decimal @default(53.98); heightMm Decimal @default(85.60)
  front Json; back Json   /* elements: [{id,type:"TEXT|PHOTO|QR|IMAGE|SHAPE|SIGNATURE",binding?,text?,xMm,yMm,wMm,hMm,font:{family,size,weight,color,align},z}] */
  frontBgFileId String?; backBgFileId String?; version Int; status TemplateStatus; isDefault Boolean
  requiredBindings String[]  @@unique([tenantId, name, version]) }
enum IdCardStatus { QUEUED READY SENT_TO_PRINT PRINTED ISSUED REVOKED REPLACED SURRENDERED VOID }
model IdCard { …base employeeId String; templateId String; templateVersion Int; serial String /* IDC-2026-0001 */; status IdCardStatus
  missingFields String[]; frontPngFileId String?; backPngFileId String?; printPdfFileId String?; dataSnapshot Json?
  verifyToken String @unique; generatedAt DateTime?; printBatchId String?; issuedAt DateTime?; validTill DateTime? @db.Date
  revokedAt DateTime?; revokeReason String? /* EXITED LOST DAMAGED DATA_CHANGE */; replacedById String?
  @@unique([tenantId, serial]) @@index([tenantId, status]) }
  // partial unique index: one card per employee with status IN (QUEUED,READY,SENT_TO_PRINT,PRINTED,ISSUED)
enum PrintBatchStatus { QUEUED SENT ACKNOWLEDGED DELIVERED FAILED }
model IdCardPrintBatch { …base vendorName String?; vendorEmail String; adapter String; cardCount Int; pdfFileId String; status PrintBatchStatus
  sentAt DateTime?; sentById String; providerRef String?; error String? }
model IdCardSettings { tenantId String @id; printVendorName String?; printVendorEmail String?; defaultTemplateId String?
  autoGenerate Boolean @default(true); validityMonths Int? ; returnAddress String?; emergencyLine String?
  authorisedSignatoryFileId String?; requireBloodGroup Boolean @default(true) }
```
- **Binding whitelist:**
  - `employee.full_name`, `employee.preferred_name`, `employee.emp_code`, `employee.designation`, `employee.department`, `employee.blood_group`, `employee.photo`
  - `employee.emergency_contact_name`, `employee.emergency_contact_phone`
  - `employee.joining_date`, `card.valid_till`, `card.serial`, `qr.verify_url`
  - `tenant.name`, `tenant.logo`, `tenant.address`, `settings.return_address`, `settings.signatory`

**3. State machine**
- QUEUED (created with the employee; missingFields computed from requiredBindings versus the employee's data, and the photo must be APPROVED)
  → READY (generation job rendered front/back PNG and print PDF)
  → SENT_TO_PRINT (in a batch)
  → PRINTED (batch marked delivered)
  → ISSUED (HR "Mark issued"; issuedAt recorded).
- ISSUED/PRINTED → REVOKED (exit, lost) → a new card via "Reissue" (old card REPLACED with replacedById).
- An exit with the card returned → SURRENDERED (ticks the exit checklist IDCARD_SURRENDER).
- A data change (name, designation, photo, emp code) on a READY-or-later card prompts HR: "Regenerate?". Accepting creates a new card and marks the old REPLACED (verifyToken invalid).
- Cancel joining → VOID.
- **Auto-generate:** when `autoGenerate` is on and an `employee.photo_approved`, `employee.updated` or `onboarding.submitted` event makes missingFields empty, the `idcard.generate` job runs for that card.

**4. API**
- Templates:
  - `GET|POST /api/v1/idcards/templates`, `GET|PATCH /api/v1/idcards/templates/:id`
  - `POST /api/v1/idcards/templates/:id/{publish|set-default|clone}`
  - `POST /api/v1/idcards/templates/:id/preview {employeeId, side}` returns PNG (idcard.template.manage)
  - `POST /api/v1/idcards/templates/:id/background {side, fileId}`
- Cards:
  - `GET /api/v1/idcards?status&q` (idcard.generate)
  - `GET /api/v1/idcards/generatable` returns `{count, waiting:[{employeeId, missing[]}]}`
  - `POST /api/v1/idcards/generate {cardIds?|allGeneratable:true}` returns `{jobId}`
  - `POST /api/v1/idcards/:id/regenerate`
  - `POST /api/v1/idcards/:id/{issue|revoke|surrender}`
  - `POST /api/v1/employees/:id/idcards/reissue {reason}` (idcard.issue)
  - `GET /api/v1/idcards/:id/{front.png|back.png|print.pdf}` (idcard.view own or HR)
  - `GET /api/v1/me/idcard`
- Print:
  - `POST /api/v1/idcards/print-batches {cardIds?|allReady:true}` (idcard.print)
  - `GET /api/v1/idcards/print-batches`
  - `PATCH /api/v1/idcards/print-batches/:id {status}`
- Settings: `GET|PUT /api/v1/idcards/settings` (idcard.template.manage)
- Public: `GET /public/id/verify/:token` (rate-limited to 30/min/IP; tenant resolved from the host)
- Scan (for the Time domain's ID compliance): `GET /api/v1/idcards/scan/:token` returns employee id and status (authenticated, security or HR).
- Realtime: `idcard.generation.progress {jobId, done, total}`.

**5. Rules**
- **Render:** an HTML/CSS template is rendered with headless Chromium (Playwright) at 300 DPI.
  - Portrait CR80 = 638 × 1011 px.
  - The print PDF has 3 mm bleed on each side and crop marks, one card per page (front then back) at 86.6 × 91.6 mm media, fonts embedded, CMYK-safe colours noted.
  - PNGs are for screen use.
- **Photo:** JPG/PNG, at least 600×600 px, face-cropped to 5:6 in the client, stored at 1200×1440.
- **Serial:** `IDC-{YYYY}-{seq:4}` per tenant.
- **verifyToken:** 16 random bytes, base64url (22 characters).
- **validTill:** joiningDate + validityMonths, or null. Interns: the internship end date if set.
- **"Generate for N":** N = count(status = QUEUED and missingFields = ∅).
- **Print batch:** the merged PDF contains all selected READY cards. If it is 15 MB or smaller it is sent as an attachment; otherwise as a 7-day presigned link. The email goes to the vendor, CC HR, with subject "ID cards · {tenant} · batch {id} · {n} cards".

**6. Jobs, notifications, audit**
- Jobs:
  - `idcard.generate` (concurrency 2; 20 s timeout per card; 3 retries).
  - `idcard.print-batch`.
  - `idcard.expiry.scan` (monthly: cards expiring in 30 days → HR).
- Notifications:
  - HR: "{n} ID cards ready to print"; batch sent or failed; card generated for a joiner.
  - Employee: "Your ID card is ready for collection" when ISSUED is pending pickup after PRINTED.
- Audit: `idcard.template.published`, `idcard.generated|sent_to_print|issued|revoked|reissued|surrendered`, `idcard.verified_public` (token, IP; sampled).

**7. Integrations**
```ts
interface PrintVendorAdapter { key:'email'|'api';
  submitBatch(b:{batchId:string; vendorEmail?:string; pdf:{fileId:string; sizeBytes:number; url?:string}; cardCount:number; tenantName:string}):
    Promise<{providerRef?:string; status:'SENT'|'QUEUED'}>;
  getStatus?(ref:string):Promise<'ACKNOWLEDGED'|'DELIVERED'|'FAILED'>; }
```
- The default `EmailPrintVendorAdapter` (SMTP) is real and functional.
- The `ApiPrintVendorAdapter` is a stub (logs and returns QUEUED) until a vendor API exists.

**8. Edge cases**
- Blood group missing and requireBloodGroup → the card stays QUEUED with `missing:["employee.blood_group"]`.
- Publishing a new default template does not auto-regenerate issued cards. It prompts HR: "Regenerate {n} cards?".
- Revoked or replaced token → the public page shows "Revoked" (still HTTP 200 so scanners read it). An unknown token → 404 page.
- Tenant branding change (logo) → the same prompt as a template change.

**9. Phase:** P1 (seeded templates, drag-drop designer, auto-generate, email print vendor, QR verify). P2: vendor API adapter, multiple card types (visitor, intern).
- Depends on M2, M5, Branding (logo, colours, domain), Mail.
- Consumed by Time's ID card compliance.

**10. Acceptance**
1. Adding an employee without a photo gives an IdCard QUEUED with missing `employee.photo`. HR uploads a photo; the card becomes READY within the job SLA and shows PNGs.
2. With 3 generatable joiners, the button reads "Generate for 3 new joiners". Clicking it gives 3 READY cards, progress events, and the toast "3 ID cards generated (front & back)".
3. "Send to print vendor": Mailpit receives an email to print@shreeprints.in with a PDF of 6 pages (3 cards × 2 sides) at 300 DPI with bleed. Cards become SENT_TO_PRINT and the batch is SENT.
4. Scanning the QR opens `/verify/id/{token}` showing Valid with name and photo and no blood group. After the employee exits, the same URL shows "Revoked".
5. The designer binding `employee.full_name` at font size 22 renders "Priya Sharma" at 22 pt in the preview. A binding outside the whitelist gives 422 on save.

---

## M11. Digital Visiting Card

**1. Screens & UX**
- **Visiting card** (NAV: ALL). Subtitle: "Auto-filled from your profile using the corporate template."
- **Card preview** at 3.5 × 2 in (1.75 ratio):
  - Company name/logo and QR (top).
  - Name, designation.
  - Official email and phone (bottom).
- **Buttons:**
  - "Download PNG" (1050 × 600 px at 300 DPI).
  - "Download PDF" (print size with 3 mm bleed).
  - "Share by email": modal with recipients (up to 10) and an optional message.
  - "Share on WhatsApp": modal with a phone number (+91), or a "Share via WhatsApp" link.
- **Settings drawer:**
  - Show phone (toggle), use a work phone instead of personal, add LinkedIn URL, public link on/off.
  - Card fields come from the profile and cannot be edited here, except for these toggles.
- **Admin/HR:** "Card template" editor under Branding: layout choice, colours from the tenant palette, address, website.

**2. Data model**
```prisma
model VCardTemplate { tenantId String @id; layout String @default("classic"); showLogo Boolean @default(true); address String?; website String?; updatedAt DateTime }
model VCardProfile { …base employeeId String @unique; showPhone Boolean @default(true); workPhone String?; linkedinUrl String?
  publicSlug String /* priya-sharma-7k2 */; isPublic Boolean @default(true)  @@unique([tenantId, publicSlug]) }
model VCardShare { …base employeeId String; channel ShareChannel /* EMAIL WHATSAPP */; recipient String; status String; providerRef String? }
```

**4. API**
- `GET|PATCH /api/v1/me/vcard` (vcard.self)
- `GET /api/v1/me/vcard.{png|pdf|vcf}`
- `POST /api/v1/me/vcard/share/email {to[], message?}`
- `POST /api/v1/me/vcard/share/whatsapp {phone?}` returns `{mode:"sent"|"deeplink", url?}`
- `GET|PUT /api/v1/vcard/template` (vcard.template.manage)
- Public: `GET /public/cards/:slug` (HTML card with an "Add to contacts" button), `GET /public/cards/:slug.vcf`

**5. Rules**
- **QR** encodes `https://{tenant-domain}/c/{slug}` (short and scannable). The hosted page offers the .vcf download.
- **vCard 3.0 fields:** FN, N, ORG, TITLE, EMAIL;TYPE=WORK, TEL;TYPE=WORK,CELL (only if showPhone), URL, ADR;TYPE=WORK (template address), PHOTO (URI, optional), X-SOCIALPROFILE (LinkedIn).
- **Slug:** kebab-case full name plus 3 random base36 characters, stable across renames. A rename updates the display, not the slug.
- **Email share:** sent from the tenant noreply address with Reply-To set to the employee. Attaches the PNG and .vcf. Limit 20 shares per day per user.
- **Data refresh:** the card re-renders on the fly from the current profile. The PNG is cached by a hash of the inputs.

**6. Jobs, notifications, audit**
- No scheduled jobs. Rendering is synchronous with a cache (Playwright pool).
- Audit: `vcard.shared {channel, recipient masked}`, `vcard.public_toggled`.
- On `employee.exited`: isPublic = false, and the public URL returns 410 "No longer with {company}".

**7. Integrations**
```ts
interface WhatsAppProvider { key:'cloud_api'|'stub';
  sendTemplate(i:{to:string; template:string; lang:'en'; params:string[]; mediaUrl?:string}): Promise<{messageId:string}>; }
```
- The stub does not send. The API responds with `mode:"deeplink"` and `url = https://wa.me/{phone?}?text={encoded "Here's my visiting card: {publicUrl}"}`, and the client opens it. This works fully without credentials.
- The real WhatsApp Cloud API adapter is used when configured, with template `visiting_card_share` (document header = PNG/PDF).

**8. Edge cases**
- An employee without a phone hides TEL.
- isPublic = false: the QR URL returns 404 and the PNG shows a vCard-content QR (offline) instead of the URL.
- An invalid phone for WhatsApp gives 422.

**9. Phase:** P1 (email + WhatsApp deep link). P3: WhatsApp Business API. Depends on M2 and Branding.

**10. Acceptance**
1. Priya opens the Visiting card page and sees her name, "Software Engineer · Development", email and phone. The PNG is 1050 × 600.
2. "Share by email" to a@x.com: Mailpit has the email with PNG and .vcf attachments and Reply-To priya.sharma@lexisora.com.
3. With the WhatsApp stub, `POST /api/v1/me/vcard/share/whatsapp` returns a wa.me URL containing the public card URL.
4. Scanning the QR opens `/c/{slug}` and the .vcf imports with FN and ORG correct. After Priya exits, the page returns 410.

---

## Cross-domain contracts

**Consumed from other domains**

| Domain | Contract |
|---|---|
| Auth/IAM | `UserService.createInvited({email, name, tenantId}) → userId`; `acceptInvite`; `disableUser(userId)`; `revokeSessions(userId)`; permission/scope resolver `can(user, key, {ownerEmployeeId})`; role assignment |
| Time and Attendance | Shift master and `ShiftAllocation.create(employeeId, shiftId, from)`; WorkLocation (with branchId); punch policy by workMode; `GET attendance monthly summary`; leave balances initialisation on `employee.created`; approved leave lookup for interview conflicts. ID card compliance consumes `IdCard` status and `/idcards/scan/:token`. |
| Tracker | `TrackerDevice` list, pair-claim, unpair, and `revokeAllForEmployee` on exit |
| Payroll | `SalaryStructure` (Offer & pay tab, offer annexure, compensation breakdown doc); reads `EmployeeBankAccount (VERIFIED)`, `EmployeeStatutory`; F&F settlement → emits `payroll.fnf.settled`; notice shortfall and asset-loss recovery inputs |
| Engagement | Kudos badges per employee (profile header); EOTM |
| Comms | LiveKit room/token for video interviews; deactivate chat membership on exit |
| Notifications | `notify({userIds|role, type, title, body, link, channels:['inapp','email'], dedupeKey})`; email templates; dashboard to-do API (`todo.create/complete`) |
| Files/Platform | StoredFile, presign, AV scan, object lock |
| Branding/Tenancy | tenant name, logo, palette, domain, address (ID card, vcard, public pages); host → tenant resolution for `/public/*` |
| Billing (P3) | `seats.canAdd(tenantId)`, `seats.sync` on activate and exit |
| Finance | optional `Purchase` link for assets |
| Helpdesk / Facility (P2) | create IT ticket for asset repair; visitor e-pass for in-office interview |
| Projects | on exit: remove from boards and reassign tasks (event consumer) |

**Exposed by People** (events published through the BullMQ event bus plus an outbox table)
- `employee.created {employeeId, userId, joiningDate, employmentType, workMode, shiftId, managerId, departmentId}`
- `employee.updated {employeeId, changed:{field:[old,new]}, effectiveFrom}`
- `employee.activated`, `employee.notice_started {lwd}`, `employee.exited {exitType, lwd}`, `employee.converted`, `employee.photo_approved`
- `onboarding.submitted`, `onboarding.completed`
- `bank_account.changed`, `bank_account.verified`, `document.verified`
- `recruitment.candidate_hired`, `recruitment.referral_hired`
- `appraisal.cycle_closed {participants:[{employeeId, finalScore, band}]}`
- `asset.assigned|returned`
- `idcard.issued|revoked`
- Read APIs for other domains: `GET /internal/employees/:id` (core fields), `/people/search`, `/people/events/upcoming`, reporting-chain resolver `getManagerChain(employeeId)` (used by Leave, Timesheet L2, Helpdesk escalation), `getTeam(managerId, depth)`.

---

## Phase summary

| Phase | Modules |
|---|---|
| P1 | M1 Masters; M2 Employees and lifecycle (incl. exit checklist, CSV import); M3 Profile + Devices; M4 Vault; M5 Onboarding + local e-sign + IFSC; M8 Assets; M9 Welcome kits; M10 ID cards (designer, auto-generate, email print, QR verify); M11 Visiting card (email + wa.me) |
| P2 | M6 Recruitment (jobs, candidates, interviews + ICS + LiveKit, scorecards, offers, conversion); M7 Appraisals; e-sign countersign and OTP, third-party e-sign adapter; print vendor API; Helpdesk/Facility links |
| P3 | Per-tenant envelope encryption for PAN/Aadhaar/bank/documents; seat enforcement; WhatsApp Business API; penny-drop bank verification; public careers page / job boards; resume parser; dedicated-DB tenants (no People-specific change beyond the connection factory) |

---

## Open questions (real ambiguities)

1. **Invite destination.** The Add employee form has only "Official email", but new joiners usually cannot reach their company mailbox before day one. I have added an optional Personal email that the invite goes to. Confirm.
2. **Intern to full-time conversion.** Should the employee get a new STAFF code (LX-I-021 becomes LX-0152) or keep the intern code? The spec assumes a new code, with the old one kept in history.
3. **Employee access to self-review.** NAV hides Appraisals from employees. Should there be a "My appraisal" nav item, or are the to-do/alert deep link and the profile link enough?
4. **Manager directory scope.** Should managers see the whole directory (basic columns) or only their reporting subtree? The spec assumes the subtree, with everyone else reachable through the basic search.
5. **Portal access after exit.** Should exited employees keep limited access (payslips, Form 16, relieving letter) for a period, or email-only delivery? The spec assumes login is disabled.
6. **Retention periods.** Candidate data: 24 months. Exited-employee documents: 8 years. Both need legal and HR confirmation under the DPDP Act.
7. **Offer letter signing.** Is the company side pre-signed with a stored signatory image (assumed), or must HR/CEO countersign through e-sign?
8. **Lead scope in recruitment.** Should leads see candidates for all jobs, or only their department's jobs (assumed)? Can leads add candidates (assumed yes, department scope)?
9. **ID card rules.** Is blood group mandatory on ID cards (assumed yes), and should cards have a validity/expiry date (assumed none for full-time staff, internship end for interns)?

### Critical Files for Implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (lines 562-659 profile/onboarding/idcard/vcard markup; 778-780 NAV; 791-806 GEN employees/appraisal/jobs/candidates/interviews/vault/assets/welcomekit; 825-846 FORMS; 894-941 PROF/OB/idEls logic)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (line 357: "Hire to day one" flow)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html (lines 341-350: pairing via Profile → Devices)