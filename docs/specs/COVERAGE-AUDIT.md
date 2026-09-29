# Completeness critique: wireframes vs master design

Files read: Flow Map L352–362, Web App L317–955, Desktop Tracker L317–517.

## 1) Coverage summary

| Category | Total | Covered, correct | Covered, wrong phase or behaviour | Missing |
|---|---|---|---|---|
| (a) NAV screen ids (51) + login + profile | 53 | 47 | 4 (approvals, assets, ledger/D23, tenants/D25) | 2 (employee route to own profile; `/clients` has no NAV entry or route-map row) |
| (a) CUSTOM bespoke screens | 14 | 11 | 3 (dashboard, profile "Offer & pay", chat call buttons) | 0 |
| (b) GEN entries (actions, tabs, KPIs, cols, statuses) | 35 | 28 | 6 (projects KPIs, settings office column, jobs Masters tab, payroll/payslip sample figures, invoices draft number, payslips paid days) | 1 (P1 static privacy screen has no milestone) |
| (c) FORMS keys | 35 | 32 | 3 (`employee` depends on shift/location, `upload` reused by vault and filing, `invoice` GST editable vs derived) | 0 |
| (d) Bespoke handlers | ~40 | 35 | 5 (goApprovals for HR, shareWa copy, callToast in P1, modeBtns, kanban multi-column drop) | 0 |
| (e) Flow steps (10 flows) | 64 | 50 | 14 steps land in journeys whose exit milestone comes before a dependency ships | 0 unmapped screens |
| (f) Tracker states and handlers | 30 | 28 | 2 (screenshot toast copy, pairing copy) | 0 |
| (g) Role visibility vs matrix | 5 roles × 8 matrix rows + 51 nav | Matrix 8/8 (HR "Payroll & ledger" partial is documented) | 4 relationship-vs-role conflicts | — |
| (h) Milestone exits referencing later milestones | — | — | 14 (see §3) | — |

## 2) Gaps

**G1. Reporting-manager rights are tied to role, not to the reporting relationship (high).**
- Wireframe: `employees` row Vikram Joshi has Manager = Arjun Mehta, a lead (L791). Approvals sample `a3` Vikram is "Pending RM" (L862). Isha's manager is also Arjun.
- Master §4 gives `timesheet.approve.l2`, `attendance.regularize.approve` and `appraisal.review` only to M and A. L2 routing (K3) picks `employee.managerId`, so Vikram's L2 step goes to an approver who lacks the permission and stalls.
- Fix (M4 People + M8): grant these keys implicitly to anyone who is the subject's RM, via a TEAM ScopeResolver in which "has reports" counts as holding the key. Alternatively seed lead L2 as [TEAM]. The approvals nav then needs `permissionAny` to include "is RM of someone".

**G2. Employees acting as panelists or mentors cannot reach their work (high).**
- Wireframe: `interviews` row Tanvi, round Portfolio, interviewer Vikram Joshi (L797). `interns` mentors are Sneha Patel and Vikram Joshi (L790). Neither holds the lead role.
- Master §4: `recruitment.interviews.score` and `interns.assign` are not granted to E, and NAV hides Interviews and Intern task sheets from employees.
- Seed conflict: master §8.5 says all interns have mentor Arjun, but the wireframe lists Arjun, Sneha and Vikram.
- Fix: implicit OWN grant for panelists (M14) and for `Employee.mentorId` (M14). Add a to-do or alert deep link, since there is no nav item. Correct the seed mentors.

**G3. D11 standing tasks break L1 routing (high).**
- Every timesheet line now has a `taskId` under the INT project. K3 only skips L1 for project-less lines, so INT lines would create an L1 step for the INT project lead.
- Result: Priya's sheet cannot follow the wireframe chain Employee → Arjun → Neha.
- Wireframe grid rows: "Code review · Atlas CRM" and "Stand-up & meetings · Internal" (L930). Tracker `TASKS` has `AT-110 Code review` (Tracker L465).
- Fix (M6/M8):
  - `Project.isInternal`, or `approvalRoute=RM_ONLY` on INT, so its lines go straight to L2.
  - Seed AT-110 "Code review" as a real Atlas task, not INT-2, so the grid label and billability match.

