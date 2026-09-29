# Domain Spec: Platform, Identity, RBAC & SaaS

Lexisora HRMS — People & Operations Suite. This covers the platform/identity/SaaS domain.

## 0. Domain map and shared foundations

| # | Module | Phase | Summary |
|---|---|---|---|
| M1 | App shell and design system port | P1 | Sidebar NAV, header (search, punch, Alerts, sign-out), generic screen template, form modal, toast, tokens |
| M2 | Authentication, sessions and devices | P1 (SSO/MFA in P2, SAML in P3) | Login, forgot/reset, invite, JWT and refresh, mobile restriction, tracker device credentials |
| M3 | RBAC and permission catalogue | P1 | Roles & access screen, permission matrix, Add role / copy, data scopes, nav derivation |
| M4 | Tenancy core | P1 (dedicated DB in P3) | Tenant resolution by domain, RLS, tenant context, settings, number sequences, outbox, scheduler |
| M5 | Notifications | P1 (preferences, digest, WhatsApp, push in P2) | Alerts screen, header count, notification service for all domains, email |
| M6 | Audit log | P1 (export and hash-verify UI in P2) | Append-only, hash-chained, admin screen |
| M7 | File storage | P1 | Upload intents, virus-scan hook, signed URLs, retention |
| M8 | Global search | P1 (content search in P2) | "Search people, tasks, documents", ACL-filtered |
| M9 | Platform console and Tenants | P3 | Super-admin console, tenant provisioning and lifecycle, KPIs |
| M10 | Subscription and billing | P3 | Plans, seats, cycle, promo, GST invoices, payment gateway, dunning |
| M11 | Branding / white-label | P3 | Palettes, logo, login domain, publish theme as runtime CSS variables |
| M12 | Data privacy and encryption | P1 seam; P3 per-tenant keys, KMS, rotation | Classification registry, super-admin no-access enforcement, privacy screen |
| M13 | Lexisora support (B2B) | P3 | Tenant admin requests SUP-###, console queue, SLA |
| M14 | Seed data and demo mode | P1 | Catalogue sync, tenant base seed, deterministic demo seed, "sign in as" switcher |

### 0.1 Architecture baseline (every module relies on this)

**DB layout.** PostgreSQL 16 with three schemas:
- `platform`: Tenant, TenantDomain, Plan, Subscription, SaaS invoices, PlatformUser, SupportTicket, usage. No RLS.
- `tenant`: all tenant-owned tables. Each has `tenant_id uuid NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and policy `tenant_isolation USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (same)`.
- `audit`: tenant-scoped rows with RLS; platform events have a null tenant.

**DB roles.**
- `migrator` owns the schema.
- `app_user` (tenant API) is NOBYPASSRLS. It has CRUD on `tenant`, SELECT on selected `platform` tables (Tenant, TenantDomain, Plan, Subscription, BrandingVersion public columns), and INSERT/SELECT only on `audit`.
- `platform_svc` (console API) has full `platform` and INSERT on `audit`. It has **no grants on `tenant`**; it only gets EXECUTE on `SECURITY DEFINER` aggregate functions such as `platform.fn_tenant_usage(tenant_id)`, which return counts only.

**Tenant context.**
- `nestjs-cls` holds `{tenantId, userId, employeeId, sessionId, clientType, permVersion, requestId}`.
- A Prisma client extension opens a request-scoped transaction and runs `SELECT set_config('app.tenant_id', $1, true)` before any query.
- `tenantId` is always injected from CLS. It is never taken from the request body.
- BullMQ jobs carry `tenantId`; the worker restores CLS the same way.

**Outbox events.**
- Table `tenant.domain_event_outbox`, written in the same transaction as the change.
- A relay publishes via LISTEN/NOTIFY with a 1 s poll fallback, then fans out to in-process handlers and BullMQ.
- Envelope: `{id (uuidv7), tenantId, type, version, occurredAt, actor:{type,id,label}, payload}`.

**Realtime.**
- Socket.IO with the Redis adapter. Handshake uses the access token.
- Rooms: `t:{tenantId}`, `u:{userId}`, `s:{sessionId}`.

**Shared package.** `packages/shared` holds zod schemas, the permission catalogue, notification-type catalogue, file-purpose registry, data-classification registry, status-to-tone registry, formatters, and the brand ramp generator. It is used by web, api and tracker.

**Formatters (shared contract).**
- `formatINR(paise, {compact})`: "₹ 1,02,880" (Indian grouping), "₹ 86.4 L", "₹ 1.2 Cr".
- `formatDuration(sec)`: "41h 20m".
- `formatDay(date, tz)`: "29 Sep".
- `formatLongDate`: "Tuesday, 29 September 2026".
- `formatRelative`: "Today" / "Yesterday" / "26 Sep".
- Times are 24h "09:41". Timezone comes from the tenant (default Asia/Kolkata).

---

## M1. App shell and design system port (P1)

### 1. Screens and UX

**Package `packages/ui`**
- `tokens.css` ports every `:root` variable verbatim: bg/surface/text/accent/accent-2/divider, neutral/accent/accent-2 ramps 100–900, fonts, spacing (4.6px scale), radii, shadows.
- Component classes are ported as-is: `.btn` (primary, secondary, ghost, icon, block), `.field`, `.input`, `.radio`, `.seg`, `.card` (+ kicker, title, body, meta), `.tag` (accent, accent-2, neutral, outline), `.nav`, `.table`, `.dialog`.
- Fonts are self-hosted with @fontsource: Cormorant Garamond 400/600 (+ italic for the quote) and Lora 400/600.
- New brand tokens for M11: `--brand-sidebar-bg` (default transparent), `--brand-sidebar-fg`, `--brand-logo-url`, `--brand-product-name`.

**Login layout** (`/login`, M2 behavior)
- Left panel: wordmark "Lexisora" or the tenant product name, tagline "People & Operations Suite", headline, body, and the footnote "Mobile access is enabled only for CEO, Admin and HR roles."
- Right panel: the form.

**App layout** (grid 236px sidebar + main; main max-width 1320px, padding 28/32/64)

*Sidebar*
- Sticky, full height.
- Groups in order: Home, Time, Work, People, Finance, Workplace, Admin, SaaS.
- Group label: 10px uppercase neutral-600.
- Item: 13px. Active style is bg accent-100 and text accent-800. `employees` stays active while on `/employees/:id`.
- The item list comes from `GET /me` → `navigation` (server-computed from M3 permissions and M10 entitlements).
- Plan-locked items: shown with a "Growth" tag to users holding `billing.manage` (opens an upsell page). Hidden for everyone else.

*Header*
- Global search input, placeholder "Search people, tasks, documents", max 320px, Ctrl/Cmd+K focuses it (M8).
- Demo role chips, only in demo mode (M14).
- Punch button, primary. Label "Punch in"/"Punch out" comes from the Attendance contract `GET /attendance/me/punch-state`. If the location punch mode is biometric-only and the user is not punched in, clicking shows the toast "Office mode: punch in with the biometric sensor". Hidden when the user lacks `attendance.self`.
- "Alerts · N" secondary button: unread count from M5, capped "99+", updated live by socket `notification.count`. Goes to `/alerts`.
- Avatar button: initials in an accent ring, name, and "Sign out" subtext. Calls `POST /auth/logout`.

*Global banners* (top of main)
- Tenant read-only / past-due (M10).
- Demo workspace (M14).
- Connection lost (socket down more than 10 s).
- Session-expiring modal.

**Generic screen template** (`<ModulePage>`, drives every GEN screen)
- Header: `title` h2, `subtitle` (max 760px), optional `action2` secondary and `action` primary. Buttons render only if the user holds the action's permission.
- `kpis`: strip, auto-fit min 170px. Border-top accent, 11px uppercase label, 30px tnum heading value, 12px sub.
- `tabs`: underline tabs; the active one uses accent-700 text and an accent 2px border. Tab counts ("All · 128") come from the API.
- `tiles`: auto-fill min 230px cards. 16:9 striped media placeholder when `media`, kicker, title, body, ghost CTA.
- `table`: CSS-grid table. First column `minmax(140px,1.6fr)`, others `minmax(90px,1fr)`. Header 11px uppercase. Rows hover 4%. When `to` is set, a row click navigates.
- Cell kinds:
  - `text`
  - `tag` with tone: `~` → tag-accent (positive/active/done), `!` → tag-outline (attention/pending), `-` → tag-neutral (info/inactive)
  - `check`: toggle button, accent fill. Only editable when the user has the row's write permission; otherwise read-only.
- Status-to-tone mapping is centralized in `packages/shared/status-tones.ts`, keyed by `{module, status}`. Domains never hardcode tones.
- Standard states: loading skeleton, empty ("Nothing here yet" + primary action), error with retry, 403 ("You don't have access to this module"), plan-locked.
- Pagination: cursor based, 25 rows, infinite "Load more".

**FormDialog** (from wireframe FORMS)
- Width min(560px,100%), max-height 90vh, two-column grid. `span:2` becomes `grid-column: 1 / -1`.
- Field kinds: text, email, date, time, select (async options), area, file (dropzone → M7 upload intent).
- Buttons: Cancel and Submit (label per form).
- Validated by a shared zod schema through react-hook-form. Server 422 errors map to fields.
- Success closes the dialog, shows the form's toast, and invalidates the related TanStack Query keys.

**Toast**
- Fixed bottom-center, neutral-900 background, neutral-100 text, 2.6 s. Queue of at most 3.
- Variants: info and error (error has an accent-outline border).

**Routing** (TanStack Router; wireframe screenId → route)

| Screen IDs | Routes |
|---|---|
| login, dashboard, feed, notices, chat | `/login`, `/dashboard`, `/feed`, `/notices`, `/chat` |
| attendance, timesheet, approvals, leave, leaveAdmin, idcompliance | `/attendance`, `/timesheet`, `/approvals`, `/leave`, `/leave/setup`, `/id-compliance` |
| projects, kanban, archive, interns | `/projects`, `/projects/:id/board` (kanban also at `/board`), `/archive`, `/interns` |
| employees, profile, onboarding, shifts, locations, appraisal, jobs, candidates, interviews | `/employees`, `/employees/:id`, `/onboarding`, `/shifts`, `/locations`, `/appraisals`, `/jobs`, `/candidates`, `/interviews` |
| payslips, payroll, ledger, invoices, purchases, filing | `/payslips`, `/payroll`, `/ledger`, `/invoices`, `/purchases`, `/filing` |
| vault, idcard, vcard, assets, welcomekit, policies, helpdesk, lms, kudos, facility, cctv, wellness | `/vault`, `/id-cards`, `/visiting-card`, `/assets`, `/welcome-kits`, `/policies`, `/helpdesk`, `/learning`, `/kudos`, `/facility`, `/cctv`, `/wellness` |
| roles, settings, notif | `/admin/roles`, `/admin/attendance-policy`, `/alerts` |
| New screens (not in wireframe) | `/admin/audit`, `/admin/security` |
| billing, whitelabel, tenants, privacy, support | `/saas/subscription`, `/saas/branding`, `/saas/tenants` (operator tenant only; hands off to console), `/saas/privacy`, `/saas/support` |
| Auth utility routes | `/reset-password`, `/invite/:token`, `/sso/callback`, `/workspace-not-found`, `/403` |

- A route guard checks `navigation` from `/me`. A forbidden route redirects to `/dashboard` with a toast, matching the wireframe's role-switch behavior.

**Responsive**
- Below 900px the sidebar becomes a drawer and the header collapses (search icon, punch, alerts, avatar).
- The mobile layout is only reachable by users with `mobile.access` (M2).

### 2. Data model
- No shell-owned tables. Uses `/me` (M2/M3), and `UserUiPrefs` (tenant): `userId @id, tenantId, sidebarCollapsed Boolean, lastRoute String?, density enum(COMFORTABLE, COMPACT)`.

### 3. Workflows
- Boot:
  1. `GET /public/workspace` (by host) returns branding and login methods.
  2. If the access token is not in memory, `POST /auth/refresh`.
  3. `GET /me` → render.
- Socket `rbac.changed` → refetch `/me` and re-guard the current route.
- `branding.published` → reload the theme stylesheet.
- `session.revoked` → clear cache and redirect to `/login?reason=revoked`.

### 4. API
- `GET /me` (authenticated). Returns `{user, employee:{id,empCode,name,designation,department}, tenant:{id,name,slug,plan,status,timezone}, roles:[{key,name}], permissions:{[key]:Scope[]}, entitlements:string[], navigation:[{group,items:[{id,label,route,locked?}]}], brandingVersion, flags, unreadCount}`.
- `PATCH /me/ui-prefs`.

### 5. Business rules
- A nav item is visible iff `hasAny(item.permission) ∧ (entitled(item.feature) ∨ showLockedToBillingAdmin)`.
- Nav order is fixed by the catalogue. Groups with zero visible items are hidden.

### 6. Jobs / notifications / audit
None.

### 7. Integrations
None.

### 8. Edge cases
- Sign out while punched in: attendance session continues. Sign-out is not punch-out.
- Deep link to a forbidden route: show 403, then redirect.
- Stale nav after a role change: handled by `rbac.changed`.

### 9. Phase and dependencies
- P1. Depends on M2, M3, M5, M8.
- Consumes the Attendance punch-state API.

### 10. Acceptance
1. Log in as employee. The sidebar shows exactly the NAV-visible items for employee (for example, no Timesheet approvals, Employees, Payroll run, Admin/Roles, or SaaS). Direct navigation to `/payroll` shows 403, then redirects to dashboard.
2. Log in as admin. All 8 groups are visible. The Alerts count equals the unread notifications, and it increments live when a notification is created for that user.
3. A GEN screen renders KPIs, tabs, and tags with the correct tones (`Active` = tag-accent, `Pending` = tag-outline, `Draft` = tag-neutral). A row with `to` navigates.
4. A form dialog with an invalid email shows a field error from zod. On a server 422, the error attaches to the field. On success, the toast text matches the form spec.
5. Office-mode user (biometric-only location) clicks header Punch in: gets the toast "Office mode: punch in with the biometric sensor", and no punch is recorded.

---

## M2. Authentication, sessions and devices (P1; SSO and MFA P2)

### 1. Screens and UX

**Login `/login`**
- Workspace: prefilled from the host (for example `lexisora.hrms.app`) and read-only, with a "Change" link. On the apex `hrms.app/login` it is editable; submitting resolves the workspace and redirects to its domain.
- Official email: placeholder `name@{tenant.primaryEmailDomain}`.
- Password.
- Sign in button (btn-block).
- "Forgot password" link → inline panel with email field and "Send reset link".
- "Use SSO" link: shown only if the tenant has an enabled SsoConnection. If SSO is enforced, it is the primary button and the password fields collapse behind "Sign in with password (admins)".
- Demo "sign in as" block: demo mode only (M14).

Error copy:
- Wrong email or password: generic "Email or password is incorrect".
- Locked: "Too many attempts. Try again in 15 minutes or reset your password."
- Disabled: "Your account is deactivated. Contact HR." Shown only after a correct password.
- Mobile blocked: "Mobile access is enabled only for CEO, Admin and HR roles."
- Tracker blocked: "Available to Remote / WFH employees. Office staff punch with biometric."

**Other auth pages**
- `/reset-password?token`: new password + confirm, with a strength meter.
- `/invite/:token`: set password (from "Add & send onboarding invite"), then redirect to `/onboarding`.

**Profile → Devices tab** (added to profile tabs, self only)
- Lists the user's own paired devices: name "PRIYA-LAPTOP", platform "Windows 11", app version "v1.4.2", paired date, last seen, "Unpair" button.
- "Enter pairing code" 6-box input.
- Pending request cards: "Approve" / "Reject".
- HR sees the same list per employee on the profile, with `devices.manage`.

**`/admin/security` (admin; new screen under Admin)**
- Session idle timeout, allowed email domains, password policy (display), max devices per user.
- SSO connections (P2): add OIDC (Google Workspace / Microsoft Entra / generic), test connection, enforce toggle, last 20 SSO failures with reason codes.
- MFA policy (P2): off, optional, or required for roles holding high-risk permissions.
- Active sessions list for the whole tenant, with "Revoke".

**Desktop tracker screens** (UI owned by the tracker domain; these endpoints are owned here)
- Sign in: workspace, email, password.
- "Pair this device": step 2 of 2, 6-digit code, device name and platform, permissions line "activity monitor, screen capture", "I've approved it · continue".
- Settings: "Sign out & unpair".

### 2. Data model (schema `tenant`, RLS)

```
model User {
  id                String   @id @db.Uuid
  tenantId          String   @db.Uuid
  email             String   @db.Citext      // official email
  displayName       String
  avatarFileId      String?  @db.Uuid
  passwordHash      String?                  // argon2id; null until invite accepted / SSO-only
  passwordChangedAt DateTime?
  status            UserStatus @default(INVITED)
  failedLoginCount  Int      @default(0)
  lockedUntil       DateTime?
  lastLoginAt       DateTime?
  employeeId        String?  @db.Uuid         // FK → People.Employee (unique)
  mfaEnabled        Boolean  @default(false)
  isDemoPersona     Boolean  @default(false)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  @@unique([tenantId, email]) @@unique([tenantId, employeeId]) @@index([tenantId, status])
}
enum UserStatus { INVITED ACTIVE LOCKED DISABLED }
enum ClientType { WEB MOBILE DESKTOP }

