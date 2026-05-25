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
$DesktopInstaller = Join-Path $Root "frontend\public\downloads\xk-reader-setup.exe"
$DistDesktopInstaller = Join-Path $Root "frontend\dist\downloads\xk-reader-setup.exe"

function Invoke-DeployStep {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $Body
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
  Write-Host "OK: $Name" -ForegroundColor Green
}

function Assert-DesktopInstaller {
  if (-not (Test-Path -LiteralPath $DesktopInstaller)) {
    throw "Desktop installer was not generated: $DesktopInstaller"
  }

  $installer = Get-Item -LiteralPath $DesktopInstaller
  if ($installer.Length -le 0) {
    throw "Desktop installer is empty: $DesktopInstaller"
  }

  if (-not (Test-Path -LiteralPath $DistDesktopInstaller)) {
    throw "Desktop installer was not copied into frontend dist: $DistDesktopInstaller"
  }
}

if (-not $BackendOnly -and -not $SkipDesktopPackage) {
  Invoke-DeployStep "Package desktop installer and web download" {
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

  Invoke-DeployStep "Verify desktop installer" {
    Assert-DesktopInstaller
  }
} elseif (-not $BackendOnly) {
  Invoke-DeployStep "Verify existing desktop installer" {
    Assert-DesktopInstaller
  }
}

$deployParams = @{
  HostName = $HostName
  UserName = $UserName
}

if ($FrontendOnly) {
  $deployParams["FrontendOnly"] = $true
}

if ($BackendOnly) {
  $deployParams["BackendOnly"] = $true
}

if (-not $BackendOnly) {
  $deployParams["SkipBuild"] = $true
}

Invoke-DeployStep "Deploy web/backend to server" {
  & $DeployScript @deployParams
}
