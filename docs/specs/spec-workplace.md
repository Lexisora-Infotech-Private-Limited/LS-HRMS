# Lexisora HRMS: Workplace & Culture Domain Build Spec

Scope: Dashboard, Notice board, Company feed, Kudos & EOTM, Comms hub (chat and calls), Helpdesk, Learning (LMS), Rooms & visitors, Policies & rulebook (with the holiday list), Wellness games, CCTV. It also defines two services this domain owns and others can use: **Certificates** (with public verification) and the **Audience resolver**.

Source files:
- `C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html`: dashboard markup at lines 383-434, feed 661-677, chat 679-693, generic screen template 722-739, NAV 774-782, GEN rows 785-819, FORMS 821-856, QUOTES 857, sample posts, channels and messages 901-947.
- `C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html`: flow 8, "Workplace & culture", at line 361.
- The desktop tracker wireframe does not touch this domain. Its only link is the optional wellness rule "games playable only during a break" (§11).

---

## 0. Domain-wide conventions

### 0.1 Common columns and tenancy
- Every model below has these fields unless marked `[global]`:
  - `id String @id @default(uuid(7)) @db.Uuid`
  - `tenantId String @db.Uuid`
  - `createdAt DateTime @default(now())`
  - `updatedAt DateTime @updatedAt`
  
  Every index starts with `tenantId`.
- Every table gets PostgreSQL row-level security: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. A Prisma client extension runs `SET LOCAL app.tenant_id` inside each request's transaction.
- Soft delete (`deletedAt DateTime?`) applies to user-generated content: Notice, Post, Comment, Message, Ticket comment.
- Per-tenant human-readable numbers (`HD-1043`, `VIS-0201`) come from the shared `TenantSequence(tenantId, key, next)`. It is incremented with `UPDATE … RETURNING` inside the same transaction.
- All times are stored in UTC. They are displayed and bucketed in `tenant.timezone` (default `Asia/Kolkata`). A "day" is always the tenant's local day.
- Rich text uses a TipTap/ProseMirror document stored as JSON, plus HTML sanitised on the server (see the allowlist in §3).

### 0.2 Audience resolver (shared service, owned here)
Notices, LMS assignments, policies, company events and chat auto-membership all target people the same way.

```
enum AudienceType { ALL  DEPARTMENT  PROJECT  LOCATION  ROLE  DESIGNATION  EMPLOYMENT_TYPE  EMPLOYEE }
```

- An embedded `AudienceRule { type, refId? }` is stored as child rows per owning entity.
- `AudienceService.resolve(tenantId, rules[]) → userId[]` returns the union of the rules. It only includes employees whose status is `ACTIVE` or `NOTICE_PERIOD`.
- `AudienceService.matches(userCtx, rules[]) → boolean` is used for read-time visibility.
- `EMPLOYMENT_TYPE` covers cases such as "Full-time, Interns".
- `ROLE` means an RBAC role (seeded or custom).

### 0.3 Permission keys (seeded default grants)
Columns: E = employee, L = lead, M = manager, H = hr, A = admin. ✓ means granted by default. All are editable on the Roles & access screen.

| Key | E | L | M | H | A |
|---|---|---|---|---|---|
| dashboard.view, feed.view, feed.interact, notice.view, chat.use, chat.call.start, helpdesk.ticket.create, lms.view, facility.room.book, facility.visitor.register, policy.view, wellness.play, kudos.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| notice.publish.team (only for audiences the user leads or manages) | | ✓ | ✓ | ✓ | ✓ |
| notice.publish.team.any, notice.publish.global, notice.manage | | | | ✓ | ✓ |
| quote.manage, event.manage | | | | ✓ | ✓ |
| feed.post.submit (sent to review) | | ✓ | ✓ | | |
| feed.post.publish, feed.moderate | | | | ✓ | ✓ |
| kudos.give | | ✓ | ✓ | ✓ | ✓ |
| eotm.announce, badge.manage, certificate.manage | | | | ✓ | ✓ |
| chat.channel.create | | ✓ | ✓ | ✓ | ✓ |
| chat.channel.manage, chat.announce.post, chat.call.record | | | | ✓ | ✓ |
| chat.retention.manage | | | | | ✓ |
| helpdesk.ticket.work (also needs membership of a support group) | | | | ✓ | ✓ |
| helpdesk.ticket.view.all, helpdesk.admin | | | | ✓ | ✓ |
| helpdesk.escalation.receive | | ✓ | ✓ | ✓ | ✓ |
| lms.course.manage, lms.assign, lms.report.view | | | | ✓ | ✓ |
| facility.room.manage, facility.visitor.frontdesk, facility.manage | | | | ✓ | ✓ |
| policy.manage, policy.ack.report | | | | ✓ | ✓ |
| wellness.manage | | | | ✓ | ✓ |
| cctv.view, cctv.manage | | | | | ✓ |

- **Optional seeded roles, disabled by default.** Enabling one uses "Add role / copy permissions":
  - *Facility Manager*: facility.*, cctv.view.
  - *Security desk*: facility.visitor.frontdesk, plus `idcompliance.log`, which belongs to the People domain.
  - *IT desk agent*: helpdesk.ticket.work.
- **Platform super-admin.** No permission key in this domain is ever granted to the platform super-admin. The API guard rejects any `platformUser` principal on every `/api/v1/*` tenant route in this domain. The only exceptions are the aggregated metrics endpoints in the SaaS domain.

### 0.4 Notifications contract (consumed from the Platform/Notifications domain)
- `NotificationService.notify({tenantId, userIds, type, title, body, link, channels: ('inapp'|'email'|'whatsapp')[], dedupeKey?, data?})`
- In-app notifications appear under "Alerts · N" and are pushed over the Socket.IO `user:{id}` room as `notification:new`.
- Email goes through the SMTP adapter (Mailpit in dev).
- Users set per-type preferences. Types marked "mandatory" below cannot be switched off.

### 0.5 Audit contract
- `AuditService.log({tenantId, actorId, action, entityType, entityId, before?, after?, ip, ua})` writes append-only rows.
- Action names use the pattern `<module>.<verb>`.

---

## 1. Dashboard (P1)

### 1.1 Screens and UX (lines 383-434)
- **Header**
  - Kicker: the local date as `EEEE, d MMMM yyyy`.
  - H2: "Good {morning|afternoon|evening}, {firstName}". Before 12:00 is morning, 12:00-16:59 is afternoon, 17:00 onwards is evening.
  - Right side: designation · department.
- **Thought of the day strip**: `GET /quotes/today`.
- **Today card** (from the Attendance domain):
  - `punchState` ("Not punched in", "Punched in", "On break", "Punched out"), and a live elapsed timer that ticks on the client from `punchedInAt`.
  - Shift line "Shift 09:30 – 18:30 · {mode note}".
  - Punch in/out button. When web punch is blocked (biometric-only location) the button is replaced with the dashed note from the Attendance screen, "Use the fingerprint sensor…".
- **Leave balance card**: rows `{type} {available} / {entitled}` (EL, CL, SL, Comp-off), plus an "Apply time off" button that opens the leave form (Leave domain).
- **Pending to-do card**: a merged, sorted list with a checkbox, text and due tag ("Today", weekday, or date). "Add task" opens a modal with two tabs (defined in §1.3):
  - **Personal to-do**: Title, Due date, Note. This is the default tab.
  - **Board task**: the FORMS.task fields Title, Project, Module, Assignee, Estimated hours, Due date, Team board, Description. The tab only shows if the user has `task.create` on at least one board (Projects domain).
- **Awaiting your approval card**
  - Shown when the user has any of `timesheet.approve`, `leave.approve`, `helpdesk.escalation.receive`.
  - Each row is hidden if its permission is missing: "Timesheets N", "Time-off requests N", "Helpdesk escalations N".
  - "Review now" goes to the first non-zero queue, in order approvals, leave requests, helpdesk (filter `escalatedToMe`).
  - With seeded roles, employees never see the card. HR sees time-off and escalations only, because HR has no timesheet approval in the roles matrix.
- **Announcements**: the top 5 visible, unexpired, published notices. Pinned notices come first, then newest by `publishedAt`. Each row shows a scope tag (Global = `tag-accent`, Team = `tag-outline`), title, a 160-character plain-text excerpt and the date. Clicking opens the notice drawer and marks it read.
- **Birthdays & events**: the next 14 days of birthdays (only if the employee opted in), work anniversaries of 1 year or more ("Sneha Patel · 3 years") and company events ("Town hall · 3 Oct, 5 pm"). Sorted by date and capped at 6, with a "See all" link to the Notice board → Events tab.
- **Leave history**: the last 4 of my leave requests, showing type, days and a status tag (Leave domain).

### 1.2 Data model
```prisma
model Quote { id; tenantId; text String @db.VarChar(280); author String?; scheduledFor DateTime? @db.Date; active Boolean @default(true); sortOrder Int; createdById
  @@unique([tenantId, scheduledFor]) @@index([tenantId, active, sortOrder]) }
model PersonalTodo { id; tenantId; userId; title String @db.VarChar(200); note String?; dueDate DateTime? @db.Date; completedAt DateTime?; sortOrder Int
  @@index([tenantId, userId, completedAt]) }
model CompanyEvent { id; tenantId; title; description String?; kind EventKind; startsAt DateTime; endsAt DateTime?; location String?; meetingUrl String?; audience EventAudience[]; createdById; cancelledAt DateTime?
  @@index([tenantId, startsAt]) }
enum EventKind { TOWN_HALL CELEBRATION TRAINING OTHER }
model EventAudience { id; tenantId; eventId; type AudienceType; refId String? @db.Uuid }
```
- The `Employee` model (People domain) provides `dob`, `joiningDate` and `showBirthdayPublicly Boolean @default(true)`.
- A tenant seed loads the 4 wireframe quotes plus about 60 curated default quotes.

### 1.3 To-do rules
- **Personal to-do**: a private item that only its owner can see. It has no hours and is never billed or timesheeted. Checking it sets `completedAt`. Completed items are hidden after 24 hours and deleted after 90 days.
- **Board task**: a `Task` in the Projects/Kanban domain, with an assignee, estimate and board, and it appears in the timesheet. Creating one from the dashboard calls the Kanban API. The dashboard only lists board tasks assigned to me that are in `Alloted` or `WIP`, due within 7 days or overdue, with the checkbox hidden (the deep link opens the card).
- **System action items**: generated live and never stored. The user cannot check them; they clear automatically when the underlying condition clears. Each is provided by the owning module through `TodoProvider`:
  - Timesheet for the last week not submitted: Timesheet domain; "Submit timesheet for 21–27 Sep"; due Monday.
  - Policy acknowledgement pending: §10; due = ack due date.
  - Required course due or overdue: §7.
  - Ticket waiting on me as requester: §6.
  - Onboarding step pending: People domain.
- **Sort order**: overdue first, then due date ascending, then source priority (system → board → personal), then creation time. The card shows 6 items with "+N more".

### 1.4 Aggregation API
- `GET /dashboard` (permission `dashboard.view`) returns:
  ```
  { greeting:{localDate, dayPart, firstName, designation}, quote, today, leaveBalances[], todos[], approvals?, announcements[], events[], leaveHistory[] }
  ```
- `?sections=todos,approvals` refreshes only those sections.
- **Server pattern**: `DashboardSectionProvider { key; isVisible(ctx): boolean; resolve(ctx): Promise<unknown>; cacheTtlSec }`. Each domain module registers its providers: attendance → `today`, leave → `leaveBalances`, `leaveHistory` and `approvals.leave`, timesheet → `approvals.timesheets`, and so on.
- **Failure handling**: sections resolve in parallel with an 800 ms timeout each. A section that fails or times out returns `{ error: 'UNAVAILABLE' }` and the UI shows that card with a Retry button. The rest of the page still renders.
- **Caching**: per-user in Redis under `dash:{tenant}:{user}:{section}`, 30 s TTL. Busted by events such as `leave.request.*`, `timesheet.*`, `notice.published` and `ticket.escalated`, and the server then emits `dashboard:invalidate {sections[]}` on `user:{id}` so TanStack Query refetches.
- **Other endpoints**:
  - To-dos: `GET /todos`, `POST /todos`, `PATCH /todos/:id`, `POST /todos/:id/complete`, `POST /todos/:id/reopen`, `DELETE /todos/:id` (owner only).
  - Quotes: `GET /quotes/today`. `GET/POST/PATCH/DELETE /quotes` and `POST /quotes/import` (CSV with columns text, author, scheduledFor) need `quote.manage`.
  - Events: `GET /company-events?from&to` (audience-filtered). `POST/PATCH/DELETE /company-events/:id` need `event.manage`.
  - Celebrations: `GET /celebrations?from&to` returns birthdays and anniversaries, audience ALL.

### 1.5 Rules and calculations
- **Quote rotation**:
  - If a quote has `scheduledFor = localDate`, that quote is used.
  - Otherwise pick from the active, unscheduled pool ordered by `sortOrder, id` at `index = (daysSinceEpoch(localDate)) mod count`.
  - The result is the same for everyone in the tenant for the whole day, and cached until local midnight.
  - An empty pool falls back to the platform default list.
- **Birthday**: month and day match. 29 Feb is shown on 28 Feb in non-leap years. The year of birth is never exposed.
- **Anniversary**: month and day of `joiningDate`, when `years = localYear − joinYear ≥ 1`. The label is "{n} year(s)".
- **Events visibility**: the event's audience must match me. Cancelled events show struck through for 24 hours, then hide.

### 1.6 Jobs, notifications, audit
- **Job `celebrations.daily`** runs at 07:00 in the tenant timezone. It sends an in-app alert "Birthday: {name}" to the person's department and project members (for example "Birthday: Rahul Desai · System") and an email greeting to the person themselves, with dedupe key `bday:{user}:{date}`. It does the same for anniversaries.
- **Job `events.reminder`** sends an alert to the audience 24 hours and 1 hour before a `TOWN_HALL`.
- **Audit**: `quote.create|update|delete`, `event.create|update|cancel`. Personal to-dos are not audited because they are private.

### 1.7 Validation and edge cases
- A to-do title is 1-200 characters. The due date may be in the past, and it is then shown as overdue.
- A user without an employee record, such as a pure admin service account, gets `today: null` and the Today card is hidden.
- Tenant timezone changes take effect on the next request, and cache keys include the local date.
- Section cache keys include the RBAC version, so a permission change hides the approvals card immediately.

### 1.8 Phase and dependencies
- P1.
- Dependencies:
  - Attendance: today and punch.
  - Leave: balances, history, pending count.
  - Timesheet: pending count.
  - Kanban: task create and assigned tasks.
  - People: employee dob, joining date, department.
  - RBAC.
  - Notifications.