**G4. No route to your own profile, which pairing needs (high).**
- Wireframe: `profile` is not in NAV. It is reached only from Employees (`to:'profile'`), which employees cannot see. The header avatar only signs out (L357).
- The tracker pair screen says "Enter this code in the web portal under Profile → Devices" (Tracker L345).
- Fix (M2 shell / M4): an avatar menu item "My profile" going to `/employees/me` (implicit OWN), and put the Devices tab there.
- Also settle the conflict over where Devices lives: People puts it on Overview, Tracker says it is a tab. Make it a tab.

**G5. HR's approval work has no entry point (medium).**
- Wireframe: dashboard `isMgr` (role ≠ employee) shows the approvals card to HR, and "Review now" calls `goApprovals` (L417, L919). NAV hides approvals from HR.
- Master: HR gets the Time-off and Escalations rows, and holds `attendance.regularize.approve [ALL]`. The regularization tab lives only on `/approvals`.
- Fix (M5/M8/M9):
  - `/approvals` access = any approval key, with only the tabs the user may see.
  - The approvals nav is computed from timesheet keys only, which keeps the wireframe NAV.
  - "Review now" resolves to `/approvals?tab=leave|regularization` or `/helpdesk?tab=escalations`.

**G6. Office staff tracking is contradicted by the wireframe (high).**
- Wireframe `settings` Office column: Auto-idle, Screenshot and Deduct idle are all ticked (L815). Approvals samples Rahul Desai (Office) have 234 shots and Sneha Patel (Office) 240 (L862).
- D6 defaults to blocking office staff, so all of those are inert and the seeded approvals data cannot be produced.
- Fix (M5/M7): seed `officeMonitorOnly=true` for the demo tenant, or disable the Office tracker cells in the UI with a "requires monitor-only mode" hint. Decide which, and make M7 seed and M8 fixtures agree.

**G7. Late event consumers have no backfill (medium).**
- The outbox purges published events after 7 days, and new handlers never see events from earlier milestones. Affected:
  - M9: Leave balances and proration for employees created in M4.
  - M11: chat project and department channels for projects from M6.
  - M11: policy acknowledgement requirements.
  - M11: notice late-joiner sync.
  - M15: LMS new-joiner enrollments.
- Fix: each module's SeedContributor gains a `reconcile(tenant)` that runs on deploy. List it in each milestone's exit.

**G8. People masters have no screen in P1 (medium).**
- The People M1 spec puts Departments, Designations and Branches under Jobs → "Masters" (L795, tab `Masters`). Jobs ships in M14 (P2), while masters are an M4 P1 deliverable.
- Fix: M4 adds `/admin/masters`, or an Employees "Settings" drawer. Jobs → Masters links to it in M14.

**G9. Employee form depends on M5 entities (high, see D-1).**
- FORMS `employee` has Shift* and Work mode, and `Employee.workLocationId` FKs to WorkLocation (Time).

**G10. Offer letter and "Offer & pay" depend on M10 (high, see D-2).**
- Onboarding OB[0] "compensation shown in Annexure A" and PROF "Offer & pay" rows (L895–897) need `EmployeeSalary` and salary preview.

**G11. `/clients` is incomplete (low).**
- Master tree has `routes/_app/clients` and workfin Module A, but it is missing from the §2.4 route map and from `nav.ts`, and has no permission-gated nav item (`clients.view` L/M/A).
- Fix (M6): add a Work group item.

**G12. Some P1 items have no milestone (low).**
- Static `/saas/privacy` screen (Platform M12 "P1 static screen"): M2 only builds placeholders.
- `/demo/flows` page (tree `demo/flows`; Platform M14).
- Dashboard to-do "Code review: AT-102 GST rounding" (L926) needs a GitLab MR-reviewer TodoProvider. Workfin marks it P2, but no milestone includes it; add to M17.
- Fix: assign privacy and demo/flows to M2/M3, and the MR reviewer to-do to M17.

**G13. The Onboarding screen has no completed-state view (low).**
- Priya (ACTIVE, onboarding done) opening `/onboarding` from NAV (ALL) has no defined view. Define it in M4, e.g. a read-only summary with signed documents.

