# Lexisora HRMS — People & Operations Suite

Web portal + API + Windows desktop tracker built from the wireframes in `docs/wireframes/`
(flow map, web app, desktop tracker). TypeScript end to end, multi-tenant from day one.

| Part | Stack | Path |
|---|---|---|
| API | NestJS 11 · Prisma 6 · PostgreSQL 16 · Redis/BullMQ · Socket.IO | `apps/api` |
| Web portal | React 18 · Vite · React Router · TanStack Query · "Classical" design system | `apps/web` |
| Desktop tracker | Electron 37 · electron-vite · React (Windows, NSIS installer) | `apps/tracker` |
| Shared contracts | zod schemas, permissions, navigation, tracker protocol | `packages/shared` |
| E2E | Playwright journeys from the flow map | `e2e` |

## Quick start (development)

Prerequisites: Node 20+ (tested on 24), pnpm 10, Docker Desktop.

```bash
pnpm install
docker compose up -d                  # Postgres :5433, Redis :6380, Mailpit :1025 / UI http://localhost:8025
cp apps/api/.env.example apps/api/.env   # first time only
pnpm build:shared
pnpm --filter @lexisora/api db:sync   # validate + generate Prisma client + push schema
pnpm db:seed                          # demo tenant (skips if it already exists)
pnpm dev                              # API http://localhost:4000/api/v1 · Web http://localhost:5173
```

Need a clean demo database without touching an existing one? Create a new database and point
`DATABASE_URL` in `apps/api/.env` at it, then `db:sync` + `db:seed`:

```bash
docker exec lexisora-hrms-postgres-1 psql -U hrms -d postgres -c "CREATE DATABASE hrms_demo2"
```

(`pnpm db:reset` force-resets the configured database — destructive, dev only.)

### Demo sign-in

Workspace `lexisora.hrms.app`, password `password` for every seeded user (the login page has
"Demo: sign in as" buttons; hide them in production with `VITE_DEMO_LOGINS=false`).

| Persona | Email | Role |
|---|---|---|
| Priya Sharma | priya.sharma@lexisora.com | Employee (remote) |
| Arjun Mehta | arjun.mehta@lexisora.com | Team / Project Lead |
| Neha Kapoor | neha.kapoor@lexisora.com | Reporting Manager |
| Kavya Iyer | kavya.iyer@lexisora.com | HR |
| Rohit Verma | rohit.verma@lexisora.com | Admin / CEO (also platform admin) |
| Rahul Desai | rahul.desai@lexisora.com | Employee (office → biometric only) |

Seed data follows the wireframe's sample rows around **Tue 29 Sep 2026**. Invite/reset emails land in Mailpit (http://localhost:8025).

## Desktop tracker (Windows)

```bash
pnpm --filter @lexisora/tracker dev        # run against http://localhost:4000
pnpm --filter @lexisora/tracker dist:win   # → apps/tracker/dist/Lexisora-Tracker-Setup-<version>-x64.exe
```

Sign in → the app shows a 6-digit code → approve it in the portal under **My profile → Devices**
(or HR approves under **Devices**). Remote/hybrid staff punch from the tracker; office staff run it in
monitor-only mode. See `apps/tracker/README.md`.

## Tests

```bash
pnpm -r typecheck
pnpm --filter @lexisora/api test        # unit tests (business rules: payroll, leave, attendance, approvals…)
pnpm --filter @lexisora/tracker test    # tracker engine (idle, breaks, offline queue, clock changes)
pnpm --filter @lexisora/api build && pnpm --filter @lexisora/e2e test   # e2e journeys
```

The e2e suite is non-destructive: each run creates a fresh `hrms_e2e_<timestamp>` database, seeds it,
and starts its own API against it (`e2e/playwright.config.ts`). Old `hrms_e2e_*` databases and
`e2e/.storage/` can be dropped/deleted whenever convenient.

## Production

`docker-compose.prod.yml` builds the API (`apps/api/Dockerfile`) and the web app (nginx serving the
SPA and proxying `/api` + `/socket.io`, `apps/web/Dockerfile`). Provide `POSTGRES_PASSWORD`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`, `WEB_ORIGIN` and SMTP settings in
`.env.prod`. CI: `.github/workflows/ci.yml` (typecheck, tests, seed, builds, Windows installer artifact).

Integrations use adapters with working stubs until configured: GitLab (`GITLAB_URL/TOKEN`),
LiveKit calls, WhatsApp, Razorpay, CCTV gateway, e-sign, print vendor.

## Release status

**Core release (v0.1.0-core) — complete, tested end to end**

- Sign-in (workspace, email, password, forgot/reset password, invite acceptance, SSO stub), mobile-access rule, JWT + rotating refresh cookies, tenant-scoped data, permission-based RBAC
- Dashboard (quote, today/punch card, leave balance, to-dos, approvals, announcements, birthdays & events, leave history), Notice board, Alerts, header search
- Attendance (web punch rules by work mode, timeline, monthly stats, team view), shifts, work locations, attendance policy matrix, holidays
- Desktop tracker app + backend (pairing, punch, per-task time, auto-idle dialog, breaks, screenshots, tray widget, offline encrypted queue, daily summary, HR-locked settings)
- My timesheet (tracker-driven grid, adjustments with reason, outside-hours tasks) and two-level approvals (project lead → reporting manager, screenshots + idle claims)
- Time off (balances, sandwich/holiday rules, approvals), leave setup, salary structures, payroll run (PF/ESI/PT/TDS, LOP, idle deduction) with payslip PDFs, My payslips
- Employees directory (+ CSV import), masters, employee profile & My profile (documents, assets, offer & pay, attendance, devices), paperless onboarding (e-sign, documents + HR verification, bank & tax, welcome kit), digital vault
- Clients, projects, task board (team boards with access control, drag & drop, GitLab branch/MR on WIP/Dev Completed)
- Roles & access (matrix + per-role editor), audit log

**Next releases** (screens currently show a placeholder; much of the API already exists):
Finance (GST invoices, purchases & input GST, ledger, filing cabinet) · Workplace (company feed, kudos & EOTM,
comms hub, helpdesk, learning, rooms & visitors, policies, wellness games, CCTV) · Recruitment (jobs, candidates,
interviews), appraisals, assets, welcome kits, ID card designer, visiting card · ID card compliance, regularization
& period-lock screens · project archive, intern task sheets · SaaS (subscription, branding, tenants, data privacy,
Lexisora support).

Design documents: `docs/ARCHITECTURE.md` (conventions and cross-domain contract), `docs/specs/`
(master design, per-domain specs, coverage audit).