### 1.9 Acceptance scenarios
1. **Quote rotation.** With 4 active quotes and none scheduled, two users on the same local date get the same quote. On the next date they get the next index. When a quote is scheduled for today it overrides the rotation.
2. **Role differences.** An employee logs in and sees Today, Leave, To-do, Announcements, Events and History, but no approvals card. A manager with 2 pending timesheets and 3 pending leave requests sees "Timesheets 2 / Time-off requests 3 / Helpdesk escalations 0". HR sees no Timesheets row.
3. **To-do merge.** Add a personal to-do due today and tick it; it disappears. Separately, a policy needing acknowledgement adds "Acknowledge Leave & attendance policy"; acknowledging it removes the item without any manual action.
4. **Partial failure.** Stop the leave service mock. `/dashboard` still returns 200, with `leaveBalances.error = 'UNAVAILABLE'`, and all other sections are populated.
5. **Birthday opt-out.** An employee with `showBirthdayPublicly = false` is not listed. Their work anniversary still is.
6. **Realtime approvals count.** A manager approves a leave request in another tab and the dashboard approvals count drops within 2 s, driven by `dashboard:invalidate`.

---

## 2. Notice board (P1)

### 2.1 Screens and UX (GEN.notices, FORMS.notice)
- Title "Notice board". Subtitle: "Global notices reach everyone. Team-specific notices are visible only to the selected department or project."
- The "Publish notice" action shows if the user has `notice.publish.team` or `notice.publish.global`.
- **Tabs**:
  - **All**: everything visible to me.
  - **Global**.
  - **My teams**: team notices whose audience includes me, plus team notices I authored.
  - **Drafts & scheduled**: publishers only.
  - **Events** and **Thought of the day**: `event.manage` / `quote.manage` only. They host the management tables for §1.
- **Table columns**: Title (with a pin icon and an attachment clip), Visibility tag (`~Global`, `!Team`), Audience (such as "Everyone" or "Development · Atlas"; multiple audiences are comma-joined and truncated with a tooltip), Published (date), Read.
  - **Read column**: for the author and anyone with `notice.manage` it shows `read/recipients` (e.g. "112 / 128") and links to a receipts drawer listing Read and Not yet read people, with a "Remind unread" button. For everyone else it shows my own state tag, `~Read` or `!New`.
- **Row click** opens a drawer with the full sanitised body, attachments (download through a signed URL) and author. Opening it marks the notice read.
- **Unread badge**: the Home nav entry "Notice board" shows my unread count.
- **Publish form**:
  - Title: required, 5-150 characters.
  - Visibility: "Global · everyone" or "Team-specific". Global is only offered with `notice.publish.global`.
  - Team: multi-select of Departments and Projects, grouped. Disabled when Global is chosen. For `notice.publish.team` without `.any`, the list is limited to departments I lead or manage and projects where I am the lead or a member-manager.
  - Body: rich text limited to the feed allowlist.
  - Attachment: up to 5 files of at most 10 MB each; pdf, png, jpg, docx, xlsx.
  - Advanced (collapsed): Publish at (schedule), Expires on, Pin to top (only with `notice.manage`), Also email recipients (default on for Global, off for Team).
  - Buttons: Save draft, Publish.

### 2.2 Data model
```prisma
model Notice { id; tenantId; title String @db.VarChar(150); bodyJson Json; bodyHtml String; visibility NoticeVisibility; status NoticeStatus @default(DRAFT)
  authorId; publishAt DateTime?; publishedAt DateTime?; expiresAt DateTime?; pinned Boolean @default(false); emailRecipients Boolean
  recipientCount Int @default(0); readCount Int @default(0); deletedAt DateTime?
  audiences NoticeAudience[]; attachments NoticeAttachment[]; recipients NoticeRecipient[]
  @@index([tenantId, status, publishedAt(sort: Desc)]) }
enum NoticeVisibility { GLOBAL TEAM }
enum NoticeStatus { DRAFT SCHEDULED PUBLISHED EXPIRED ARCHIVED }
model NoticeAudience { id; tenantId; noticeId; type AudienceType /* DEPARTMENT|PROJECT (UI); others API-only */; refId String? @db.Uuid
  @@unique([noticeId, type, refId]) }
model NoticeAttachment { id; tenantId; noticeId; fileId /* FileObject from Storage domain */; name; sizeBytes Int; mime }
model NoticeRecipient { tenantId; noticeId; userId; addedAt DateTime @default(now()); readAt DateTime?
  @@id([noticeId, userId]) @@index([tenantId, userId, readAt]) }
```

### 2.3 State machine
- DRAFT → SCHEDULED: publish with a future `publishAt`.
- DRAFT or SCHEDULED → PUBLISHED: publish now, or the scheduler fires. Allowed for the author or `notice.manage`.
- SCHEDULED → DRAFT: unschedule.
- PUBLISHED → EXPIRED: job, when `expiresAt` passes.
- PUBLISHED or EXPIRED → ARCHIVED: author or `notice.manage`. The notice is hidden from lists, but receipts are kept.
- **Editing a PUBLISHED notice**:
  - Title, body and attachments can change. This sets `editedAt`, records an audit entry with a diff, and does not reset receipts.
  - The audience cannot change after publish. The user must archive and republish.
- **Side effects on PUBLISHED**:
  - Materialise `NoticeRecipient` from `AudienceService.resolve`, excluding the author, and set `recipientCount`.
  - In-app alert to recipients, type `notice.published`.
  - Email if `emailRecipients`.
  - Dashboard invalidate for recipients.
  - Emit domain event `notice.published`.

### 2.4 API
All paths are under `/notices`.
- `GET /notices?tab=all|global|teams|drafts&cursor&q` (`notice.view`). Uses RLS plus an application filter: visible if global, or if I am a recipient, or if I am the author.
- `GET /notices/:id` and `POST /notices/:id/read` (idempotent).
- `POST /notices`, `PATCH /notices/:id`, `POST /notices/:id/publish`, `POST /notices/:id/unschedule`, `POST /notices/:id/archive`, `DELETE /notices/:id` (drafts only). Permission: `notice.publish.global` when visibility is GLOBAL. Otherwise `notice.publish.team`, and the audience scope is checked.
- `GET /notices/:id/receipts?state=read|unread` and `POST /notices/:id/remind-unread`: author or `notice.manage`.
- `POST /notices/:id/pin` and `DELETE /notices/:id/pin`: `notice.manage`.
- `GET /notices/unread-count`.
- Attachments: `POST /files/presign` (Storage domain), then pass the `fileIds` in the notice body.
- Realtime: `notice:new {id}` to recipients' `user:{id}` rooms.

### 2.5 Rules
- The Read count is `readCount / recipientCount`. `readCount` is incremented once, on the first `readAt` set, using `UPDATE … WHERE readAt IS NULL`.
- **Late joiners** (events `employee.created`, `employee.department.changed`, `project.member.added`): the user is added as a recipient of every PUBLISHED, unexpired notice whose audience now matches, and `recipientCount` is incremented.
- **Leavers** (`employee.exited`): not removed; history is kept. Their unread rows are excluded from the "Remind" list.
- "Remind unread" is throttled to once per 24 hours per notice.
- Team-scope check for non-`.any` publishers: every audience `refId` must be in the set of teams I lead or manage (People and Projects domain API). Otherwise the API returns 403 `NOTICE_AUDIENCE_OUT_OF_SCOPE`.

### 2.6 Jobs, notifications, audit
- **Jobs**:
  - `notices.publishScheduled`: every minute. Selects SCHEDULED rows with `publishAt ≤ now` using `FOR UPDATE SKIP LOCKED`.
  - `notices.expire`: every 15 minutes.
  - `notices.syncRecipients`: runs on the People events listed in §2.5.
- **Notifications**: `notice.published` (in-app; email optional), `notice.reminder`.
- **Audit**: `notice.create|update|publish|archive|delete|pin|remind`.

### 2.7 Validation and edge cases
- A TEAM notice needs at least one audience. A GLOBAL notice must have none (rejected otherwise).
- `expiresAt` must be later than `publishAt` (or now).
- An audience that resolves to 0 people gets a warning with a confirm step. The API accepts `?force=true`.
- Attachments are virus-scanned through the Storage AV hook before download is allowed. The file shows "Scanning" until then.
- The body is sanitised on the server. A `bodyJson` that fails to parse returns 422.

### 2.8 Phase and dependencies
- P1.
- Depends on: People (departments, managers), Projects (membership), Storage, Notifications, RBAC.

### 2.9 Acceptance scenarios
1. **Global read receipts.** HR publishes a Global notice with an attachment in a tenant of 128 active employees. `recipientCount` is 127 (the author is excluded). After 3 users open it, the author sees "3 / 127".
2. **Team scope and "My teams".** A lead publishes a Team notice to "Development · Atlas". A QA employee does not see it in any tab, and `GET /notices/:id` returns 404. A Development member sees it under "My teams" and on the dashboard.
3. **Publishing permissions.** A lead tries Visibility=Global and gets 403. A lead targeting the QA department, which they do not lead, gets 403 `NOTICE_AUDIENCE_OUT_OF_SCOPE`. HR can target QA.
4. **Scheduled and expiry.** A notice scheduled for 10:00 is not visible at 09:59 and is visible with alerts sent at 10:01. After `expiresAt` it drops off the dashboard but stays under All with an Expired tag.
5. **Late joiner.** A new employee added to Development receives the still-active Atlas notice, and the denominator becomes 17.

---

## 3. Company feed (P1 core feed; P2 review workflow and image uploads)

### 3.1 Screens and UX (lines 661-677)
- **Two-column layout.**
  - Main column: composer and post list.
  - Sidebar (260 px):
    - "Employee of the month": card showing the month, name and citation of the latest EotmAward (current month, else the previous one).
    - "Kudos this week": up to 5 entries like "Star Coder → Rahul D." from the last 7 days, linking to Kudos.
- **Composer**
  - Shown to users with `feed.post.publish` or `feed.post.submit`.
  - Toolbar: exactly B, I, H2, Link, Image, List (both bullet and ordered).
  - Fields: Title (required, at most 150 characters), Kind select (Blog, Milestone, Update), cover image (optional), body.
  - Buttons: "Save draft" (autosaves every 10 s), and "Publish" for `feed.post.publish` or "Submit for review" for submit-only users.
  - A "My drafts" dropdown reopens drafts.
- **Post card**:
  - Avatar initials, author name, and a meta line "{designation-short} · {d MMM}" (e.g. "CEO · 1 Sep").
  - Kind tag: EOTM, Blog, Milestone, Update or Kudos.
  - Title (heading font) and body (sanitised HTML with a "Read more" collapse beyond 600 characters).
  - Actions: "Like · N" or "Liked · N" as a toggle; "N comments", which expands the comment thread; and for EOTM posts, "Download certificate".
- **Comments**: flat list with one level of replies. Each comment has a delete action for the author or `feed.moderate`. @mentions give the mentioned user an alert.
- **Moderation menu** (`feed.moderate`): Pin, Unpin, Archive, Delete comment.
- **Review queue** (`feed.post.publish`): a "Pending review (N)" link above the composer. Each item can be Publish-ed or Return-ed with a comment.
- Infinite scroll, 10 posts per page.

### 3.2 Data model
```prisma
model Post { id; tenantId; kind PostKind; status PostStatus @default(DRAFT); title String @db.VarChar(150); bodyJson Json; bodyHtml String; excerpt String @db.VarChar(300)
  coverFileId String?; authorId; publishedAt DateTime?; publishedById String?; reviewNote String?; pinned Boolean @default(false)
  likeCount Int @default(0); commentCount Int @default(0); eotmAwardId String? @unique; kudosId String? @unique; deletedAt DateTime?
  @@index([tenantId, status, pinned, publishedAt(sort: Desc)]) }
enum PostKind { BLOG MILESTONE UPDATE EOTM KUDOS }
enum PostStatus { DRAFT PENDING_REVIEW PUBLISHED ARCHIVED }
model PostImage { id; tenantId; postId?; fileId; width Int; height Int; createdById }   // orphan cleanup
model PostLike { tenantId; postId; userId; createdAt  @@id([postId, userId]) }
model PostComment { id; tenantId; postId; authorId; parentId String?; body String @db.VarChar(2000); mentions String[] @db.Uuid; deletedAt DateTime?; deletedById String?
  @@index([tenantId, postId, createdAt]) }
```

### 3.3 State machine
- DRAFT → PUBLISHED: `feed.post.publish`.
- DRAFT → PENDING_REVIEW: `feed.post.submit`. Alert goes to holders of `feed.post.publish`.
- PENDING_REVIEW → PUBLISHED, where `publishedById` is the reviewer: `feed.post.publish`.
- PENDING_REVIEW → DRAFT, with `reviewNote`: `feed.post.publish`. Alert to the author.
- PUBLISHED → ARCHIVED: the author (if they hold publish permission) or `feed.moderate`.
- EOTM and KUDOS posts are only created by the system (§4) directly as PUBLISHED. The author is the announcer or giver.
- **On PUBLISHED**:
  - In-app alert `feed.post.published` to everyone. Low priority and batched: posts from the last 15 minutes are grouped into one alert.
  - Realtime `feed:new {postId}` to the `tenant:{t}:feed` room.

### 3.4 API
- `GET /feed/posts?cursor&kind` (`feed.view`) returns published posts plus my drafts when `?mine=1`.
- `GET /feed/posts/:id`.
- `POST /feed/posts` and `PATCH /feed/posts/:id`: the author, while the post is DRAFT, needs `feed.post.submit` or `.publish`.
- `POST /feed/posts/:id/publish` (`feed.post.publish`), `POST /feed/posts/:id/submit` (`feed.post.submit`), `POST /feed/posts/:id/return` (`feed.post.publish`).
- `POST /feed/posts/:id/archive` and `POST /feed/posts/:id/pin` (`feed.moderate`).
- `PUT /feed/posts/:id/like` and `DELETE /feed/posts/:id/like` (`feed.interact`).
- `GET /feed/posts/:id/comments`, `POST /feed/posts/:id/comments`, `DELETE /feed/comments/:id` (author or `feed.moderate`).
- `POST /feed/images`, which takes a `fileId` from the presign step and returns `{src}`.
- `GET /feed/sidebar` returns `{eotm, kudosThisWeek[]}`.
- Realtime: `feed:new`, `feed:like {postId, likeCount}`, `feed:comment {postId, commentCount}`.