model Session {
  id String @id @db.Uuid; tenantId; userId
  clientType ClientType; deviceId String? @db.Uuid
  ip String; userAgent String; geoHint String?
  createdAt; lastSeenAt; idleExpiresAt DateTime; absoluteExpiresAt DateTime
  revokedAt DateTime?; revokeReason RevokeReason?   // LOGOUT, LOGOUT_ALL, ADMIN, PASSWORD_RESET, REUSE_DETECTED, USER_DISABLED, MOBILE_ACCESS_REMOVED, TENANT_SUSPENDED, DEVICE_UNPAIRED
  @@index([tenantId, userId, revokedAt])
}
model RefreshToken {
  id; tenantId; sessionId; familyId String @db.Uuid; parentId String?
  tokenHash String @unique  // sha256 of 256-bit random
  expiresAt DateTime; usedAt DateTime?; revokedAt DateTime?
  @@index([sessionId])
}
model AuthToken {  // single-use links
  id; tenantId; userId; purpose AuthTokenPurpose // INVITE, PASSWORD_RESET, EMAIL_CHANGE, DEVICE_APPROVE, CONSOLE_HANDOFF
  tokenHash String @unique; expiresAt; usedAt?; createdById String?; meta Json?
  @@index([tenantId, userId, purpose])
}
model LoginAttempt {
  id BigInt @id @default(autoincrement()); tenantId String?; emailHash String; ip String
  clientType ClientType; success Boolean; reason String?; createdAt DateTime @default(now())
  @@index([tenantId, emailHash, createdAt]) @@index([ip, createdAt])
}
model Device {
  id; tenantId; userId; name String; platform String; appVersion String
  publicKey String          // Ed25519 SPKI, private key in Electron safeStorage/DPAPI
  status DeviceStatus @default(ACTIVE)  // ACTIVE, REVOKED
  pairedAt; approvedById String?; lastSeenAt DateTime?; revokedAt?; revokedById?
  @@index([tenantId, userId, status])
}
model DevicePairRequest {
  id; tenantId; userId; deviceName; platform; appVersion; publicKey
  codeHash String; attempts Int @default(0)
  status PairStatus @default(PENDING)  // PENDING, APPROVED, REJECTED, EXPIRED
  expiresAt DateTime; decidedAt?; decidedById?; deviceId String?
  @@index([tenantId, userId, status])
}
model SsoConnection {   // P2
  id; tenantId; protocol SsoProtocol (OIDC, SAML); provider (GOOGLE, MICROSOFT, GENERIC)
  displayName; issuer; clientId; clientSecretEnc Bytes; discoveryUrl; emailDomains String[]
  enabled Boolean; enforced Boolean; allowPasswordForAdmins Boolean @default(true)
  lastFailureAt DateTime?; createdAt
}
model SsoFailure { id; tenantId; connectionId; emailHint String?; reason String; createdAt }  // P2
model MfaFactor { id; tenantId; userId; type (TOTP); secretEnc Bytes; confirmedAt?; recoveryCodeHashes String[] } // P2
```

`TenantSettings` (M4) holds: `webIdleMinutes = 720`, `webAbsoluteDays = 7`, `mobileDays = 30`, `desktopDays = 30`, `maxDevicesPerUser = 2`, `allowedEmailDomains`.

### 3. Workflows

**Login** (`POST /auth/login`)
1. Resolve the tenant (M4). If not found → 404 `WORKSPACE_NOT_FOUND`.
2. Tenant status gate:
   - CANCELLED / DELETED → 403 `WORKSPACE_CLOSED`.
   - SUSPENDED → only users holding `billing.manage` continue (session flagged `billingOnly`).
3. Rate limits: 10/min per IP, 5 failures per account per 15 min.
4. Look up the user. Always run argon2 verify (dummy hash when not found) so timing does not leak.
5. On failure: `failedLoginCount++`. At 5 within 15 min → `LOCKED`, `lockedUntil = now + 15 min`, email `security.account_locked`, audit.
6. On success, check status:
   - INVITED → 409 `INVITE_PENDING` ("Check your email for the invite", with a resend option for admins).
   - DISABLED → 403.
   - LOCKED with `lockedUntil` in the future → 423.
7. SSO enforced: reject password logins unless the user holds `roles.manage` and `allowPasswordForAdmins` is true.
8. Client check. Detect the client (M2 rule 5.3):
   - MOBILE without `mobile.access` → 403 `MOBILE_ACCESS_DISABLED`, audit `auth.mobile_blocked`.
   - DESKTOP → require `tracker.use` and `Attendance.canUseDesktopTracker(userId) = true`, else 403 `TRACKER_NOT_ALLOWED`.
9. MFA (P2): if required → 200 `{mfaRequired, challengeToken (5 min)}`, then `POST /auth/mfa/verify`.
10. Create Session and RefreshToken. Issue the access JWT. Reset the failure counter. Set `lastLoginAt`. Audit `auth.login.success`. A new device/IP fingerprint triggers notification `security.new_signin`.

**Refresh** (`POST /auth/refresh`)
- Web reads an httpOnly cookie `__Host-rt`, path `/auth`, SameSite=Strict, and requires header `X-Requested-With`. Desktop and mobile send the token in the body; desktop must also send a request signature (see Devices).
- Token already used → **reuse detected**: revoke the family and session, audit `auth.refresh_reuse`, notify the user.
- Validate the session is not revoked, `idleExpiresAt` and `absoluteExpiresAt`, tenant status, user ACTIVE, and (for MOBILE) `mobile.access` still granted.
- Rotate the refresh token, slide `idleExpiresAt`, issue a new access token with the current `pv`.

**Logout**
- `POST /auth/logout` revokes the current session.
- `POST /auth/logout-all` revokes all sessions except device sessions, unless `includeDevices=true`.

**Forgot password**
- `POST /auth/password/forgot {workspace,email}` always returns 202.
- If ACTIVE or LOCKED: AuthToken PASSWORD_RESET, TTL 30 min, previous tokens invalidated. Email link `https://{primaryHost}/reset-password?token=`.
- `POST /auth/password/reset {token,password}` sets the hash, unlocks, and revokes **all** sessions including desktop sessions. Devices stay paired, so the tracker re-login does not need re-pairing. Emails `security.password_changed`, audits.

**Invite** (called by People on "Add employee")
- `IdentityService.inviteUser({email,name,employeeId,roleKeys})` creates User INVITED and AuthToken INVITE (TTL 7 days), then emails `identity.invite`.
- Accept → ACTIVE → auto-login → `/onboarding`.
- Resend invalidates earlier tokens. Expired → "Ask HR to resend".

**SSO (P2, OIDC)**
- `GET /auth/sso/start?workspace&connection` (PKCE + state + nonce, 10 min in Redis) → IdP → `GET /auth/sso/callback`.
- Require `email_verified`. Email domain must be in `emailDomains`. Match an existing User by (tenant, email); no JIT provisioning by default.
- Then the same checks as login steps 6–10.
- Failures are recorded in `SsoFailure` with reason codes: `NO_MATCHING_USER`, `DOMAIN_NOT_ALLOWED`, `EMAIL_UNVERIFIED`, `IDP_ERROR`, `CLOCK_SKEW`, `USER_DISABLED`.
- SAML is P3.

**Devices (tracker pairing)**
1. Tracker login (`client=DESKTOP`) returns a `prePairToken` (10 min, scope `device.pair` only) plus `pairingRequired: true`, unless the device public key matches an ACTIVE Device.
2. `POST /devices/pair-requests {deviceName, platform, appVersion, publicKey}` (prePairToken) returns `{requestId, code (6 digits), expiresAt (10 min)}`. The server also emails the user `device.pair_request` with a one-click approve link (AuthToken DEVICE_APPROVE).
3. Approval, by either:
   - the user in the portal: Profile → Devices → enter code (`POST /devices/pair-requests/approve {code}`), max 5 wrong attempts per request, then EXPIRED; or
   - the email link, which requires a logged-in web session of the same user.
4. On approve: create Device ACTIVE (enforce `maxDevicesPerUser`; the oldest must be unpaired first, else 409 `DEVICE_LIMIT`). Emit socket `device.pair.approved` to room `pair:{requestId}`; the tracker also polls `GET /devices/pair-requests/:id` every 3 s as a fallback.
5. The tracker exchanges its prePairToken plus a signature over `requestId` for a DESKTOP session bound to `deviceId`.
6. Every desktop refresh must carry `X-Device-Sig = Ed25519(sign, refreshTokenHash|timestamp)`, with timestamp within ±5 min.

Unpair:
- From the tracker ("Sign out & unpair") → `DELETE /devices/self/current`.
- From the portal, or by HR → `DELETE /devices/:id`.
- Either way the Device is REVOKED, its sessions are revoked, and socket `session.revoked` goes to the tracker.

**User deactivation** (event `employee.exited` or `employee.access_revoked` from People)
- User → DISABLED, revoke all sessions and devices, remove from search, notify admins. Seat is freed (M10).

**Session state machine**
- ACTIVE → REVOKED (logout, admin, reuse, reset, disabled, mobile toggle off, tenant suspended, unpair).
- ACTIVE → EXPIRED (idle or absolute), evaluated lazily at refresh and swept by a job.

**Account state machine**
- INVITED → ACTIVE (accept).
- ACTIVE ↔ LOCKED (failures / timeout or reset).
- ACTIVE or LOCKED → DISABLED (exit or admin).
- DISABLED → ACTIVE (rehire / admin reactivate; requires a seat).

### 4. API

| Method and path | Permission |
|---|---|
| `GET /public/workspace?host=` → `{tenantName, productName, logoUrl, themeCssUrl, loginMethods:{password, sso:[{id,label}]}, status}` | public |
| `POST /auth/login` | public |
| `POST /auth/refresh` | public (refresh token) |
| `POST /auth/logout`, `POST /auth/logout-all` | authenticated |
| `POST /auth/password/forgot`, `POST /auth/password/reset` | public |
| `POST /auth/invite/accept`, `GET /auth/invite/:token` (validity + name) | public |
| `POST /auth/password/change {current,new}` | authenticated |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id` | self |
| `GET /admin/sessions?userId=`, `DELETE /admin/sessions/:id` | `security.manage` |
| `POST /admin/users/:id/resend-invite` | `employees.manage` |
| `POST /admin/users/:id/unlock` | `employees.manage` |
| `POST /admin/users/:id/disable`, `/enable` | `employees.manage` |
| `POST /auth/mfa/totp/setup`, `/verify`, `DELETE /auth/mfa` (P2) | self |
| `GET/POST/PATCH/DELETE /admin/sso-connections`, `POST /admin/sso-connections/:id/test` (P2) | `security.manage` |
| `GET /auth/sso/start`, `GET /auth/sso/callback` (P2) | public |
| `POST /devices/pair-requests` | prePairToken |
| `GET /devices/pair-requests/:id` | prePairToken |
| `POST /devices/pair-requests/approve {code}` | `devices.self` |
| `POST /devices/pair-requests/:id/reject` | `devices.self` |
| `POST /devices/pair-requests/:id/exchange` | prePairToken + signature |
| `GET /devices` (own), `DELETE /devices/:id` (own) | `devices.self` |
| `GET /admin/devices?userId=`, `DELETE /admin/devices/:id` | `devices.manage` |
| `PATCH /admin/security-settings` | `security.manage` |

Realtime events: `session.revoked {reason}`, `device.pair.approved`, `device.pair.rejected`.

### 5. Business rules

**Access JWT**
- EdDSA, 15 min, `kid` rotation every 90 days (2 keys valid).
- Claims: `{iss:"https://{host}", aud:"tenant-api", sub:userId, tid, sid, cli, pv, did?, iat, exp}`.
- Each request checks `sid` against a Redis session-state cache (`sess:{sid}` → active|revoked, TTL 15 min, DB fallback) for instant revocation.
- The access token is held in memory only, never in localStorage.

**Refresh TTLs** (tenant-configurable, cannot exceed these maximums)

| Client | Idle | Absolute |
|---|---|---|
| Web | 12 h (720 min) | 7 days |
| Mobile | 30 days sliding | 90 days |
| Desktop | 30 days sliding | none while the device is ACTIVE |

**Client detection**
- `X-Client-App: hrms-mobile/<ver>` → MOBILE.
- `X-Client-App: lexisora-tracker/<ver>` + device signature → DESKTOP.
- `Sec-CH-UA-Mobile: ?1` or UA matching `/Android|iPhone|iPod|Mobile/` → MOBILE.
- Otherwise WEB.
- The claim is fixed for the life of the session.

**Password policy**
- Length ≥ 10 and ≤ 128. Not in the top-100k breached list (bundled offline list; HIBP k-anonymity adapter optional). Must not contain the email local-part or name tokens. No composition rules.
- argon2id with m=19 MiB, t=2, p=1.

**Lockout:** 5 failures in 15 min → 15 min lock. Admin unlock or password reset clears it.

**Devices:** at most `maxDevicesPerUser` (default 2) ACTIVE devices. Pair code: 6 digits, 10 min TTL, 5 attempts.

### 6. Jobs / notifications / audit
- Jobs: `auth.session-sweep` (hourly, marks expired sessions), `auth.token-purge` (daily; used/expired AuthTokens and RefreshTokens older than 30 days), `auth.pair-expire` (every minute).
- Notifications:
  - `identity.invite` (email)
  - `security.password_reset` (email)
  - `security.password_changed` (email + in-app)
  - `security.account_locked` (email)
  - `security.new_signin` (in-app + email)
  - `security.refresh_reuse` (email + in-app, HIGH)
  - `device.pair_request` (email + in-app)
  - `device.paired`, `device.unpaired` (in-app)
- Audit:
  - `auth.login.success`, `auth.login.failure` (reason)
  - `auth.lockout`, `auth.logout`, `auth.logout_all`
  - `auth.password.reset_requested`, `auth.password.reset`, `auth.password.changed`
  - `auth.refresh_reuse`, `auth.mobile_blocked`, `auth.tracker_blocked`
  - `auth.invite.sent`, `auth.invite.accepted`
  - `session.revoked` (by whom)
  - `device.pair_requested`, `device.paired`, `device.pair_rejected`, `device.unpaired`
  - `sso.connection.*`, `sso.login.failure`, `mfa.enabled`, `mfa.disabled`
  - `user.disabled`, `user.enabled`, `user.unlocked`

### 7. Integrations
- `EmailAdapter` (via M5).
- `SsoProvider` interface: `{ buildAuthUrl(conn, state, nonce, pkce): string; exchange(conn, code, verifier): Promise<{sub, email, emailVerified, name}> }`. OIDC implementation uses `openid-client`. Mock provider (dev) is a local page at `/dev/sso` where you pick a seeded email.
- `BreachedPasswordChecker { isBreached(pw): Promise<boolean> }`. Implementations: offline list (default) and HIBP.

### 8. Validation and edge cases
- Email is compared case-insensitively (citext) and trimmed.
- Workspace input accepts slug, full host, or URL, all normalized.
- Login during tenant PROVISIONING → 503 "Workspace is being set up".
- User holds roles in the tenant but has no Employee record (platform-created admin) → allowed. People features show "Complete your profile".
- Two tabs refreshing at the same time: rotation grace. The parent token is accepted once more within 10 s and returns the same child, so this is not flagged as reuse.
- Clock skew on device signature: ±5 min, else 401 `DEVICE_CLOCK_SKEW`.
- Mobile toggle removed while a mobile session is live: revoke immediately (see M3 side effect).
- A tracker user whose work mode changes to Office: the next refresh → 403 `TRACKER_NOT_ALLOWED`, and the tracker shows the office message. The Attendance domain emits `employee.work_mode_changed` so sessions are revoked proactively.

### 9. Phase and dependencies
- P1: password, invite, reset, JWT/refresh, lockout, mobile/desktop gates, devices.
- P2: OIDC SSO, TOTP MFA, security settings SSO panel.
- P3: SAML.
- Depends on M3 (permissions), M4 (tenant), M5 (email).
- Needs from People: `employee.*` events. Needs from Attendance: `canUseDesktopTracker`.

### 10. Acceptance
1. Correct credentials on `lexisora.localhost` log in. A wrong password 5 times → the 6th attempt returns 423 even with the correct password; the lockout email arrives in Mailpit; the audit shows 5 failures and 1 lockout.
2. Forgot password → Mailpit link → reset. The old refresh token fails (session revoked) and the new password works. Replaying the used reset link → "Link expired".
3. Mobile UA login as employee → 403 `MOBILE_ACCESS_DISABLED`. The same account as hr → success. Admin toggles Mobile off for HR → HR's mobile session gets `session.revoked` within 2 s and the next refresh fails.
4. Replaying a rotated refresh token → the whole session is revoked and the user is notified.
5. Tracker pairing: the tracker requests a code, the user enters it in Profile → Devices, the tracker receives a DESKTOP session, refreshes without a valid device signature → 401. After unpair in the portal, the tracker gets `session.revoked`.
6. Office-mode employee logs into the tracker → 403 `TRACKER_NOT_ALLOWED` with the office message.

---

## M3. RBAC and permission catalogue (P1)

### 1. Screens and UX

**Roles & access `/admin/roles`** (requires `roles.manage`)
- Title "Roles & access". Subtitle "Module permissions per role. Mobile access is off by default and should be enabled only for top-level roles." Primary action "Add role".
- Tabs (additive): **Matrix** (default), **Members**, **All permissions**.
- **Matrix tab** (wireframe table):
  - Columns: "Module" plus one column per role. Seeded order: Employee, Team Lead, Rep. Manager, HR, Admin / CEO; custom roles are appended.
  - Rows are the curated "matrix rows": Mobile app access, Approve timesheets, View all task boards, Payroll & ledger, Publish global notices, Publish team notices, Recruitment, CCTV feeds.
  - Each cell is a check toggle. A matrix row can bundle several permission keys; the cell is tri-state (all / some / none), where "some" shows a half-fill. Clicking a partial cell opens the detail drawer.
  - Toggling is immediate (optimistic PATCH) with a toast "Saved · Undo" (undo within 10 s).
  - High-risk rows (Mobile app access, Payroll & ledger, CCTV feeds, any `roles.manage`) ask for confirmation. Enabling Mobile for Employee/Team Lead/Rep. Manager shows the warning "Mobile access should be enabled only for top-level roles."
- **All permissions tab**: the full catalogue grouped by NAV group (Home…SaaS, plus Platform), one row per permission key, a cell per role.
  - Cells for scoped permissions show a scope chip (Own / Project / Team / Department / All) editable from a dropdown.
  - Plan-locked permissions are shown disabled with a "Growth"/"Enterprise" tag.
  - Dependencies auto-enable, with the toast "Also enabled: Employees › View compensation".
- **Members tab**: role picker → members table (Name, Emp ID, Department, Assigned on, Assigned by), "Add members" (multi-select employees), remove.
- **Role header menu**: Rename, Description, Duplicate, Delete (custom roles with 0 members only; otherwise "Reassign members to…").
- **"Add role" form**: Role name (text, span 2), "Copy permissions from" (select of existing roles; default Employee; also "None (empty)") → "Save" → toast "Role created".
- **Employee profile** gets a Roles chip list (edit with `roles.assign`).

### 2. Data model

```
// platform schema (global, synced from code at deploy; read-only at runtime)
model Permission {
  key String @id                 // "timesheet.approve.l1"
  group String                   // NAV group: Home|Time|Work|People|Finance|Workplace|Admin|SaaS|Platform
  module String                  // screen id / module
  label String; description String
  allowedScopes Scope[]          // [] = unscoped (boolean)
  defaultScope Scope?
  requires String[]              // dependency keys
  risk Risk @default(LOW)        // LOW | HIGH
  feature String?                // entitlement key (M10)
  matrixRow String?              // "Approve timesheets"
  navItems String[]              // screen ids this permission reveals
  deprecatedAt DateTime?
}
enum Scope { OWN PROJECT TEAM DEPARTMENT ALL }