**G14. Leave approvals count provider is not in M9 (low).**
- The approvals card needs a Time-off count. D16 lists the registry, but no M9 deliverable registers the leave or comp-off `ApprovalCountProvider`. Flow 04 step 3 needs it. Add to M9.

**G15. Seed does not cover all wireframe rows (low).**
- Clients Crest Labs (INV-0414, Pulse) and Ardent Co. (Helix) are missing.
- Project "Ledger sync" (Planning, lead Rahul) is missing.
- INV-0414 Draft is missing.
- Fix: add to `packages/fixtures` for M6, M13 and M14.

**G16. Late data on APPROVED timesheets is unspecified (low).**
- T6 defines `TimesheetDelta`, which D10 dropped silently. Time J says store `lateSync` and send an HR digest.
- Fix: state the Time J rule in the master (M8).

**G17. Chat call buttons in P1 (low).**
- `callToast` "recording saved to cloud archive" (L947) is bound to Audio, Video and Share screen.
- M11 is text only, so hide or disable those buttons until M16. The copy also implies auto-recording, but `ChatSettings.autoRecord=false` and the consent banner is the default. Fix the copy.

## 3) Dependency and ordering errors

| # | Milestone exit or deliverable | Needs | Fix |
|---|---|---|---|
| D-1 | M4 Add employee (Shift*, work location) and journey 05A | M5 Shift, WorkLocation, ShiftAssignment | Move the WorkLocation and Shift models, seed and CRUD into M4, or split M5a "locations+shifts" before M4 |
| D-2 | M4 onboarding offer e-sign (Annexure A), Profile "Offer & pay", journey 05A | M10 SalaryTemplate, EmployeeSalary, `/payroll/salary/preview` | Pull the Payroll P1 structure module (components, templates, revisions, preview) into M4 |
| D-3 | M5 day-status precedence, and Time C acceptance ("Upcoming" on Time off) | M9 LeaveService and the Time off screen | M5 ships a `LeaveService` port stub. The Time C "Upcoming" assertion moves to M9 |
| D-4 | M5 Holidays UI "Leave setup → Holidays" | M9 builds `/leave/setup` | M5 creates the `/leave/setup` route with a Holidays-only tab. M9 adds the other tabs |
| D-5 | M5 exit "Time A–G": D#2 (tracker refetch), E#1 (tracker switches within 2 s), E#3 (desktop day row) | M7 | Tag those scenarios as M7 exits |
| D-6 | M5 journey 09 assertion "policy push reaches the tracker" | M7 | Move that assertion to M7, or to the M12 nightly run |
| D-7 | M6 exit Workfin B#4/#6 (logged hours, AT_RISK health, billable ₹) and C#4 (auto WIP on first log) | M7 `tracker.day.updated`, M8 TimesheetCell | Seed `loggedMinutes` fixtures for M6, or move those scenarios to M8 |
| D-8 | M7 exit "T1–T8": T3#3 (L1 reject claim), T6#1/#2 (timesheet cells), T6#3 (September payroll), T8#2 (L2 acknowledge) | M8, M10 | Re-tag them as M8 or M10 exits |
| D-9 | M8 "Journey 01 end to end" dashboard assertions (quote, leave cards, notices) | M9 leave cards, M11 quotes and notices | Journey 01 is full at M11. At M8, assert only steps 1, 3, 4, 5 |
| D-10 | M2 exit "Platform M1/M2/M3 acceptance": M1#5 (office punch toast), M2#5/#6 (tracker pairing, office login), M3#2 (`GET /cctv/cameras` for Vikram), M3#5 (manager TEAM list) | M5, M7, M16, M4 | Re-scope the M2 exit to shell-level checks. Re-tag each scenario to its owning milestone |
| D-11 | M3 exit "platform M8 search ACL": candidates, PAN documents, QA notice, `employee.exited` | M14, M4, M11 | Test with synthetic providers in M3. Real cases run in the owning milestones |
| D-12 | M2 NAV smoke test "against the wireframe NAV table" | D23 (HR sees Ledger), D25 (Tenants operator-only) | The expected table must encode the deviations. Otherwise the test contradicts the design |
| D-13 | Flow-map link checker (§8.3) for `#screen=tenants&role=admin` | Demo tenant is kind DEMO in dev, and D25 shows Tenants only in OPERATOR | Allow `platform.console.link` in the DEMO kind, or run e2e with lexisora as OPERATOR |
| D-14 | Journey 05 steps 5 and 9 ("employee" role on onboarding and vcard) | §8.3 signs in via demo persona chips, but the joiner Meera is INVITED and not a persona | The journey must accept the invite from Mailpit as Meera. It must not use the demo login |