### 3.5 Rules
- **HTML allowlist**: `p, br, strong, em, h2, ul, ol, li, a[href|rel|target], img[src|alt|width|height]`.
  - `a[href]` must be `https:`, `http:` or `mailto:`. The server forces `rel="noopener nofollow" target="_blank"`.
  - `img[src]` must point to a tenant `FileObject` (resolved server-side to a signed or proxied URL). External image URLs are rejected.
  - Images: png, jpg or webp, at most 5 MB. The server re-encodes to webp at max 1600 px wide and strips EXIF.
- **Counters**: `likeCount` and `commentCount` are updated in the same transaction as the like or comment. A nightly job recomputes them from source.
- **Excerpt**: the first 300 characters of plain text.
- **Sort order**: pinned first (max 3 pinned), then `publishedAt` descending.

### 3.6 Jobs, notifications, audit
- **Jobs**: `feed.imageOrphanCleanup` daily (removes PostImage rows with no post after 24 hours), `feed.recount` nightly.
- **Notifications**: `feed.review.requested`, `feed.review.returned`, `feed.comment.mention`, and `feed.comment.onMyPost` (batched).
- **Audit**: `feed.post.publish|archive|pin`, `feed.comment.delete` (records the moderator).

### 3.7 Edge cases
- Liking your own post is allowed.
- A comment on an ARCHIVED post returns 409.
- An author who has left: posts stay, and the meta shows "Former employee".
- Editing a PUBLISHED post: allowed for `feed.post.publish` and sets `editedAt`. For a submit-only author, editing a published post moves it back to review.

### 3.8 Phase and dependencies
- P1: feed with publish, likes and comments.
- P2: the review workflow and image re-encoding.
- Depends on: People (designation), Storage, Notifications, §4 (sidebar and EOTM posts).

### 3.9 Acceptance scenarios
1. **Publish and XSS.** HR writes a post with H2, a list, a link and an uploaded image, then saves a draft. Reloading restores the content exactly. After Publish, an employee sees it at the top. `<script>` and `onerror` injected in the payload are stripped.
2. **Likes under concurrency.** An employee likes a post; the count goes from 21 to 22 and the label changes to "Liked · 22". Unliking returns it to 21. 50 parallel like requests from the same user leave the count at 22.
3. **Review workflow.** A lead submits a Milestone. HR sees "Pending review (1)" and publishes it. The post then shows the lead as author and HR as `publishedById`.
4. **Visibility.** An employee cannot see the composer, and `POST /feed/posts` returns 403.
5. **Mentions.** A comment containing @Priya sends Priya an in-app alert linking to the post and comment.

---

## 4. Kudos, EOTM and Certificates (P2)

### 4.1 Screens and UX (GEN.kudos, FORMS.kudos, FORMS.eotm)
- Title "Kudos & Employee of the Month". Actions: "Give kudos" (`kudos.give`) and "Announce EOTM" (`eotm.announce`).
- **Tabs** (added): All, Given by me, Received, Badges (manage, `badge.manage`).
- **Table columns**: Employee, Badge (tag), From, Message, Date.
- **KPI strip** (added, `lms.report.view`-style): kudos this month and top badge.
- **Give kudos form**:
  - Employee: searchable select that excludes me.
  - Badge: active badges; the EOTM badge is excluded.
  - Message: required, 10-500 characters.
  - Submit button "Send kudos". Toast "Kudos posted to feed".
- **Announce EOTM form**:
  - Employee.
  - Month: defaults to the current month; the list offers only the current month and the previous two.
  - Citation: 20-600 characters.
  - Submit button "Announce & issue certificate". Toast "Posted to feed · certificate issued".
- **Profile** (People domain): header tags show the distinct badges earned. The label "Star Coder" shows "×N" when there are multiples. A Kudos tab on the profile is optional and belongs to People.
- **Certificate download**: from the EOTM feed post, the Kudos row and My digital vault (Vault domain, category "Certificates").
- **Public page** `/verify/{code}`: no login needed.

### 4.2 Data model
```prisma
model Badge { id; tenantId; name String @db.VarChar(40); icon String /* key */; color String?; description String?; system Boolean @default(false) /* EOTM */; active Boolean @default(true)
  @@unique([tenantId, name]) }
model Kudos { id; tenantId; giverId; recipientId; badgeId; message String @db.VarChar(500); postId String? @unique; revokedAt DateTime?; revokedById String?
  @@index([tenantId, recipientId, createdAt]) @@index([tenantId, createdAt]) }
model EotmAward { id; tenantId; employeeId; month String @db.Char(7) /* YYYY-MM */; citation String @db.VarChar(600); announcedById; postId String? @unique; certificateId String? @unique; revokedAt DateTime?
  @@unique([tenantId, month]) }
model Certificate { id; tenantId; type CertificateType; recipientId; title String; subtitle String?; issuedAt DateTime; verificationCode String @unique @db.VarChar(12)
  fileId String?; sha256 String?; status CertStatus @default(PENDING); revokedAt DateTime?; revokeReason String?; sourceType String; sourceId String @db.Uuid; metadata Json
  @@unique([tenantId, sourceType, sourceId]) @@index([tenantId, recipientId]) }
enum CertificateType { EOTM COURSE }
enum CertStatus { PENDING READY FAILED REVOKED }
```
- Seeded badges: Star Coder, Bug Hunter, Team Player, and Employee of the Month (system).

### 4.3 Workflows
- **Give kudos**, in one transaction:
  - Create the Kudos row.
  - Create a Post (kind KUDOS, PUBLISHED, author = giver). Title "{Badge} → {Recipient}", body = the message.
  - Alert and email the recipient (`kudos.received`).
  - Invalidate the recipient's profile badge aggregate.
  - Emit `kudos.awarded`.
- **Revoke kudos** (`feed.moderate` or the giver within 24 hours): sets `revokedAt` and archives the post.
- **Announce EOTM**, in one transaction:
  - Create the EotmAward row.
  - Create an EOTM Post. Title "Employee of the Month: {name}"; body = citation plus "Her/His certificate is ready to download", with a pronoun-neutral template: "The certificate is ready to download."
  - Create a Certificate in PENDING and enqueue `certificate.render`.
  - Alert everyone (`eotm.announced`) and email the recipient.
  - Emit `eotm.announced`.
- **Certificate lifecycle**: PENDING → READY once the render job has uploaded the PDF and set `sha256`. PENDING → FAILED after 3 retries, and an alert is sent to `certificate.manage` holders. READY → REVOKED via `certificate.manage` with a reason; the verify page then shows "Revoked on …".
- **Re-render**: `POST /certificates/:id/regenerate` (`certificate.manage`) keeps the same code.

### 4.4 API
- `GET /kudos?tab=all|given|received&cursor` (`kudos.view`), `POST /kudos` (`kudos.give`), `POST /kudos/:id/revoke`.
- `GET /badges`. `POST/PATCH /badges/:id` (`badge.manage`); system badges cannot be edited or deleted.
- `GET /users/:id/badges` returns `[{badgeId, name, icon, count, lastAt}]` (public inside the tenant).
- `GET /eotm?year` and `GET /eotm/current`. `POST /eotm` (`eotm.announce`). `POST /eotm/:id/revoke` (`eotm.announce`, which also revokes the certificate).
- `GET /certificates/mine`, `GET /certificates/:id/download` (the recipient, `certificate.manage`, or everyone for EOTM, since the award is public), `POST /certificates/:id/regenerate`, `POST /certificates/:id/revoke`.
- **Public**: `GET /public/certificates/verify/:code`. No auth. Rate limited to 30 requests per minute per IP. Returns `{valid, status, holderName, title, subtitle, issuedAt, issuer: tenant.displayName, logoUrl}` and never an employee ID, email or anything else.
- `POST /public/certificates/verify/:code/file` accepts an uploaded PDF, compares its sha256 and returns `{matches}`.

### 4.5 Rules
- **Kudos anti-spam**: a giver can give a recipient the same badge at most once per 7 days, and can give at most 10 kudos per 7 days. Violations return 429 `KUDOS_LIMIT`.
- **EOTM**: one per tenant per month (enforced by the unique constraint). The month cannot be in the future. The recipient must have been ACTIVE during that month.
- **Verification code**: 10 characters of Crockford base32 from 50 bits of CSPRNG output, shown formatted as `XXXXX-XXXXX`. The PDF footer carries a QR code for `https://{tenantDomain}/verify/{code}` and a sha256 fingerprint prefix.
- **Certificate PDF**: A4 landscape, tenant branding (logo and accent colour from the Whitelabel domain), holder name, title, citation (EOTM) or course name and completion date (COURSE), issue date, signatory name and title from tenant settings (default: Admin/CEO), QR code and code.

### 4.6 Jobs, notifications, audit
- **Jobs**: `certificate.render` (BullMQ queue `pdf`, 3 attempts, exponential backoff), which also copies the file to the recipient's Vault (Vault domain contract `VaultService.addSystemDocument`).
- **Notifications**: `kudos.received`, `eotm.announced`, `certificate.ready`.
- **Audit**: `kudos.give|revoke`, `eotm.announce|revoke`, `certificate.issue|regenerate|revoke`, and `certificate.verify` (public; logs the IP hash only).

### 4.7 Integrations
- `PdfRenderer { renderHtml(html: string, opts: {format:'A4', landscape:boolean}): Promise<Buffer> }`.
  - Default: Puppeteer/Chromium in the worker container.
  - Mock (tests): a minimal PDF built with pdf-lib.
  - Shared with Payslips and ID cards: this domain defines the interface and the Platform domain hosts the worker.

### 4.8 Edge cases
- The recipient leaves after the award: the certificate remains valid and the name is preserved in `metadata.holderName` (a snapshot).
- Tenant rename: new renders use the new name; old PDFs are untouched.
- Deleting a badge that is in use is blocked; the badge is deactivated instead.

### 4.9 Phase and dependencies
- P2 for everything in this module.
- Depends on: §3 Feed, People (profile), Vault, Whitelabel settings, Notifications.

### 4.10 Acceptance scenarios
1. **Kudos end to end.** A manager gives Rahul "Star Coder". A KUDOS post appears on the feed, Rahul gets an alert and an email, `GET /users/rahul/badges` includes Star Coder ×1, and the sidebar lists "Star Coder → Rahul D.".
2. **Kudos limits.** The same manager gives Rahul Star Coder again within 7 days and gets 429. Self-kudos returns 422.
3. **EOTM uniqueness.** Admin announces September for Priya. The feed shows an EOTM post, and the certificate reaches READY within 30 s. A second EOTM for September returns 409.
4. **Verification and revocation.** Download the PDF, scan its QR and open `/verify/{code}` without logging in: it shows valid, Priya Sharma, "Employee of the Month · September 2026", Lexisora Infotech. Uploading the same PDF returns `matches=true`. After revocation it shows "Revoked".
5. **Permission.** An employee calls `POST /kudos` and gets 403, because kudos.give is not granted to employees by default.

---

## 5. Comms hub: chat, calls, screen share and recordings

Phasing: P1 text chat; P2 calls and recordings; P3 encryption.

### 5.1 Screens and UX (lines 679-693)
- **Left rail**:
  - "Channels": the channels I belong to, with an unread badge (1-99, then "99+").
  - "Direct messages": DMs, with a presence dot.
  - A "+" to browse or join public channels, or create one (`chat.channel.create`).
  - A "+ New message" to start a DM or group DM (up to 8 people).
