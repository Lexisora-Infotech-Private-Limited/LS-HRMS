<#
  Creates .env.prod (in the repo root) for docker-compose.prod.yml with freshly generated secrets.
  Run once from the repo root:
    powershell -ExecutionPolicy Bypass -File deploy\new-env.ps1            # your real company (prompts)
    powershell -ExecutionPolicy Bypass -File deploy\new-env.ps1 -Demo      # demo data, all passwords "password"
  It never overwrites an existing .env.prod (delete it yourself if you really want new secrets —
  new secrets make existing encrypted data unreadable).
#>
param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env.prod'
if (Test-Path $target) { Write-Host ".env.prod already exists - leaving it unchanged." -ForegroundColor Yellow; exit 0 }

function New-Secret([int]$bytes = 32) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b)
}
function New-Password([int]$len = 24) { (New-Secret 32) -replace '[^a-zA-Z0-9]', '' | ForEach-Object { $_.Substring(0, $len) } }

function Test-PortFree([int]$port) {
  -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
# Web portal port: the first free of 8080 / 8088 / 8090 / 8180 on this machine.
$webPort = @(8080, 8088, 8090, 8180) | Where-Object { Test-PortFree $_ } | Select-Object -First 1
if (-not $webPort) { $webPort = 8088 }
if (-not (Test-PortFree 4000)) { Write-Host 'Port 4000 is in use (dev API?). Stop it before starting the stack, or set API_PORT in .env.prod.' -ForegroundColor Yellow }

$lines = @(
  '# Lexisora HRMS - production environment (keep this file private; it is git-ignored)',
  "POSTGRES_PASSWORD=$(New-Password)",
  "JWT_ACCESS_SECRET=$(New-Secret 48)",
  "JWT_REFRESH_SECRET=$(New-Secret 48)",
  "DATA_ENCRYPTION_KEY=$(New-Secret 32)",
  '# Published ports on this machine (web portal, API for the desktop tracker, mail outbox)',
  "WEB_PORT=$webPort",
  'API_PORT=4000',
  'MAIL_UI_PORT=8026',
  "WEB_ORIGIN=http://localhost:$webPort",
  '# Plain-HTTP LAN access needs COOKIE_SECURE=false; set true once you serve the app over HTTPS.',
  'COOKIE_SECURE=false',
  '# Real email (leave empty to keep using the built-in Mailpit outbox at http://localhost:8026)',
  'SMTP_HOST=',
  'SMTP_PORT=',
  'SMTP_USER=',
  'SMTP_PASS=',
  'MAIL_FROM=Lexisora HRMS <no-reply@lexisora.hrms.app>'
)

if ($Demo) {
  $lines += @('# First run: load the demo company (sign-in password for every demo user: "password")', 'SEED_DEMO=true', 'VITE_DEMO_LOGINS=true')
} else {
  $company = Read-Host 'Company name (e.g. Lexisora Infotech)'
  $domain = Read-Host 'Workspace address users type at sign-in (e.g. lexisora.hrms.app)'
  $adminName = Read-Host 'First admin full name'
  $adminEmail = Read-Host 'First admin official email'
  $sec = Read-Host 'First admin password (min 10 characters)' -AsSecureString
  $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ($adminPassword.Length -lt 10) { throw 'Password must be at least 10 characters.' }
  $lines += @(
    '# First run: create the company workspace and first admin (ignored once the workspace exists)',
    'SEED_DEMO=false',
    'VITE_DEMO_LOGINS=false',
    "SETUP_COMPANY=$company",
    "SETUP_DOMAIN=$domain",
    "SETUP_ADMIN_NAME=$adminName",
    "SETUP_ADMIN_EMAIL=$adminEmail",
    "SETUP_ADMIN_PASSWORD=$adminPassword",
    'SETUP_STATE_CODE=24'
  )
}

Set-Content -Path $target -Value $lines -Encoding utf8
Write-Host "Created $target (web portal will be http://localhost:$webPort)" -ForegroundColor Green
Write-Host 'Next: docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build'
