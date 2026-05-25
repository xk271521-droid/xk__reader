param(
  [string]$HostName = "47.99.141.123",
  [string]$UserName = "root",
  [switch]$FrontendOnly,
  [switch]$BackendOnly,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

if ($FrontendOnly -and $BackendOnly) {
  throw "FrontendOnly and BackendOnly cannot be used together."
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $Root "frontend"
$BackendDir = Join-Path $Root "backend"
$FrontendDist = Join-Path $FrontendDir "dist"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Require-Command "python"

if (-not $BackendOnly -and -not $SkipBuild) {
  Require-Command "npm"
  Push-Location $FrontendDir
  try {
    Write-Host "Building frontend..."
    npm run build
  } finally {
    Pop-Location
  }
}

if (-not $BackendOnly -and -not (Test-Path $FrontendDist)) {
  throw "Frontend dist folder not found: $FrontendDist"
}

$Password = $env:XK_SERVER_PASSWORD
if (-not $Password) {
  $SecurePassword = Read-Host "Server password for $UserName@$HostName" -AsSecureString
  $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  try {
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
  }
}

$env:XK_DEPLOY_ROOT = $Root
$env:XK_DEPLOY_HOST = $HostName
$env:XK_DEPLOY_USER = $UserName
$env:XK_DEPLOY_PASSWORD = $Password
$env:XK_DEPLOY_FRONTEND_ONLY = if ($FrontendOnly) { "1" } else { "0" }
$env:XK_DEPLOY_BACKEND_ONLY = if ($BackendOnly) { "1" } else { "0" }

try {
  @'
import os
import posixpath
import stat
import tarfile
import time
from pathlib import Path

import paramiko

root = Path(os.environ["XK_DEPLOY_ROOT"])
host = os.environ["XK_DEPLOY_HOST"]
user = os.environ["XK_DEPLOY_USER"]
password = os.environ["XK_DEPLOY_PASSWORD"]
frontend_only = os.environ.get("XK_DEPLOY_FRONTEND_ONLY") == "1"
backend_only = os.environ.get("XK_DEPLOY_BACKEND_ONLY") == "1"

timestamp = time.strftime("%Y%m%d%H%M%S")
frontend_dist = root / "frontend" / "dist"
backend_dir = root / "backend"
desktop_download_name = "xk-reader-setup.exe"
desktop_download = frontend_dist / "downloads" / desktop_download_name
local_frontend_archive = root / "deploy-frontend-dist.tar.gz"
local_backend_archive = root / "deploy-backend.tar.gz"

remote_root = "/www/xk-reader"
remote_frontend = f"{remote_root}/frontend"
remote_backend = f"{remote_root}/backend"
remote_backup = f"{remote_root}/backups/deploy-{timestamp}"
remote_frontend_archive = f"/tmp/xk-reader-frontend-{timestamp}.tar.gz"
remote_backend_archive = f"/tmp/xk-reader-backend-{timestamp}.tar.gz"

backend_include_names = {
    "app",
    "scripts",
    "main.py",
    "requirements.txt",
    "VERIFICATION_SETUP.md",
}
backend_exclude_dirs = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "uploads",
    "data",
}
backend_exclude_suffixes = (
    ".log",
    ".pyc",
    ".pyo",
)
backend_exclude_names = {
    ".env",
    ".env.server",
    ".env.example",
    "tmp_fix_notifications.sql",
}


def should_skip_backend_path(path: Path) -> bool:
    rel_parts = path.relative_to(backend_dir).parts
    if any(part in backend_exclude_dirs for part in rel_parts):
        return True
    if path.name in backend_exclude_names:
        return True
    return path.name.endswith(backend_exclude_suffixes)


def build_frontend_archive() -> None:
    if not desktop_download.exists():
        raise RuntimeError(
            "Desktop installer is missing from frontend/dist/downloads. "
            "Run npm run package:win in C:\\Users\\xk\\Desktop\\codexwork\\paper-reader-desktop before deploying the web app."
        )
    if local_frontend_archive.exists():
        local_frontend_archive.unlink()
    with tarfile.open(local_frontend_archive, "w:gz") as tar:
        for path in frontend_dist.rglob("*"):
            if path.is_file():
                tar.add(path, arcname=path.relative_to(frontend_dist).as_posix())


def build_backend_archive() -> None:
    if local_backend_archive.exists():
        local_backend_archive.unlink()
    with tarfile.open(local_backend_archive, "w:gz") as tar:
        for name in backend_include_names:
            path = backend_dir / name
            if not path.exists():
                continue
            if path.is_file():
                if not should_skip_backend_path(path):
                    tar.add(path, arcname=path.relative_to(backend_dir).as_posix())
                continue
            for child in path.rglob("*"):
                if child.is_file() and not should_skip_backend_path(child):
                    tar.add(child, arcname=child.relative_to(backend_dir).as_posix())


def run(ssh: paramiko.SSHClient, command: str) -> str:
    stdin, stdout, stderr = ssh.exec_command(command)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if code != 0:
        raise RuntimeError(f"Remote command failed with exit {code}\nSTDOUT:\n{out}\nSTDERR:\n{err}")
    if err.strip():
        print(err)
    return out


if not backend_only:
    print("Packing frontend dist...")
    build_frontend_archive()
if not frontend_only:
    print("Packing backend code...")
    build_backend_archive()

print(f"Connecting to {user}@{host}...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname=host, username=user, password=password, timeout=30)

try:
    sftp = ssh.open_sftp()
    try:
        if not backend_only:
            print("Uploading frontend archive...")
            sftp.put(str(local_frontend_archive), remote_frontend_archive)
        if not frontend_only:
            print("Uploading backend archive...")
            sftp.put(str(local_backend_archive), remote_backend_archive)
    finally:
        sftp.close()

    remote_commands = [
        "set -e",
        f"mkdir -p {remote_root} {remote_backup}",
    ]

    if not backend_only:
        remote_commands.extend([
            f"if [ -d {remote_frontend} ]; then cp -a {remote_frontend} {remote_backup}/frontend; fi",
            f"mkdir -p {remote_frontend}",
            f"rm -f {remote_frontend}/index.html",
            f"tar -xzf {remote_frontend_archive} -C {remote_frontend}",
            f"chown -R www-data:www-data {remote_frontend} || true",
        ])

    if not frontend_only:
        remote_commands.extend([
            f"mkdir -p {remote_backend}",
            f"mkdir -p {remote_backend}/uploads/avatars {remote_backend}/uploads/papers",
            f"for item in app scripts main.py requirements.txt VERIFICATION_SETUP.md; do "
            f"[ -e {remote_backend}/$item ] && mkdir -p {remote_backup}/backend && cp -a {remote_backend}/$item {remote_backup}/backend/; "
            "done",
            f"rm -rf {remote_backend}/app {remote_backend}/scripts",
            f"rm -f {remote_backend}/main.py {remote_backend}/requirements.txt {remote_backend}/VERIFICATION_SETUP.md",
            f"tar -xzf {remote_backend_archive} -C {remote_backend}",
            f"if [ -x {remote_root}/venv/bin/python ]; then "
            f"{remote_root}/venv/bin/python -m pip install -r {remote_backend}/requirements.txt; "
            f"elif [ -x /opt/miniconda3/envs/xk-reader/bin/python ]; then "
            f"/opt/miniconda3/envs/xk-reader/bin/python -m pip install -r {remote_backend}/requirements.txt; "
            "else echo 'No known Python environment found' >&2; exit 1; fi",
            "systemctl restart xk-reader-backend",
        ])

    remote_commands.extend([
        "nginx -t",
        "systemctl reload nginx",
        "sleep 2",
        "curl -fsS http://127.0.0.1:8000/api/health >/tmp/xk-reader-health.txt",
        "curl -fsS -I http://127.0.0.1/ >/tmp/xk-reader-frontend-head.txt",
        "curl -fsS -I http://127.0.0.1/downloads/xk-reader-setup.exe >/tmp/xk-reader-desktop-download-head.txt",
        f"echo backup={remote_backup}",
        "cat /tmp/xk-reader-health.txt",
    ])

    print("Applying deployment on server...")
    output = run(ssh, "\n".join(remote_commands))
    print(output)
finally:
    ssh.close()

print("Deployment finished.")
'@ | python -
  $deployExitCode = $LASTEXITCODE
  if ($deployExitCode -ne 0) {
    throw "Deployment failed with exit code $deployExitCode"
  }
} finally {
  Remove-Item Env:XK_DEPLOY_PASSWORD -ErrorAction SilentlyContinue
}
