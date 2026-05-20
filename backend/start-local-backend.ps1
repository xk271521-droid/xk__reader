$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = 'C:\Python314\python.exe'
$tunnelScript = Join-Path $projectRoot 'scripts\db_ssh_tunnel.py'
$backendOut = Join-Path $projectRoot 'backend-local-fixed.out.log'
$backendErr = Join-Path $projectRoot 'backend-local-fixed.err.log'
$databaseUrl = 'mysql+pymysql://xk_reader_user:fI8I9FH0oTQZTAJrvtp-5O7ctsp1kNE7@127.0.0.1:3307/xk_reader?charset=utf8mb4'

$existingTunnel = Get-NetTCPConnection -LocalPort 3307 -ErrorAction SilentlyContinue
if (-not $existingTunnel) {
  Start-Process -FilePath $pythonExe `
    -ArgumentList @($tunnelScript) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

$backendProcesses = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*uvicorn main:app*8000*' }
foreach ($process in $backendProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

$bootstrap = @"
`$env:DATABASE_URL = '$databaseUrl'
`$env:UPLOAD_PUBLIC_BASE_URL = 'http://47.99.141.123'
`$env:PYTHONUTF8 = '1'
Set-Location '$projectRoot'
& '$pythonExe' -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
"@

Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $bootstrap) `
  -RedirectStandardOutput $backendOut `
  -RedirectStandardError $backendErr `
  -WindowStyle Hidden
