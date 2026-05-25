param(
  [string]$HostName = "47.99.141.123",
  [string]$UserName = "root",
  [switch]$FrontendOnly,
  [switch]$BackendOnly,
  [switch]$SkipDesktopPackage
)

$ErrorActionPreference = "Stop"

if ($FrontendOnly -and $BackendOnly) {
  throw "FrontendOnly and BackendOnly cannot be used together."
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Join-Path $Root "paper-reader-desktop"
$DeployScript = Join-Path $Root "deploy.ps1"
$DownloadArchive = Join-Path $Root "frontend\public\downloads\xk-reader-desktop-windows.zip"
$DistDownloadArchive = Join-Path $Root "frontend\dist\downloads\xk-reader-desktop-windows.zip"

function Invoke-DeployStep {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Body
  Write-Host "OK: $Name" -ForegroundColor Green
}

function Assert-DesktopDownloadArchive {
  if (-not (Test-Path -LiteralPath $DownloadArchive)) {
    throw "Desktop download archive was not generated: $DownloadArchive"
  }

  $archive = Get-Item -LiteralPath $DownloadArchive
  if ($archive.Length -le 0) {
    throw "Desktop download archive is empty: $DownloadArchive"
  }

  if (-not (Test-Path -LiteralPath $DistDownloadArchive)) {
    throw "Desktop download archive was not copied into frontend dist: $DistDownloadArchive"
  }
}

if (-not $BackendOnly -and -not $SkipDesktopPackage) {
  Invoke-DeployStep "Package desktop app and web download archive" {
    if (-not (Test-Path -LiteralPath (Join-Path $DesktopDir "package.json"))) {
      throw "Desktop project was not found: $DesktopDir"
    }

    Push-Location $DesktopDir
    try {
      npm run package:win
    } finally {
      Pop-Location
    }
  }

  Invoke-DeployStep "Verify desktop download archive" {
    Assert-DesktopDownloadArchive
  }
} elseif (-not $BackendOnly) {
  Invoke-DeployStep "Verify existing desktop download archive" {
    Assert-DesktopDownloadArchive
  }
}

$deployArgs = @(
  "-HostName", $HostName,
  "-UserName", $UserName
)

if ($FrontendOnly) {
  $deployArgs += "-FrontendOnly"
}

if ($BackendOnly) {
  $deployArgs += "-BackendOnly"
}

if (-not $BackendOnly) {
  $deployArgs += "-SkipBuild"
}

Invoke-DeployStep "Deploy web/backend to server" {
  & $DeployScript @deployArgs
}