- **Header**: channel name (or the DM person's name), topic, member count. Buttons: Audio, Video, Share screen (P2), and a "⋯" menu with Members, Pinned, Files, Recordings, Mute and Leave.
- **Messages pane**:
  - Grouped by day with separators and a "New messages" divider at `lastReadSeq`.
  - Each message: avatar initials, name, time (HH:mm), and body (markdown-lite: bold, italic, code, links, @mentions, #channel).
  - Attachments as chips or thumbnails; edited marker; reactions (emoji, optional P2).
  - Hover actions: reply-quote, edit (own, within 15 minutes), delete (own, or `chat.channel.manage`), copy link.
  - Scrolling up loads 50 more messages per page.
- **Typing indicator**: "Neha is typing…" under the pane.
- **Composer**: input plus Send, with Enter to send and Shift+Enter for a newline. Also an attach button (up to 10 files of 25 MB each) and an emoji picker. Composer draft is saved per channel in localStorage.
- **#announcements**: read-only unless the user has `chat.announce.post`, in which case the composer is shown. Otherwise it displays "Only HR/Admin can post here".
- **Call UI** (P2):
  - Starting a call sends `call:ring` to online members: a toast with Join and Dismiss, plus a sound.
  - The call window is a modal or pop-out with a tile grid, and mute, camera, share screen, record (`chat.call.record`) and leave controls. Recording shows a red "REC" banner to all participants.
  - When the call ends, a system message is posted: "Call · 23 min · 4 participants".
  - When the recording is ready, a system message is posted: "Recording available", with an inline player.
- **Search** (P1): search inside a channel, and across all my channels with filters `from:`, `in:` and a date range.

### 5.2 Data model
```prisma
model Channel { id; tenantId; kind ChannelKind; name String? @db.VarChar(60) /* slug, null for DM */; displayName String?; topic String?; 
  linkedType ChannelLink?; linkedId String? @db.Uuid; dmKey String? /* sorted userIds joined */; postingPolicy PostingPolicy @default(ALL_MEMBERS)
  createdById; archivedAt DateTime?; lastMessageSeq BigInt @default(0); lastMessageAt DateTime?
  @@unique([tenantId, name]) @@unique([tenantId, dmKey]) @@unique([tenantId, linkedType, linkedId]) }
enum ChannelKind { PUBLIC PRIVATE DM GROUP_DM }
enum ChannelLink { COMPANY_GENERAL COMPANY_ANNOUNCEMENTS DEPARTMENT PROJECT }
enum PostingPolicy { ALL_MEMBERS ADMINS_ONLY }
model ChannelMember { tenantId; channelId; userId; role MemberRole @default(MEMBER); joinedAt; lastReadSeq BigInt @default(0); muted Boolean @default(false)
  notifyLevel NotifyLevel @default(ALL); managedBy MembershipSource @default(MANUAL)
  @@id([channelId, userId]) @@index([tenantId, userId]) }
enum MemberRole { OWNER ADMIN MEMBER }
enum NotifyLevel { ALL MENTIONS NONE }
enum MembershipSource { MANUAL AUDIENCE /* synced from dept/project */ }
model Message { id; tenantId; channelId; seq BigInt; senderId String? /* null = system */; kind MessageKind @default(USER)
  body String? /* plaintext P1-P2; ciphertext base64 in P3 */; encKeyVersion Int?; bodyTsv Unsupported("tsvector")?
  replyToId String?; mentions String[] @db.Uuid; editedAt DateTime?; deletedAt DateTime?; clientMsgId String @db.VarChar(36)
  attachments MessageAttachment[]
  @@unique([channelId, seq]) @@unique([tenantId, senderId, clientMsgId]) @@index([tenantId, channelId, seq(sort: Desc)]) }
enum MessageKind { USER SYSTEM CALL_SUMMARY RECORDING }
model MessageAttachment { id; tenantId; messageId; fileId; name; mime; sizeBytes Int; width Int?; height Int?; scanStatus ScanStatus }
model Call { id; tenantId; channelId; kind CallKind; roomName String @unique; startedById; startedAt; endedAt DateTime?; maxParticipants Int @default(0)
  participants CallParticipant[]; recordings CallRecording[] }
enum CallKind { AUDIO VIDEO }
model CallParticipant { id; tenantId; callId; userId; joinedAt; leftAt DateTime?; @@index([callId, userId]) }
model CallRecording { id; tenantId; callId; startedById; egressId String @unique; status RecStatus; fileId String?; durationSec Int?; sizeBytes BigInt?; startedAt; endedAt DateTime?; expiresAt DateTime? }
enum RecStatus { STARTING RECORDING PROCESSING READY FAILED PURGED }
model ChatSettings { tenantId @id; editWindowMin Int @default(15); messageRetentionDays Int? /* null = forever */; recordingRetentionDays Int @default(90); autoRecord Boolean @default(false); allowEmployeeChannelCreate Boolean @default(false) }
```
- **Seeding and auto-created channels**:
  - `#general` (COMPANY_GENERAL, audience ALL, auto-join).
  - `#announcements` (COMPANY_ANNOUNCEMENTS, ADMINS_ONLY posting, auto-join).
  - Department channels such as `#qa-team`, created on `department.created`, with slug `{dept}-team`.
  - Project channels such as `#atlas-crm`, created on `project.created`, with the slug from the project name. PRIVATE, members = the project team.
  - `managedBy=AUDIENCE` members are added and removed by the sync.

### 5.3 Workflows
- **Send**:
  - The client emits `message:send {channelId, clientMsgId, body, attachmentFileIds[], replyToId}`.
  - The server authorises (member, not archived, posting policy), then inside a transaction increments `Channel.lastMessageSeq` with `UPDATE … RETURNING` and inserts the message with that seq.
  - The ack returns `{id, seq, createdAt}` and the server broadcasts `message:new` to the `ch:{channelId}` room.
  - For each member not in the room, it increments unread over `user:{id}` with `channel:unread {channelId, count}`.
  - Mention notifications follow `notifyLevel`.
  - Idempotency comes from the unique `(senderId, clientMsgId)`: a retry returns the existing message.
- **Read**: emit `channel:read {channelId, seq}`. This sets `lastReadSeq = max(existing, seq)` and syncs the other devices of the same user.
- **Edit**: allowed within `editWindowMin` for the sender. Broadcasts `message:updated`.
- **Delete**: soft delete; the body is nulled and rendered as "Message deleted". Broadcasts `message:deleted`.
- **Channel lifecycle**: create → archive (`chat.channel.manage` or owner) → unarchive. Audience-linked channels cannot be left, only muted.
- **Call** (P2):
  - `POST /chat/channels/:id/calls {kind}` returns `{callId, livekitUrl, token}`. If a call is already live for the channel, it returns that call instead (one live call per channel).
  - Joining: `POST /chat/calls/:id/join` returns a token.
  - The LiveKit webhook `participant_joined`/`participant_left` updates participants, and `room_finished` ends the call and posts a CALL_SUMMARY.
  - **Recording**: `POST /chat/calls/:id/recordings` (`chat.call.record`, or `autoRecord`) starts a LiveKit room-composite egress to S3 at `tenants/{t}/recordings/{callId}/{recId}.mp4` and broadcasts `call:recording {state:'on'}`.
  - The `egress_ended` webhook sets the recording to PROCESSING, then READY once the file is stored, and posts a RECORDING message.
  - Recordings are visible to channel members (the "cloud archive" is the channel's Recordings panel plus `GET /chat/recordings`).

### 5.4 API
- **REST**, permission `chat.use` unless stated:
  - `GET /chat/channels` (mine, with unread counts and last message preview).
  - `GET /chat/channels/browse` (public channels).
  - `POST /chat/channels` (`chat.channel.create`).
  - `PATCH /chat/channels/:id`, archive/unarchive, and `POST/DELETE /chat/channels/:id/members` (owner/admin or `chat.channel.manage`).
  - `POST /chat/channels/:id/join` (PUBLIC only), `POST /chat/channels/:id/leave`.
  - `POST /chat/dms {userIds[]}` returns an existing or new DM or group DM.
  - `GET /chat/channels/:id/messages?beforeSeq&afterSeq&limit≤100`.
  - `POST /chat/channels/:id/messages` (REST fallback for socket send).
  - `PATCH /chat/messages/:id` and `DELETE /chat/messages/:id`.
  - `PATCH /chat/channels/:id/me {muted, notifyLevel}`.
  - `GET /chat/search?q&channelId&from&after&before`.
  - Calls (`chat.call.start`): `POST /chat/channels/:id/calls`, `POST /chat/calls/:id/join`, `POST /chat/calls/:id/leave`.
  - Recordings: `POST /chat/calls/:id/recordings` and `POST /chat/recordings/:id/stop` (`chat.call.record`). `GET /chat/recordings?channelId` and `GET /chat/recordings/:id/stream` (member only).
  - Retention: `PATCH /chat/settings` (`chat.retention.manage`).
  - Webhook: `POST /integrations/livekit/webhook` (signature-verified, no user auth).
- **Socket.IO namespace `/rt`**, authenticated with the JWT at the handshake.
  - Rooms: `user:{id}`, `ch:{channelId}` (joined for all member channels on connect and on membership events), `tenant:{t}:feed`.
  - Client → server: `message:send`, `typing {channelId, on}`, `channel:read`, `presence:set {status}`.
  - Server → client: `message:new`, `message:updated`, `message:deleted`, `typing {channelId, userId, on}`, `channel:unread`, `channel:updated`, `channel:member`, `presence {userId, status}`, `call:ring {callId, channelId, kind, from}`, `call:ended`, `call:recording`.
  - Uses the Redis adapter.

### 5.5 Rules
- **Unread** = `Channel.lastMessageSeq − member.lastReadSeq`, counting only messages from others. This is kept exact by a correction query when the channel opens. Muted channels show a grey dot instead of a count.
- **Typing**: throttled on the client to one emit per 3 s. The server does not persist it and expires it after 5 s.
- **Presence**: `online` while any socket is connected, `away` after 10 minutes with no client activity, and `offline` 60 s after the last socket disconnects.
- **Offline DM email**: an email digest is sent if the recipient has been offline for 30 minutes and has DMs or mentions, at most one per user per 2 hours.
- **Retention**: when `messageRetentionDays` is set, a nightly purge hard-deletes older messages and attachments. `#announcements` is exempt. Recordings expire at `startedAt + recordingRetentionDays`.
- **Search**: Postgres full-text on `bodyTsv` in P1-P2, restricted to channels the user is a member of.
- **Encryption (P3)**:
  - Each tenant has a data key (DEK) wrapped by a KMS key-encryption key (KEK). Message bodies and recording objects are encrypted with AES-256-GCM, storing `encKeyVersion`.
  - `bodyTsv` is dropped, and search becomes a server-side decrypt-and-scan over a bounded window (see open question 7).
  - Super-admin exclusion is enforced both by the API guard and by the KMS key policy.

### 5.6 Jobs, notifications, audit
- **Jobs**:
  - `chat.syncAudienceMembers` on People and Projects membership events.
  - `chat.attachmentScan`: AV scan; the file is downloadable only when clean.
  - `chat.offlineDigest`: every 15 minutes.
  - `chat.retentionPurge`: nightly.
  - `chat.recordingFinalize`: triggered by the webhook; ffprobe the file, set duration and size.
  - `chat.recordingPurge`: nightly.
  - `chat.callReaper`: every 5 minutes; ends calls with no participants for 2 minutes.
- **Notifications**: `chat.mention`, `chat.dm` (in-app plus the email digest), `chat.recording.ready`.
- **Audit**: `chat.channel.create|archive|member.add|member.remove`, `chat.message.delete` (moderator deleting another user's message), `chat.recording.start|stop|view|purge`, `chat.settings.update`. Message content is never audited.

### 5.7 Integrations
```
interface RtcProvider {
  createRoom(name, opts:{maxParticipants, emptyTimeoutSec}): Promise<void>;
  issueToken(p:{room, identity, name, canPublish, canPublishSources:('microphone'|'camera'|'screen_share')[], ttlSec}): Promise<string>;
  startRecording(room, s3Target:{bucket, key}): Promise<{egressId}>;
  stopRecording(egressId): Promise<void>;
  endRoom(room): Promise<void>;
  verifyWebhook(rawBody, authHeader): RtcEvent;
}
```
- **Real adapter**: `livekit-server-sdk` against self-hosted LiveKit plus Egress (both added to Docker Compose), with MinIO as the S3 target.
- **Mock adapter**: returns a dummy token. The client mock renders placeholder tiles, and recordings produce a 5-second sample mp4.

### 5.8 Validation and edge cases
- Body is 1-4000 characters, or empty when attachments are present.
- Channel slug: `^[a-z0-9][a-z0-9-]{1,59}$`, unique per tenant.
- DM with self: allowed, as "notes to self".
- Messaging a user who has left: their DM becomes read-only, showing "User deactivated".
- Out-of-order delivery: the client sorts by `seq` and detects gaps (a `message:new` with a seq greater than the last known + 1 triggers a `GET afterSeq`).
- Reconnect: the client refetches `afterSeq` for the active channel and reloads the channel list with unread counts.
- Screen sharing is web-only in P2. The Electron tracker is not a chat client.

### 5.9 Phase and dependencies
- P1: text chat, attachments, search.
- P2: calls, screen share, recordings.
- P3: per-tenant encryption and the retention and legal-hold controls.
- Depends on: People and Projects (audience sync), Storage and AV, Notifications, the Platform KMS (P3).

### 5.10 Acceptance scenarios
1. **Realtime and unread.** A and B are both in `#atlas-crm`. A sends a message; B's open pane receives it in under 500 ms with the correct seq. C, in the channel but offline, has unread 1. C opens the channel and unread becomes 0 on every device C has.
2. **Idempotency.** Resending the same `clientMsgId` after a network drop does not create a duplicate.
3. **Announcements channel.** An employee's post to `#announcements` returns 403. HR's post succeeds.
4. **Project membership sync.** Adding Priya to the Atlas project adds her to `#atlas-crm` (AUDIENCE-managed). Removing her from the project removes her from the channel, and message history then returns 403 for her.
5. **Calls and recording (P2).** Start a video call in `#qa-team` and a second member joins. Start recording, share a screen, then end the call. A CALL_SUMMARY message is posted, the recording goes READY in MinIO, and members can stream it while non-members get 403.
6. **Super-admin exclusion.** A super-admin principal calls `GET /chat/channels/:id/messages` and gets 403. The attempt is logged in the platform audit.

---

## 6. Helpdesk (P1)

### 6.1 Screens and UX (GEN.helpdesk, FORMS.ticket)
- Title "Helpdesk", subtitle "Raise IT or HR tickets and track them to resolution." Action: "Raise ticket".
- **Tabs**:
  - **My tickets**: requester = me.
  - **Assigned to me**: assignee = me, plus unassigned tickets in my support groups, labelled "Unassigned (group)". Shown only to users with `helpdesk.ticket.work`.
  - **All**: `helpdesk.ticket.view.all`.
  - **Escalations**: tickets escalated to me (`helpdesk.escalation.receive`). The dashboard deep-links here.
  - **Settings**: categories, groups and SLA (`helpdesk.admin`).
- **Columns**: Ticket (HD-1042), Subject, Category, Priority (High = `!` outline tag), Assignee (a person, or a group name such as "IT desk"), Status tag.
- **Added columns**: SLA (a countdown chip, or Breached in red text) and Updated.
- **Filters**: status, category, priority, and SLA state (on track, at risk, breached).
- **Row click** opens the ticket detail:
  - Header: number, subject, status select, priority, assignee picker, category.
  - Timeline of comments. Public replies are visible to the requester. Internal notes are visible to agents only and have a yellow background.
  - Attachments.
  - SLA panel: first-response due and resolution due, with elapsed and paused time.
  - Actions: Resolve (with resolution note), Reopen (requester, within 7 days), Cancel (requester, while OPEN), Escalate manually, and a CSAT 1-5 prompt after resolve.
- **Raise ticket form**:
  - Category: IT hardware, IT access, Payroll, HR. The categories are tenant-managed.
  - Priority: Medium (default), High, Low.
  - Subject: 5-150 characters.
  - Description: 10-5000 characters.
  - Attachment: up to 5 files of 10 MB.
  - Toast "Ticket HD-{n} created".
  - Added: an optional "Related asset" select from my assigned assets (Assets domain), shown only for IT hardware.

### 6.2 Data model
```prisma
model SupportGroup { id; tenantId; name String /* "IT desk","Payroll desk","HR desk" */; leadUserId String?; members SupportGroupMember[]; active Boolean
  @@unique([tenantId, name]) }
model SupportGroupMember { tenantId; groupId; userId; @@id([groupId, userId]) }
model TicketCategory { id; tenantId; name String; defaultGroupId; restricted Boolean @default(false) /* payroll/HR: requester+group+HR/admin only */; active Boolean; sortOrder Int
  @@unique([tenantId, name]) }
model SlaPolicy { id; tenantId; priority TicketPriority; firstResponseMins Int; resolutionMins Int; businessHoursOnly Boolean @default(true)
  @@unique([tenantId, priority]) }
model Ticket { id; tenantId; number Int; categoryId; priority TicketPriority; subject String @db.VarChar(150); description String; status TicketStatus @default(OPEN)
  requesterId; assigneeId String?; groupId; assetId String?; 
  firstResponseDueAt DateTime; resolutionDueAt DateTime; firstRespondedAt DateTime?; resolvedAt DateTime?; closedAt DateTime?; pausedMins Int @default(0); pausedSince DateTime?
  slaState SlaState @default(ON_TRACK); escalationLevel Int @default(0); escalatedToIds String[] @db.Uuid; csat Int?; csatComment String?; reopenCount Int @default(0)
  @@unique([tenantId, number]) @@index([tenantId, requesterId, status]) @@index([tenantId, assigneeId, status]) @@index([tenantId, groupId, status]) @@index([tenantId, status, resolutionDueAt]) }
enum TicketPriority { LOW MEDIUM HIGH }
enum TicketStatus { OPEN IN_PROGRESS WAITING_ON_REQUESTER RESOLVED CLOSED CANCELLED }
enum SlaState { ON_TRACK AT_RISK BREACHED MET }
model TicketComment { id; tenantId; ticketId; authorId String?; visibility CommentVisibility; body String @db.VarChar(5000); kind TicketEventKind @default(COMMENT); meta Json?; attachments TicketAttachment[] }
enum CommentVisibility { PUBLIC INTERNAL }
enum TicketEventKind { COMMENT STATUS_CHANGE ASSIGNMENT ESCALATION PRIORITY_CHANGE }
model TicketAttachment { id; tenantId; ticketId; commentId String?; fileId; name; sizeBytes Int }
```
- **Seeds**:
  - Groups: IT desk, Payroll desk, HR desk.
  - Categories: IT hardware → IT desk; IT access → IT desk; Payroll → Payroll desk (restricted); HR → HR desk (restricted).
  - SLA:

    | Priority | First response | Resolution |
    |---|---|---|
    | HIGH | 60 min | 480 min (8 business hours) |
    | MEDIUM | 240 min | 1440 min (3 business days) |
    | LOW | 480 min | 2400 min (5 business days) |

### 6.3 State machine
| From | To | Who | Side effect |
|---|---|---|---|
| (new) | OPEN | requester | Number assigned, SLA clocks start, group notified, auto-assign if the group has round-robin enabled |
| OPEN | IN_PROGRESS | agent (assignee) | Sets `firstRespondedAt` if not set |
| OPEN or IN_PROGRESS | WAITING_ON_REQUESTER | agent | Sets `pausedSince` and alerts the requester |
| WAITING_ON_REQUESTER | IN_PROGRESS | automatic when the requester replies, or agent | `pausedMins += elapsed business minutes`, due dates shift by the same amount |
| any open state | RESOLVED | agent | Resolution note required; sets `resolvedAt`, `slaState = MET` or `BREACHED` (final); CSAT request to the requester |
| RESOLVED | IN_PROGRESS (reopen) | requester within 7 days | `reopenCount++`; the resolution SLA restarts from its remaining time (no reset) |
| RESOLVED | CLOSED | job after 3 days, or requester confirms | — |
| OPEN | CANCELLED | requester | — |

- Any public comment by an agent counts as the first response.

### 6.4 SLA and escalation rules
- **Business calendar**: Mon-Fri 09:30-18:30 in the tenant timezone, excluding tenant holidays (Leave domain holiday calendar). Configurable per tenant.
- **Due dates**: `due = addBusinessMinutes(createdAt, policy.mins)` using `BusinessCalendar.addMinutes(tenantId, start, mins)`.
- **Monitor**, every 5 minutes. For open tickets whose clock is not paused, `pct = elapsedBusinessMins / (resolutionMins + pausedAdj)`:
  - **pct ≥ 0.8**: `slaState = AT_RISK`, and the assignee (or the group lead if unassigned) gets an alert.
  - **Level 1 escalation**, when first response breaches or `pct ≥ 1.0`: `escalationLevel = 1`, `slaState = BREACHED`. `escalatedToIds` is set to the group lead plus the assignee's reporting manager (People domain). If the requester is the lead themself, the requester's RM is excluded. Alerts go to the escalation targets.
  - **Level 2 escalation** at `pct ≥ 1.5`: `escalationLevel = 2`, and HR/admin holders of `helpdesk.escalation.receive` are added. For IT categories, users with the admin role are added.
  - Escalation targets must hold `helpdesk.escalation.receive`.
- **Dashboard "Helpdesk escalations"** = count of tickets that are not resolved, closed or cancelled and where `escalatedToIds` contains me.
- **Restricted categories** (Payroll, HR): a ticket is visible only to the requester, members of its group and holders of `helpdesk.ticket.view.all`. A lead or RM who is an escalation target sees only the header (number, subject, status, SLA) and cannot see comments, because payroll details are sensitive.
- **Auto-assign**: off by default. When a group has `roundRobin` on, the ticket goes to the member with the fewest open tickets, with ties broken by the oldest `lastAssignedAt`.

### 6.5 API
- `GET /helpdesk/tickets?tab=mine|assigned|all|escalations&status&category&priority&sla&q&cursor`.
- `POST /helpdesk/tickets` (`helpdesk.ticket.create`).
- `GET /helpdesk/tickets/:id`, with visibility rules applied.
- `PATCH /helpdesk/tickets/:id` (status, priority, assignee, category). Requires `helpdesk.ticket.work` and group membership, or `view.all`. Category changes re-route to the new category's group.
- `POST /helpdesk/tickets/:id/comments {visibility, body, fileIds}`. The requester can only post PUBLIC comments.
- `POST /helpdesk/tickets/:id/resolve`, `/reopen`, `/cancel`, `/close`, `/escalate` (manual, agent), `/csat`.
- Admin (`helpdesk.admin`): `GET/POST/PATCH /helpdesk/groups`, `/helpdesk/categories`, `/helpdesk/sla`.
- `GET /helpdesk/reports?from&to` returns volume, first-response and resolution medians, SLA-met %, and CSAT average, by category.
- Realtime: `ticket:updated {id}` to the requester, the assignee and group members.

### 6.6 Jobs, notifications, audit
- **Jobs**: `helpdesk.slaMonitor` every 5 minutes, `helpdesk.autoClose` hourly, `helpdesk.csatReminder` 24 hours after resolve.
- **Notifications**: `ticket.created` (group), `ticket.assigned`, `ticket.comment` (the other party), `ticket.waiting` (requester), `ticket.resolved` (requester, with email), `ticket.atRisk`, and `ticket.escalated` (mandatory).
- **Email reply-to**: P2. Inbound mail parsing is an adapter, stubbed.
- **Audit**: `ticket.create|status|assign|priority|category|escalate|resolve|reopen|cancel`, and `helpdesk.config.update`.

### 6.7 Edge cases
- A requester who is also an agent in the group cannot self-assign a restricted ticket.
- A ticket created outside business hours starts its clock at the next business open.
- A holiday added mid-ticket: due dates are not recomputed. This is a documented choice to keep past SLA data stable.
- Deleting a category that has open tickets is blocked; deactivate it instead.
- Other domains create tickets through `HelpdeskService.createTicket({requesterId, categoryName, subject, description, link})`. Example: a "Raise ticket" button on a payslip prefills the Payroll category.

### 6.8 Phase and dependencies
- P1.
- Depends on: People (reporting manager), Leave (holiday calendar), Assets (optional related asset), Storage, Notifications. Provides `approvals.helpdesk` and a todo provider to the Dashboard.

### 6.9 Acceptance scenarios
1. **Create, route, SLA.** An employee raises "Laptop battery drains fast" (IT hardware, High) at Tue 10:00. It gets number HD-{n+1}, group IT desk, first-response due 11:00 and resolution due 18:00 the same day. IT desk members get an alert.
2. **Pause.** An agent sets WAITING_ON_REQUESTER at 11:00. The requester replies at 14:00. The status returns to IN_PROGRESS and the resolution due time moves forward by 180 minutes.
3. **Escalation.** A High ticket gets no response and is not resolved. By 80% of the resolution SLA the assignee has the AT_RISK alert. At breach, the group lead and the RM get escalations and the RM's dashboard shows "Helpdesk escalations 1". At 150%, HR is added.
4. **Restricted visibility.** A Payroll ticket raised by Priya: an IT desk member gets 404, the Payroll desk sees full detail, and Priya's RM (as escalation target) sees the header with comments hidden.
5. **Resolve, reopen, close.** Resolve, then the requester reopens within 7 days: the status goes back to IN_PROGRESS and `reopenCount` is 1. After a second resolve with no action for 3 days, it becomes CLOSED automatically.

---

## 7. Learning / LMS (P2)

### 7.1 Screens and UX (GEN.lms tiles, FORMS.course)
- Title "Learning", subtitle "Training videos and coding guidelines. Certificates issue automatically on completion." Action: "Upload course" (`lms.course.manage`).
- **Learner tabs**:
  - **My learning**: tiles for my enrollments.
  - **Catalogue**: published courses open to me, where "Enroll" self-enrols me in an optional course.
  - **Certificates**.
- **Admin tabs** (managers of courses):
  - **Manage courses**: table with columns Title, Category, Lessons, Assigned to, Enrolled, Completed %, Overdue, Status.
  - **Reports**.
- **Tile layout**: a media thumbnail (the "Video" placeholder, or the first-lesson poster); kicker "{Required|Optional|Onboarding} · {duration}"; title; a status line; and a CTA.

  | State | Status line | CTA |
  |---|---|---|
  | NOT_STARTED | "Not started" | Start |
  | IN_PROGRESS | "{done} of {total} lessons done" | Continue (opens the next incomplete lesson at the last position) |
  | COMPLETED, certificate enabled | "Completed · certificate ready" | Download certificate |
  | COMPLETED, no certificate | "Completed" | Review |
  | OVERDUE | status in the outline tag | as for its progress state |

  A due chip shows "Due 12 Oct".
- **Course player**:
  - Left: lesson list with check marks.
  - Main: HLS video player (hls.js) with speed up to 1.5× and a transcript or description beneath. DOCUMENT lessons use PDF.js with a "Mark as read" button enabled after 10 s at the last page.
  - A "Next lesson" button.
- **Upload course form** (initial): Title; Video (the first lesson; mp4, mov or webm, at most 2 GB, uploaded resumably with a multipart presign); Certificate on completion (Yes/No); Assign to (All employees, a department (e.g. "All developers" = department Development), a project, a role, employment type Interns, specific employees, or "New joiners"). The Publish button creates the course and opens the course editor.
- **Course editor** (added): category, description, estimated minutes (automatic from the lessons), lessons (add video or document, reorder, title), assignments (add multiple, each with "due in N days" and required yes/no), and publish or archive.

### 7.2 Data model
```prisma
model Course { id; tenantId; title String @db.VarChar(150); description String?; category CourseCategory; certificateOnCompletion Boolean @default(true)
  status CourseStatus @default(DRAFT); thumbnailFileId String?; totalDurationSec Int @default(0); version Int @default(1); createdById; publishedAt DateTime?
  lessons Lesson[]; assignments CourseAssignment[] @@index([tenantId, status]) }
enum CourseCategory { REQUIRED OPTIONAL ONBOARDING }
enum CourseStatus { DRAFT PUBLISHED ARCHIVED }
model Lesson { id; tenantId; courseId; order Int; title; type LessonType; sourceFileId String; hlsManifestKey String?; posterKey String?; durationSec Int?; pageCount Int?; transcodeStatus MediaStatus
  @@unique([courseId, order]) }
enum LessonType { VIDEO DOCUMENT }
enum MediaStatus { PENDING PROCESSING READY FAILED }
model CourseAssignment { id; tenantId; courseId; audienceType AudienceType /* + NEW_JOINERS handled as flag */; refId String?; newJoiners Boolean @default(false); required Boolean; dueInDays Int?; assignedById
  @@index([tenantId, courseId]) }
model Enrollment { id; tenantId; courseId; userId; source EnrollSource; assignmentId String?; required Boolean; assignedAt; dueAt DateTime?; status EnrollStatus @default(NOT_STARTED)
  startedAt DateTime?; completedAt DateTime?; progressPct Int @default(0); lessonsDone Int @default(0); certificateId String?; courseVersion Int
  @@unique([courseId, userId]) @@index([tenantId, userId, status]) @@index([tenantId, status, dueAt]) }
enum EnrollSource { ASSIGNED SELF }
enum EnrollStatus { NOT_STARTED IN_PROGRESS COMPLETED }   // OVERDUE is derived: dueAt < now && status != COMPLETED
model LessonProgress { tenantId; enrollmentId; lessonId; watchedSec Int @default(0); maxPositionSec Int @default(0); lastPositionSec Int @default(0); watchedBitmap Bytes? /* 10s buckets */; completedAt DateTime?
  @@id([enrollmentId, lessonId]) }
```

### 7.3 Workflows
- **Course**: DRAFT → PUBLISHED, which requires at least one lesson and every lesson READY. PUBLISHED → ARCHIVED hides the course from the catalogue while existing enrollments stay viewable. PUBLISHED can move back to DRAFT only when there are no enrollments.
- **Assignment materialisation**, on assignment create or on publish: resolve the audience and upsert an Enrollment for each user. Existing SELF enrollments are upgraded to ASSIGNED with the `required` flag. `dueAt = assignedAt + dueInDays` (end of that local day).
- **Continuing assignments**: on `employee.created` and on department or project changes, matching assignments create enrollments. `newJoiners` assignments use `dueAt = joiningDate + dueInDays`, with a default of 14 days for the ONBOARDING category.
- **Progress heartbeat**: every 15 s the player posts `{lessonId, positionSec, playing}`.
  - The server marks the 10-second buckets between the last position and the new one as watched, but only if the delta is at most 20 s × playbackRate. Larger jumps (seeks) are not credited.
  - A VIDEO lesson is complete when watched buckets reach at least 90% of `ceil(durationSec/10)`.
  - A DOCUMENT lesson is complete on "Mark as read".
- **Course completion**: when all lessons are complete, set COMPLETED, `completedAt`, and `progressPct = 100`. If `certificateOnCompletion`, create a Certificate (type COURSE; title = course title; subtitle "Completed on {date}") and render it (§4). Alert the learner. Emit `course.completed`.
- **Course changes**: adding a lesson to a PUBLISHED course sets `version++`. Existing COMPLETED enrollments stay completed. IN_PROGRESS enrollments see the new lesson, and `progressPct` is recomputed.

### 7.4 API
- `GET /lms/my?status` returns the tiles. `GET /lms/catalogue`. `POST /lms/courses/:id/enroll` (self, OPTIONAL courses or any course open to me).
- `GET /lms/courses/:id` (enrolled, or `lms.course.manage`).
- `GET /lms/lessons/:id/playback` returns a short-lived signed HLS manifest URL. Segment URLs are signed through a proxy, or use MinIO presigned URLs with a 10-minute TTL.
- `POST /lms/lessons/:id/progress` (heartbeat) and `POST /lms/lessons/:id/complete` (DOCUMENT lessons).
- `lms.course.manage`: `POST /lms/courses`, `PATCH /lms/courses/:id`, `POST /lms/courses/:id/lessons`, `PATCH /lms/lessons/:id`, `POST /lms/courses/:id/lessons/reorder`, `POST /lms/courses/:id/publish`, `POST /lms/courses/:id/archive`.
- `lms.assign`: `POST /lms/courses/:id/assignments`, `DELETE /lms/assignments/:id`. Deleting removes NOT_STARTED enrollments from that source and keeps the rest.
- `lms.report.view`: `GET /lms/reports/courses/:id` (per-user progress, CSV export) and `GET /lms/reports/overdue`.
- `GET /users/:id/learning` returns completions (for the profile and Appraisal domains).

### 7.5 Rules
- Tile duration = the sum of `durationSec`, formatted as "40 min" or "1h 10m".
- `progressPct = round(100 × Σ lessonCompletionFraction / lessonCount)`, where the fraction for an incomplete video is its watched share, capped at 0.9.
- "{done} of {total}" counts completed lessons only.
- Required courses feed the Dashboard to-do list when due within 7 days or overdue.
- Onboarding courses also appear in the People domain's onboarding checklist, through a contract.

### 7.6 Jobs, notifications, audit
- **Jobs**:
  - `lms.transcode`: queue `media`, ffmpeg in the worker. Produces HLS at 360p, 720p and 1080p where the source allows, a poster, and the duration. On failure the lesson is FAILED with an alert.
  - `lms.materialiseAssignment`.
  - `lms.dueReminders`: daily at 09:00. Reminds at 3 days before due and on the due day; once overdue, an alert every 3 days, plus a weekly digest to the learner's RM.
- **Notifications**: `course.assigned`, `course.dueSoon`, `course.overdue`, `course.completed`, `certificate.ready`.
- **Audit**: `lms.course.create|publish|archive`, `lms.assignment.create|delete`, `lms.certificate.issue`.

### 7.7 Integrations
- `VideoTranscoder { transcode(input:{bucket,key}, output:{bucket,prefix}): Promise<{manifestKey, posterKey, durationSec}> }`.
  - Default: local ffmpeg.
  - Mock: copy the mp4 and return a stub manifest that points at the mp4, using a progressive fallback player.

### 7.8 Edge cases
- Transcoding is still running at publish: blocked with 409 `LESSON_NOT_READY`.
- A user outside an assignment's audience after a department change: an unstarted required enrollment is removed, and a started one is kept but made optional.
- Parallel tabs send heartbeats: the watched bitmap is merged with bitwise OR, so progress is not double-counted.
- A 0-second video is rejected.

### 7.9 Phase and dependencies
- P2.
- Depends on: Storage (multipart), People (audience and joiner events), §4 Certificates, Notifications, the Dashboard todo provider.

### 7.10 Acceptance scenarios
1. **Assign and remind.** HR uploads "Secure coding guidelines" (5 videos), assigns it to department Development as Required with a 14-day due period, and publishes. Every Development employee gets a NOT_STARTED enrollment, an alert, and a dashboard to-do once the due date is within 7 days.
2. **Watch rules.** A learner watches lesson 1 to 95% through heartbeats, and it completes. Seeking to 100% on lesson 2 without watching leaves it incomplete. The tile shows "1 of 5 lessons done · Continue".
3. **Completion and certificate.** Completing all 5 sets COMPLETED, and a certificate reaches READY. The tile shows "Completed · certificate ready · Download certificate", and the certificate verifies publicly.
4. **New joiner.** A new joiner with an ONBOARDING course assigned to "New joiners" gets the enrollment on `employee.created`, due joining date + 14 days.
5. **Overdue report.** An overdue required course appears with an outline tag, the RM's weekly digest lists it, and it appears in `GET /lms/reports/overdue`.

---

## 8. Rooms & visitors (P2)

### 8.1 Screens and UX (GEN.facility, FORMS.booking, FORMS.visitor)
- Title "Rooms & visitors". Actions: "Book room" and "Register visitor".
- **Tab "Room bookings"**:
  - Sub-toggle List or Day calendar. The calendar has rooms as columns and 15-minute rows from 08:00 to 21:00; dragging selects a free slot and opens the form prefilled.
  - Filters: My bookings, All, a location, and a date.
  - **Columns**: Room, Date, Time ("11:00 – 12:00"), Host, Purpose, Status (`~Booked`, `-Cancelled`, `-Completed`).
  - Row actions: Cancel (host or `facility.room.manage`), Edit time (host).
- **Tab "Visitor log"**:
  - **Columns**: Visitor (with company), Date, Time (expected, then in and out times once available), Host, Purpose, Status (`!E-pass sent`, `~Checked in`, `-Checked out`, `-No show`, `-Cancelled`).
  - Employees see visitors they host. `facility.visitor.frontdesk` and `facility.manage` see all.
- **Tab "Front desk"** (`facility.visitor.frontdesk`): a scan box that uses the camera QR reader or takes a typed pass code. It shows the visitor card (name, company, host, photo if captured) with Check in and Check out buttons, and a list of today's expected visitors with walk-in registration.
- **Tab "Rooms"** (`facility.room.manage`): room master with columns name, location, capacity, amenities and active.
- **Book room form**:
  - Room: rooms at my location first.
  - Date, From, To (15-minute steps), Purpose (required, at most 120 characters).
  - Added: attendees (optional; they get a calendar invite email with an ICS).
  - Submit "Book". An inline conflict message shows before submit, using the live availability API.
- **Register visitor form**:
  - Visitor name, Company.
  - Host: defaults to me; only `facility.manage` can change it.
  - Date, Phone (+91, validated).
  - Added: Expected time (required), Purpose (required), Email (optional), "Send pass via" (WhatsApp, Email, or both; default WhatsApp when a phone is present).
  - Submit "Send e-pass". Toast "E-pass sent on WhatsApp".
- **Public pass page** `/pass/{token}` (no login): tenant logo, visitor name, host, date and window, a QR code, the office address from the Work location, and the status.

### 8.2 Data model
```prisma
model Room { id; tenantId; locationId; name String @db.VarChar(60); capacity Int; amenities String[]; active Boolean @default(true); maxBookingMins Int @default(240); openFrom String @default("08:00"); openTo String @default("21:00")
  @@unique([tenantId, locationId, name]) }
model RoomBooking { id; tenantId; roomId; hostId; purpose String @db.VarChar(120); startAt DateTime; endAt DateTime; attendeeIds String[] @db.Uuid; status BookingStatus @default(BOOKED); cancelledById String?; cancelReason String?
  @@index([tenantId, roomId, startAt]) @@index([tenantId, hostId, startAt]) }
  -- raw migration: CREATE EXTENSION btree_gist; ALTER TABLE room_booking ADD CONSTRAINT no_overlap EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'BOOKED');
enum BookingStatus { BOOKED CANCELLED COMPLETED }
model Visitor { id; tenantId; number Int /* VIS-0001 */; name String @db.VarChar(100); company String?; phoneE164 String?; email String?; hostId; locationId; visitDate DateTime @db.Date; expectedTime String /* HH:mm */
  purpose String @db.VarChar(160); status VisitorStatus @default(REGISTERED); checkedInAt DateTime?; checkedOutAt DateTime?; checkedInById String?; photoFileId String?; badgeNo String?
  @@unique([tenantId, number]) @@index([tenantId, visitDate, status]) @@index([tenantId, hostId, visitDate]) }
enum VisitorStatus { REGISTERED PASS_SENT CHECKED_IN CHECKED_OUT NO_SHOW CANCELLED }
model VisitorPass { id; tenantId; visitorId @unique; token String @unique /* 32-byte url-safe */; shortCode String /* 6-char for manual entry */; validFrom DateTime; validUntil DateTime; revokedAt DateTime?
  deliveries PassDelivery[] @@unique([tenantId, shortCode]) }
model PassDelivery { id; tenantId; passId; channel DeliveryChannel; to String; status DeliveryStatus; providerMsgId String?; error String?; sentAt DateTime? }
enum DeliveryChannel { WHATSAPP EMAIL }
enum DeliveryStatus { QUEUED SENT DELIVERED FAILED STUBBED }
```

### 8.3 Workflows
- **Booking**:
  - Create → BOOKED.
  - Inserting a booking that overlaps an existing BOOKED one violates the exclusion constraint. The API catches it and returns 409 `ROOM_CONFLICT {conflicting:{time, host}}`.
  - BOOKED → CANCELLED by the host or `facility.room.manage`. A manager cancelling someone else's booking must give a reason, and the host is alerted.
  - BOOKED → COMPLETED by job after `endAt`.
  - Editing the time re-checks the constraint inside a transaction.
- **Visitor**:
  - REGISTERED → PASS_SENT when at least one delivery is SENT or STUBBED.
  - → CHECKED_IN at the front desk, only on `visitDate` and inside `[validFrom, validUntil]`. Sets `checkedInAt` and `checkedInById`, alerts the host "{name} from {company} has arrived at reception" (in-app, plus WhatsApp to the host when their preference allows), and optionally captures a photo.
  - → CHECKED_OUT at the front desk.
  - REGISTERED or PASS_SENT → CANCELLED by the host, which revokes the pass and sends a cancellation message to the visitor.
  - REGISTERED or PASS_SENT → NO_SHOW by job at 23:30 on `visitDate`.
  - Walk-in: the front desk registers and checks in in one step, and the host is alerted.

### 8.4 API
- `GET /facility/rooms?locationId` and `GET /facility/rooms/availability?date&locationId` (busy intervals per room). `POST/PATCH /facility/rooms/:id` (`facility.room.manage`).
- `GET /facility/bookings?scope=mine|all&date&roomId`, `POST /facility/bookings` (`facility.room.book`), `PATCH /facility/bookings/:id`, `POST /facility/bookings/:id/cancel`.
- `GET /facility/visitors?scope=hosting|all&date&status` (`all` requires frontdesk or manage), `POST /facility/visitors` (`facility.visitor.register`), `POST /facility/visitors/:id/cancel`, `POST /facility/visitors/:id/resend-pass`.
- `facility.visitor.frontdesk`: `POST /facility/visitors/lookup {tokenOrCode}`, `POST /facility/visitors/:id/check-in`, `POST /facility/visitors/:id/check-out`, `POST /facility/visitors/walk-in`.
- **Public**: `GET /public/visitor-pass/:token` (rate limited). It never returns the phone or email.
- Realtime: `facility:visitor {id, status}` to the host and the `frontdesk:{locationId}` room; `facility:booking` to the `rooms:{locationId}` room so the calendar refreshes.

### 8.5 Rules
- **Booking granularity**: 15 minutes. Minimum 15 minutes. Maximum `room.maxBookingMins`. Must fall inside the room's open window in the location's timezone. Cannot start in the past (with 5 minutes of grace). At most 60 days ahead. At most 3 overlapping bookings per host across rooms.
- **Pass validity**: `validFrom = visitDate expectedTime − 2h`, `validUntil = visitDate 23:59` local time.
- **QR contents**: `https://{tenantDomain}/pass/{token}`. The token is random (not a JWT), is looked up on the server, and is revoked on cancel or checkout.
- **Short code**: 6 characters, unambiguous alphanumeric (no 0/O or 1/I), unique per tenant for active passes.
- **Visitor data retention**: phone, email and photo are purged after 180 days (tenant configurable). Name, company, host and timestamps are kept.

### 8.6 Jobs, notifications, audit
- **Jobs**: `facility.sendPass` (queue `messaging`, 3 retries), `facility.bookingReminder` (host and attendees, 15 minutes before), `facility.bookingComplete` (every 15 minutes), `facility.visitorNoShow` (23:30), `facility.visitorPiiPurge` (nightly).
- **Notifications**: `booking.cancelledByManager`, `booking.reminder`, `visitor.arrived`, `visitor.passFailed` (to the host when every channel failed).
- **Audit**: `room.create|update`, `booking.create|update|cancel`, `visitor.register|cancel|checkin|checkout|walkin`, `visitor.pii.purge`.

### 8.7 Integrations
```
interface WhatsAppProvider { sendTemplate(p:{toE164, templateName, lang:'en', params:string[], mediaUrl?}): Promise<{messageId, status:'SENT'|'STUBBED'}>; }
```
- **Stub**: logs the message, stores it in the `dev_outbox` table and returns STUBBED. The pass page link is visible in the dev console.
- **Real**: WhatsApp Business Cloud API with the template `visitor_pass` (params: name, host, date, time, link), once credentials exist.
- **Email**: SMTP adapter with an HTML pass, an inline QR PNG, and an ICS attachment.
- **QR**: generated with the `qrcode` library on the server.

### 8.8 Edge cases
- A booking that touches another at the boundary (10:00-11:00 and 11:00-12:00) is allowed because the range is `[)`.
- A room deactivated with future bookings: blocked unless `?cancelFuture=true`, which cancels those bookings with host alerts.
- Visitor with no phone and no email: the pass is shown to the host to share manually.
- Checking in on the wrong date returns 422 `PASS_NOT_VALID_TODAY`.
- Two front desks checking in at the same moment: a conditional `UPDATE … WHERE status IN (REGISTERED, PASS_SENT)` makes the second one get 409.

### 8.9 Phase and dependencies
- P2.
- Depends on: People (Work locations, host), Notifications, the WhatsApp and SMTP adapters, Storage (photo).

### 8.10 Acceptance scenarios
1. **Conflict detection.** Board room is booked 30 Sep 11:00-12:00. A second request for 11:30-12:30 gets 409 with the conflict detail. 12:00-12:30 succeeds.
2. **Race safety.** 20 parallel requests for the same free slot produce exactly one BOOKED row, backed by the database constraint.
3. **Pass delivery.** Registering a visitor with a phone gets PASS_SENT with a STUBBED WhatsApp delivery. `/pass/{token}` renders with a QR code and no phone number.
4. **Check-in and check-out.** The front desk scans the QR on the visit date: the status becomes CHECKED_IN and the host gets a "has arrived" alert within 2 s. Check-out revokes the token, and scanning again gets 409.
5. **No-show.** A visitor who never arrives becomes NO_SHOW at 23:30.
6. **Visibility.** An employee sees only visitors they host. A Security desk role sees all visitors at its location.

---

## 9. Policies & rulebook, with the holiday list (P1)

### 9.1 Screens and UX (GEN.policies, FORMS.policy)
- Title "Policies & rulebook", subtitle "Official rules, HR policies, holiday list and compliance guidelines. Some require acknowledgement." Action: "Upload policy" (`policy.manage`).
- **Tabs** (added): All, Pending for me, Holiday list, Compliance (`policy.ack.report`).
- **Columns**: Document, Updated (current version's `effectiveFrom`), Requires acknowledgement (Yes/No), Acknowledged.
- **Acknowledged column values**:
  - `~You acknowledged`, with the date in a tooltip.
  - `!Pending · read now`, which is clickable and opens the reader.
  - `-—` when no acknowledgement is required.
  - For managers of policies, a compliance fraction such as "118 / 128" is added.
- **Reader** (full-screen drawer):
  - PDF.js viewer showing version, effective date and a "What changed" summary, with a version history dropdown.
  - For required policies: the checkbox "I have read and understood this policy" becomes enabled once the last page has been in view and at least `max(10 s, pages × 3 s)` has elapsed. Then the "Acknowledge" button.
- **Upload policy form**:
  - Title; File (pdf, at most 20 MB; docx is converted to PDF by LibreOffice through the PdfRenderer adapter, or rejected in P1); Require acknowledgement.
  - Added: Category, Audience (default ALL), Effective from, Ack due in N days (default 7), and "What changed".
  - The **new version** action on an existing policy has the same form plus "Require re-acknowledgement" (default Yes).
- **Holiday list tab**: year selector, then a table with columns Date, Day, Holiday, Type (Mandatory or Optional/Restricted), Location. Button "Download PDF". The "Holiday list 2026" row under All opens this tab.
- **Compliance tab**: per policy, show required, acknowledged, pending and overdue counts, a drill-down list of pending names with a "Remind" button, and CSV export.

### 9.2 Data model
```prisma
model Policy { id; tenantId; title String @db.VarChar(150); category PolicyCategory; requiresAck Boolean; ackDueDays Int @default(7); status PolicyStatus @default(DRAFT)
  currentVersionId String? @unique; holidayYear Int? /* for HOLIDAY_LIST */; audiences PolicyAudience[]; versions PolicyVersion[]; sortOrder Int
  @@index([tenantId, status]) }
enum PolicyCategory { HANDBOOK HR LEAVE_ATTENDANCE IT_SECURITY POSH HOLIDAY_LIST COMPLIANCE OTHER }
enum PolicyStatus { DRAFT PUBLISHED ARCHIVED }
model PolicyAudience { id; tenantId; policyId; type AudienceType; refId String? }
model PolicyVersion { id; tenantId; policyId; version Int; fileId String? /* null for generated holiday list */; pageCount Int?; effectiveFrom DateTime @db.Date; changeSummary String?; requiresReack Boolean; publishedAt DateTime?; publishedById String?
  @@unique([policyId, version]) }
model PolicyAckRequirement { tenantId; policyVersionId; userId; dueAt DateTime; acknowledgedAt DateTime?; ackIp String?; ackUserAgent String?; readSeconds Int?; lastRemindedAt DateTime?
  @@id([policyVersionId, userId]) @@index([tenantId, userId, acknowledgedAt]) }
```
- **Holiday data** is owned by the Leave domain (Holiday: date, name, type, locationIds, year). This domain only renders it (see contracts). The Leave screen's "Upcoming" list uses the same source.

### 9.3 Workflows
- **Policy**: DRAFT → PUBLISHED, where version 1 is published. PUBLISHED → ARCHIVED hides it, keeps the acknowledgement history, and stops reminders.
- **Publish version N** (`policy.manage`):
  - Sets `currentVersionId`.
  - If `requiresAck`:
    - When N = 1, or the new version has `requiresReack`: create PolicyAckRequirement rows for the resolved audience with `dueAt = max(effectiveFrom, today) + ackDueDays`.
    - Otherwise: copy the acknowledgements from version N−1, carrying `acknowledgedAt` and noting the carry-over in the audit.
  - Alerts: in-app plus email "Acknowledge the updated {title}", which is mandatory.
  - Dashboard to-do.
  - Emit `policy.published`.
- **Acknowledge**: `POST …/ack` checks that the version is current and that a requirement exists, then records `acknowledgedAt`, IP, user agent and `readSeconds` (from the client). The action is final; there is no un-acknowledge. Emit `policy.acknowledged`.
- **Joiners and movers**: on `employee.created` or an audience change, create requirements for current PUBLISHED policies with ack required, `dueAt = joining + ackDueDays`. Onboarding shows these as a step (People contract).

### 9.4 API
- `GET /policies?tab=all|pending` (`policy.view`, audience-filtered) returns rows with `myAckState`.
- `GET /policies/:id` and `GET /policies/:id/versions`. `GET /policy-versions/:id/file` returns a signed URL (5 minutes, inline).
- `POST /policy-versions/:id/ack` (only the user themself).
- `policy.manage`: `POST /policies`, `PATCH /policies/:id`, `POST /policies/:id/versions`, `POST /policies/:id/publish`, `POST /policies/:id/archive`.
- `policy.ack.report`: `GET /policies/compliance`, `GET /policies/:id/compliance?state=pending|done|overdue`, `POST /policies/:id/remind`, `GET /policies/:id/compliance.csv`.
- `GET /holidays?year&locationId` (proxied to Leave) and `GET /holidays/:year/pdf`.
- `GET /users/:id/policy-acks` (People and Onboarding domains).

### 9.5 Rules
- A requirement is overdue when `dueAt < now` and `acknowledgedAt` is null.
- **Reminders**: on day 3 and on the due day; after that, every 3 days. Throttled by `lastRemindedAt` to 24 hours.
- **Overdue escalation**: after 7 days overdue, a weekly list goes to HR (`policy.ack.report` holders) and to the employee's RM.
- **Blocking**: tenants can set `blockingPolicies` (e.g. POSH, IT security), stored in tenant settings. If any is overdue, a modal on login forces reading before any navigation. Default off.
- "Updated" shows `effectiveFrom` of the current version.

### 9.6 Jobs, notifications, audit
- **Jobs**: `policies.ackReminders` (daily at 10:00), `policies.materialiseRequirements` (on publish and on People events), `policies.overdueDigest` (Monday 09:00).
- **Notifications**: `policy.ackRequired` (mandatory), `policy.ackReminder`, `policy.overdueDigest`.
- **Audit**: `policy.create|version.publish|archive`, `policy.ack` (with IP; legal evidence), `policy.remind`.

### 9.7 Edge cases
- Acknowledging a superseded version returns 409 `VERSION_SUPERSEDED`, and the client reloads the current version.
- An employee who leaves: their requirements are frozen and excluded from compliance denominators.
- A HOLIDAY_LIST policy never requires acknowledgement; this is forced.
- A holiday list with no holidays for the year shows an empty state, plus "Add holidays" for users with `leave.holiday.manage`.

### 9.8 Phase and dependencies
- P1.
- Depends on: People (audience, joiners), Leave (Holiday entity and API), Storage, Notifications, the Dashboard todo provider. Onboarding consumes the acknowledgement state.

### 9.9 Acceptance scenarios
1. **Publish with acknowledgement.** HR publishes "Leave & attendance policy" v1 with acknowledgement required and a 7-day due period. 128 requirements are created, and each employee sees "Pending · read now" plus a dashboard to-do.
2. **Reader gating.** In the reader, the Acknowledge button stays disabled until the last page has been viewed and the minimum time has passed. After acknowledging, the row shows "You acknowledged" and the to-do disappears. The compliance count becomes 1 / 128.
3. **Versions.** v2 with `requiresReack = false` keeps everyone's acknowledgement state. v3 with `requiresReack = true` resets everyone to pending, and a v2 acknowledgement request gets 409.
4. **Holiday list.** The Holiday list tab shows Dussehra 20 Oct and Diwali 8-9 Nov from the Leave domain data, and the PDF downloads.
5. **Overdue digest.** Overdue employees show in Compliance with an overdue tag. The RM receives the weekly digest listing them.

---

## 10. Wellness games (P2)

### 10.1 Screens and UX (GEN.wellness tiles)
- **Tiles**:
  - "Daily · 3 min · Queens · Place one queen per row, column and colour region." → Play.
  - "Daily · 5 min · Mini Sudoku · A 6×6 grid." → Play.
  - "Daily · 2 min · Word ladder · Change one letter at a time." → Play.
  - "Weekly · Team leaderboard · {top department} leads this week." → View.
- Once a game is completed today, its tile shows "Solved in 2:14 · +16 pts" and the CTA "Review".
- A streak chip ("🔥 5-day streak") is shown. The spec says no emojis in output for me, but the UI can use an icon.
- **Game screen**:
  - Board, timer, Undo, Clear and Hint. A hint costs points, maximum 2.
  - Checks run on the client: conflicts are highlighted in the accent colour.
  - On solve: a completion card and submission to the server.
  - "Reveal" is available after 10 minutes and gives 0 points.
- **Leaderboard**:
  - Tabs: This week (Mon-Sun, local), Last week, Individuals.
  - Team table columns: Department, Players, Points, Score per member, Rank.
  - Individuals: the top 20 by points, only for users who opted in. `wellnessLeaderboardOptIn` defaults to true, can be turned off, and anyone opted out shows as "Anonymous".
- **Admin** (`wellness.manage`): enable or disable each game; set the unlock time (default 00:00 local); set "Playable only when on break or not punched in" (default off).

### 10.2 Deterministic generation (shared package `packages/games`, pure TS, used by client and server)
- **RNG**: `seed = sha256(`${tenantId}:${gameKey}:${yyyy-mm-dd}:${attempt}`)`, where `attempt` counts up from 0. The first 16 bytes seed an `sfc32` PRNG. Everyone in a tenant gets the same puzzle each day, which keeps the leaderboard fair.
- **Queens** (N = 7; configurable 6-9):
  1. Place queens with a seeded backtracking search: one per row and column, and no two touching, including diagonally.
  2. Grow N colour regions by seeded multi-source BFS from each queen until the grid is covered, balancing region sizes by choosing among the smallest regions first.
  3. Verify there is exactly one solution with a DLX or backtracking solver. If not, `attempt++`, up to 50 times. A deterministic fallback library of 365 prebuilt boards is indexed by day.
- **Mini Sudoku 6×6** (2 rows × 3 columns per box):
  1. Build a full grid by seeded backtracking over a shuffled digit order.
  2. Remove cells in seeded order while the solution stays unique (solver count ≤ 1), down to a target of 14-16 givens.
  3. Difficulty is fixed as "easy-medium" for a 5-minute session.
- **Word ladder**:
  - A bundled dictionary of about 2,500 common 4-letter English words, curated to exclude offensive words, stored in `packages/games/words4.json`.
  - A seeded pick of a start word, then BFS to find targets at distance 4-6. The pick is seeded among those targets.
  - `par` = the shortest path length.
  - Each move must change exactly one letter and produce a dictionary word.
  - Score uses steps against par.
- **Unlock**: `yyyy-mm-dd` = the current local date once past `unlockTime`; before that, the previous day. The server rejects start requests for any other date.

### 10.3 Data model
```prisma
model WellnessSettings { tenantId @id; enabledGames String[] @default(["queens","sudoku6","wordladder"]); unlockTime String @default("00:00"); breakOnly Boolean @default(false) }
model GameSession { id; tenantId; userId; gameKey String; puzzleDate DateTime @db.Date; startedAt DateTime; startToken String @unique; completedAt DateTime?; elapsedSec Int?; hintsUsed Int @default(0); moves Int?; revealed Boolean @default(false); points Int @default(0); solution Json?
  @@unique([tenantId, userId, gameKey, puzzleDate]) @@index([tenantId, puzzleDate, gameKey]) }
model LeaderboardWeek { id; tenantId; weekStart DateTime @db.Date; departmentId; players Int; headcount Int; points Int; scorePerMember Decimal @db.Decimal(8,2); rank Int
  @@unique([tenantId, weekStart, departmentId]) }
```
Only the first session per game per day counts, which the unique key enforces. Replays happen in local client state and are never scored.

### 10.4 API
- `GET /wellness/today` returns `{date, games:[{key, enabled, state, points?}], streak}`.
- `POST /wellness/:game/start` returns `{puzzleDate, startToken, startedAt}`. It is idempotent and returns the existing session.
- `POST /wellness/:game/complete {startToken, solution, hintsUsed, moves, revealed}`. The server regenerates the puzzle from the seed, validates the solution, computes elapsed time as `now − startedAt` on the server (capped at 60 minutes), awards points and returns `{points, rank}`.
- `GET /wellness/leaderboard?week=current|last&type=team|individual`.
- `PATCH /wellness/settings` (`wellness.manage`) and `PATCH /me/preferences {wellnessLeaderboardOptIn}`.
- Permission `wellness.play` applies to all of these.

### 10.5 Scoring
- `points = revealed ? 0 : 10 + speedBonus − 3 × hintsUsed`, with a floor of 2.
- `speedBonus = max(0, 10 − floor(elapsedSec / par_time_step))`.
- The step is 20 s for Queens, 30 s for Sudoku and 12 s for the word ladder.
- The word ladder adds `+3` for solving at par and `−1` per extra step, with a floor of 2.
- **Team score** = `Σ points of department members / active headcount` (per member, so department size is normalised), rounded to 2 decimals.
- Ranking ties are broken by the number of players.
- **Streak**: consecutive local days with at least one completed game.
- **Break-only mode**: `start` returns 423 `WELLNESS_BREAK_ONLY` unless the Attendance state is ON_BREAK or NOT_PUNCHED_IN. Attendance contract: `AttendanceService.getState(userId)`.

### 10.6 Jobs, notifications, audit
- **Jobs**:
  - `wellness.leaderboardSnapshot`: Monday 00:05 local, snapshots the previous week.
  - `wellness.leaderboardLive`: computed on read, cached for 60 s.
  - `wellness.pregenerate`: 23:50 local, runs the generator for tomorrow on the server to warm the cache and check uniqueness.
- **Notifications**: optional weekly "Your team is #1 this week" to the winning department, on Monday. No per-game alerts.
- **Audit**: `wellness.settings.update` only.

### 10.7 Edge cases
- The same puzzle opened in two tabs gets the same `startToken`.
- **Clock skew**: elapsed time is always computed on the server.
- **Tampered solution**: returns 422 and no points.
- **Tenant timezone change mid-day**: `puzzleDate` comes from the start token.
- A user without a department is counted under "Unassigned" and excluded from team ranks.

### 10.8 Phase and dependencies
- P2.
- Depends on: People (department), Attendance (break-only state).

### 10.9 Acceptance scenarios
1. **Determinism and uniqueness.** For a given (tenant, date), the client and server generators produce byte-identical Queens, Sudoku and ladder puzzles. For 365 consecutive dates, every Queens and Sudoku puzzle has exactly one solution and every ladder has a path of length 4-6.
2. **Server-side validation.** Submitting a valid Sudoku solution 150 s after start awards `10 + (10 − 5) = 15` points. A second complete call returns the same result without double-counting. An invalid grid returns 422.
3. **Unlock time.** At 23:59 local the Queens puzzle is date D. At 00:00 it is D+1. Starting with D−1 returns 422.
4. **Team normalisation.** Development (10 members, 120 points) scores 12.00 per member. QA (4 members, 60 points) scores 15.00 per member and ranks higher.
5. **Break-only mode.** With it on, an employee who is punched in and working gets 423. After starting a break (web or desktop tracker) the game can be started.

---

## 11. CCTV (P2 feature, gated to the Enterprise plan in P3)

### 11.1 Screens and UX (GEN.cctv tiles)
- Title "CCTV", subtitle "Live camera feeds streamed from the office NVR. Visible to Admin and Facility Manager only."
- The nav entry shows only with `cctv.view`. The route guard returns 403 otherwise.
- **Location filter**: All, Ahmedabad HQ, Pune studio.
- **Tile grid**: each tile shows a status kicker (`Live` or `Offline`), the camera name and a meta line (location, or "Last seen HH:mm" when offline), and a 16:9 video area.
  - Live tiles show the HLS player (hls.js, muted, low-latency mode). Hovering reveals Fullscreen.
  - Offline tiles show a placeholder and a "Reconnect" button (`cctv.manage`, or `cctv.view` so viewers can trigger a reconnect).
- **Layout toggle**: 2×2, 3×3 or 4×4. With more than 9 cameras, only visible tiles stream (IntersectionObserver), to save bandwidth.
- **Admin sub-tab "Cameras"** (`cctv.manage`):
  - Columns: name, location, RTSP URL (write-only; masked as `rtsp://***@10.0.0.21/…`), status, last seen, enabled, sort order.
  - Actions: Add camera, Edit, Test connection, Disable.
- **Footer notice** on the page: "Viewing sessions are logged."

### 11.2 Data model
```prisma
model Camera { id; tenantId; locationId; name String @db.VarChar(60); rtspUrlEnc Bytes /* AES-GCM, tenant DEK (P1-2: app key) */; gatewayPath String @unique /* t_{tenantShort}_{cameraShort} */
  status CameraStatus @default(UNKNOWN); lastSeenAt DateTime?; lastError String?; enabled Boolean @default(true); sortOrder Int; lowLatency Boolean @default(true)
  @@unique([tenantId, name]) }
enum CameraStatus { ONLINE OFFLINE UNKNOWN DISABLED }
model CameraViewSession { id; tenantId; cameraId; userId; startedAt; endedAt DateTime?; ipHash String; userAgent String @@index([tenantId, cameraId, startedAt]) }
```

### 11.3 Workflows
- **Add camera**: store the encrypted RTSP URL, then call `gateway.upsertPath(gatewayPath, rtspUrl, {sourceOnDemand: true})`, then run a connection test with a 10-second timeout, which sets the status.
- **View**:
  - `POST /cctv/cameras/:id/view` creates a CameraViewSession and returns `{hlsUrl, token (JWT, 5 min, claims {tid, cam:gatewayPath, sid})}`.
  - The player appends the token as a query parameter.
  - MediaMTX's external auth (`authMethod: http`, `authHTTPAddress`) calls `POST /internal/cctv/auth`. That endpoint accepts internal network requests only, verifies the JWT, checks that the path matches, and checks that the session is open.
  - The client heartbeats every 60 s through `POST /cctv/sessions/:sid/heartbeat`, which extends the token.
  - `POST /cctv/sessions/:sid/end` is sent on unload. Sessions without a heartbeat for 3 minutes are closed by job.
- **Health**: poll every 30 s (§11.6). A path that is `ready` sets ONLINE and `lastSeenAt = now`. A path not ready or erroring for 2 consecutive polls sets OFFLINE, and an alert goes to `cctv.manage` holders (throttled to one per camera per hour).
- **Reconnect**: `gateway.restartPath(gatewayPath)`, which removes and re-adds the path. The status is set to UNKNOWN and a probe runs after 10 s. Rate limited to one per camera per 30 s.

### 11.4 API
- `GET /cctv/cameras?locationId` (`cctv.view`) never returns the RTSP URL.
- `POST /cctv/cameras/:id/view`, `POST /cctv/sessions/:sid/heartbeat`, `POST /cctv/sessions/:sid/end` (`cctv.view`).
- `POST /cctv/cameras/:id/reconnect` (`cctv.view`).
- `cctv.manage`: `POST /cctv/cameras`, `PATCH /cctv/cameras/:id`, `POST /cctv/cameras/:id/test`, `DELETE /cctv/cameras/:id` (removes the gateway path).
- `GET /cctv/sessions?cameraId&from&to` (`cctv.manage`): the viewing audit.
- `POST /internal/cctv/auth`: gateway to API only; the network policy allows requests from the gateway only.
- Realtime: `cctv:status {cameraId, status, lastSeenAt}` to the `cctv:{tenant}` room, which only `cctv.view` sockets may join.

### 11.5 Rules and security
- The RTSP credentials are never sent to the browser.
- HLS is served only through the gateway, with the token check on every request. Segment tokens are covered by the gateway's auth hook on each request.
- Only enabled cameras can be viewed.
- Plan gating (P3): requires the tenant feature flag `cctv` (Enterprise). Without it, the nav is hidden and the API returns 402 `FEATURE_NOT_IN_PLAN`.
- A super-admin has no access, including through `/internal`.

### 11.6 Jobs, audit
- **Jobs**: `cctv.healthPoll` (repeatable, 30 s, per tenant with cameras) and `cctv.sessionReaper` (every minute).
- **Audit**: `cctv.camera.create|update|delete|test|reconnect` and `cctv.view.start|end`. Viewing is always audited, including who, which camera and how long.

### 11.7 Integrations
```
interface StreamGateway {
  upsertPath(path, sourceUrl, opts:{sourceOnDemand:boolean}): Promise<void>;
  removePath(path): Promise<void>;
  restartPath(path): Promise<void>;
  listPaths(): Promise<{path, ready:boolean, readers:number, lastError?:string}[]>;
  hlsUrl(path): string; // e.g. https://cctv.{domain}/{path}/index.m3u8
}
```
- **Real adapter**: the MediaMTX HTTP API v3 (`/v3/config/paths/add|patch|delete`, `/v3/paths/list`). MediaMTX runs in Docker Compose.
- **Mock adapter**: MediaMTX with `runOnInit` ffmpeg publishing a `testsrc` pattern per mock path, or a static sample `.m3u8` from MinIO. `listPaths` reports a configurable OFFLINE camera ("Server room") so the offline and Reconnect UI can be exercised.

### 11.8 Edge cases
- The gateway is down: every camera shows OFFLINE with the banner "Stream gateway unreachable". The API returns a 503 per view request.
- Deleting a camera while it is being viewed: the session is ended, the token is invalidated, and the player shows "Camera removed".
- An RTSP URL that fails the validation `^rtsps?://` returns 422.

### 11.9 Phase and dependencies
- P2 for the feature. P3 adds Enterprise plan gating and per-tenant DEK encryption of RTSP URLs.
- Depends on: People (Work locations), RBAC, Billing feature flags (P3), the Platform KMS (P3).

### 11.10 Acceptance scenarios
1. **Permissions and live view.** An employee requests `/cctv/cameras` and gets 403, and the nav entry is hidden. An admin sees 6 tiles, and the mock streams play within 3 s.
2. **Gateway auth.** Taking an HLS URL without a token, or with an expired or other-camera token, gets 401 from the gateway through the auth hook.
3. **Offline and reconnect.** The mock "Server room" is offline and shows "Last seen 08:12" with Reconnect. Reconnect calls restartPath, the status goes UNKNOWN and then ONLINE once the mock recovers, and a realtime `cctv:status` event updates the tile.
4. **Session audit.** Viewing for 2 minutes and closing the tab creates a session row with a start and end about 2 minutes apart, and audit entries `cctv.view.start` and `cctv.view.end`.
5. **Custom role.** A custom "Facility Manager" role with `cctv.view` can view feeds but cannot open the Cameras admin tab (403).

---

## 12. Cross-domain contracts

### 12.1 Consumed (this domain needs these from others)
| Provider domain | Contract |
|---|---|
| Identity/RBAC | `can(user, key)`, `usersWithPermission(tenantId, key)`, `rbacVersion(user)`; custom roles; super-admin principal flag |
| People | `Employee {id, userId, fullName, initials, designation, departmentId, locationId, reportingManagerId, employmentType, status, dob, joiningDate, showBirthdayPublicly}`; `Department {id, name, leadUserId}`; teams led/managed by a user; events `employee.created`, `employee.exited`, `employee.department.changed`, `department.created`; onboarding step hooks; Work locations (address, timezone) |
| Projects/Kanban | `Project {id, name, leadId}`, members; events `project.created`, `project.member.added`, `project.member.removed`; `TaskService.create(dto)` and `listAssigned(userId, dueBefore)`; `task.create` permission per board |
| Attendance | `getToday(userId) → {state, punchedInAt, shift:{start,end}, mode, webPunchAllowed}`; punch action; `getState(userId)` for break-only mode |
| Leave | `getBalances(userId)`, `getHistory(userId, limit)`, `pendingApprovalsCount(approverId)`, `Holiday` list by year and location, `BusinessCalendar.addMinutes()` (or it is hosted in Platform, built from shift and holidays) |
| Timesheet | `pendingApprovalsCount(approverId, level)`; todo provider "submit timesheet" |
| Assets | `listAssigned(userId)` for ticket linkage |
| Vault | `VaultService.addSystemDocument(userId, category:'Certificates', fileId, title)` |
| Platform | Storage (`FileObject`, presign, multipart, AV scan status), NotificationService, AuditService, TenantSequence, PdfRenderer worker, Socket.IO gateway and auth, BullMQ queues, KMS/envelope encryption (P3), tenant settings (timezone, displayName, domain) |
| Whitelabel | Tenant logo and accent colour for certificates, passes and emails |
| Billing (P3) | Feature flags `cctv`, `calls`, `lms`, `wellness` by plan |

### 12.2 Exposed (others can use these)
- **Services**: `AudienceService`, `CertificateService.issue({type, recipientId, title, subtitle, sourceType, sourceId, metadata})`, `HelpdeskService.createTicket()`, `DashboardSectionProvider` and `TodoProvider` registries (other domains register into them), `ChatService.postSystemMessage(channelLink, text)` (e.g. a release-freeze bot).
- **APIs**:
  - `GET /users/:id/badges` (profile tags)
  - `GET /users/:id/learning` (appraisals)
  - `GET /users/:id/policy-acks` (onboarding and compliance)
  - `GET /public/certificates/verify/:code`
- **Events**:
  - `notice.published`
  - `feed.post.published`
  - `kudos.awarded`
  - `eotm.announced`
  - `certificate.issued` / `certificate.revoked`
  - `course.completed`
  - `policy.published` / `policy.acknowledged`
  - `ticket.created` / `ticket.escalated` / `ticket.resolved`
  - `visitor.checked_in`
  - `booking.created`

### 12.3 Recommended seeding (Lexisora demo tenant)
- Channels `#general`, `#announcements`, `#atlas-crm`, `#qa-team`, with the wireframe messages.
- The 4 wireframe notices with matching receipt counts.
- The 3 wireframe feed posts.
- Kudos rows for Rahul (Star Coder), Sneha (Bug Hunter) and Priya (EOTM September 2026).
- Tickets HD-1031, HD-1038 and HD-1042, with the sequence starting at 1043.
- The 4 wireframe courses.
- Rooms Board room, Huddle 1 and Huddle 2.
- 5 policies, and the 2026 holidays (via Leave).
- 6 mock cameras.

---

## 13. Phase summary
| Module | Phase | Hard dependencies |
|---|---|---|
| Dashboard (aggregation, quotes, to-dos, events) | P1 | Attendance, Leave, Timesheet, Kanban, People, RBAC |
| Notice board | P1 | People, Projects, Storage, Notifications |
| Policies and holiday list | P1 | People, Leave (Holiday), Storage |
| Helpdesk | P1 | People (RM), BusinessCalendar, Notifications |
| Comms hub, text | P1 | People and Projects events, Socket.IO, Storage |
| Company feed (publish, like, comment) | P1 | Storage |
| Feed review workflow and images | P2 | — |
| Kudos, EOTM, Certificates | P2 | Feed, PdfRenderer, Vault |
| LMS | P2 | Storage multipart, transcoder, Certificates |
| Rooms and visitors | P2 | Work locations, WhatsApp and SMTP adapters |
| Calls, screen share, recordings (LiveKit) | P2 | Chat, MinIO |
| Wellness games | P2 | People, Attendance (break-only) |
| CCTV (MediaMTX) | P2; P3 Enterprise gate | Work locations, RBAC |
| Chat and recording encryption with per-tenant keys, retention controls | P3 | Platform KMS |
| WhatsApp real adapter | P3 or when credentials exist | Business API credentials |

---

## 14. Open questions (real ambiguities only)
1. **Peer kudos.** Should employees be able to give kudos? The wireframe says "Managers award badges", while the nav shows Kudos to everyone. Default here: view for all, give for lead and above, and configurable.
2. **EOTM per month.** Exactly one tenant-wide EOTM per month, or one per department or branch (Ahmedabad and Pune)? Default: one per tenant.
3. **Feed authorship.** Sample post p3 is authored by a Project Lead, but `canPublish` is HR/Admin only. This spec resolves it with lead and manager "submit for review". Confirm.
4. **Facility Manager and Security desk.** These are named in the wireframe (CCTV subtitle; ID-check "Logged by Security desk") but are not among the 5 roles. Should they be seeded as disabled optional roles, as proposed, or enabled by default?
5. **Call recording consent.** Should starting a recording need consent from every participant, or is the visible banner enough? What are the retention defaults (90 days proposed) and the need for legal hold?
6. **Birthday visibility.** Should the default be opt-in or opt-out (currently opt-out, visible by default) under DPDP Act 2023 considerations?
7. **P3 chat search.** Should search over encrypted chats be kept (decrypt-and-scan window, or a blind index), or dropped when per-tenant encryption is on?
8. **Holiday ownership.** Confirm the Leave domain owns the `Holiday` entity and the business-hours calendar, not this domain.
9. **Wellness unlock time.** "A new set unlocks every morning": 00:00 local (proposed) or a morning time such as 06:00?

### Critical Files for Implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html