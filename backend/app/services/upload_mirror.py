from __future__ import annotations

from pathlib import Path, PurePosixPath

from app.core.config import settings


def _remote_path(relative_path: str) -> str:
    clean_parts = [
        part
        for part in PurePosixPath(relative_path.replace("\\", "/")).parts
        if part not in {"", ".", ".."}
    ]
    return str(PurePosixPath(settings.upload_mirror_remote_dir, *clean_parts))


def _ensure_remote_parent(sftp, remote_file_path: str) -> None:
    parent = PurePosixPath(remote_file_path).parent
    current = PurePosixPath("/")
    for part in parent.parts:
        if part in {"", "/"}:
            continue
        current = current / part
        try:
            sftp.stat(str(current))
        except OSError:
            sftp.mkdir(str(current))


def _connect_sftp():
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        settings.upload_mirror_sftp_host,
        port=settings.upload_mirror_sftp_port,
        username=settings.upload_mirror_sftp_username,
        password=settings.upload_mirror_sftp_password or None,
        timeout=settings.upload_mirror_timeout_seconds,
        banner_timeout=settings.upload_mirror_timeout_seconds,
        auth_timeout=settings.upload_mirror_timeout_seconds,
    )
    return client, client.open_sftp()


def mirror_upload_file(local_path: Path, relative_path: str) -> None:
    if not settings.upload_mirror_enabled:
        return
    if not (
        settings.upload_mirror_sftp_host
        and settings.upload_mirror_sftp_username
        and settings.upload_mirror_remote_dir
    ):
        return

    client = None
    sftp = None
    try:
        client, sftp = _connect_sftp()
        remote_file_path = _remote_path(relative_path)
        _ensure_remote_parent(sftp, remote_file_path)
        sftp.put(str(local_path), remote_file_path)
    except Exception as exc:
        print(f"upload mirror failed for {relative_path}: {exc}")
    finally:
        if sftp is not None:
            sftp.close()
        if client is not None:
            client.close()


def remove_mirrored_upload(relative_path: str) -> None:
    if not settings.upload_mirror_enabled:
        return
    if not (
        settings.upload_mirror_sftp_host
        and settings.upload_mirror_sftp_username
        and settings.upload_mirror_remote_dir
    ):
        return

    client = None
    sftp = None
    try:
        client, sftp = _connect_sftp()
        sftp.remove(_remote_path(relative_path))
    except FileNotFoundError:
        pass
    except Exception as exc:
        print(f"upload mirror delete failed for {relative_path}: {exc}")
    finally:
        if sftp is not None:
            sftp.close()
        if client is not None:
            client.close()
