@echo off
title Vǫlundr — The Forge
cd /d "%~dp0"

REM --- Display ASCII banner via PowerShell (reliable ANSI support) ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0banner.ps1"

REM --- Set VLDR_HOME default ---
if not defined VLDR_HOME (
    set "VLDR_HOME=%USERPROFILE%\.volundr"
)

REM --- Initialize VLDR_HOME on first run ---
if not exist "%VLDR_HOME%\projects\registry.json" (
    echo Initializing Volundr home at %VLDR_HOME%...
    if not exist "%VLDR_HOME%\projects" mkdir "%VLDR_HOME%\projects"
    if not exist "%VLDR_HOME%\global\patterns" mkdir "%VLDR_HOME%\global\patterns"
    if not exist "%VLDR_HOME%\data" mkdir "%VLDR_HOME%\data"

    REM Migrate existing data from repo if present
    if exist "%~dp0projects\registry.json" (
        echo Migrating existing projects to %VLDR_HOME%...
        xcopy /E /I /Y "%~dp0projects" "%VLDR_HOME%\projects" >nul 2>&1
        if exist "%~dp0global" xcopy /E /I /Y "%~dp0global" "%VLDR_HOME%\global" >nul 2>&1
        echo Migration complete.
    ) else (
        echo {"version":1,"projects":{},"activeProject":null}> "%VLDR_HOME%\projects\registry.json"
        echo # Global Lessons> "%VLDR_HOME%\global\lessons.md"
    )
    echo.
)

REM --- Parse flags ---
set "LOCAL_BUILD=0"
if "%~1"=="--rebuild" set "LOCAL_BUILD=1"
if "%~1"=="--local" set "LOCAL_BUILD=1"

REM --- Step 1: Start Docker Desktop if not running ---
docker info >nul 2>&1
if errorlevel 1 (
    echo Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Waiting for Docker daemon...
    :docker_wait
    docker info >nul 2>&1
    if errorlevel 1 (
        timeout /t 3 /nobreak >nul
        goto docker_wait
    )
    echo Docker is ready.
)

echo.

REM --- Fast path: dashboard already running and healthy ---
if "%LOCAL_BUILD%"=="1" goto skip_fast_path
curl -sf http://localhost:3141/api/health >nul 2>&1
if not errorlevel 1 (
    echo Dashboard already running.
    goto open_browser
)
:skip_fast_path

REM --- Step 2: Start dashboard ---
set "VLDR_HOME_DATA=%VLDR_HOME%\data"
set "CLAUDE_HOME=%USERPROFILE%\.claude"

if "%LOCAL_BUILD%"=="1" (
    echo Building dashboard from source...
    set "DOCKER_BUILDKIT=1"
    docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
) else (
    echo Pulling and starting dashboard...
    docker compose pull
    docker compose up -d
)

echo Waiting for dashboard health check...
:health_loop
curl -sf http://localhost:3141/api/health >nul 2>&1 && goto healthy
timeout /t 2 /nobreak >nul
goto health_loop
:healthy
echo Dashboard is healthy.

echo.

:open_browser
REM --- Step 3: Open browser ---
echo Opening dashboard in browser...
start http://localhost:3000

echo.
echo ============================================
echo   Dashboard ready. Launching Claude CLI...
echo ============================================
echo.
set "VLDR_HOME=%VLDR_HOME%"
claude "Wake up!" --dangerously-skip-permissions
