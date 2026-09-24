$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# The local API has one supported entrypoint. Keep this in sync with the
# frontend proxy and do not silently move to another backend port.
$backendHost = '127.0.0.1'
$backendPort = 8000
$tunnelScript = Join-Path $projectRoot 'scripts\db_ssh_tunnel.py'
$backendOut = Join-Path $projectRoot 'backend-local-fixed.out.log'
$backendErr = Join-Path $projectRoot 'backend-local-fixed.err.log'

function Import-EnvFile {
  param(
    [string]$Path,
    [switch]$Overwrite
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) {
      continue
    }

    $name, $value = $line -split '=', 2
    $name = $name.Trim()
    if (-not $name) {
      continue
    }

    $value = $value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if ($Overwrite -or -not ([Environment]::GetEnvironmentVariable($name, 'Process'))) {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

Import-EnvFile -Path (Join-Path $projectRoot '.env')
Import-EnvFile -Path (Join-Path $projectRoot '.env.local') -Overwrite

$pythonExe = if ($env:PYTHON_EXE) { $env:PYTHON_EXE } else { 'C:\Python314\python.exe' }
$isStandaloneLocal = $env:XK_READER_USE_LOCAL_DATABASE -match '^(1|true|yes)$'
$databaseUrl = if ($isStandaloneLocal) {
  # The tunnel-only URL can use a server account without local MySQL permission.
  $env:DATABASE_URL
} elseif ($env:XK_READER_LOCAL_DATABASE_URL) {
  $env:XK_READER_LOCAL_DATABASE_URL
} else {
  $env:DATABASE_URL
}
$uploadPublicBaseUrl = $env:UPLOAD_PUBLIC_BASE_URL
$localTunnelPort = if ($env:DB_TUNNEL_LOCAL_PORT) { [int]$env:DB_TUNNEL_LOCAL_PORT } else { 3307 }
$usesLocalTunnel = -not $isStandaloneLocal -and -not [string]::IsNullOrWhiteSpace($databaseUrl) -and $databaseUrl -match "@(127\.0\.0\.1|localhost):$localTunnelPort\b"
$enableReload = $env:XK_BACKEND_RELOAD -match '^(1|true|yes)$'

if ($usesLocalTunnel) {
  $existingTunnel = Get-NetTCPConnection -LocalPort $localTunnelPort -ErrorAction SilentlyContinue
  if (-not $existingTunnel) {
    if ([string]::IsNullOrWhiteSpace($env:DB_TUNNEL_SSH_HOST) -or [string]::IsNullOrWhiteSpace($env:DB_TUNNEL_SSH_USERNAME)) {
      throw "Missing DB_TUNNEL_* settings. Put local-only tunnel values in backend\.env.local."
    }

    Start-Process -FilePath $pythonExe `
      -ArgumentList @($tunnelScript) `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
}

$backendProcesses = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*uvicorn main:app*$backendPort*" }
foreach ($process in $backendProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

[Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'Process')

if (-not [string]::IsNullOrWhiteSpace($databaseUrl)) {
  [Environment]::SetEnvironmentVariable('DATABASE_URL', $databaseUrl, 'Process')
}

if (-not [string]::IsNullOrWhiteSpace($uploadPublicBaseUrl)) {
  [Environment]::SetEnvironmentVariable('UPLOAD_PUBLIC_BASE_URL', $uploadPublicBaseUrl, 'Process')
}

$uvicornArgs = @('-m', 'uvicorn', 'main:app', '--host', $backendHost, '--port', "$backendPort")
if ($enableReload) {
  $uvicornArgs += '--reload'
}

Start-Process -FilePath $pythonExe `
  -ArgumentList $uvicornArgs `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $backendOut `
  -RedirectStandardError $backendErr `
  -WindowStyle Hidden
