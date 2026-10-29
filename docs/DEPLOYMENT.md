# Deploying Lexisora HRMS with Docker (this machine)

Runs the whole system — PostgreSQL, Redis, API, web portal and a mail outbox — as Docker containers.
Commands are for Windows, run from the repository root (`lexisora-hrms`).

**Quickest way:** double-click **`deploy.bat`** (or run `deploy.bat start`). It checks Docker, creates
`.env.prod` on the first run (asks: real company or demo), builds, starts, waits until healthy and
prints the addresses and logins. The menu also has Stop, Restart, Status, Logs, Rebuild, Backup,
Build tracker installer, Open portal and Reset. Every menu item is also an argument:
`deploy.bat start | stop | restart | status | logs | rebuild | backup | tracker | open | reset`.

The sections below are the same steps done by hand.

## 1. Prerequisites

- Docker Desktop running (WSL 2 backend).
- Ports: web portal **8080** (or the first free of 8088 / 8090 / 8180 — `new-env.ps1` picks it and
  prints the address); the portal is also available on **8081** and **80**. API / desktop tracker:
  **4000**. Database browser: **8082** (localhost only; use an SSH tunnel for remote access).
  Mail outbox: **8026**. The configurable ports are set in `.env.prod`.
  Stop the development servers (`pnpm dev`) first — they also use port 4000.

## 2. Create the environment file (once)

Your real company:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\new-env.ps1
```

It generates strong secrets and asks for the company name, the workspace address people type at
sign-in (e.g. `lexisora.hrms.app`) and the first admin's name, email and password.

Or a demo company with sample data (every demo user's password is `password`):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\new-env.ps1 -Demo
```

The result is `.env.prod` (git-ignored). **Back it up** — `DATA_ENCRYPTION_KEY` is needed to read
encrypted fields (PAN, Aadhaar, bank accounts, salary structures).

## 3. Start

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api   # watch first start
```

On first start the API applies the database schema and creates your workspace (or the demo data).
Then open the web portal address printed by `new-env.ps1` (e.g. **http://localhost:8080**) and sign in with the workspace address and the admin you entered.

| What | Where |
|---|---|
| Web portal | http://localhost:8080 |
| Web portal (alternate) | http://localhost:8081 |
| API health | http://localhost:4000/api/v1/health |
| Database browser (Adminer) | http://localhost:8082 |
| Invite / password-reset emails (until SMTP is configured) | http://localhost:8026 |

Adminer connects to PostgreSQL using server `postgres`, database `hrms`, and username `hrms`.
Use the `POSTGRES_PASSWORD` value from `.env.prod`. To access Adminer from your computer, create
an SSH tunnel with `ssh -L 8082:127.0.0.1:8082 <user>@<server>` and open http://localhost:8082.
The browser is intentionally not exposed directly to the public internet.

## 4. First steps as admin (real company)

1. **People → Employees → Masters**: departments, designations, branches.
2. **People → Shifts** and **Work locations**: office hours, grace, weekly offs; biometric-only vs remote.
3. **Admin → Attendance policy**: office vs remote rules (auto-idle, screenshots, idle deduction).
4. **Time → Leave setup**: leave types and credits; holidays.
5. **People → Employees → Add employee** (or **Import CSV**): each person gets an invite email to set a
   password and complete paperless onboarding.
6. **Admin → Roles & access**: adjust what each role can do.
7. Salary structures and **Finance → Payroll run** once attendance and timesheets are flowing.

## 5. Desktop tracker for remote staff

Build the Windows installer on this machine:

```powershell
pnpm --filter @lexisora/tracker dist:win      # → apps\tracker\dist\Lexisora-Tracker-Setup-<version>-x64.exe
```

Install it on each remote employee's laptop. The default server is `http://localhost:4000`, which works
on this machine; on other laptops enter `http://<this-PC's-IP>:4000` at sign-in (Windows Firewall must
allow inbound port 4000). The employee then enters the 6-digit pairing code under **My profile → Devices**.
Unsigned installers show a SmartScreen warning ("More info → Run anyway") until you sign them with a
code-signing certificate.

## 6. Access from other computers on your network

Find this PC's IP (`ipconfig`), allow ports 8081 (or the configured web port) and 4000 in Windows
Firewall, and set in `.env.prod`:

```
WEB_ORIGIN=http://<this-PC's-IP>:8081
COOKIE_SECURE=false
```

then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`. For internet access put
an HTTPS reverse proxy (e.g. Caddy) in front of port 8080 and set `COOKIE_SECURE=true`.

## 7. Real email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `.env.prod` (e.g. Google
Workspace, Microsoft 365, Amazon SES, Zoho) and restart the API:
`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`.

## 8. Backups

```powershell
powershell -ExecutionPolicy Bypass -File deploy\backup.ps1     # → backups\<timestamp>\ (DB dump + files)
```

Schedule it daily with Windows Task Scheduler and copy `backups\` and `.env.prod` somewhere off this PC.

## 9. Updates

```powershell
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Data stays in the `pgdata` and `storage` Docker volumes. Take a backup before every update.

On Linux (or Git Bash), `./deploy.sh` pulls `main`, rebuilds and starts the Compose services, prunes
unused images, and checks the API health endpoint for up to 30 seconds. It does not make a backup;
run the backup procedure before updating production. The API container applies committed Prisma
migrations on startup when migration files are present.

GitHub Actions deploys automatically after a successful CI run for a push to `main`. Configure
`SERVER_HOST`, `SERVER_USER`, and `SERVER_SSH_KEY` under **Settings → Secrets and variables → Actions**
so the workflow can connect to this server.

Schema changes must ship as migration files: after editing `apps/api/prisma/schema/*.prisma`, run
`pnpm --filter @lexisora/api prisma:migrate` and commit the new folder under `prisma/schema/migrations/`.
`db push` (and `db:sync`) only change your local database — production never sees those changes.

## 10. Stop / start

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod stop     # stop (data kept)
docker compose -f docker-compose.prod.yml --env-file .env.prod start    # start again
```

Do **not** run `docker compose … down -v` — `-v` deletes the database and uploaded files.
