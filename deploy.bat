@echo off
setlocal enabledelayedexpansion

title Lexisora HRMS - Deploy Launcher

:: ============================================================
::  Lexisora HRMS  |  People & Operations Suite
::  Docker deployment launcher (this machine)
::
::  Requirements: Docker Desktop (https://docker.com)
::  Usage:        Double-click for the menu, or run with an action:
::                  deploy.bat start      build + start (first run sets everything up)
::                  deploy.bat stop       stop (data kept)
::                  deploy.bat restart    restart services
::                  deploy.bat status     containers + health
::                  deploy.bat logs       follow live logs
::                  deploy.bat rebuild    rebuild images after a code update, then start
::                  deploy.bat backup     database dump + uploaded files into backups\
::                  deploy.bat tracker    build the Windows desktop tracker installer
::                  deploy.bat open       open the web portal
::                  deploy.bat reset      DELETE all data and start fresh (asks first)
:: ============================================================

cd /d "%~dp0"
set "COMPOSE_FILE_ARGS=-f docker-compose.prod.yml --env-file .env.prod"
set "API_CONTAINER=lexisora-hrms-prod-api-1"

if not "%~1"=="" (
  set "ACTION=%~1"
  set "NOPAUSE=1"
  goto :dispatch
)

:menu
cls
call :read_env
echo.
echo  =====================================================
echo    Lexisora HRMS  ^|  People ^& Operations Suite
echo    Docker Deploy Launcher
echo  =====================================================
echo.
if exist ".env.prod" (
  echo    Environment : .env.prod  ^(!MODE_LABEL!^)
  echo    Web portal  : http://localhost:!WEB_PORT!
) else (
  echo    Environment : not created yet - option [1] sets it up
)
echo.
echo   --- DEPLOY -----------------------------------------
echo   [1]  Deploy / Start    ^(build images if needed, migrate, start^)
echo   [2]  Stop              ^(data is kept^)
echo   [3]  Restart
echo   [4]  Status            ^(containers + API health^)
echo   [5]  View Live Logs
echo.
echo   --- MAINTAIN ---------------------------------------
echo   [6]  Rebuild ^& Deploy  ^(after pulling new code^)
echo   [7]  Backup Now        ^(database + uploaded files^)
echo   [8]  Build Desktop Tracker Installer ^(Windows .exe^)
echo.
echo   --- OTHER ------------------------------------------
echo   [9]  Open Web Portal in Browser
echo   [R]  Reset Everything  ^(WARNING: deletes all data^)
echo   [0]  Exit
echo.
set "CHOICE="
set /p CHOICE="  Enter choice: "
set "NOPAUSE="
if "%CHOICE%"=="1" set "ACTION=start"
if "%CHOICE%"=="2" set "ACTION=stop"
if "%CHOICE%"=="3" set "ACTION=restart"
if "%CHOICE%"=="4" set "ACTION=status"
if "%CHOICE%"=="5" set "ACTION=logs"
if "%CHOICE%"=="6" set "ACTION=rebuild"
if "%CHOICE%"=="7" set "ACTION=backup"
if "%CHOICE%"=="8" set "ACTION=tracker"
if "%CHOICE%"=="9" set "ACTION=open"
if /i "%CHOICE%"=="R" set "ACTION=reset"
if "%CHOICE%"=="0" exit /b 0
if not defined ACTION (
  echo.
  echo  Invalid choice.
  call :sleep 2
  goto :menu
)

:dispatch
set "A=%ACTION%"
set "ACTION="
if /i "%A%"=="start"   goto :start
if /i "%A%"=="stop"    goto :stop
if /i "%A%"=="restart" goto :restart
if /i "%A%"=="status"  goto :status
if /i "%A%"=="logs"    goto :logs
if /i "%A%"=="rebuild" goto :rebuild
if /i "%A%"=="backup"  goto :backup
if /i "%A%"=="tracker" goto :tracker
if /i "%A%"=="open"    goto :open
if /i "%A%"=="reset"   goto :reset
echo  Unknown action "%A%". Use: start, stop, restart, status, logs, rebuild, backup, tracker, open, reset
exit /b 1


:: ─── Actions ────────────────────────────────────────────────────────────────

:start
  set "BUILD_FLAG=--build"
  goto :deploy

:rebuild
  set "BUILD_FLAG=--build --force-recreate"
  goto :deploy

:deploy
  echo.
  echo  =====================================================
  echo   Lexisora HRMS - DEPLOY
  echo  =====================================================
  echo.
  echo [1/5] Checking prerequisites...
  call :check_docker || goto :done_fail
  echo  OK - Docker is running.
  echo.

  echo [2/5] Checking environment...
  if not exist ".env.prod" (
    call :create_env || goto :done_fail
  ) else (
    echo  .env.prod already exists, keeping it.
  )
  call :read_env
  echo  Mode: !MODE_LABEL!   Web port: !WEB_PORT!   API port: !API_PORT!
  echo.

  echo [3/5] Building images and starting services...
  echo  First run builds the images - takes 3-5 minutes. Later runs reuse the cache.
  docker compose %COMPOSE_FILE_ARGS% up -d %BUILD_FLAG%
  if errorlevel 1 (
    echo.
    echo  ERROR: docker compose failed. Check the output above.
    echo         "port is already allocated" means another app uses port !WEB_PORT!, !API_PORT! or !MAIL_PORT!.
    echo         Stop that app, or change WEB_PORT / API_PORT / MAIL_UI_PORT in .env.prod and run again.
    goto :done_fail
  )
  echo.

  echo [4/5] Waiting for the API to be ready ^(migrations + first-run setup^)...
  call :wait_healthy || goto :done_fail
  echo.

  echo [5/5] Verifying the web portal...
  curl -sf -o nul "http://localhost:!WEB_PORT!/" >nul 2>&1
  if errorlevel 1 (
    echo  WARNING: http://localhost:!WEB_PORT! did not answer yet. Give it a few seconds.
  ) else (
    echo  Web portal is up.
  )
  call :summary
  if not defined NOPAUSE start "" "http://localhost:!WEB_PORT!"
  goto :done_ok

:stop
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  echo.
  echo  Stopping Lexisora HRMS ^(data is kept^)...
  docker compose %COMPOSE_FILE_ARGS% stop
  echo  Stopped. Start again with option [1] or: deploy.bat start
  goto :done_ok

:restart
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  echo.
  echo  Restarting Lexisora HRMS...
  docker compose %COMPOSE_FILE_ARGS% restart
  call :read_env
  call :wait_healthy || goto :done_fail
  call :summary
  goto :done_ok

:status
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  call :read_env
  echo.
  docker compose %COMPOSE_FILE_ARGS% ps
  echo.
  curl -sf "http://localhost:!API_PORT!/api/v1/health" >nul 2>&1
  if errorlevel 1 (
    echo  API health : NOT RESPONDING  ^(see: deploy.bat logs^)
  ) else (
    echo  API health : OK   http://localhost:!API_PORT!/api/v1/health
  )
  curl -sf -o nul "http://localhost:!WEB_PORT!/" >nul 2>&1
  if errorlevel 1 (
    echo  Web portal : NOT RESPONDING
  ) else (
    echo  Web portal : OK   http://localhost:!WEB_PORT!
  )
  goto :done_ok

:logs
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  echo.
  echo  Showing live logs ^(Ctrl+C to stop watching^)...
  echo.
  docker compose %COMPOSE_FILE_ARGS% logs -f --tail 200
  goto :done_ok

:backup
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  echo.
  echo  Backing up database and uploaded files...
  powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\backup.ps1"
  if errorlevel 1 (
    echo  ERROR: Backup failed. Is the stack running? ^(deploy.bat status^)
    goto :done_fail
  )
  goto :done_ok

:tracker
  call :read_env
  echo.
  echo  =====================================================
  echo   Building the Windows desktop tracker installer...
  echo  =====================================================
  where node >nul 2>&1
  if errorlevel 1 (
    echo  ERROR: Node.js 20+ is required: https://nodejs.org
    goto :done_fail
  )
  where pnpm >nul 2>&1
  if errorlevel 1 (
    echo  pnpm not found. Installing pnpm...
    call npm install -g pnpm@10.31.0
    if errorlevel 1 (
      echo  ERROR: Failed to install pnpm.
      goto :done_fail
    )
  )
  if not exist "node_modules" (
    echo  Installing dependencies ^(first time only^)...
    call pnpm install
    if errorlevel 1 goto :done_fail
  )
  call pnpm --filter @lexisora/shared build
  if errorlevel 1 goto :done_fail
  call pnpm --filter @lexisora/tracker dist:win
  if errorlevel 1 (
    echo  ERROR: Tracker build failed. See the output above.
    goto :done_fail
  )
  echo.
  echo  Installer ready in: apps\tracker\dist\
  dir /b "apps\tracker\dist\*.exe" 2>nul
  echo.
  echo  Install it on remote employees' laptops. At sign-in use server address
  echo  http://^<this PC's IP^>:!API_PORT!  ^(this PC: http://localhost:4000^), then pair the
  echo  6-digit code under My profile ^> Devices in the web portal.
  if not defined NOPAUSE start "" "apps\tracker\dist"
  goto :done_ok

:open
  call :read_env
  echo.
  echo  Opening http://localhost:!WEB_PORT! ...
  start "" "http://localhost:!WEB_PORT!"
  goto :done_ok

:reset
  call :check_docker || goto :done_fail
  call :require_env || goto :done_fail
  echo.
  echo  =====================================================
  echo   WARNING: This permanently deletes ALL data:
  echo            employees, attendance, payroll, documents,
  echo            uploaded files - everything in this deployment.
  echo   Take a backup first ^(option [7]^) if you may need it.
  echo  =====================================================
  echo.
  set "CONFIRM="
  set /p CONFIRM="  Type YES and press Enter to confirm (or just Enter to cancel): "
  if /i not "!CONFIRM!"=="YES" (
    echo.
    echo  Cancelled. No data was changed.
    goto :done_ok
  )
  docker compose %COMPOSE_FILE_ARGS% down -v --remove-orphans
  echo.
  echo  All data deleted.
  set "NEWENV="
  set /p NEWENV="  Also switch company / regenerate .env.prod (demo vs real company)? [y/N]: "
  if /i "!NEWENV!"=="y" (
    del ".env.prod" >nul 2>&1
    echo  .env.prod removed - a new one will be created now.
  )
  set "BUILD_FLAG=--build"
  goto :deploy


:: ─── Helpers ────────────────────────────────────────────────────────────────

:check_docker
  where docker >nul 2>&1
  if errorlevel 1 (
    echo  ERROR: Docker is not installed. Download Docker Desktop from:
    echo         https://www.docker.com/products/docker-desktop
    exit /b 1
  )
  docker info >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  =====================================================
    echo   [ERROR] Docker Desktop is not running!
    echo  =====================================================
    echo   Start Docker Desktop from the Start Menu, wait for the
    echo   whale icon in the system tray, then try again.
    exit /b 1
  )
  exit /b 0

