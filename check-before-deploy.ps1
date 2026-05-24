param(
  [switch]$SkipFrontendBuild,
  [switch]$SkipFrontendTests,
  [switch]$SkipBackendCompile,
  [switch]$SkipBackendTests,
  [switch]$FailOnDirty
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-CheckStep {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Body
  Write-Host "OK: $Name" -ForegroundColor Green
}

function Test-PowerShellSyntax {
  param([string]$Path)
  $parseErrors = $null
  [System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath $Path -Raw), [ref]$parseErrors) | Out-Null
  if ($parseErrors -and $parseErrors.Count -gt 0) {
    $messages = $parseErrors | ForEach-Object { "$($_.Token.Content): $($_.Message)" }
    throw "PowerShell syntax error in $Path`n$($messages -join "`n")"
  }
}

function Get-DeployScanFiles {
  $allowedExtensions = @('.ps1', '.py', '.js', '.jsx', '.ts', '.tsx', '.json', '.example')
  Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object {
      $_.FullName -notmatch '\\(\.git|node_modules|dist|build|uploads|logs|__pycache__|\.pytest_cache)\\' -and
      $_.FullName -notmatch '\\(\.claude|\.codex)\\' -and
      ($_.Name -eq '.env.example' -or $_.Name -notmatch '^\.env(\.|$)') -and
      $allowedExtensions -contains $_.Extension
    }
}

Invoke-CheckStep "Git working tree visibility" {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    Write-Host "git not found; skipping dirty tree check." -ForegroundColor Yellow
    return
  }
  Push-Location $root
  try {
    $status = git status --short
    if ($status) {
      Write-Host "Working tree has local changes. deploy.ps1 will package local files, including untracked deploy files." -ForegroundColor Yellow
      $status | Select-Object -First 80 | ForEach-Object { Write-Host "  $_" }
      if ($FailOnDirty) {
        throw "Working tree is dirty and -FailOnDirty was set."
      }
    } else {
      Write-Host "Working tree is clean."
    }
  } finally {
    Pop-Location
  }
}

Invoke-CheckStep "PowerShell syntax" {
  Test-PowerShellSyntax -Path (Join-Path $root 'deploy.ps1')
  Test-PowerShellSyntax -Path (Join-Path $root 'check-before-deploy.ps1')
  $localBackendScript = Join-Path $root 'backend\start-local-backend.ps1'
  if (Test-Path -LiteralPath $localBackendScript) {
    Test-PowerShellSyntax -Path $localBackendScript
  }
}

Invoke-CheckStep "Sensitive value scan" {
  $patterns = @(
    ('271521' + 'Lq'),
    ('QZ' + 'TAJ'),
    ('fI' + '8I9'),
    'DB_TUNNEL_SSH_PASSWORD\s*=\s*["'']?[^"''\s]+',
    'XK_SERVER_PASSWORD\s*=\s*["'']?[^"''\s]+',
    'mysql\+pymysql://[^:\s]+:[^@\s]+@'
  )
  $hits = @(
    foreach ($file in Get-DeployScanFiles) {
    Select-String -LiteralPath $file.FullName -Pattern $patterns -ErrorAction SilentlyContinue
    }
  ) | Where-Object {
    $_.Line -notmatch 'your_password|your\.server\.host'
  }
  if ($hits) {
    $hits | Select-Object -First 40 | ForEach-Object {
      Write-Host "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow
    }
    throw "Potential hardcoded secret found. Move it into local env variables or backend/.env.local before deploy."
  }
}

if (-not $SkipBackendCompile) {
  Invoke-CheckStep "Backend compile" {
    Push-Location (Join-Path $root 'backend')
    try {
      python -m compileall app
    } finally {
      Pop-Location
    }
  }
}

if (-not $SkipBackendTests) {
  Invoke-CheckStep "Backend tests" {
    Push-Location (Join-Path $root 'backend')
    try {
      python -m unittest discover -s tests
    } finally {
      Pop-Location
    }
  }
}

Invoke-CheckStep "Backend route smoke check" {
  Push-Location (Join-Path $root 'backend')
  try {
    @'
from app.main import app

schema = app.openapi()
paths = set((schema.get("paths") or {}).keys())
required = {
    "/api/health",
    "/api/health/detail",
    "/api/events/stream",
    "/api/tasks",
    "/api/tasks/summary",
    "/api/tasks/archive",
    "/api/tasks/archive-completed",
    "/api/research-matrix/runs/status",
    "/api/research-matrix/runs/{run_id}/papers/{paper_id}/retry-review",
}
missing = sorted(required - paths)
if missing:
    raise SystemExit("Missing required API routes: " + ", ".join(missing))
print(f"OpenAPI routes OK: {len(paths)} paths")
'@ | python -
  } finally {
    Pop-Location
  }
}

if (-not $SkipFrontendTests) {
  Invoke-CheckStep "Frontend tests" {
    Push-Location (Join-Path $root 'frontend')
    try {
      npm test
    } finally {
      Pop-Location
    }
  }
}

if (-not $SkipFrontendBuild) {
  Invoke-CheckStep "Frontend build" {
    Push-Location (Join-Path $root 'frontend')
    try {
      npm run build
    } finally {
      Pop-Location
    }
  }
}

Write-Host ""
Write-Host "All pre-deploy checks passed." -ForegroundColor Green