// tenant schema (RLS)
model Role {
  id String @id @db.Uuid; tenantId
  key String                     // employee|lead|manager|hr|admin | custom slug
  name String; description String?
  isSystem Boolean @default(false)
  copiedFromRoleId String?; sortOrder Int
  archivedAt DateTime?; createdById; createdAt; updatedAt
  @@unique([tenantId, key]) @@unique([tenantId, name])
}
model RolePermission {
  tenantId; roleId; permissionKey String
  scopes Scope[]                 // [] for unscoped keys; may hold several e.g. [PROJECT, TEAM]
  grantedById; grantedAt
  @@id([roleId, permissionKey]) @@index([tenantId, permissionKey])
}
model UserRole {
  tenantId; userId; roleId; assignedById; assignedAt
  @@id([userId, roleId]) @@index([tenantId, roleId])
}
// TenantSettings.rbacVersion Int (bumped on any change)
```

### 3. Permission catalogue (all NAV modules)

Seeded role columns: E = employee, L = lead, M = manager, H = hr, A = admin. A scope in brackets is the seeded scope. "All" in the Seeded column means every seeded role. The Nav column is the screen the key reveals.

**Home**

| Key | Seeded | Nav / notes |
|---|---|---|
| `dashboard.view` | All | dashboard |
| `feed.view`, `feed.engage` (like/comment) | All | feed |
| `feed.publish` | H, A | feed editor ("canPublish") |
| `notices.view` | All | notices |
| `notices.publish.team` [DEPARTMENT/PROJECT] | L, M, H, A | matrix row "Publish team notices" |
| `notices.publish.global` | H, A | matrix row "Publish global notices" |
| `chat.use` | All | chat |
| `chat.channels.manage` | L, M, H, A | |
| `chat.calls.start` | All | |

**Time**

| Key | Seeded | Nav / notes |
|---|---|---|
| `attendance.self` | All | attendance, header punch |
| `attendance.view` | M [TEAM], H [ALL], A [ALL] | |
| `attendance.regularize.approve` | M [TEAM], H, A | |
| `attendance.policy.manage` | H, A | settings |
| `tracker.use` | All | desktop sign-in; gated additionally by work mode |
| `timesheet.self` | All | timesheet |
| `timesheet.approve.l1` [PROJECT] | L, A [ALL] | approvals; matrix "Approve timesheets" |
| `timesheet.approve.l2` [TEAM] | M, A [ALL] | approvals; matrix "Approve timesheets" |
| `timesheet.screenshots.view` | L [PROJECT], M [TEAM], A [ALL] | |
| `leave.self` | All | leave |
| `leave.approve` | M [TEAM], H [ALL], A [ALL] | |
| `leave.setup.manage`, `leave.credit` | H, A | leaveAdmin |
| `idcompliance.view`, `idcompliance.log` | H, A | idcompliance |

**Work**

| Key | Seeded | Nav / notes |
|---|---|---|
| `projects.view` | E [PROJECT], L [PROJECT], M [DEPARTMENT], H [ALL], A [ALL] | projects |
| `projects.manage` | L [PROJECT], M, A | |
| `tasks.board.view` | E [DEPARTMENT], L [DEPARTMENT], H [DEPARTMENT], M [ALL], A [ALL] | kanban; the ALL scope is the matrix row "View all task boards" |
| `tasks.manage` | L, M, A | |
| `tasks.move` [OWN] | All; L/M/A [PROJECT] | |
| `archive.view` | L, M, A | archive; per-project access list applies |
| `archive.manage` | M, A | |
| `interns.view`, `interns.assign` | L, H, A | interns |

**People**

| Key | Seeded | Nav / notes |
|---|---|---|
| `employees.view` | M [TEAM], H [ALL], A [ALL] | employees, profile |
| `employees.manage` (add, import, edit, disable) | H, A | |
| `employees.compensation.view` | H, A | profile "Offer & pay" |
| `employees.documents.verify` | H, A | |
| `onboarding.self` | All | onboarding |
| `onboarding.manage` | H, A | |
| `shifts.manage` | H, A | shifts |
| `locations.manage` | H, A | locations |
| `appraisal.view` | M [TEAM], H, A | appraisal |
| `appraisal.manage` | H, A | |
| `appraisal.review` | M [TEAM], A | |
| `appraisal.self` | All | |
| `recruitment.jobs.manage` | H, A | jobs |
| `recruitment.candidates.view` | L, H, A | candidates; matrix "Recruitment" |
| `recruitment.candidates.manage` | H, A | matrix "Recruitment" |
| `recruitment.interviews.view` | L, M, H, A | interviews |
| `recruitment.interviews.schedule` | L, H, A | matrix "Recruitment" |
| `recruitment.interviews.score` [OWN = assigned interviewer] | L, M, H, A | |
| `roles.assign` | H, A | assigning roles on the profile; cannot grant a role holding permissions the assigner lacks |

**Finance**

| Key | Seeded | Nav / notes |
|---|---|---|
| `payslips.self` | All | payslips |
| `payroll.view`, `payroll.run` | H, A | payroll; matrix "Payroll & ledger" |
| `ledger.manage` | A | ledger; matrix "Payroll & ledger" (so HR shows partial) |
| `invoices.manage` | A | invoices |
| `purchases.manage` | A | purchases |
| `filing.manage` | A | filing |

**Workplace**

| Key | Seeded | Nav / notes |
|---|---|---|
| `vault.self` | All | vault |
| `vault.manage` | H, A | |
| `idcard.design` | H, A | idcard |
| `vcard.self` | All | vcard |
| `assets.manage` | H, A | assets |
| `welcomekit.manage` | H, A | welcomekit |
| `policies.view` | All | policies |
| `policies.publish` | H, A | |
| `helpdesk.raise` | All | helpdesk |
| `helpdesk.resolve` | H, A | "Assigned to me" |
| `helpdesk.view.all` | H, A | |
| `lms.learn` | All | lms |
| `lms.manage` | H, A | |
| `kudos.view` | All | kudos |
| `kudos.give` | L, M, H, A | |
| `kudos.eotm` | H, A | |
| `facility.book`, `facility.visitor.register` | All | facility |
| `facility.manage` | H, A | |
| `cctv.view` | A | cctv; matrix "CCTV feeds" |
| `wellness.play` | All | wellness |

**Admin**

| Key | Seeded | Nav / notes |
|---|---|---|
| `roles.manage` | A | roles |
| `security.manage` | A | admin/security |
| `audit.view` | A | admin/audit |
| `notifications.self` | All | notif |
| `tenant.settings.manage` | A | |
| `mobile.access` | H, A | matrix "Mobile app access" |
| `devices.self` | All | |
| `devices.manage` | H, A | |
| `search.use` | All | |
| `directory.basic` | All | name / designation / department / email in search and chat |

**SaaS (tenant side)**

| Key | Seeded | Nav / notes |
|---|---|---|
| `billing.manage` | A | billing |
| `branding.manage` | A | whitelabel |
| `privacy.view` | A | privacy |
| `privacy.manage` (key rotation, support grants, export) | A | P3 |
| `support.request` | A | support |
| `platform.console.link` | none seeded | tenants; only meaningful in the OPERATOR tenant, auto-granted to users linked to a PlatformUser |

**Example seeded custom roles** (demo seed only; they prove "Add role" works)
- "Security desk": `idcompliance.log` + E defaults.
- "Facility Manager": `cctv.view`, `facility.manage` + E defaults. Matches the CCTV subtitle "Admin and Facility Manager only".
- "IT desk": `helpdesk.resolve`.

**Seeded role composition**
- Lead, Manager and HR each include all Employee permissions (seeded by copy).
- Admin holds every permission with ALL scope, except `platform.console.link`.

### 4. Workflows
- **Create role**: validate the name is unique (case-insensitive, 2–40 chars) → create Role (`key = slug(name)`, collision suffix) → copy RolePermission rows (scopes included) from the source → bump `rbacVersion` → audit `rbac.role.created {copiedFrom}`.
- **Toggle permission** `PUT /roles/:id/permissions/:key {enabled, scopes?}`:
  - Enable adds the `requires` closure.
  - Disable fails if other enabled keys on the same role depend on it (409 with the list), unless `cascade=true`.
  - Plan-locked keys → 402 `FEATURE_NOT_IN_PLAN`.
  - Bump version, invalidate the Redis cache `perm:{tenant}:{user}:*` for role members, and socket `rbac.changed` to members.
  - If the key is `mobile.access` and it was removed, revoke MOBILE sessions of members who no longer hold it through any role.
- **Matrix row toggle**: applies to all keys in the row, using each key's default scope.
- **Assign/remove member**: an assigner without `roles.manage` can only assign roles whose permission set is a subset of their own. Side effects are the same as a toggle.
- **Delete role**: custom only, 0 members → archived (soft). System roles cannot be deleted; they can be renamed and edited.
- **Lockout protection**: any change that would leave zero ACTIVE users with `roles.manage` → 409 `LAST_ADMIN`.

### 5. Business rules and evaluation
- `effective(user) = ⋃_{role ∈ user.roles} RolePermission → Map<key, Set<Scope>>`. Cached in Redis for 10 min, keyed by `rbacVersion`.
- `can(user, key) = key ∈ effective ∧ entitled(tenant, Permission.feature) ∧ statusAllows(tenant.status, method)`.
- `scopeFilter(user, key, resourceKind)` → `OR` over the held scopes. Each scope is resolved by a registered `ScopeResolver`:
  - OWN → `ownerUserId = me`
  - PROJECT → `projectId ∈ myProjects(lead|member)` (Projects domain)
  - TEAM → `employeeId ∈ reportsTree(me)` (direct and indirect reports; People domain)
  - DEPARTMENT → `departmentId ∈ myDepartments` (People domain)
  - ALL → no filter
- Relationship checks stack on top of scope. Example: a timesheet L1 approver must be the project's lead, or hold ALL scope. That check is enforced by the owning domain using `scopeFilter`.
- Guards:
  - `@RequirePermission(key)` on controllers → 403 `{code:'FORBIDDEN', permission:key}`.
  - `@Scoped(key)` injects the filter.
  - Denied attempts on HIGH-risk keys are audited.
- A user may hold several roles. Primary role for display = highest `sortOrder` among system roles.

### 6. Jobs / notifications / audit
- Job: `rbac.catalogue-sync` on deploy. Upserts Permission rows. When a new key has `seedFor` defaults, it is added to system roles of existing tenants **only if the key is new**; admin edits are never overwritten.
- Notification: `rbac.role_changed` (in-app to the affected user: "Your access was updated: +Approve timesheets").
- Audit: `rbac.role.created/renamed/deleted`, `rbac.permission.granted/revoked {role,key,scopes}`, `rbac.member.added/removed`, `rbac.denied` (HIGH risk only).

### 7. Integrations
None.

### 8. Edge cases
- Two admins toggle the same cell at once: last write wins, and both clients get `rbac.changed` and re-render.
- A user loses access to the screen they are on: redirect with a toast.
- Plan downgrade: permissions remain stored but are inert (entitlement check), and re-activate on upgrade.
- A custom role named "Admin": allowed only with a distinct key; the name must be unique.

### 9. Phase and dependencies
- P1.
- Depends on M4.
- Needs a ScopeResolver from People (TEAM, DEPARTMENT) and Projects (PROJECT).
- Every domain contributes its permission keys to the catalogue file.

### 10. Acceptance
1. Fresh tenant: the matrix equals the wireframe defaults (Mobile: H, A; Approve timesheets: L, M, A; View all task boards: M, A; Payroll & ledger: H partial, A full; Global notices: H, A; Team notices: L, M, H, A; Recruitment: L, H, A; CCTV: A).
2. "Add role" "Facility Manager" copied from Employee, enable CCTV feeds, assign Vikram. Vikram's sidebar shows CCTV without re-login, and `GET /cctv/cameras` returns 200 for him and 403 for Priya.
3. Removing `roles.manage` from the only admin → 409 `LAST_ADMIN`.
4. Enabling `payroll.run` for a custom role auto-enables `employees.compensation.view`. Disabling the compensation key alone → 409 listing the dependency.
5. A manager with `employees.view` [TEAM] lists employees and sees only their direct and indirect reports. HR sees all 128.
6. Tenant on the Free plan: the `payroll.run` toggle is disabled with a "Growth" tag, and the API returns 402.

---

## M4. Tenancy core (P1; dedicated DB P3)

### 1. Screens and UX
- `/workspace-not-found`: "We couldn't find that workspace" with an input to try another.
- `/admin/security` hosts company settings in P1 as a "Company" section: display name, legal name, GSTIN, PAN, registered address, state (GST state code), timezone, financial-year start month, week start, allowed email domains. Requires `tenant.settings.manage`. (A separate "Company settings" screen is possible later.)

### 2. Data model

```
// platform schema
model Tenant {
  id String @id @db.Uuid; slug String @unique        // ^[a-z][a-z0-9-]{2,30}$
  name String; legalName String?
  kind TenantKind @default(CUSTOMER)                  // OPERATOR (Lexisora), CUSTOMER, DEMO
  status TenantStatus @default(PROVISIONING)
  planCode String                                     // FREE|GROWTH|ENTERPRISE|INTERNAL
  dbMode DbMode @default(SHARED)                      // SHARED | DEDICATED (P3)
  dbConnectionRef String?                             // secret-manager ref, never the DSN itself
  timezone String @default("Asia/Kolkata"); locale String @default("en-IN"); currency String @default("INR")
  stateCode String?                                   // GST state code "24"
  createdAt; updatedAt; readOnlySince?; suspendedAt?; cancelledAt?; deletionScheduledAt?
  domains TenantDomain[]
}
enum TenantStatus { PROVISIONING PROVISION_FAILED ACTIVE READ_ONLY SUSPENDED CANCELLED DELETED }
model TenantDomain {
  id; tenantId; host String @unique                   // lower-case, no port
  kind DomainKind                                     // SUBDOMAIN | CUSTOM (P3)
  isPrimary Boolean; verificationToken String?; verifiedAt?; tlsStatus TlsStatus? // PENDING|ISSUED|FAILED
  redirectToPrimary Boolean @default(false); retiresAt DateTime?  // old hosts kept 90 days
  @@index([tenantId])
}
// tenant schema (RLS)
model TenantSettings {
  tenantId String @id; companyDisplayName; legalName; gstin String?; pan String?
  registeredAddress Json; stateCode String; timezone String; fyStartMonth Int @default(4)
  weekStart Weekday @default(MON); allowedEmailDomains String[]
  webIdleMinutes Int @default(720); webAbsoluteDays Int @default(7); mobileDays Int @default(30)
  desktopDays Int @default(30); maxDevicesPerUser Int @default(2)
  rbacVersion Int @default(1); updatedAt; updatedById
}
model NumberSequence {
  tenantId; key String      // "employee.fulltime", "employee.intern", "helpdesk.ticket", "invoice.gst", "voucher.receipt", ...
  period String @default("") // "" or FY label "2026-27"
  prefix String; padding Int; nextValue BigInt @default(1)
  @@id([tenantId, key, period])
}
model DomainEventOutbox { id String @id @db.Uuid; tenantId; type; version Int; payload Json; actor Json; occurredAt; publishedAt DateTime?; attempts Int @default(0) @@index([publishedAt, occurredAt]) }
model ScheduledJob { id; tenantId; key String; cron String?; runAt DateTime?; jobName; payload Json; timezone; enabled; lastRunAt?; nextRunAt; @@unique([tenantId, key]) }
```

### 3. Workflows

**Tenant resolution** (NestJS middleware, runs first)
1. Take the host from the `Host` header (behind the proxy: trusted `X-Forwarded-Host`), lower-case it, strip the port.
2. `GET domain:{host}` in Redis (TTL 5 min) → on miss, TenantDomain lookup.
3. Dev: `*.localhost` → slug; `X-Workspace` header allowed.
4. Tracker and mobile send the `X-Workspace` header (slug or host) against `api.hrms.app`.
5. Retired host → 308 redirect to primary (web) or header `X-Workspace-Moved` (API clients).
6. Unknown → 404 `WORKSPACE_NOT_FOUND`.
7. Put `tenantId` in CLS. After authentication, assert `jwt.tid === resolved tenantId`, else 401.

**Status write gate** (global guard)
- READ_ONLY: block POST/PUT/PATCH/DELETE with 423 `TENANT_READ_ONLY`. Exempt: `/auth/*`, `/billing/*`, `/support/*`, attendance punch and tracker ingest (keeps payroll data complete), and notification mark-read.
- SUSPENDED: only `billingOnly` sessions, and only `/billing`, `/auth`, `/support`.

**Sequences**: `SequenceService.next(key, {date?})`
- Inside the caller's transaction: `UPDATE ... SET next_value = next_value + 1 RETURNING next_value - 1` (row lock). This is gap-free because it rolls back with the caller.
- `period` = FY label computed from `fyStartMonth` when `fyScoped`.
- Formats `prefix + lpad(n, padding)`.
- Seeded keys:

| Key | Format / example |
|---|---|
| `employee.fulltime` | `LX-` pad 4 → LX-0142 |
| `employee.intern` | `LX-I-` pad 3 → LX-I-021 |
| `helpdesk.ticket` | HD-, pad 4 |
| `invoice.gst` | fyScoped, `INV-` pad 4 (GST rule: ≤16 chars, unique per FY) |
| `voucher.receipt` | RCPT- |
| `voucher.payment` | PMT- |
| `voucher.hr` | HRV- |
| `voucher.journal` | JV- |
| `facility.visitor_pass` | VP- |

  - Prefixes are editable by admin before first use.

**Scheduler** (tenant-local cron)
- One BullMQ repeatable "tick" every minute scans `ScheduledJob.nextRunAt <= now` and enqueues `jobName` with the tenantId.
- `nextRunAt` is computed with the tenant timezone (croner).
- Domains register jobs via `Scheduler.upsert({key, cron, jobName, payload})`, for example the timesheet reminder "Fri 17:00".

**Provisioning** is in M9. In P1 the Lexisora tenant is created by seed as kind OPERATOR (prod) or DEMO (dev) on plan INTERNAL.

**Dedicated DB (P3)**
- `TenantConnectionResolver(tenantId)` returns the shared Prisma client, or a per-tenant client from an LRU pool (max 20 open) built from `dbConnectionRef`.
- Migrations: `pnpm db:migrate:all` iterates dedicated DBs via job `tenancy.migrate-dedicated` and reports per-tenant status.
- RLS stays on in dedicated DBs too (defense in depth).

### 4. API

| Method and path | Permission |
|---|---|
| `GET /public/workspace` | public (see M2) |
| `GET /tenant/settings` | `tenant.settings.manage` (a subset like tz, fy, name is exposed in `/me`) |
| `PATCH /tenant/settings` | `tenant.settings.manage` |
| `GET /tenant/sequences`, `PATCH /tenant/sequences/:key` (prefix and padding only, before first use) | `tenant.settings.manage` |

- Internal services: `TenantContext.run(tenantId, fn)`, `SequenceService.next`, `Scheduler.upsert/remove`, `EventBus.publish/subscribe`.

### 5. Business rules
- Every tenant-owned table: `tenant_id` first in every composite index and in every unique constraint. FK integrity uses a composite (`tenant_id`, `id`) where cross-row references exist, to prevent cross-tenant FKs.
- Reserved slugs: www, app, api, console, admin, status, mail, smtp, support, docs, static, cdn, assets, auth, sso, billing, help, demo.
- FY label: if `month >= fyStartMonth` then `YYYY-(YY+1)`, else `(YYYY-1)-YY`. Example: 29 Sep 2026 → "2026-27".
- Timezone changes are allowed but warn that attendance and payroll use tz-local day boundaries.

### 6. Jobs / notifications / audit
- Jobs: `outbox.relay` (continuous), `outbox.purge` (published older than 7 days), `scheduler.tick` (every minute), `tenancy.domain-cache-warm`.
- Audit: `tenant.settings.updated` (diff), `sequence.updated`.

### 7. Integrations
- `DnsVerifier` (P3, custom domains): `verifyTxt(host, token): Promise<boolean>`.
- `CertificateIssuer` (P3): `request(host)`, `status(host)`. Stub for dev: marks ISSUED; in prod, Caddy on-demand TLS with an ask endpoint `GET /internal/tls/allowed?domain=`.

### 8. Edge cases
- Queries without tenant context return zero rows (RLS `current_setting(..., true)` is null). CI test asserts this for every table.
- Background job missing tenantId → rejected by the worker wrapper.
- Admin raw SQL tooling runs as a separate role with an audit trail.

### 9. Phase and dependencies
- P1 (shared DB and RLS, OPERATOR tenant). P3: dedicated DB, custom domains.
- Foundation for all domains.

### 10. Acceptance
1. Seed tenants A and B. A user of A requesting with A's host and A's JWT against B's host → 401. With a direct `set_config` to A, selecting B's rows returns 0.
2. Automated RLS audit: every table in schema `tenant` has RLS enabled and forced, plus the `tenant_isolation` policy (a migration-time check fails CI otherwise).
3. Two concurrent `SequenceService.next('invoice.gst')` calls where one transaction rolls back → issued numbers have no gap and no duplicate. The FY rollover on 1 Apr resets to 0001 with the new period.
4. READ_ONLY tenant: POST /leave → 423. Attendance punch still succeeds. `/billing/checkout` succeeds.
5. A retired host (after a slug change) returns a 308 redirect to the new primary for 90 days, then 404.

---

## M5. Notifications (Alerts center and service) (P1; preferences, digest, WhatsApp, web push P2)

### 1. Screens and UX

**Alerts `/alerts`** (`notifications.self`, all roles)
- Title "Alerts", subtitle "Reminders and approvals that need your attention."
- Tabs (additive): All, Unread, Approvals, Reminders.
- Columns (wireframe): **Alert** (title; unread rows in 600 weight with an accent dot), **From** (`sourceLabel`: "System", "HR", "Payroll", or actor name), **When** (`formatRelative(eventAt ?? createdAt)` → "Today", "Yesterday", "26 Sep").
- Row click: mark read, then navigate to `link`.
- Header actions: "Mark all read" (secondary). "Notification settings" (P2) opens a preferences dialog: rows are notification types grouped by category, columns In-app / Email / WhatsApp; mandatory ones are locked.
- Approval-type alerts whose underlying item has been actioned show a "Done" tag-neutral and drop out of the unread count.

**Header** "Alerts · N" (see M1).

**Dev-only** `/dev/outbox`: lists OutboundMessage (email/WhatsApp stubs), linking to Mailpit.

### 2. Data model

```
// catalogue in packages/shared (synced to platform.notification_type)
model NotificationType { key String @id; module; category NotifCategory; defaultChannels Channel[]; mandatoryChannels Channel[]; sourceLabel String; titleTemplate; bodyTemplate?; emailTemplate String?; whatsappTemplate String?; ttlDays Int? }
enum NotifCategory { APPROVAL REMINDER INFO SECURITY BILLING SYSTEM CELEBRATION }
enum Channel { IN_APP EMAIL WHATSAPP PUSH }

// tenant schema
model Notification {
  id String @id @db.Uuid (uuidv7); tenantId; userId
  typeKey String; category NotifCategory
  title String; body String?; sourceLabel String; actorUserId String?
  link Json?                // {route:"/timesheet", params:{week:"2026-09-21"}}
  eventAt DateTime?         // e.g., birthday date shown in "When"
  priority Priority @default(NORMAL)   // NORMAL | HIGH
  dedupeKey String?; readAt DateTime?; resolvedAt DateTime?; expiresAt DateTime?
  createdAt DateTime @default(now())
  @@unique([tenantId, userId, dedupeKey])
  @@index([tenantId, userId, readAt, createdAt(sort: Desc)])
  @@index([tenantId, dedupeKey])
}
model NotificationPreference { tenantId; userId; typeKey; inApp Boolean; email Boolean; whatsapp Boolean; push Boolean; @@id([userId, typeKey]) }
model OutboundMessage {
  id; tenantId String?; channel Channel; to String; templateKey; subject String?
  payload Json; status MsgStatus @default(QUEUED)   // QUEUED SENT FAILED BOUNCED SUPPRESSED
  providerMessageId String?; attempts Int @default(0); lastError String?
  notificationId String?; createdAt; sentAt?
  @@index([tenantId, status, createdAt])
}
model EmailSuppression { tenantId; email; reason (BOUNCE|COMPLAINT|MANUAL); createdAt; @@id([tenantId, email]) }  // P2
```

### 3. Workflows

**`NotificationService.notify(input)`** (server-side API used by every domain)

```
notify({ type, recipients: {userIds?} | {permission, scopeAnchor?} | {roleKeys?} | {audience:'ALL'|'DEPARTMENT'|'PROJECT', ids?},
         data, link?, eventAt?, dedupeKey?, actorUserId?, priority? })
```

1. Resolve recipients:
   - `permission` + `scopeAnchor` → users holding the permission whose scope covers the anchor. Example: `{permission:'timesheet.approve.l1', anchor:{projectId}}` → the project lead(s) plus ALL-scope holders. Uses ScopeResolver reverse lookups.
   - Exclude DISABLED users.
2. Render title and body from the type templates (ICU MessageFormat, en-IN).
3. Upsert per recipient on `(tenant, user, dedupeKey)`. An existing unread row is updated (bumps `createdAt`) rather than duplicated.
4. Commit, then socket `notification.new` and `notification.count` to `u:{userId}`.
5. For each channel enabled by preference ∪ mandatory: enqueue `notify.email` / `notify.whatsapp` with idempotency key `notifId:channel`.

**`NotificationService.resolve(dedupeKey | {typeKey, entityId})`**
- Sets `resolvedAt` (and `readAt` if null) on all recipients' rows. Example: once leave L-123 is approved by one approver, the "Approve leave" alert resolves for all approvers.

**`NotificationService.sendDirect({channel, to, templateKey, data, attachments})`**
- For external recipients: client invoice email, visitor e-pass WhatsApp, vCard share, print-vendor email.
- Recorded in OutboundMessage. Not an Alert.

**Email job**
- Renders the React Email template with tenant branding (logo, accent, product name). From: `"{Tenant name} via Lexisora HRMS" <no-reply@hrms.app>`; Reply-To: tenant HR email.
- `EmailAdapter.send`. Retry 5× with exponential backoff (30 s → 30 min). Final failure → FAILED, plus an admin alert when failures in the tenant exceed 20 per hour.

**Digest (P2)**
- Optional per user: daily 09:00 tenant time. Unread INFO/CELEBRATION items are aggregated into one email and suppressed individually.

**Read state**
- `PATCH /notifications/:id/read`, `POST /notifications/read-all {category?}` → emit count.

### 4. API

| Method and path | Permission |
|---|---|
| `GET /notifications?tab=all\|unread\|approvals\|reminders&cursor` | `notifications.self` |
| `GET /notifications/unread-count` | `notifications.self` |
| `PATCH /notifications/:id/read`, `POST /notifications/read-all` | `notifications.self` |
| `GET /notifications/preferences`, `PUT /notifications/preferences` (P2) | `notifications.self` |
| `GET /dev/outbox` | dev only |

Realtime: `notification.new {id,title,sourceLabel,link}`, `notification.count {unread}`.

### 5. Business rules
- Unread count = `readAt IS NULL AND resolvedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`.
- "When" = `eventAt ?? createdAt` in the tenant timezone: same day → "Today"; previous day → "Yesterday"; otherwise "d MMM", or "d MMM yyyy" if it is a different year. A future `eventAt` shows the date (for example "Birthday: Rahul Desai · 30 Sep").
- Retention: read items deleted after 180 days, unread after 365 days, or at `expiresAt`.
- Mandatory channels: SECURITY → email + in-app. BILLING (to admins) → email + in-app. APPROVAL → in-app.
- Quiet hours for WhatsApp (P2): 21:00–08:00 tenant time, deferred.

### 6. Jobs / notifications / audit
- Jobs: `notify.email`, `notify.whatsapp`, `notify.push` (P2), `notify.digest` (P2), `notify.purge` (daily 03:00).
- Notification types owned by this domain (security, billing, rbac, device, file, branding, support) are catalogued in each module. Types from wireframe Alerts rows are registered by their domains:
  - `timesheet.submission_due` (System, REMINDER)
  - `policy.ack_required` (HR, REMINDER)
  - `helpdesk.ticket_resolved` (from = the assignee's queue label, for example "Payroll")
  - `celebration.birthday` (System, CELEBRATION, eventAt)
- Audit: preference changes only (`notification.preferences.updated`). Notification sends are logged in OutboundMessage, not in audit.

### 7. Integrations

```
interface EmailAdapter { send(msg:{from,to[],cc?,replyTo?,subject,html,text,attachments?:{filename,contentType,content|fileId}[],headers?}): Promise<{providerMessageId}> }
  // SmtpEmailAdapter (nodemailer) → Mailpit in dev, any SMTP in prod; LogEmailAdapter for tests
interface WhatsAppAdapter { sendTemplate({to:E164, template, lang:'en', params:string[], mediaUrl?}): Promise<{messageId}>; }
  // StubWhatsAppAdapter: writes OutboundMessage SENT + shows in /dev/outbox; real Meta Cloud API adapter when creds exist
interface PushAdapter { send(subscription, payload) }  // P2 Web Push (VAPID, self-hosted)
```

### 8. Edge cases
- Recipient resolution yields 0 users → log a warning, no error.
- User disabled after notify → email is SUPPRESSED at send time.
- Email to an address not matching `allowedEmailDomains` is still allowed (personal email for invites is possible).
- Fan-out to "ALL" in large tenants (for example a global notice): batch insert 1,000 per statement; the socket emits a single `t:{tenant}` event so clients refetch counts.

### 9. Phase and dependencies
- P1 (in-app + email). P2: preferences, digest, WhatsApp, push.
- Depends on M3 (recipient resolution), M4, M11 (branding in emails; default until P3).

### 10. Acceptance
1. A domain calls `notify({type:'timesheet.submission_due', recipients:{userIds:[priya]}, dedupeKey:'ts-due:2026-W39'})` twice. Priya gets one Alert ("Timesheet for 21–27 Sep awaiting your submission", From "System", When "Today"), her header count goes 0→1 live, and the email shows in Mailpit.
2. Leave request notifies 2 approvers. When one approves, `resolve()` clears it from both unread counts.
3. "Mark all read" sets count 0 and emits `notification.count`.
4. SMTP down → the message retries and ends FAILED after 5 attempts. The Alert is still delivered in-app.
5. Birthday alert with `eventAt = 30 Sep` shows "30 Sep" in the When column.

---

## M6. Audit log (P1; export and chain-verify UI P2)

### 1. Screens and UX

**`/admin/audit`** (new screen under the Admin group, `audit.view`)
- Title "Audit log", subtitle "Every sign-in, permission change and sensitive action, tamper-evident."
- Filters: date range (default 7 days), actor (person picker, or "Lexisora platform"), module, action, result (Success / Denied / Failure), entity id.
- Columns: When (dd MMM, HH:mm:ss), Actor, Action, Module, Entity, Summary, IP, Result (tag).
- Row → side drawer with the redacted `changes` diff (before/after), requestId, userAgent, session.
- Tabs: All, Security, Access changes, Platform access (rows where `actorType = PLATFORM_USER`; also surfaced on the Privacy screen).
- P2: "Export CSV" and "Verify integrity" (runs chain verification and shows OK, or the first broken sequence).

### 2. Data model (schema `audit`, RLS where `tenant_id` is not null; monthly partitions)

```
model AuditEvent {
  id String @db.Uuid (uuidv7); tenantId String?  // null = platform-only event
  seq BigInt?                                   // per-tenant sequence assigned by sealer
  occurredAt DateTime
  actorType ActorType   // USER PLATFORM_USER SYSTEM DEVICE API
  actorId String?; actorLabel String            // "Kavya Iyer", "System", "Lexisora support (A. Shah)"
  action String         // "rbac.permission.granted"
  module String; entityType String?; entityId String?
  summary String        // human text
  changes Json?         // redacted diff {field:{from,to}}
  result AuditResult    // SUCCESS DENIED FAILURE
  ip String?; userAgent String?; requestId String?; sessionId String?
  prevHash Bytes?; hash Bytes?
  @@id([occurredAt, id])  @@index([tenantId, occurredAt]) @@index([tenantId, action, occurredAt]) @@index([tenantId, actorId, occurredAt]) @@index([tenantId, entityType, entityId])
}
```
- DB: `app_user` and `platform_svc` have INSERT and SELECT only. A trigger raises on UPDATE/DELETE, except for the `audit_sealer` role, which may only set `seq/prevHash/hash` where they are null.

### 3. Workflows
- **Capture**
  - `AuditInterceptor` records every mutating request whose handler has `@Audit('action', {entity})` metadata.
  - Explicit `AuditService.record()` for non-HTTP events: jobs, login failures, sockets.
  - Written in the same transaction as the change (or via the outbox for jobs).
- **Redaction**: fields tagged RESTRICTED or SECRET in the classification registry (M12) are logged as `"[redacted]"` with a changed flag only. Passwords and tokens are never logged.
- **Sealing**: job `audit.seal` every 60 s per tenant.
  - Selects unsealed rows ordered by (occurredAt, id) and assigns `seq = last+1`.
  - `hash = SHA-256(prevHash || canonicalJSON(row without hash))`.
  - Platform rows (tenant null) are chained in their own chain.
- **Verify**: recompute sequentially, and compare against a daily anchor hash stored in `platform.audit_anchor(tenantId, date, seq, hash)`; optionally also emailed to the operator.

### 4. API

| Method and path | Permission |
|---|---|
| `GET /audit?from&to&actor&module&action&result&entityType&entityId&cursor` | `audit.view` |
| `GET /audit/:id` | `audit.view` |
| `POST /audit/export` (P2; async → file via M7, notify when ready) | `audit.view` |
| `POST /audit/verify` (P2) | `audit.view` |

- Internal: `AuditService.record({action, module, entity, summary, changes, result})`.

### 5. Business rules
- Retention: 8 years for `finance.*`, `payroll.*`, `invoice.*` (Companies Act books-of-account period); 3 years for everything else. Partitions older than the retention window are detached and archived to object storage (compressed JSONL), then dropped.
- Every access by a platform actor to anything tenant-scoped (metadata only) must produce an event with `actorType = PLATFORM_USER`. This is enforced in the console API base service.

### 6. Jobs
`audit.seal` (60 s), `audit.anchor` (daily 00:05), `audit.partition-maintain` (monthly: create next partition, archive expired), `audit.export` (P2).

### 7. Integrations
None beyond M7 for exports.

### 8. Edge cases
- High volume (tracker events are not audited; only pairing is).
- Clock skew between API nodes: the sealer orders by DB `now()`-stamped `occurredAt`.
- Denied-request storms: aggregate identical DENIED events per user, action and minute (count field in summary).

### 9. Phase and dependencies
- P1 capture and screen. P2 export/verify.
- Every domain annotates its actions.

### 10. Acceptance
1. Toggle a permission → an audit row appears with actor, action `rbac.permission.granted`, and changes.
2. Direct SQL `UPDATE audit.audit_event` as `app_user` → error.
3. Tamper test: altering a sealed row as superuser makes verify report that sequence as broken.
4. Changing an employee's bank account (RESTRICTED) logs `changes: {bankAccount: "[redacted]"}`.
5. Tenant admin sees platform support actions in the "Platform access" tab. Tenant B's admin cannot see tenant A's events.

---

## M7. File storage (P1)

### 1. Screens and UX
- No standalone screen. It provides the shared `<FileDrop>` component used in every form `file` field: "Drop file or browse", progress bar, scan status chip (Scanning… / Ready / Blocked: threat found), and remove.
- Download buttons ("-PDF", "-Download", "Download certificate") call `GET /files/:id/download-url`, then open it.
- Admin storage usage appears in Subscription (M10): "Storage 3.2 GB of 250 GB".

### 2. Data model (tenant schema)

```
model FileObject {
  id String @id @db.Uuid; tenantId
  purpose FilePurpose   // AVATAR, BRAND_LOGO, EMPLOYEE_DOCUMENT, OFFER_LETTER, SIGNED_DOCUMENT, PAYSLIP_PDF, INVOICE_PDF, PURCHASE_BILL,
                        // FILING, POLICY, COURSE_VIDEO, CERTIFICATE, RESUME, PROJECT_REQUIREMENT, NOTICE_ATTACHMENT, TICKET_ATTACHMENT,
                        // CHAT_ATTACHMENT, CALL_RECORDING, SCREENSHOT, ID_PHOTO, ID_CARD_PDF, IMPORT_CSV, EXPORT, SUPPORT_ATTACHMENT
  classification DataClass    // PUBLIC_BRANDING, INTERNAL, CONFIDENTIAL, RESTRICTED  (derived from purpose registry)
  ownerType String?; ownerId String?   // e.g. "EmployeeDocument", id  (set by attach)
  uploadedById String?; fileName String; mime String; sizeBytes BigInt; sha256 String?
  bucket String; objectKey String
  status FileStatus @default(PENDING_UPLOAD) // PENDING_UPLOAD UPLOADED SCANNING AVAILABLE INFECTED SCAN_ERROR DELETED PURGED
  scanEngine String?; scanSignature String?; scannedAt DateTime?
  encryption EncMode @default(SSE)   // SSE | TENANT_DEK (P3 for RESTRICTED)
  keyVersion Int?; iv Bytes?          // when TENANT_DEK
  retentionUntil DateTime?; legalHold Boolean @default(false)
  createdAt; deletedAt?
  @@index([tenantId, ownerType, ownerId]) @@index([tenantId, status, createdAt]) @@index([tenantId, purpose, createdAt])
}
```
- The purpose registry (`packages/shared/files.ts`) defines per purpose: allowed mime (magic-byte checked), maximum size, classification, whether scanning is required, default retention, and access policy key.

### 3. Workflows (state machine)
1. `POST /files/upload-intents {purpose, fileName, mime, sizeBytes, sha256?}`
   - Validate against the registry and the plan storage quota.
   - Create FileObject PENDING_UPLOAD with `objectKey = q/{tenantId}/{purpose}/{yyyy}/{mm}/{fileId}` (quarantine prefix).
   - Return a presigned PUT (15 min), or S3 multipart (parts of 16 MB) when size > 100 MB (COURSE_VIDEO up to 2 GB).
2. The client PUTs directly to MinIO/S3.
3. `POST /files/:id/complete`
   - HEAD the object: size must match; sniff the first 4 KB for magic bytes against the claimed mime → UPLOADED.
   - Enqueue `files.scan` → SCANNING.
   - Purposes with `scan=false` (SCREENSHOT from paired devices, system-generated PDFs) go straight to AVAILABLE.
4. Scan result:
   - CLEAN → copy to `t/{tenantId}/...`, delete the quarantine copy → AVAILABLE, emit `file.available`.
   - INFECTED → delete the object → INFECTED. Notify the uploader (`file.infected`, HIGH). Audit. Emit `file.rejected` so the owning domain can mark its record.
   - Engine error → retry 3× (1, 5, 15 min) → SCAN_ERROR, notify tenant admins. The file stays blocked.
5. `FileService.attach(fileId, {ownerType, ownerId})` by the owning domain, inside its own transaction. Only AVAILABLE (or SCANNING, attached-pending) files are accepted.
6. Download: `GET /files/:id/download-url`
   - Authorization via the purpose's `FileAccessPolicy.canRead(ctx, file)`, registered by the owning domain. Example: EMPLOYEE_DOCUMENT → owner employee, or `vault.manage`.
   - Returns a presigned GET (5 min) with `Content-Disposition: attachment; filename*=UTF-8''...`; inline for images and PDFs when `?inline=1`.
   - RESTRICTED downloads are audited (`file.downloaded`).
7. Delete: `DELETE /files/:id` (policy `canDelete`) → DELETED (soft). `files.purge` removes the object after 30 days unless `legalHold` or `retentionUntil` is in the future.
8. Orphans: PENDING_UPLOAD or unattached UPLOADED/AVAILABLE rows older than 24 h → purged.
9. P3 RESTRICTED encryption: uploads go through the API streaming proxy (`POST /files/:id/content`, ≤ 25 MB). The API encrypts with the tenant DEK (AES-256-GCM, chunked) and stores `encryption=TENANT_DEK`. Downloads are streamed and decrypted by the API (no presigned URL). CALL_RECORDING egress is encrypted by a worker.

**Public branding assets**: `GET /public/assets/:fileId` serves only PUBLIC_BRANDING-class files (logo, favicon), cached with an immutable ETag.

### 4. API

| Method and path | Permission |
|---|---|
| `POST /files/upload-intents` | per-purpose upload permission from the registry (for example BRAND_LOGO → `branding.manage`; TICKET_ATTACHMENT → `helpdesk.raise`) |
| `POST /files/:id/parts/:n/url`, `POST /files/:id/complete` | uploader |
| `GET /files/:id` (metadata + status) | read policy |
| `GET /files/:id/download-url` | read policy |
| `DELETE /files/:id` | delete policy |
| `GET /public/assets/:fileId` | public |

Realtime: `file.status {id,status}` to the uploader.

### 5. Business rules (defaults)

**Size and type limits**

| Purpose | Limit |
|---|---|
| Images (AVATAR, ID_PHOTO) | ≤ 5 MB, jpeg/png/webp |
| BRAND_LOGO | ≤ 1 MB, svg/png; SVG sanitized (strip script, foreignObject, on*, external href) |
| Documents | ≤ 20 MB, pdf/jpeg/png/docx/xlsx |
| RESUME | ≤ 10 MB, pdf/docx |
| IMPORT_CSV | ≤ 5 MB |
| COURSE_VIDEO | ≤ 2 GB, mp4/webm |
| SCREENSHOT | ≤ 1 MB, webp/jpeg |
| CALL_RECORDING | system only |

**Storage quota** (counted over AVAILABLE + SCANNING)

| Plan | Quota |
|---|---|
| Free | 5 GB |
| Growth | 5 GB × paid seats |
| Enterprise / Internal | contract (default unlimited) |

- At 90%: admin alert. At 100%: uploads → 413 `STORAGE_QUOTA`. System-generated files (payslips, invoices) are still allowed.

**Retention defaults** (domains may override)

| Purpose | Retention |
|---|---|
| SCREENSHOT | 90 days |
| CALL_RECORDING | 365 days |
| PAYSLIP_PDF, INVOICE_PDF, PURCHASE_BILL, FILING | 8 years |
| RESUME of rejected candidates | 2 years |
| EXPORT | 7 days |

**Key layout**: `t/{tenantId}/{purpose}/{yyyy}/{mm}/{fileId}`. Single bucket per environment. Bucket policy denies public access. SSE-S3 on.

### 6. Jobs / notifications / audit
- Jobs: `files.scan` (concurrency 4), `files.orphan-sweep` (hourly), `files.purge` (daily), `files.retention` (daily), `files.usage` (daily bytes per tenant → TenantUsageDaily).
- Notifications: `file.infected` (uploader, HIGH), `file.scan_error` (admins), `storage.quota_90` and `storage.quota_100` (admins).
- Audit: `file.uploaded` (CONFIDENTIAL+), `file.downloaded` (RESTRICTED), `file.deleted`, `file.infected`, `file.legal_hold.set`.

### 7. Integrations

```
interface ObjectStorage { presignPut(key, {contentType, contentLength, expiresIn}); createMultipart(key); presignPart(key, uploadId, n); completeMultipart(...);
  presignGet(key, {expiresIn, disposition}); head(key); copy(src, dst); delete(key); putObject(key, body, meta); getObjectStream(key); }
  // S3ObjectStorage (@aws-sdk/client-s3) → MinIO dev / any S3 prod; FsObjectStorage for unit tests
interface VirusScanner { scan(stream: Readable, meta): Promise<{status:'CLEAN'|'INFECTED'|'ERROR', signature?, engine}> }
  // ClamAvScanner (clamd INSTREAM over TCP; docker clamav/clamav in compose); MockScanner: CLEAN unless content contains EICAR string
```

### 8. Edge cases
- Mime spoofing (an .exe renamed to .pdf) → rejected at complete (415).
- A client never calls complete → orphan sweep.
- Duplicate uploads (same sha256 within the tenant) are not deduplicated (simplicity), but `sha256` is recorded.
- Presigned URLs leaking: 5 min TTL, never logged.
- Virus scanner unavailable in dev: `SCANNER=mock`.

### 9. Phase and dependencies
- P1. Depends on M4, M5, M6. P3 encryption depends on M12.
- Domains register purposes and policies.

### 10. Acceptance
1. Upload a PDF: intent → PUT → complete → SCANNING → AVAILABLE. A download URL works for an authorized user and returns 403 for an unrelated employee.
2. Upload the EICAR test file → INFECTED, the object is gone from MinIO, the uploader gets an Alert, and there is an audit row.
3. A PNG renamed .pdf with mime `application/pdf` → 415 at complete.
4. Tenant at quota → intent returns 413. A system payslip PDF is still stored.
5. An unattached file older than 24 h is purged by the sweep.

---

## M8. Global search (P1; document content search P2)

### 1. Screens and UX
- Header input "Search people, tasks, documents". Ctrl/Cmd+K focuses it. 250 ms debounce, minimum 2 characters.
- Dropdown panel (max 480px) with grouped results, top 5 each: **People** (avatar, name, designation · department), **Tasks** (AT-101 · title · project · column tag), **Documents** (title · category · owner/folder), **Projects**, **Notices & posts**, **Tickets**, **Candidates** (only with permission), **Go to** (nav items matching the query, client-side from `navigation`).
- Keyboard up/down, Enter opens, Esc closes. "See all results" → `/search?q=` with filter tabs by type.
- Person click:
  - with `employees.view` covering them → `/employees/:id`
  - otherwise → mini card (name, designation, department, official email, "Message" → chat DM, "Visiting card").

### 2. Data model (tenant schema)

```
model SearchDocument {
  tenantId; entityType String   // PERSON TASK PROJECT DOCUMENT NOTICE POST TICKET CANDIDATE JOB POLICY COURSE ASSET
  entityId String
  title String; subtitle String?; keywords String?     // e.g. emp code, serial no., task key
  body String?                                         // P2 extracted text (non-RESTRICTED only)
  tsv Unsupported("tsvector")                          // generated: setweight(title,'A')||setweight(keywords,'A')||setweight(subtitle,'B')||setweight(body,'C')
  route Json                                           // {route, params}
  isPublic Boolean @default(false)                     // visible to everyone with search.use
  requiredPermission String?                           // e.g. "recruitment.candidates.view"
  allowUserIds String[] @db.Uuid; allowDeptIds String[] @db.Uuid; allowProjectIds String[] @db.Uuid
  classification DataClass; updatedAt DateTime
  @@id([tenantId, entityType, entityId])
  // indexes: GIN(tsv), GIN(title gin_trgm_ops), GIN(allowUserIds), GIN(allowDeptIds), GIN(allowProjectIds)
}
```

### 3. Workflows
- **Index**: domains call `SearchIndexer.upsert(doc)` / `remove(type,id)` (or publish `search.upsert` events). This is async via the `search.index` queue, and idempotent.
- **Reindex**: `POST /admin/search/reindex` (P2) or the `search.reindex` job iterates registered `SearchProvider.fullScan(tenantId)`.
- **Query**: `GET /search?q&types&limit`
  1. Build `websearch_to_tsquery('simple', q)` with prefix `:*` on the last term, OR trigram `similarity(title, q) > 0.3` (for names and typos).
  2. ACL filter: `isPublic OR (requiredPermission = ANY(:myPermsWithAnyScope) AND scope satisfied) OR :me = ANY(allowUserIds) OR allowDeptIds && :myDepts OR allowProjectIds && :myProjects`.
  3. Rank = `ts_rank_cd*0.7 + similarity*0.3` + type boost (People 1.2).
  4. Group by type.

### 4. API

| Method and path | Permission |
|---|---|
| `GET /search?q=&types=&limit=5` | `search.use` |
| `GET /search/all?q=&type=&cursor` | `search.use` |
| `POST /admin/search/reindex` (P2) | `tenant.settings.manage` |

- Internal: `SearchIndexer`, and the `SearchProvider` registration interface `{entityType, fullScan(tenantId): AsyncIterable<SearchDocument>}`.

### 5. Business rules

| Entity | ACL |
|---|---|
| PERSON | `isPublic` (`directory.basic`). Fields: name, emp code, designation, department, official email. Never phone, PAN, etc. Exited users removed. |
| TASK | `allowDeptIds` = the board's department plus `allowProjectIds`. ALL-scope `tasks.board.view` holders see everything. |
| DOCUMENT (vault) | `allowUserIds=[owner]` + `requiredPermission='vault.manage'`. Title and category only, never content. |
| POLICY | public |
| FILING | `requiredPermission='filing.manage'` |
| ARCHIVE | per-project access list ("Leads only" → holders of `archive.view` in that project; "All developers" → department) |
| NOTICE | Global → public; Team → dept/project ids |
| TICKET | `allowUserIds=[raiser, assignee]` + `helpdesk.view.all` |
| CANDIDATE | `recruitment.candidates.view` |

- Rate limit: 10 queries/s per user. Max query length 100.

### 6. Jobs
`search.index`, `search.reindex`, `search.consistency` (nightly per tenant; compares counts per provider and re-queues diffs).

### 7. Integrations
- `SearchEngine` interface with the Postgres implementation. An OpenSearch adapter is optional later. Not needed.

### 8. Edge cases
- Indian names with diacritics or case: `unaccent` + lower. The 'simple' config avoids English stemming on names.
- "LX-0142" exact code → a keywords-weight A match.
- A permission revoked mid-session → the next query reflects it (perms loaded per request).

### 9. Phase and dependencies
- P1 metadata search. P2 content extraction (PDF text via a worker using pdf-parse, non-RESTRICTED only).
- Needs providers from People, Projects/Tasks, Workplace (vault, policies, filing, archive, notices, helpdesk), Recruitment.

### 10. Acceptance
1. Priya searches "rahul" → Rahul Desai under People. She sees no candidates when searching "Aditya"; HR does.
2. Priya searches "PAN" → only her own PAN card document. HR sees all employees' PAN documents (titles only).
3. Employee in Development searches "regression" → the QA team notice is not shown to them. A QA member sees it.
4. Search "payroll" as admin → the "Go to: Payroll run" nav entry. As employee → only "My payslips".
5. A disabled employee disappears from People results within 1 minute of `employee.exited`.

---

## M9. Platform console and Tenants (P3)

### 1. Screens and UX

**Platform console** (`console.hrms.app`, separate SPA route tree in `apps/web` under `/console`, same design system)
- Login requires email, password and TOTP (mandatory).
- Nav: Tenants, Subscriptions & invoices, Plans & promo codes, Support queue (M13), Usage metrics, Platform users, Platform audit.

**Tenants** (wireframe GEN `tenants`)
- Title "Tenants". Subtitle copy adjusted to "Client companies on the platform. Each has isolated data and its own login domain (Enterprise: dedicated database)."
- KPIs:
  - **Tenants** = count of tenants with status not in (CANCELLED, DELETED, PROVISION_FAILED). Sub "{n} on free tier".
  - **Seats billed** (formula in M10). Sub "+{Δ} this month".
  - **MRR** as `formatINR(compact)`. Sub "+x%" vs 30 days ago.
- Columns:
  - **Company**
  - **Domain** (primary host)
  - **Plan**: "Internal", "Free", "Growth · yearly", "Growth · monthly", "Enterprise"
  - **Seats**: used for Free/Internal; "used / purchased" for paid
  - **Renewal**: "—" for Free/Internal; "12 Oct" if within 60 days, else "Mar 2027"
  - **Status**:
    - ~Active: status ACTIVE and subscription ACTIVE
    - -Free tier: plan FREE
    - !Payment due: subscription PAST_DUE
    - !Read-only
    - -Suspended
    - -Provisioning
- Tabs (additive): All, Paid, Free, Attention (past due, read-only, provision failed).
- Primary action "Add tenant" opens the form: Company (text, span 2), Login domain (text; suffix `.hrms.app`, live availability check), Plan (select "Free (10 users)" / "Growth" / "Enterprise"), Admin email (email, span 2).
  - Growth/Enterprise reveal: Billing cycle, Seats, Collection method (Payment link / Offline invoice Net 15), GSTIN, State.
  - Submit "Create tenant" → toast "Tenant provisioned" (or "Provisioning…" with a live status chip).
- Row click → **Tenant detail**:
  - Overview: plan, seats used/purchased, storage, active users (7 days), created date, kind.
  - Domains.
  - Subscription and invoices.
  - Support tickets.
  - Platform audit for this tenant.
  - Actions: Change plan, Adjust seats, Extend grace (+N days), Suspend, Reactivate, Resend admin invite, Schedule deletion (OWNER only, type the slug to confirm), Retry provisioning.
  - **No** view of employees, chats, salaries or documents. The only people data shown is admin contact email(s).

**Tenant-side `/saas/tenants`**
- Nav item visible only in the OPERATOR tenant to users holding `platform.console.link` (auto-granted to users linked to a PlatformUser).
- Clicking does a one-time handoff (AuthToken CONSOLE_HANDOFF, 60 s) to `console.hrms.app`, which **still requires TOTP**.

### 2. Data model (platform schema)

```
model PlatformUser { id; email String @unique; name; role PlatformRole; passwordHash; totpSecretEnc Bytes; status (ACTIVE|DISABLED); linkedTenantUserId String?; lastLoginAt; createdAt }
enum PlatformRole { OWNER BILLING SUPPORT ENGINEER }
model PlatformSession { id; platformUserId; ip; userAgent; createdAt; lastSeenAt; expiresAt; revokedAt }   // 8h absolute, 30 min idle
model TenantProvisioning { id; tenantId @unique; step ProvisionStep; status (RUNNING|DONE|FAILED); error String?; attempts Int; startedAt; finishedAt; requestedById }
enum ProvisionStep { CREATE_TENANT RESERVE_DOMAIN CREATE_KEYS SEED_BASE SEED_DOMAINS CREATE_SUBSCRIPTION CREATE_ADMIN SEND_INVITE DONE }
model TenantUsageDaily { tenantId; date DateTime @db.Date; activeUsers Int; seatsUsed Int; storageBytes BigInt; logins Int; trackerHours Decimal; @@id([tenantId, date]) }
model MrrSnapshot { date DateTime @id @db.Date; mrrPaise BigInt; paidTenants Int; freeTenants Int; seatsBilled Int }
```
(Tenant and TenantDomain are defined in M4; Subscription in M10.)

### 3. Workflows

**Provisioning** (job `tenant.provision`, idempotent steps, each committed; resumable)
1. CREATE_TENANT: Tenant PROVISIONING with the slug.
2. RESERVE_DOMAIN: TenantDomain `{slug}.hrms.app` primary.
3. CREATE_KEYS (P3): generate the tenant DEK, wrapped by the tenant KEK (M12).
4. SEED_BASE: TenantSettings, 5 system roles + matrix, sequences, default BrandingVersion (Default · gold & ink).
5. SEED_DOMAINS: run every registered `SeedContributor.base(tenantCtx)`, for example default leave types, General shift, departments, notification catalogue.
6. CREATE_SUBSCRIPTION (M10): FREE, or Growth/Enterprise with the chosen seats.
7. CREATE_ADMIN: User with the admin role, `employeeId=null`.
8. SEND_INVITE: invite email to the admin address.
9. DONE → Tenant ACTIVE. Emit `tenant.provisioned`. Notify the platform ops channel.
- Failure → PROVISION_FAILED with the error. "Retry provisioning" resumes from the failed step.
- Dedicated DB (Enterprise, P3): extra steps CREATE_DATABASE and MIGRATE before SEED_BASE.

**Lifecycle**
- ACTIVE ⇄ READ_ONLY ⇄ SUSPENDED (driven by billing, M10, or manual by OWNER/BILLING).
- → CANCELLED (manual or 90 days unpaid).
- → DELETED: purge job after `deletionScheduledAt` (30 days after cancel, with warning emails at T-30 and T-7). Deletes tenant rows, objects and key material (crypto-shred in P3).
- Every transition: audit (platform chain + the tenant's "Platform access" view), emit `tenant.status_changed`, notify tenant admins.

**Usage**: job `usage.daily` 01:00 IST calls `platform.fn_tenant_usage(tenantId, date)` (SECURITY DEFINER, returns counts only) → TenantUsageDaily. `billing.mrr-snapshot` 00:30 IST.

### 4. API (console, `aud=platform-api`, `platform_svc` DB role)

| Method and path | Role |
|---|---|
| `POST /platform/auth/login`, `/totp`, `/logout`, `/handoff` | public / linked |
| `GET /platform/tenants?tab&q&cursor`, `GET /platform/tenants/kpis` | any |
| `GET /platform/tenants/:id` (metadata, usage, subscription) | any |
| `POST /platform/tenants` (Add tenant) | OWNER, BILLING |
| `GET /platform/domains/available?slug=` | any |
| `POST /platform/tenants/:id/retry-provisioning` | OWNER, ENGINEER |
| `POST /platform/tenants/:id/suspend`, `/reactivate`, `/extend-grace {days}` | OWNER, BILLING |
| `POST /platform/tenants/:id/schedule-deletion {confirmSlug}` | OWNER |
| `POST /platform/tenants/:id/resend-admin-invite` | OWNER, SUPPORT |
| `GET /platform/usage?from&to` | any |
| `GET/POST/PATCH /platform/users` | OWNER |
| `GET /platform/audit` | OWNER |

### 5. Business rules
- A platform user can never obtain a tenant-api JWT (different issuer and audience keys). Impersonation does not exist.
- Tenant-side endpoints reject any `aud=platform-api` token.
- MRR, Seats billed and Tenants formulas: see M10 §5.

### 6. Jobs / notifications / audit
- Jobs: `tenant.provision`, `tenant.purge`, `usage.daily`, `billing.mrr-snapshot`.
- Notifications (tenant admins): `tenant.welcome`, `tenant.status_changed` (read-only / suspended / reactivated), `tenant.deletion_scheduled` (T-30, T-7).
- Audit (platform chain): `platform.tenant.created`, `platform.tenant.status_changed`, `platform.tenant.plan_changed`, `platform.login`, `platform.user.*`, `platform.handoff`.

### 7. Integrations
- `PlatformAlertSink` (ops notifications): an email adapter to an ops mailbox; Slack webhook optional.

### 8. Edge cases
- Slug taken or reserved → inline error.
- Admin email already an admin in another tenant → allowed (users are per tenant).
- Provisioning called twice → the unique slug makes it idempotent.
- Suspending the OPERATOR tenant → forbidden.

### 9. Phase and dependencies
- P3. Depends on M2 (tokens), M4, M10, M12, M13, M14 (seed contributors from all domains).

### 10. Acceptance
1. Add tenant "Acme Logistics", domain `acme`, Growth yearly 250 seats, admin email → provisioning completes all steps. `acme.localhost` shows the login. The admin invite is in Mailpit. The 5 roles exist with default matrix.
2. Force a failure at SEED_DOMAINS → status PROVISION_FAILED. Retry resumes and completes without duplicating roles.
3. KPIs over the seeded platform data equal the recomputed formulas (test computes independently).
4. The console API, using the `platform_svc` role, attempts `SELECT` on `tenant.payroll_line` → permission denied (DB grant test).
5. Suspend Nova Clinics → its non-billing users cannot log in, its admin sees only Subscription, and the tenant's Privacy → Platform access list shows the suspension event.

---

## M10. Subscription and billing (P3)

### 1. Screens and UX

**`/saas/subscription`** (`billing.manage`; wireframe "Subscription & billing")
- Subtitle, live: "{used} of {purchased} seats used · first 10 users are free on every plan."
- Cycle segmented control: "Monthly" | "Yearly · save {round((1−149/179)×100)}%" → "save 17%". Defaults to the current cycle.
- Plan cards:
  - **Free**: "₹ 0", "up to 10 users". Features: Attendance & leave; Projects & tasks; Community support.
  - **Growth**: "₹ 149" (yearly) / "₹ 179" (monthly), "per user / month, billed {cycle}". Features: Everything in Free; Payroll, ledger & GST; Desktop tracker; White-label theme. Accent border on the current plan.
  - **Enterprise**: "Custom", "200+ users". Features: Dedicated database; CCTV & biometric integrations; 24/7 priority support.
- Card CTAs depend on the current plan:

| Current plan | Free card | Growth card | Enterprise card |
|---|---|---|---|
| Free | "Current plan" | "Upgrade" (→ checkout) | "Contact sales" |
| Growth | "Downgrade" (confirm dialog) | "Current plan · renew" (early renew / change cycle) | "Contact sales" |
| Enterprise | disabled | disabled | "Current plan" |

- Contact sales opens a SalesLead form (name, phone, seats, message) → toast "Request noted".
- Upgrade/renew → "Redirecting to payment gateway…" → gateway checkout.
- Promo code input + "Apply" → "Promo applied · 20% off next renewal", or an error.
- Additive sections:
  - **Seats**: stepper "Purchased seats" with a price preview ("Adding 5 seats: ₹ 3,725.00 prorated + GST") and "Update seats".
  - **Billing details**: legal name, GSTIN (optional), state, address, billing email.
  - **Invoices** table: Invoice no., Date, Period, Amount, GST, Total, Status tag, "PDF".
  - **Payment method**: gateway-managed, "Update".
  - **Usage**: active users, storage.
- Past-due banner in the shell: "Payment of ₹ X due since 12 Oct. Workspace becomes read-only on 19 Oct. Pay now".

**Console "Subscriptions & invoices"**: all subscriptions, invoices, payments, webhook log, manual "Mark paid (offline)", refunds.

**Console "Plans & promo codes"**: plan prices (versioned, `activeFrom`); promo CRUD (code, % or ₹ off, plans, cycles, duration, max redemptions, validity).

### 2. Data model (platform schema)

```
model Plan { code String @id; name; maxActiveUsers Int?; freeSeats Int @default(10); features String[]; isPublic Boolean; sortOrder Int }
  // FREE {maxActiveUsers:10}, GROWTH, ENTERPRISE, INTERNAL {isPublic:false, all features}
model PlanPrice { id; planCode; cycle BillingCycle; unitPaisePerSeatMonth Int; activeFrom DateTime; activeTo DateTime?; @@unique([planCode, cycle, activeFrom]) }
  // GROWTH MONTHLY 17900, GROWTH YEARLY 14900
enum BillingCycle { MONTHLY YEARLY }
model Subscription {
  id; tenantId String @unique; planCode; cycle BillingCycle?
  status SubStatus         // FREE ACTIVE PENDING_PAYMENT PAST_DUE READ_ONLY SUSPENDED CANCELLED
  quantity Int             // purchased seats incl. the 10 free
  unitPaise Int?           // price snapshot for current period
  contractPaisePerYear BigInt?   // Enterprise
  currentPeriodStart DateTime?; currentPeriodEnd DateTime?
  cancelAtPeriodEnd Boolean @default(false)
  pendingChange Json?      // {planCode?, cycle?, quantity?} effective at renewal
  autoRenew Boolean @default(true); autoExpandSeats Boolean @default(false)
  collection Collection @default(GATEWAY)  // GATEWAY | OFFLINE_INVOICE
  gatewayCustomerId String?; gatewaySubscriptionId String?
  pastDueSince DateTime?; graceEndsAt DateTime?
  createdAt; updatedAt
}
model SubscriptionChange { id; subscriptionId; type ChangeType; from Json; to Json; effectiveAt; invoiceId String?; actorType; actorId; createdAt }
  // ChangeType: CREATED UPGRADE DOWNGRADE_SCHEDULED DOWNGRADE_APPLIED SEATS_ADDED SEATS_REDUCE_SCHEDULED CYCLE_CHANGE RENEWED STATUS PROMO_APPLIED
model BillingProfile { tenantId String @id; legalName; gstin String?; stateCode String; address Json; billingEmail String; updatedAt }
model PromoCode { id; code String @unique; description; percentOff Int?; amountOffPaise Int?; planCodes String[]; cycles BillingCycle[]
  duration PromoDuration  // NEXT_INVOICE | REPEATING
  durationCycles Int?; maxRedemptions Int?; redeemedCount Int @default(0); validFrom; validUntil; active Boolean; createdById }
model PromoRedemption { id; promoId; tenantId; subscriptionId; status (PENDING|APPLIED|VOID); cyclesRemaining Int; appliedInvoiceIds String[]; createdAt; @@unique([promoId, tenantId]) }
model SaasInvoice {
  id; number String @unique        // "LXS/26-27/0042" (≤16 chars, FY-scoped platform sequence)
  tenantId; subscriptionId; fyLabel; issueDate; dueDate; periodStart; periodEnd
  subtotalPaise BigInt; discountPaise BigInt; taxablePaise BigInt
  cgstPaise BigInt; sgstPaise BigInt; igstPaise BigInt; roundOffPaise Int; totalPaise BigInt
  supplierGstin; supplierStateCode "24"; recipientGstin String?; placeOfSupply String; sacCode String
  status InvStatus  // DRAFT ISSUED PAID OVERDUE VOID
  pdfObjectKey String?; paidAt?; createdAt
}
model SaasInvoiceLine { id; invoiceId; kind (SEATS|PRORATION|ENTERPRISE|DISCOUNT); description; quantity Int; unitPaise BigInt; amountPaise BigInt; periodStart; periodEnd }
model Payment { id; tenantId; invoiceId; gateway (RAZORPAY|MOCK|OFFLINE); gatewayOrderId; gatewayPaymentId?; amountPaise; status (CREATED|AUTHORIZED|CAPTURED|FAILED|REFUNDED); failureReason?; createdAt }
model GatewayWebhookEvent { id; gateway; eventId String @unique; type; payload Json; signatureValid Boolean; receivedAt; processedAt? }
model SalesLead { id; tenantId String?; name; email; phone; company; seats Int?; message; status (NEW|CONTACTED|WON|LOST); createdAt }
```

### 3. Workflows (subscription state machine)
- **FREE**: quantity = 10 (implicit), no invoices.
- **Upgrade** FREE → Growth:
  1. Choose cycle + seats (min = max(currentActive, 11)).
  2. Create an invoice DRAFT → gateway order → checkout.
  3. `payment.captured` webhook (signature verified, idempotent by eventId) → invoice PAID, Subscription ACTIVE, period starts today, entitlements refreshed (socket `tenant.entitlements_changed`).
  4. Failure/cancel → stay FREE, notify.
- **Renewal** (job `billing.renewals` daily 06:00 IST):
  1. At `currentPeriodEnd − 0 d`, apply `pendingChange` and any pending promo.
  2. Create the invoice and charge (gateway subscription/mandate, or payment link email; OFFLINE → ISSUED, due in 15 days).
  3. Success → RENEWED. Failure → PAST_DUE: `pastDueSince = now`, `graceEndsAt = periodEnd + 7 d`. Retries at +1, +3, +5 days.
- **Dunning** (job `billing.dunning` hourly):
  - `now > graceEndsAt` → READ_ONLY (Tenant READ_ONLY).
  - `now > pastDueSince + 30 d` → SUSPENDED.
  - `+ 90 d` → CANCELLED → M9 deletion schedule.
  - Payment at any point → ACTIVE, Tenant ACTIVE.
- **Seats add** (mid-cycle):
  - Immediate proration invoice charged; quantity is updated on capture.
  - If `autoExpandSeats` and HR adds an employee beyond quantity → auto +1 seat with proration (batched daily into a single invoice).
- **Seats reduce**: scheduled for renewal (`pendingChange.quantity`), which must be ≥ active users at renewal time, otherwise the renewal keeps the higher value and the admin is notified.
- **Cycle change**: monthly → yearly takes effect at the next renewal (or immediately with the unused-days credit applied: credit = unusedDays/periodDays × lastPaid taxable). Yearly → monthly is at renewal only.
- **Downgrade to Free**: scheduled `cancelAtPeriodEnd`. At period end it requires active users ≤ 10; else it is blocked, and admins get a list of the users to deactivate. Paid modules become locked (data retained, read-only through exports).
- **Enterprise**: console-created with a contract amount; OFFLINE_INVOICE annual or quarterly; same dunning, but grace 30 days.
- **Promo**:
  - Validate: exists, active, within validity, plan/cycle match, not redeemed by this tenant, redemptions below max.
  - Create PromoRedemption PENDING. Applied as a DISCOUNT line on the next invoice (NEXT_INVOICE) or the next N invoices (REPEATING). One promo per invoice; a newer promo replaces a PENDING one after confirmation.
- **Seat gate for other domains**: `Entitlements.assertSeatAvailable(tenantId)` is called by People on create/reactivate/invite.
  - FREE: activeUsers < 10.
  - Paid: activeUsers < quantity, or `autoExpandSeats`.
  - Else 402 `SEAT_LIMIT` with the message "All {q} seats are in use. Add seats in Subscription."

### 4. API

| Method and path | Permission |
|---|---|
| `GET /billing/overview` (plan, cycle, status, seats used/purchased, prices, renewal, storage, pending changes, promo) | `billing.manage` |
| `GET /billing/plans` | `billing.manage` |
| `POST /billing/quote {planCode, cycle, quantity, promoCode?}` → line items + GST | `billing.manage` |
| `POST /billing/checkout {planCode, cycle, quantity}` → `{gateway, orderId, checkoutUrl or keyId+options}` | `billing.manage` |
| `POST /billing/seats {quantity}` → proration quote + checkout or schedule | `billing.manage` |
| `POST /billing/cycle {cycle}`, `POST /billing/downgrade`, `POST /billing/cancel-downgrade` | `billing.manage` |
| `POST /billing/promo {code}` | `billing.manage` |
| `PUT /billing/profile` | `billing.manage` |
| `GET /billing/invoices`, `GET /billing/invoices/:id/pdf` | `billing.manage` |
| `POST /billing/contact-sales` | `billing.manage` |
| `POST /webhooks/payments/:gateway` | public, signature-verified |
| `GET /mock-pay/:orderId` (dev page with Success / Fail buttons) | dev |
| Console: `/platform/subscriptions/*`, `/platform/invoices/:id/mark-paid`, `/platform/invoices/:id/void`, `/platform/promos` CRUD, `/platform/plans/prices` | BILLING / OWNER |

- Internal: `Entitlements.has(tenantId, feature)`, `Entitlements.assertSeatAvailable(tenantId)`, `Entitlements.snapshot(tenantId)`.

### 5. Business rules and calculations (amounts in integer paise)

**Plan feature map** (entitlement keys; used by M3 `Permission.feature`)

| Plan | Features |
|---|---|
| FREE | `core.attendance_web`, `core.leave`, `core.projects`, `core.tasks`, `core.timesheet`, `core.people_basic` (employees, onboarding, shifts, locations), `core.home` (dashboard, feed, notices, alerts), `core.policies`, `core.helpdesk`, `core.vault`. Chat text only (no calls). |
| GROWTH | FREE + `payroll`, `finance` (ledger, GST invoices, purchases, filing), `tracker_desktop`, `whitelabel`, `recruitment`, `appraisal`, `assets` (+ welcome kits), `idcard`, `lms`, `kudos`, `facility`, `wellness`, `chat_calls`, `sso_oidc`, `audit_export` |
| ENTERPRISE | GROWTH + `dedicated_db`, `cctv`, `biometric_integration`, `support_24x7`, `sso_saml`, `byok` |
| INTERNAL | all features |

(The split of modules not named in the wireframe is an open question.)

**Seats**
- `activeUsers` = count of User with status in (ACTIVE, INVITED, LOCKED). DISABLED is excluded; interns count.
- `chargeableSeats = max(0, quantity − 10)`.

**Period price** (taxable, before discount)
- MONTHLY: `chargeable × 17900`
- YEARLY: `chargeable × 14900 × 12`

**Savings label**: `round((1 − 14900/17900) × 100)` = 17.

**Proration** on seat add:
- `addedChargeable = max(0, newQ − 10) − max(0, oldQ − 10)`
- `amount = round_half_up(addedChargeable × periodPrice1Seat × remainingDays / totalDaysInPeriod)`
- `periodPrice1Seat` = 17900 (monthly) or 178800 (yearly). Days are in IST, counted inclusive of today.
- Example: yearly, add 5 seats with 182 of 365 days left → 5 × 178800 × 182/365 = ₹4,457.75 + GST.

**Discount**: `percentOff` → `round(subtotal × p/100)`; or `amountOff`, capped at the subtotal. Applied before GST.

**GST** (SaaS, SAC configurable)
- Supplier Lexisora Infotech, Gujarat, state code 24.
- `placeOfSupply` = BillingProfile.stateCode (from GSTIN prefix if present).
- Intra-state (24): `cgst = sgst = round(taxable × 0.09)`, `igst = 0`.
- Inter-state: `igst = round(taxable × 0.18)`.
- `total = taxable + taxes`, rounded to the nearest rupee, with `roundOffPaise` = the difference.
- Worked example (50 seats, yearly, Gujarat): chargeable 40 → subtotal ₹71,520.00 → CGST ₹6,436.80 + SGST ₹6,436.80 → ₹84,393.60 → round-off +₹0.40 → **₹84,394**.
- Worked example (62 seats, monthly, Maharashtra): 52 × 179 = ₹9,308.00 → IGST ₹1,675.44 → ₹10,983.44 → **₹10,983**.

**Console KPIs**

| KPI | Formula |
|---|---|
| MRR (excl. GST) | Σ over subscriptions with status in (ACTIVE, PAST_DUE, READ_ONLY): MONTHLY `chargeable × 179`; YEARLY `chargeable × 149`; Enterprise `contract/12`; minus active REPEATING discounts ÷ cycle months. FREE and INTERNAL contribute 0. MRR Δ% = (today − snapshot 30 days ago) / snapshot 30 days ago. |
| Seats billed | Σ `quantity` for paid subscriptions (GROWTH, ENTERPRISE) in (ACTIVE, PAST_DUE, READ_ONLY). "+Δ this month" = Σ SubscriptionChange seat deltas since the 1st of the month. |

**Invoice number**: `LXS/{FY short}/{0000}`, platform sequence gap-free per FY. Invoice due: gateway immediate; offline Net 15 (Enterprise Net 30).

**Reminders**: renewal T-30 (yearly only), T-7, T-1; payment failed; grace ending T-2; read-only started; suspended.

**Seat warnings**: 90% and 100% of purchased seats → admin alert.

### 6. Jobs / notifications / audit
- Jobs: `billing.renewals` (daily), `billing.dunning` (hourly), `billing.reminders` (daily 09:00 IST), `billing.proration-batch` (daily), `billing.invoice-pdf` (renders a branded PDF via Playwright/HTML → M7 platform bucket), `billing.mrr-snapshot` (daily), `billing.webhook-reconcile` (hourly: fetch gateway status for orders stuck in CREATED over 30 min).
- Notifications (to `billing.manage` holders):
  - `billing.renewal_upcoming`
  - `billing.payment_succeeded` (with the invoice PDF attached)
  - `billing.payment_failed` (HIGH)
  - `billing.grace_ending`
  - `billing.read_only`
  - `billing.suspended`
  - `billing.plan_changed`
  - `billing.seats_90`, `billing.seats_full`
  - `billing.promo_applied`
- Audit (tenant and platform): `billing.checkout.started`, `billing.payment.captured`, `billing.payment.failed`, `billing.plan.changed`, `billing.seats.changed`, `billing.cycle.changed`, `billing.promo.redeemed`, `billing.profile.updated`, `billing.invoice.issued`, `billing.invoice.voided`, `billing.offline.marked_paid`.

### 7. Integrations

```
interface PaymentGateway {
  createCustomer(p:{tenantId, name, email, gstin?}): Promise<{customerId}>
  createOrder(p:{invoiceId, amountPaise, currency:'INR', customerId, notes}): Promise<{orderId, checkout:{url?:string, keyId?:string, options?:object}}>
  createMandate?(p:{customerId, maxAmountPaise, frequency}): Promise<{mandateId}>     // recurring (Razorpay subscriptions / e-mandate)
  charge?(p:{mandateId, amountPaise, invoiceId}): Promise<{paymentId, status}>
  verifyWebhook(headers, rawBody): {valid:boolean, event:{id, type:'payment.captured'|'payment.failed'|'refund.processed', orderId, paymentId, amountPaise, reason?}}
  refund(p:{paymentId, amountPaise}): Promise<{refundId}>
}
// MockGateway (default): checkout URL = /mock-pay/:orderId page with "Pay ₹X (success)" / "Fail" → posts signed webhook to self.
// RazorpayGateway: implemented against Orders + Payments + Webhooks (HMAC SHA256 X-Razorpay-Signature); enabled when RAZORPAY_KEY_ID/SECRET set.
```

### 8. Edge cases
- Duplicate webhooks → deduplicated by `eventId`.
- Webhook arrives before the redirect returns → the UI polls `GET /billing/overview` until status changes (max 60 s).
- Currency is always INR.
- GSTIN format check `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, with state code = first 2 digits.
- Seat quantity cannot go below active users.
- Enterprise with fewer than 200 users is allowed (console override).
- Price change: new PlanPrice rows apply at the next renewal; existing subscriptions keep `unitPaise` until then.
- Refund on downgrade: none (downgrade is at period end).
- Promo applied on the Free plan → only allowed if it targets GROWTH, and it is held until upgrade.

### 9. Phase and dependencies
- P3. Depends on M4, M5, M7, M9, M3 (feature gating).
- People must call `assertSeatAvailable`.

### 10. Acceptance
1. Free tenant with 10 active users: HR adds an 11th → 402 `SEAT_LIMIT`. Upgrade to Growth yearly with 50 seats via MockGateway success → invoice LXS/26-27/0001 with CGST+SGST (Gujarat) totals ₹84,394. The add now succeeds, and Payroll appears in the nav.
2. The cycle toggle shows ₹149 yearly and ₹179 monthly and "save 17%".
3. Promo "DIWALI20" (20%, NEXT_INVOICE) → toast "Promo applied · 20% off next renewal". The next renewal invoice has a discount line of 20% of the subtotal, and GST is computed on the discounted amount. Re-applying the same code → "Already used".
4. Renewal payment fails → PAST_DUE with the banner. After 7 days → READ_ONLY (writes 423, punches allowed). Payment captured → ACTIVE within one webhook.
5. Add 5 seats mid-year with 182/365 days left → proration invoice ₹4,457.75 taxable + GST.
6. Console KPIs over the seed match an independent computation of MRR and Seats billed.

---

## M11. Branding / white-label (P3; the default theme runtime is P1)

### 1. Screens and UX

**`/saas/branding`** (`branding.manage`; entitlement `whitelabel`, Growth+)

*Left column*
- "Branding", subtitle "Each client tenant gets its own colors, logo and login domain."
- **Brand palette**: radio list of presets, each with two swatches and a name. Seeded presets:
  - "Lexisora · pink & blue" `#d6457a` / `#2f5fb3`
  - "Acme · red & black" `#c62828` / `#1c1c1c`
  - "Default · gold & ink" `#b68235` / `#2d2b2b`
  - Additive: "Custom", with two hex inputs + color pickers.
- **Logo**: dropzone "Drop SVG or PNG" (M7 purpose BRAND_LOGO), preview, remove. Optional favicon.
- **Product name / wordmark** (additive; default = tenant display name; replaces "Lexisora" in the sidebar and login).
- **Login domain**: input with the `.hrms.app` suffix (slug change); "Use a custom domain" (P3 Enterprise/Growth) shows DNS instructions (CNAME to `edge.hrms.app` + TXT `_hrms-verify`) and verification status.
- **"Publish theme"** primary button.
- Contrast warnings inline, for example "Primary on background is 2.9:1; text links will use a darker shade automatically."

*Right column*: **live preview** (wireframe mock).
- Sidebar block in the secondary color with white bars; content area `#fbfafa`; cards with a 3px top border in the primary color; a "Primary action" button in the primary color.
- Toggle "Preview login page".

Free plan: the screen is visible to the admin but locked ("Available on Growth", Upgrade CTA). The Default theme applies.

### 2. Data model (tenant schema)

```
model BrandingVersion {
  id; tenantId; version Int; status BrandStatus  // DRAFT PUBLISHED ARCHIVED
  presetKey String?                              // "lexisora-pink-blue" | "acme-red-black" | "default-gold-ink" | null(custom)
  primaryHex String; secondaryHex String
  logoFileId String?; faviconFileId String?; productName String?; tagline String?
  tokens Json            // computed CSS var map
  contrastReport Json    // [{pair, ratio, pass, adjusted}]
  createdById; createdAt; publishedAt?; publishedById?
  @@unique([tenantId, version]) @@index([tenantId, status])
}
// TenantSettings.publishedBrandingVersion Int
```

### 3. Workflows
- **Edit**: autosave to a single DRAFT (created from the published version on first edit). The preview renders from the draft tokens computed client-side with the same shared function.
- **Publish**:
  1. Server recomputes tokens and validates contrast and assets.
  2. Draft → PUBLISHED, previous → ARCHIVED, bump the version.
  3. Cache-bust `theme.css`. Emit `branding.published {version}` to `t:{tenant}`; clients swap the `<link>`.
  4. Tracker clients fetch the new tokens on next focus.
  5. Audit. Notify other admins.
- **Revert**: "Restore previous" republishes an archived version as a new version.
- **Slug change**: validate availability → add the new TenantDomain as primary → the old one gets `redirectToPrimary` with `retiresAt = +90 d` → emit `tenant.domain_changed` (tracker updates its stored workspace; emails announce the new login URL to all users).

**Runtime**
- `apps/web` `index.html` includes `<link rel="stylesheet" href="/public/theme.css">`, served by the API per host (cache: `public, max-age=300` + ETag; versioned URL `?v=` after boot). This avoids a flash of the default theme.
- The response is `:root{--color-accent:...;--color-accent-100..900;--color-accent-2...;--brand-sidebar-bg:...;--brand-sidebar-fg:...}` plus `--brand-logo-url`.
- Emails, PDFs (payslips, invoices, ID cards) and the tracker use `Branding.tokens(tenantId)`.

### 4. API

| Method and path | Permission |
|---|---|
| `GET /public/theme.css` (by host) | public |
| `GET /public/workspace` (includes logoUrl, productName) | public |
| `GET /branding` (published + draft) | `branding.manage` |
| `PUT /branding/draft {presetKey?, primaryHex, secondaryHex, logoFileId?, faviconFileId?, productName?}` | `branding.manage` |
| `POST /branding/publish` | `branding.manage` |
| `POST /branding/versions/:v/restore` | `branding.manage` |
| `GET /branding/versions` | `branding.manage` |
| `POST /tenant/domain/slug {slug}`, `GET /tenant/domain/slug-available?slug=` | `branding.manage` |
| `POST /tenant/domains/custom {host}`, `POST /tenant/domains/:id/verify`, `DELETE /tenant/domains/:id` (P3) | `branding.manage` |

Realtime: `branding.published`, `tenant.domain_changed`.

### 5. Business rules
- **Ramp generation** (`packages/shared/brand.ts`, the single source for client and server):
  - Convert the shipped Classical accent ramp (100–900) to OKLCH to take its lightness steps L₁₀₀…L₉₀₀.
  - For a brand hex, take hue h and chroma c. `step_n = oklch(L_n, min(c × k_n, maxInGamut(L_n, h)), h)`, where `k_n` is the Classical ramp's chroma ratio at step n.
  - `--color-accent` = the brand hex itself; `--color-accent-2` = the secondary color's ramp likewise.
- **Mapping**
  - Primary (a) → `--color-accent*` (buttons, tags, links, focus ring, KPI rules, card top border).
  - Secondary (b) → `--brand-sidebar-bg` and `--color-accent-2*`.
  - `--brand-sidebar-fg` = `#ffffff` if the contrast of white on b ≥ 4.5, else neutral-900.
  - Default preset → `--brand-sidebar-bg: transparent`, so the Classical look is unchanged.
- **Contrast checks** (WCAG 2.1):

| Pair | Minimum | If it fails |
|---|---|---|
| accent-700 on bg (link text) | 4.5:1 | use a darker step (800) |
| accent on bg (btn-primary border/text) | 3:1 | warn; publish still allowed |
| sidebar fg on sidebar bg | 4.5:1 | |
| white on accent (preview filled button) | 4.5:1 | |

- Hex format `^#[0-9a-fA-F]{6}$`.
- Logo: rendered max-height 28px in the sidebar and 40px on login. SVG sanitized. PNG min height 64px.
- productName ≤ 40 chars. The "Powered by Lexisora HRMS" footer is hidden only on Enterprise.

### 6. Jobs / notifications / audit
- Job: `branding.domain-verify` (P3; every 10 min for 72 h per pending custom domain).
- Notifications: `branding.published` (other admins), `tenant.domain_changed` (all users, email), `domain.verified`, `domain.failed` (admins).
- Audit: `branding.draft.updated`, `branding.published`, `branding.restored`, `domain.slug_changed`, `domain.custom_added`, `domain.custom_verified`, `domain.custom_removed`.

### 7. Integrations
- `DnsVerifier`, `CertificateIssuer` (from M4).

### 8. Edge cases
- Publishing with a logo still SCANNING → blocked until AVAILABLE.
- Slug change while tracker devices are offline → the old host keeps working for 90 days via redirect/header.
- Custom domain already used by another tenant → 409.
- Invalid SVG → rejected.
- Downgrading to Free → the published custom theme is ignored at runtime (Default served) but retained.

### 9. Phase and dependencies
- P3 (Default theme runtime and `theme.css` in P1).
- Depends on M7, M4, M10 (entitlement).
- Consumed by Workplace (ID card and visiting card use the logo), Finance/Payroll PDFs, and M5 emails.

### 10. Acceptance
1. Select "Acme · red & black", upload a PNG logo, publish → a second open browser tab switches to a red accent and black sidebar without reload. `theme.css` contains the `--color-accent` for `#c62828`.
2. Custom primary `#ffe066` (low contrast) → the warning shows. Published tokens use the darker step for link text (contrast ≥ 4.5 verified in the test).
3. Change the slug `acme` → `acmelogistics` → the new host serves login, the old host 308-redirects, and all users get the email.
4. Free-plan tenant → the branding endpoints return 402 and the Default theme is served.
5. Restore the previous version → republished as version n+1.

---

## M12. Data privacy and encryption (P1 enforcement seam; P3 per-tenant keys and screen)

### 1. Screens and UX

**`/saas/privacy`** (`privacy.view`) — wireframe "Data privacy guarantee"
- Subtitle: "The platform super-admin cannot read a tenant's chats, salaries or personal documents. These controls are enforced, not optional."
- Table rendered from the classification registry. Columns: Data | Tenant admin | Lexisora super-admin | Encryption.

| Data | Tenant admin | Lexisora super-admin | Encryption |
|---|---|---|---|
| Chats & call recordings | Own users (participants) | -No access | Per-tenant key |
| Salaries & payslips | HR / Admin | -No access | Per-tenant key |
| Personal documents | HR / Admin | -No access | Per-tenant key |
| Usage & billing metrics | Admin | ~Aggregated only | At rest |

- Additive sections (P3):
  - **Encryption key**: active key version, created, last rotated, KEK provider ("Local KMS", "Vault Transit", or "Customer-managed (BYOK)" for Enterprise), "Rotate key" (`privacy.manage`, confirm dialog).
  - **Platform access log**: M6 events with `actorType = PLATFORM_USER` for this tenant, last 90 days.
  - **Support access grants**: "Grant temporary access" (scope checkboxes: Configuration read, User list metadata, Error logs; duration 24h / 72h / 7d; linked SUP ticket) → table of grants with Revoke. Restricted categories are never grantable.
  - **Data export**: "Request full export" → async zip (JSON/CSV + files), encrypted with a one-time password shown once to the requesting admin, downloadable for 7 days.
  - **Delete workspace**: request → handled via M9 deletion flow with a 30-day cool-off.

### 2. Data model

```
// packages/shared/classification.ts (code registry)
// category → {label, tenantAccess, platformAccess:'NONE'|'AGGREGATE', encryption:'TENANT_KEY'|'AT_REST', tables:[{model, fields[]}], filePurposes[]}
//   CHAT: ChatMessage.body, ChatAttachment; files CHAT_ATTACHMENT, CALL_RECORDING
//   SALARY: SalaryStructure.*, PayrollLine.* amounts, Payslip.*; files PAYSLIP_PDF, OFFER_LETTER (compensation)
//   PERSONAL_DOC: EmployeeDocument.*, Employee.pan, Employee.aadhaar, Employee.bankAccountNo, Employee.ifsc, Employee.dob?, emergency contact; files EMPLOYEE_DOCUMENT, ID_PHOTO
//   USAGE: aggregated counts only
// Prisma schema doc-comments `/// @classification RESTRICTED:SALARY` on each field; CI check ensures every tagged field is registered with CryptoService.

// platform schema (P3)
model TenantKey {
  id; tenantId; version Int; wrappedDek Bytes; kekRef String   // KMS key id / Vault transit key name "tenant-{id}"
  algorithm String @default("AES-256-GCM"); status KeyStatus    // ACTIVE DECRYPT_ONLY DESTROYED
  createdAt; rotatedAt?; destroyedAt?
  @@unique([tenantId, version])
}
model KeyRotation { id; tenantId; fromVersion; toVersion; status (RUNNING|DONE|FAILED); progress Json; startedAt; finishedAt; requestedById }
// tenant schema
model SupportAccessGrant { id; tenantId; ticketNumber Int?; scopes String[]; grantedById; expiresAt; revokedAt?; revokedById?; createdAt }
model DataExportRequest { id; tenantId; requestedById; status (QUEUED|RUNNING|READY|EXPIRED|FAILED); fileId String?; passwordHint String?; expiresAt; createdAt }
```

**Encrypted field storage**
- `bytea` holding `v{keyVersion}|iv|ciphertext|tag`.
- Searchable equality fields (PAN, Aadhaar last-4, bank account) get a companion `*_bidx` column = `HMAC-SHA256(tenantBlindIndexKey, normalized)`, truncated to 16 bytes.

### 3. Workflows and enforcement layers
1. **Structural (P1)**
   - The console API runs as `platform_svc` with zero grants on the `tenant` schema.
   - The console code lives in a separate Nest module, and ESLint `boundaries` forbids importing tenant repositories.
   - The console API has no endpoints returning RESTRICTED data.
   - Platform tokens are rejected by the tenant API.
2. **Crypto seam (P1)**
   - `CryptoService.encrypt(category, plaintext)` / `decrypt` is used by a Prisma extension for registered fields.
   - The P1 implementation: `LocalKeyProvider` with one platform master key (env/secret file) that derives a per-tenant DEK via HKDF(master, tenantId). The column format is already versioned.
3. **Per-tenant envelope keys (P3)**
   - At provisioning: generate a random 256-bit DEK, wrap it with the tenant KEK (`KeyProvider.wrap`), store it in TenantKey v1.
   - At runtime: unwrap once and cache in memory for 15 min (never in Redis). Only in tenant-context processes; the platform process identity has no KMS decrypt permission on `tenant-*` keys (Vault policy / KMS IAM).
   - Migration from P1: job `crypto.rekey` re-encrypts all registered fields and RESTRICTED files from HKDF v0 to TenantKey v1, in batches of 500 rows. Readers support both versions.
4. **Rotation (P3)**: create v(n+1) ACTIVE and mark v(n) DECRYPT_ONLY → background re-encrypt → v(n) DESTROYED 30 days after completion. Progress is shown on the screen.
5. **Crypto-shred on deletion**: destroy all TenantKeys, then purge rows and objects.
6. **Support access** (P3)
   - A console SUPPORT user can call only whitelisted metadata endpoints (`/platform/tenants/:id/diagnostics/*`: config snapshot, user list with name/email/status/roles, error logs), and only if a non-expired SupportAccessGrant covers that scope.
   - Diagnostics run as security-definer functions returning whitelisted columns.
   - Every call is audited to the tenant's Platform access log.
7. **Tenant-internal access**: chats are readable only by participants. HR/Admin see salary and personal documents through the owning domains' permissions (`employees.compensation.view`, `vault.manage`). Decrypt calls for RESTRICTED:SALARY and PERSONAL_DOC by non-owners are audited (`privacy.restricted_read`, sampled: one per user per entity per day).

### 4. API

| Method and path | Permission |
|---|---|
| `GET /privacy/overview` (registry table + key status) | `privacy.view` |
| `POST /privacy/keys/rotate` (P3) | `privacy.manage` |
| `GET /privacy/keys/rotations/:id` (P3) | `privacy.manage` |
| `GET /privacy/platform-access?cursor` | `privacy.view` |
| `GET/POST/DELETE /privacy/support-grants` (P3) | `privacy.manage` |
| `POST /privacy/exports`, `GET /privacy/exports/:id` (P3) | `privacy.manage` |
| Console: `GET /platform/tenants/:id/diagnostics/{config\|users\|errors}` (P3) | SUPPORT with an active grant |

### 5. Business rules
- AES-256-GCM with a 96-bit random IV per value, and AAD = `tenantId|model|field|rowId` (prevents copy-paste of ciphertext between rows or tenants).
- The DEK cache TTL is 15 min and the cache is zeroized on eviction.
- Grants: maximum 7 days, maximum 3 active.
- Export: RESTRICTED categories are included (the tenant owns them); the zip is AES-encrypted with a random 20-char password shown once.
- The Privacy table's "Tenant admin" column is derived from the permissions currently granted, so it shows the tenant's real config (for example, if a custom role also holds `employees.compensation.view`, the cell shows "HR / Admin + Payroll clerk").

### 6. Jobs / notifications / audit
- Jobs: `crypto.rekey`, `crypto.rotate`, `crypto.destroy-old`, `privacy.export`, `privacy.grant-expire` (every minute).
- Notifications: `privacy.key_rotated`, `privacy.export_ready`, `privacy.support_grant_used` (first use per grant), `privacy.support_grant_expired`.
- Audit: `privacy.key.rotated`, `privacy.grant.created`, `privacy.grant.revoked`, `privacy.grant.used`, `privacy.export.requested`, `privacy.export.downloaded`, `privacy.restricted_read`.

### 7. Integrations

```
interface KeyProvider {
  createKek(tenantId): Promise<{kekRef}>
  wrap(kekRef, dek: Buffer): Promise<Buffer>
  unwrap(kekRef, wrapped: Buffer): Promise<Buffer>
  destroyKek(kekRef): Promise<void>
}
// LocalKeyProvider (P1/dev: master key file, HKDF derivation); VaultTransitKeyProvider (self-hosted HashiCorp Vault/OpenBao, P3 default);
// AwsKmsKeyProvider (optional); BYOK = tenant-supplied KMS key ARN via AwsKms/Vault (Enterprise).
```

### 8. Edge cases
- KMS unavailable → decrypt fails closed (503 on RESTRICTED reads). Non-restricted features keep working.
- Rotation interrupted → resumable, and dual-version reads keep working.
- Backups contain ciphertext only for RESTRICTED fields (P3).
- Dedicated DB tenants use the same key mechanism.

### 9. Phase and dependencies
- P1: structural isolation, CryptoService seam, field tagging, platform-access audit, and a static privacy screen (acceptable in P1 for the internal tenant).
- P3: TenantKey, KMS/Vault, rotation, grants, export, BYOK.
- Needs Chat, Payroll and People to tag fields and to use `CryptoService` / `FileService` classification.

### 10. Acceptance
1. A DB dump of `tenant.payroll_line` and `employee.pan` shows ciphertext. The API returns plaintext to HR and 403 to an employee viewing another employee.
2. The console process connecting with `platform_svc` → `SELECT * FROM tenant.chat_message` → permission denied. Vault policy test: a platform token cannot unwrap `tenant-{id}`.
3. Copying tenant A's ciphertext into tenant B's row → decrypt fails (AAD mismatch).
4. Rotate key → all registered fields re-encrypted to v2. v1 goes DECRYPT_ONLY and then DESTROYED after 30 days. Reads work throughout.
5. A support engineer without a grant calls diagnostics → 403. With a 24h "Configuration read" grant → 200, and the tenant sees the access in the Platform access log.

---

## M13. Lexisora support (B2B) (P3)

### 1. Screens and UX

**Tenant side `/saas/support`** (`support.request`)
- Title "Lexisora support", subtitle "24/7 channel for client company admins to reach the Lexisora technical team." (For non-Enterprise plans the subtitle shows the plan's SLA hours.)
- Primary action "New request" opens the form b2b: Subject (text, span 2), Severity (select High / Medium / Low, span 2), Description (area, span 2), plus additive Category (Technical / Billing / Account / Feature request) and Attachments (M7 purpose SUPPORT_ATTACHMENT). Submit "Send" → toast "Request SUP-{n} opened".
- Tabs: Open, Resolved, All.
- Columns (wireframe): Request (SUP-221), Subject, Severity (!High outline, Medium / Low neutral), Opened ("Today, 10:12" / "22 Sep"), Status:
  - !Engineer assigned
  - !In progress
  - !Waiting on you
  - ~Resolved
  - -Closed
- Row → ticket thread: messages, attachments, reply box, "Mark resolved", CSAT (1–5) on resolve, "Reopen" within 7 days. A "Grant temporary access" shortcut goes to M12.

**Console "Support queue"**
- Filters: severity, plan, status, SLA breach.
- Columns: SUP#, Tenant, Plan, Subject, Severity, SLA (time to breach), Assignee, Status.
- Actions: assign/claim, reply (public), internal note, change status, merge.

### 2. Data model (platform schema)

```
model SupportTicket {
  id; number Int @unique        // platform sequence → "SUP-222"
  tenantId; openedByTenantUserId String; openedByName; openedByEmail
  subject String; description String; category SupportCategory; severity Severity // HIGH MEDIUM LOW
  status SupportStatus          // OPEN ENGINEER_ASSIGNED IN_PROGRESS WAITING_ON_CUSTOMER RESOLVED CLOSED
  assigneeId String?            // PlatformUser
  planAtOpen String; firstResponseDueAt DateTime; resolutionTargetAt DateTime?
  firstRespondedAt?; resolvedAt?; closedAt?; reopenedCount Int @default(0); csat Int?
  createdAt; updatedAt
  @@index([tenantId, status]) @@index([status, firstResponseDueAt])
}
model SupportMessage { id; ticketId; authorType (TENANT_USER|PLATFORM_USER|SYSTEM); authorId; authorName; body String; attachmentKeys String[]; internal Boolean @default(false); createdAt }
```
Attachments are stored in the platform bucket `p/support/{ticketId}/...`. The uploader consents implicitly by attaching; a UI hint warns "Don't attach salary or personal documents".

### 3. Workflows (state machine)
- OPEN → ENGINEER_ASSIGNED (assign) → IN_PROGRESS → WAITING_ON_CUSTOMER (engineer asks) → IN_PROGRESS (tenant replies) → RESOLVED (engineer or tenant).
- RESOLVED → CLOSED (auto after 7 days, or on CSAT).
- RESOLVED → IN_PROGRESS (reopen within 7 days).
- A tenant reply on WAITING_ON_CUSTOMER automatically moves the ticket to IN_PROGRESS.
- `firstRespondedAt` = the first public platform message.

### 4. API

| Method and path | Permission / role |
|---|---|
| `GET /support/tickets?tab`, `POST /support/tickets` | `support.request` |
| `GET /support/tickets/:id`, `POST /support/tickets/:id/messages` | `support.request` |
| `POST /support/tickets/:id/resolve`, `/reopen`, `/csat` | `support.request` |
| `GET /platform/support/tickets`, `PATCH /platform/support/tickets/:id` (assign/status) | SUPPORT, ENGINEER, OWNER |
| `POST /platform/support/tickets/:id/messages {body, internal}` | SUPPORT, ENGINEER, OWNER |

Realtime: `support.ticket.updated` to the tenant's support requesters.

### 5. Business rules (SLA; business hours Mon–Sat 09:00–19:00 IST, excluding the platform holiday list)

| Plan | High first response | Medium | Low |
|---|---|---|---|
| Enterprise / Internal (24/7) | 1 h wall-clock | 4 h wall-clock | 1 business day |
| Growth | 4 business hours | 1 business day | 3 business days |
| Free | Billing/Account categories only; best-effort 3 business days. Technical → docs/community link | | |

- Breach warning at 80% of the SLA; breach flag at 100% (console highlight + ops alert).

### 6. Jobs / notifications / audit
- Jobs: `support.sla-monitor` (every 5 min), `support.auto-close` (daily).
- Notifications:
  - Tenant: `support.ticket_opened` (email to the opener), `support.engineer_assigned`, `support.reply`, `support.waiting_on_you`, `support.resolved`.
  - Platform: new HIGH ticket → ops alert sink.
- Audit: `support.ticket.opened`, `support.ticket.status_changed`, `support.ticket.message` (metadata only), `support.ticket.csat`.

### 7. Integrations
- `PlatformAlertSink`. Optional inbound email (P3+) via an `InboundEmailAdapter` stub.

### 8. Edge cases
- The opener is later disabled → other `support.request` holders in the tenant can still see and reply.
- Duplicate submit (double-click) → idempotency key per form submit.
- An attachment scanned INFECTED → removed and the ticket gets a system message.

### 9. Phase and dependencies
- P3. Depends on M9 (PlatformUser), M7, M5, M10 (plan for SLA), M12 (grants).

### 10. Acceptance
1. Acme admin submits "SSO login failing for 3 users", High → SUP-222 created, the toast shows the number, the opener gets an email, and it appears in the console queue with a 4 business-hour SLA (Growth).
2. Engineer assigns themselves → the tenant sees "Engineer assigned" live.
3. Engineer posts an internal note → not visible to the tenant.
4. No first response within the SLA → breach flag and ops alert.
5. Resolve → CSAT 5 → CLOSED. Reopen after 8 days → rejected ("Open a new request").

---

## M14. Seed data and demo mode (P1)

### 1. Screens and UX
- Login "Demo: sign in as" chips: Employee, Team / Project Lead, Reporting Manager, HR, Admin / CEO. Active chip = accent border and accent-700 text.
  - Clicking signs in as that persona (no password), then goes to the requested screen or the dashboard.
- Header role chips (demo only): switching keeps the current screen if the new role is allowed, else goes to `/dashboard` (the wireframe `pick()` logic).
- Demo banner: "Demo workspace · data resets nightly at 02:00 IST."
- Deep-link compatibility: `/demo?role=hr&screen=payroll`. Also the legacy hash `#screen=payroll&role=hr` is parsed on `/` in demo mode, so the flow map links work.
- `/demo/flows`: the Flow Map ported as a demo-only page. 10 journeys, each step card (index, label, role tag, Web/Desktop, note) linking to `/demo?role&screen`. Desktop steps link to tracker download/instructions.

### 2. Data model
- `Tenant.kind = DEMO` and `User.isDemoPersona`. No new tables.
- Env `DEMO_MODE=true` is required in addition to the tenant kind.

### 3. Workflows

**Layer 1: catalogue sync** (every deploy, idempotent)
- `pnpm db:sync-catalogue` upserts Permission, NotificationType, Plan/PlanPrice, brand presets, file-purpose registry snapshot and classification registry.

**Layer 2: tenant base seed** (at provisioning, M9 step SEED_BASE/SEED_DOMAINS)
- Mine: TenantSettings, 5 system roles + default matrix (M3), sequences (M4), Default branding.
- Every domain implements `SeedContributor { key; base(ctx): Promise<void>; demo?(ctx, rng, anchor): Promise<void> }`, registered with ordering dependencies (People → Projects → Time → Finance → Workplace).

**Layer 3: demo seed** (`pnpm db:seed:demo`, dev/demo only)
- Deterministic: faker seed `20260929`.
- `SEED_ANCHOR_DATE` (default = today; `2026-09-29` for screenshot/regression tests). All dates are generated relative to the anchor, so the demo stays current.
- Tenant `lexisora` (kind DEMO, plan INTERNAL, host `lexisora.localhost` / `demo.hrms.app`).
- Personas (password `Demo@12345` for API tests; UI uses the switcher):

| Persona | Role | Title | Email |
|---|---|---|---|
| Priya Sharma | employee | Software Engineer · Development, LX-0142, Remote, RM Neha Kapoor, PL Arjun Mehta | priya.sharma@lexisora.com |
| Arjun Mehta | lead | Project Lead · Development | arjun.mehta@lexisora.com |
| Neha Kapoor | manager | Engineering Manager | neha.kapoor@lexisora.com |
| Kavya Iyer | hr | HR Manager | kavya.iyer@lexisora.com |
| Rohit Verma | admin | Chief Executive Officer | rohit.verma@lexisora.com |

- Named employees from the wireframe tables: Rahul Desai LX-0118, Sneha Patel LX-0131 (QA Lead), Vikram Joshi LX-0150 (Design, Hybrid), Ananya Rao LX-0099 (Finance, notice period), interns Isha Mehra LX-I-021, Karan Shah, Divya Nair; Meera Iyer as an offered candidate joining 6 Oct.
- Headcount: 128 active, of which 119 full-time (incl. 3 on notice) and 9 interns. Tab counts are computed, not hardcoded.
- Custom roles: Security desk, Facility Manager, IT desk (M3).
- My-domain demo data:
  - Alerts for Priya matching the wireframe rows (timesheet due Today, policy ack Yesterday, HD-1038 resolved 26 Sep, Rahul's birthday 30 Sep), so the unread count = 4.
  - An audit history.
  - Priya's device "PRIYA-LAPTOP" paired v1.4.2.
  - Files for vault documents.
  - Search index built.
- Platform demo seed:
  - 14 tenants, including Lexisora (Internal, 128), Acme Logistics (Growth yearly 240, renewal Mar 2027), Bluepeak Studio (Free, 9), Nova Clinics (Growth monthly 62, PAST_DUE, renewal 12 Oct).
  - 3 Free tenants and 2 Enterprise contracts.
  - The generator solves quantities and contract values so the computed KPIs are close to the wireframe (Seats billed ≈ 1,286, MRR ≈ ₹6.4 L). The wireframe numbers are illustrative; KPIs are always computed.
  - SUP-214 (Resolved, Low, "Custom payslip template") and SUP-221 (High, "SSO login failing for 3 users", Engineer assigned) for Lexisora.
  - Promo `DIWALI20`.
  - Platform users: owner@lexisora.dev, support@lexisora.dev (TOTP seeds printed to the console).

**Demo switch**: `POST /auth/demo/login {role}`
- Allowed only if `DEMO_MODE` ∧ `tenant.kind = DEMO`. The controller module is only registered when `DEMO_MODE=true`.
- Creates a normal WEB session for the persona. Audit `demo.persona_login`.

**Nightly reset** (demo only): job `demo.reset` 02:00 IST truncates the demo tenant's rows and re-runs the base + demo seed with anchor = today.

### 4. API

| Method and path | Permission |
|---|---|
| `POST /auth/demo/login {role}` | public, demo only |
| `GET /demo/personas` | public, demo only |

CLI: `pnpm db:sync-catalogue`, `pnpm db:seed:base --tenant`, `pnpm db:seed:demo [--anchor=2026-09-29]`, `pnpm db:seed:platform-demo`.

### 5. Business rules
- In production, `DEMO_MODE` must be false. A boot check refuses to start if `DEMO_MODE=true` and `NODE_ENV=production`, unless `DEMO_ALLOWED_HOSTS` is set to `demo.hrms.app` only.
- Demo sessions: web client only; mobile demo logins allowed only for hr/admin (the real rule).

### 6. Jobs
`demo.reset` (demo only).

### 7. Integrations
- Seeds use the mock adapters (MockGateway, MockScanner, stub WhatsApp, Mailpit).

### 8. Edge cases
- Seed re-run is idempotent (upserts by natural keys: email, empCode, SUP number).
- The anchor date is a Sunday or holiday → attendance generators skip non-working days (their domain).
- Tests use `--anchor` for determinism.

### 9. Phase and dependencies
- P1 (platform demo seed in P3).
- Every domain must supply a `SeedContributor`.

### 10. Acceptance
1. `pnpm db:seed:demo --anchor=2026-09-29` twice → the same row counts and ids (deterministic). Priya's Alerts count = 4.
2. With `DEMO_MODE=false`, `POST /auth/demo/login` → 404. The login page shows no role chips.
3. Demo: on `/payroll` as HR, switch to Employee → redirected to `/dashboard`. Switch to Admin on `/payroll` → stays.
4. `/demo?role=lead&screen=approvals` → lands on Timesheet approvals as Arjun.
5. Every Flow Map link (10 journeys) resolves to an existing route that the step's role is permitted to see (automated link-check test).

---

## Cross-domain contracts

### Exposed by this domain (all domains consume)

| Contract | Shape |
|---|---|
| Auth context | CLS `{tenantId, userId, employeeId, sessionId, clientType, permissions, requestId}`; `@CurrentUser()` decorator |
| AuthZ | `@RequirePermission(key)`, `@Scoped(key)`, `authz.can(key, resource?)`, `authz.scopeFilter(key, kind)` |
| Permission catalogue | Each domain declares its keys in `packages/shared/permissions/<domain>.ts` `{key, group, module, label, allowedScopes, defaultScope, requires, risk, feature, matrixRow, navItems, seedFor}` |
| Navigation | NAV items declared once in `packages/shared/nav.ts` `{id, label, group, route, permissionAny[], feature?}` |
| Identity | `IdentityService.inviteUser({email,name,employeeId,roleKeys})`, `disableUser(userId, reason)`, `enableUser`, `changeEmail`, `setRoles(userId, roleKeys)`, `getUser(userId)` |
| Tenancy | `TenantContext.run`, `TenantSettings` (tz, fyStartMonth, gstin, stateCode, legal name/address for Finance's client GST invoices), `SequenceService.next(key)`, `Scheduler.upsert/remove`, `EventBus.publish/subscribe` (outbox) |
| Notifications | `NotificationService.notify/resolve/sendDirect`; NotificationType registration `{key, category, defaultChannels, sourceLabel, templates}` |
| Audit | `@Audit(action)`, `AuditService.record`; action naming `module.entity.verb` |
| Files | `FileService.createIntent/complete/attach/getDownloadUrl/putSystemFile(buffer, purpose)` (for generated payslip/invoice/ID-card PDFs); purpose registration + `FileAccessPolicy`; events `file.available`, `file.rejected` |
| Search | `SearchIndexer.upsert/remove`; `SearchProvider.fullScan` |
| Entitlements | `Entitlements.has(feature)`, `assertSeatAvailable()`; event `tenant.entitlements_changed` |
| Crypto | `CryptoService.encrypt/decrypt/blindIndex(category, value)`; field tagging `/// @classification RESTRICTED:<CAT>` |
| Branding | `Branding.tokens(tenantId)`, `Branding.logoFileId(tenantId)` (ID cards, visiting cards, payslip/invoice PDFs, emails, tracker) |
| Devices | `Device` registry and DESKTOP session for the tracker domain; `DeviceGuard` yields `deviceId` in context for tracker ingestion endpoints |
| Realtime | `Realtime.emitToUser/emitToTenant/emitToRoom`; `RoomAuthorizer` hook (Chat registers channel-room policies) |
| Adapters | `EmailAdapter`, `WhatsAppAdapter` (visitor e-pass, vCard share), `ObjectStorage`, `VirusScanner`, `PaymentGateway`, `KeyProvider`, `SsoProvider` |
| Formatters and status tones | `packages/shared/format.ts`, `status-tones.ts` |
| Events emitted | `user.invited`, `user.activated`, `user.disabled`, `auth.login_succeeded`, `rbac.changed`, `tenant.provisioned`, `tenant.status_changed`, `tenant.entitlements_changed`, `tenant.domain_changed`, `branding.published`, `file.available`, `file.rejected`, `device.paired`, `device.unpaired` |

### Consumed from other domains

| From | What |
|---|---|
| People | `Employee {id, userId, empCode, name, departmentId, designation, managerId, employmentType, workMode, status, joiningDate, exitDate}`; events `employee.created`, `employee.updated`, `employee.manager_changed`, `employee.department_changed`, `employee.exited`, `employee.reactivated`, `employee.work_mode_changed`; `ScopeResolver` for TEAM (reports tree) and DEPARTMENT; people search provider; must call `assertSeatAvailable` and `inviteUser` |
| Projects/Tasks | `ScopeResolver` for PROJECT (lead/member); task/project search providers; `project.member_changed` event |
| Attendance/Tracker | `GET /attendance/me/punch-state` + punch endpoint for the header; `canUseDesktopTracker(userId)`; attendance policy "Allow desktop app punch-in" |
| Chat | Classification tagging (CHAT); room authorization; LiveKit token minting uses my auth context |
| Payroll/Finance | Classification tagging (SALARY); PDFs via `FileService.putSystemFile` with Branding; GST invoice sequence `invoice.gst` via SequenceService |
| All domains | Permission keys, NAV entries, notification types, file purposes + policies, search providers, audit action names, `SeedContributor` (base + demo) |

---

## Open questions (real ambiguities)

1. **Tenants nav for tenant "admin".** The wireframe NAV gives `tenants` to every tenant admin. I have made it operator-tenant-only, handing off to the console with TOTP. Confirm that customer tenant admins never see it.
2. **HR and "View all task boards".** The wireframe code lets HR view all departments' boards, but the Roles matrix says no. I seeded per the matrix (HR = own department only).
3. **"Payroll & ledger" matrix row vs NAV.** The row is ticked for HR, but NAV makes Ledger admin-only. I split the row into two keys (HR gets payroll only, so the row shows partial). Confirm, or grant HR ledger access.
4. **Free vs Growth split.** The plan cards only name some modules. The split of the rest (recruitment, LMS, assets, chat calls, appraisal, etc.) in M10 §5 needs product sign-off.
5. **Mobile client.** Is there a native mobile app (the "Mobile app access" row suggests so), or only a responsive web app on mobile browsers? The block is enforced for both either way.
6. **Chats and tenant admin.** "Chats & call recordings — Tenant admin: Own users". Does the tenant admin get any compliance/legal-hold export of chats? The spec assumes participants only.
7. **Encryption timing.** Per-tenant keys are P3 as decided. The spec builds the CryptoService seam in P1 and encrypts RESTRICTED fields under a derived per-tenant key, to avoid a retrofit. Confirm this is acceptable.
8. **Seat counting.** Do INVITED (not yet joined) users and interns count as billable seats? The spec counts both.
9. **Free-tier support.** "Community support" suggests no tickets. The spec allows Billing/Account tickets only.
10. **Appraisal self-review entry point.** NAV hides Appraisals from employees, yet self reviews exist (92%). The permission is seeded (`appraisal.self`); the People domain owns the entry point.

### Critical files for implementation
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Web_App/clean.html (lines 61–316: Classical tokens and classes; 319–379: login and shell; 694–767: billing, branding, generic template, modal, toast; 771–856: NAV, GEN roles/notif/tenants/privacy/support, FORMS role/tenant/b2b; 875, 899–900: role switch, plans, palettes)
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/Desktop_Tracker/clean.html (lines 329–350: tracker sign-in and device pairing; 398–402: settings "Sign out & unpair")
- C:/Users/suyam/AppData/Local/Temp/claude/c--Users-suyam-Downloads-HRMS-Portal-Design-Requirements/c12254da-74a4-4214-9416-f8fa0741525b/scratchpad/HRMS_Flow_Map/clean.html (lines 352–367: FLOWS, including "Admin controls & security" and "SaaS tenant lifecycle"; deep-link format)
- Proposed (not yet created): packages/shared/src/permissions/*.ts + nav.ts (catalogue and nav single source), apps/api/src/platform/tenancy/tenant-context.extension.ts (RLS set_config), apps/api/prisma/schema.prisma (platform/tenant/audit schemas)