:require_env
  if not exist ".env.prod" (
    echo  Not deployed yet - choose option [1] Deploy / Start first.
    exit /b 1
  )
  exit /b 0

:create_env
  echo  No .env.prod yet - first deployment.
  echo.
  echo    [1] My real company  ^(asks for company name, workspace address and first admin^)
  echo    [2] Demo company     ^(sample data; every demo password is "password"^)
  echo.
  set "ENVCHOICE="
  set /p ENVCHOICE="  Choose 1 or 2: "
  if "!ENVCHOICE!"=="2" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\new-env.ps1" -Demo
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\new-env.ps1"
  )
  if not exist ".env.prod" (
    echo  ERROR: .env.prod was not created.
    exit /b 1
  )
  echo  IMPORTANT: back up .env.prod somewhere safe - its DATA_ENCRYPTION_KEY is
  echo             needed to read encrypted PAN, bank and salary data.
  exit /b 0

:read_env
  set "WEB_PORT=8080"
  set "API_PORT=4000"
  set "MAIL_PORT=8026"
  set "SEED_DEMO=false"
  set "WORKSPACE=lexisora.hrms.app"
  set "ADMIN_EMAIL="
  if not exist ".env.prod" (
    set "MODE_LABEL=not configured"
    exit /b 0
  )
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env.prod") do (
    if /i "%%A"=="WEB_PORT" set "WEB_PORT=%%B"
    if /i "%%A"=="API_PORT" set "API_PORT=%%B"
    if /i "%%A"=="MAIL_UI_PORT" set "MAIL_PORT=%%B"
    if /i "%%A"=="SEED_DEMO" set "SEED_DEMO=%%B"
    if /i "%%A"=="SETUP_DOMAIN" set "WORKSPACE=%%B"
    if /i "%%A"=="SETUP_ADMIN_EMAIL" set "ADMIN_EMAIL=%%B"
  )
  if /i "!SEED_DEMO!"=="true" (set "MODE_LABEL=demo company") else (set "MODE_LABEL=company workspace !WORKSPACE!")
  exit /b 0

