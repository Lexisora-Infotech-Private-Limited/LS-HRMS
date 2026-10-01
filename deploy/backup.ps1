<#
  Backs up the deployed Lexisora HRMS: database dump + uploaded files (documents, payslips,
  screenshots) into backups\<timestamp>\. Safe to run while the app is running.
    powershell -ExecutionPolicy Bypass -File deploy\backup.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $root "backups\$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$compose = @('compose', '-f', (Join-Path $root 'docker-compose.prod.yml'), '--env-file', (Join-Path $root '.env.prod'))

Write-Host 'Dumping database...'
& docker @compose exec -T postgres pg_dump -U hrms -d hrms --format=custom --file=/tmp/hrms.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
$pg = (& docker @compose ps -q postgres).Trim()
& docker cp "${pg}:/tmp/hrms.dump" (Join-Path $dir 'hrms.dump')

Write-Host 'Copying uploaded files...'
$api = (& docker @compose ps -q api).Trim()
& docker cp "${api}:/data/storage" (Join-Path $dir 'storage')

Write-Host "Backup written to $dir" -ForegroundColor Green
Write-Host 'Also keep a copy of .env.prod - encrypted fields (PAN, bank, salary) need its DATA_ENCRYPTION_KEY.'