## 4) Contradictions between the design and the wireframe

1. **Screenshot toast copy.** Tracker L425 says "Visible to your Project Lead". Master §4 also grants `screenshots.view` to the RM [TEAM], admin [ALL] and the employee themself. This is a DPDP disclosure accuracy problem. Fix the copy to "Visible to your Project Lead and Reporting Manager", or restrict access to match.
2. **Idle money.**
   - Leavepay P3#3 expects ₹1,500 for 4 h raw idle minus a 60 min grace.
   - T6 expects 147 min → ₹1,118 with no allowance.
   - D12 applies SHORTFALL_ONLY first, so both acceptance cases fail on a full day.
   - M10 and M7 exits claim these scenarios pass. Rewrite them under D12.
3. **Payroll and payslip figures.**
   - Wireframe Priya Aug/Sep net is ₹78,420 with deductions ₹5,580 (L798–799). M10 exit is ₹82,000.
   - Rahul shows "Paid days 21" with "1 EL" (L799), but D31 says paid days include paid leave, which would be 22.
   - Seed computes payroll Jun–Sep with the engine, while §8.3 visual regression compares against the wireframe layout. Fixtures must not import these sample values.
4. **Invoice numbering.** INV-0414 is numbered while in Draft (L801). The adopted default assigns the number at issue, so drafts show "Draft".
5. **NAV deviations.**
   - Ledger is visible to HR with only the HR vouchers tab (D23), but the wireframe shows it to ADM only. The matrix renders "partial" for HR, while the wireframe shows a full ✓ (L814).
   - Tenants is hidden for customer admins (D25).
   - HR has no task-board ALL scope (D24), while wireframe code `allowedDepts` gives HR all boards (L891).
6. **Kanban moves.** The wireframe `moveTo` accepts a drop on any column (L892). The master one-column rule rejects the drop with the toast "Move one column at a time". Document this as intentional.
7. **Approvals level tabs.** The wireframe shows both L1 and L2 tabs to every approver role, including the lead (L933). The master shows L2 only with `l2`. This is tied to G1.
8. **WhatsApp share.** The toast says "Shared via WhatsApp Business" (L942). The P1 design is a wa.me deep link (stub adapter). Change the copy to "Opened WhatsApp".
9. **Pairing copy.** The tracker says "approve the request HR sent to your email" (L345). The T1 email approval goes to the user's own official email, and HR approval is a separate AWAITING_HR path. Fix the copy.
10. **Assets nav.** The assets nav is HRA-only, but §4 seeds `assets.view` E[OWN]. If `permissionAny` includes `assets.view`, employees would see the Assets nav. Gate it on `assets.manage`, and expose own assets as "My assets" in the profile or vault.
11. **Employees tab counts.** The wireframe shows "Full-time · 112" beside Interns 9 and Notice 3 inside All 128 (L791). The seed has 119 FT including 3 on notice, plus 9 interns. Counts are computed, so the wireframe number cannot be reproduced. Define whether the Full-time tab includes staff on notice.
12. **Hybrid persona.** Vikram is both a Facility Manager (custom role holding `cctv.view`) and Hybrid Mon/Wed, and is also an interview panelist and a mentor. He needs the implicit grants from G2. Otherwise flow 05 step 3 (Portfolio round) breaks when the panelist is Vikram.

### Critical Files for Implementation
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/packages/shared/src/nav.ts (approvals and assets `permissionAny`, clients item, "My profile" entry, D23 and D25 deviations for the smoke test)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/packages/shared/src/permissions.ts (RM, panelist and mentor implicit grants; lead L2 scope)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/apps/api/prisma/schema/core.prisma (split so WorkLocation, Shift and Salary models exist by M4)
- C:/Users/suyam/Downloads/HRMS Portal Design Requirements/lexisora-hrms/packages/shared/src/tracker.ts (INT routing and AT-110 seed; officeMonitorOnly demo default)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (L774–955, source for every item above)