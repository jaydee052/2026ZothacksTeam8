# Start the backend and frontend together in one terminal (Windows version of dev.sh).
#
#   .\dev.cmd            (works with any PowerShell execution policy)
#   .\dev.ps1            (if your policy allows scripts)
#
# Backend:  http://localhost:5001   (check http://localhost:5001/api/health)
# Frontend: http://localhost:5173
# Press Ctrl+C once to stop both.
#
# The first run sets things up (Python packages, npm packages). Later runs
# reinstall only if requirements.txt or package.json changed, e.g. after a pull.

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$BackendPort = 5001
$FrontendPort = 5173

function Say($msg) { Write-Host $msg -ForegroundColor Cyan }
function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# --- Checks -----------------------------------------------------------------

# Pick up tools installed since this terminal opened (e.g. a fresh Node install).
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

$Python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $Python -or $Python -like '*WindowsApps*') {
    $Python = (Get-Command py -ErrorAction SilentlyContinue).Source
}
if (-not $Python) { Fail 'Python not found. Install Python 3 from python.org first.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail 'npm not found. Install Node.js first: winget install OpenJS.NodeJS.LTS'
}

foreach ($port in $BackendPort, $FrontendPort) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
             Select-Object -First 1
    if ($owner) {
        Fail "Port $port is already in use (a server may already be running).
Stop it first, e.g.:  Stop-Process -Id $($owner.OwningProcess)"
    }
}

# --- Backend setup ----------------------------------------------------------

$VenvPython = Join-Path $Backend 'venv\Scripts\python.exe'
if (-not (Test-Path $VenvPython)) {
    Say "Creating the backend's Python environment (first run)..."
    & $Python -m venv (Join-Path $Backend 'venv')
    if ($LASTEXITCODE) { Fail 'Could not create the Python environment.' }
}

# Reinstall Python packages only when requirements.txt changed.
$Requirements = Join-Path $Backend 'requirements.txt'
$Stamp = Join-Path $Backend 'venv\.requirements-installed'
if (-not (Test-Path $Stamp) -or (Get-Item $Requirements).LastWriteTime -gt (Get-Item $Stamp).LastWriteTime) {
    Say 'Installing backend packages...'
    & $VenvPython -m pip install -q -r $Requirements
    if ($LASTEXITCODE) { Fail 'Installing backend packages failed.' }
    New-Item -ItemType File -Force $Stamp | Out-Null
}

# --- Frontend setup ---------------------------------------------------------

$NodeModules = Join-Path $Frontend 'node_modules'
$PackageJson = Join-Path $Frontend 'package.json'
if (-not (Test-Path $NodeModules) -or (Get-Item $PackageJson).LastWriteTime -gt (Get-Item $NodeModules).LastWriteTime) {
    Say 'Installing frontend packages...'
    Push-Location $Frontend
    try { & npm.cmd install --no-fund --no-audit } finally { Pop-Location }
    if ($LASTEXITCODE) { Fail 'Installing frontend packages failed.' }
    (Get-Item $NodeModules).LastWriteTime = Get-Date
}

# --- Run both ---------------------------------------------------------------

$env:PYTHONUNBUFFERED = '1'
$procs = @()
try {
    Say "Starting backend on http://localhost:$BackendPort"
    $procs += Start-Process -FilePath $VenvPython -ArgumentList 'app.py' `
        -WorkingDirectory $Backend -NoNewWindow -PassThru

    Say "Starting frontend on http://localhost:$FrontendPort"
    $procs += Start-Process -FilePath 'npm.cmd' `
        -ArgumentList 'run', 'dev', '--', '--port', $FrontendPort, '--strictPort' `
        -WorkingDirectory $Frontend -NoNewWindow -PassThru

    Say 'Both running. Press Ctrl+C to stop.'

    # Wait until either one exits (or Ctrl+C), then clean up both.
    while (-not ($procs | Where-Object HasExited)) { Start-Sleep -Milliseconds 500 }
    Say 'One of the servers stopped.'
}
finally {
    Write-Host ''
    Say 'Stopping backend and frontend...'
    foreach ($p in $procs) {
        # /T stops child processes too (Flask's reloader, Vite under npm).
        if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
    }
}
