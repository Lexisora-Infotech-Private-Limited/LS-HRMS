# Deploying Lexisora HRMS with Docker (this machine)

Runs the whole system — PostgreSQL, Redis, API, web portal and a mail outbox — as Docker containers.
Commands are for Windows PowerShell, run from the repository root (`lexisora-hrms`).

## 1. Prerequisites

- Docker Desktop running (WSL 2 backend).
- Free ports: **8080** (web), **4000** (API / desktop tracker), **8026** (mail outbox).
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
Then open **http://localhost:8080** and sign in with the workspace address and the admin you entered.

| What | Where |
|---|---|
| Web portal | http://localhost:8080 |
| API health | http://localhost:4000/api/v1/health |
| Invite / password-reset emails (until SMTP is configured) | http://localhost:8026 |

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

Find this PC's IP (`ipconfig`), allow ports 8080 and 4000 in Windows Firewall, and set in `.env.prod`:

```
WEB_ORIGIN=http://<this-PC's-IP>:8080
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

## 10. Stop / start

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod stop     # stop (data kept)
docker compose -f docker-compose.prod.yml --env-file .env.prod start    # start again
```

Do **not** run `docker compose … down -v` — `-v` deletes the database and uploaded files.