:wait_healthy
  set /a TRIES=0
  :wait_loop
  set /a TRIES+=1
  curl -sf "http://localhost:!API_PORT!/api/v1/health" >nul 2>&1
  if not errorlevel 1 (
    echo  API is healthy.
    exit /b 0
  )
  if !TRIES! GEQ 80 (
    echo.
    echo  ERROR: The API did not become healthy in time.
    echo         See what happened with: deploy.bat logs   ^(or: docker logs %API_CONTAINER%^)
    exit /b 1
  )
  set /p DUMMY=.<nul
  call :sleep 3
  goto :wait_loop

:summary
  echo.
  echo  =====================================================
  echo   DEPLOY COMPLETE - Lexisora HRMS is running
  echo  =====================================================
  echo.
  echo   Web portal   : http://localhost:!WEB_PORT!
  echo   API          : http://localhost:!API_PORT!/api/v1   ^(desktop tracker server address^)
  echo   Mail outbox  : http://localhost:!MAIL_PORT!   ^(invite / password-reset emails^)
  echo.
  echo   Workspace    : !WORKSPACE!
  if /i "!SEED_DEMO!"=="true" (
    echo   Demo logins  : priya.sharma@lexisora.com  ^(Employee^)
    echo                  arjun.mehta@lexisora.com   ^(Team / Project Lead^)
    echo                  neha.kapoor@lexisora.com   ^(Reporting Manager^)
    echo                  kavya.iyer@lexisora.com    ^(HR^)
    echo                  rohit.verma@lexisora.com   ^(Admin / CEO^)
    echo   Password     : password  ^(all demo accounts^)
  ) else (
    echo   Admin login  : !ADMIN_EMAIL!  ^(the password you entered during setup^)
  )
  echo.
  echo   Stop     : deploy.bat stop        Logs   : deploy.bat logs
  echo   Backup   : deploy.bat backup      Status : deploy.bat status
  echo   Guide    : docs\DEPLOYMENT.md
  echo.
  exit /b 0

:sleep
  :: Works without an interactive console (timeout /t fails when input is redirected).
  set /a PINGS=%~1+1
  ping -n !PINGS! 127.0.0.1 >nul 2>&1
  exit /b 0

:done_ok
  if not defined NOPAUSE (
    echo.
    pause
    goto :menu
  )
  exit /b 0

:done_fail
  if not defined NOPAUSE (
    echo.
    pause
    goto :menu
  )
  exit /b 1
