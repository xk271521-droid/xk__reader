$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Join-Path $projectRoot 'frontend'
$backendScript = Join-Path $projectRoot 'backend\start-standalone-local.ps1'
$frontendOut = Join-Path $frontendRoot 'frontend-local-fixed.out.log'
$frontendErr = Join-Path $frontendRoot 'frontend-local-fixed.err.log'
$frontendUrl = 'http://127.0.0.1:5173'

if (-not (Test-Path -LiteralPath $backendScript)) {
  throw "找不到后端启动脚本：$backendScript"
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'package.json'))) {
  throw "找不到前端项目：$frontendRoot"
}

# Only clean Vite/npm processes launched from this repository. Other projects
# using Vite or npm are left untouched.
$projectProcesses = Get-CimInstance Win32_Process | Where-Object {
  $commandLine = [string]$_.CommandLine
  $commandLine -and
    $commandLine -like "*$frontendRoot*" -and
    ($commandLine -like '*vite*' -or $commandLine -like '*npm run dev*')
}
foreach ($process in $projectProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

# The backend entrypoint owns its fixed 8000 process and safely replaces an
# older instance. Run it in a hidden PowerShell process so the shortcut stays
# a one-click launcher instead of leaving a console window open.
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $backendScript) `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden

Start-Sleep -Seconds 1

Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev') `
  -WorkingDirectory $frontendRoot `
  -RedirectStandardOutput $frontendOut `
  -RedirectStandardError $frontendErr `
  -WindowStyle Hidden

$frontendReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  $listener = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
  if ($listener) {
    $frontendReady = $true
    break
  }
}

if (-not $frontendReady) {
  throw "前端未能在 5173 端口启动，请查看：$frontendErr"
}

Start-Process $frontendUrl
