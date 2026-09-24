from __future__ import annotations

from pathlib import Path, PurePosixPath

from app.core.config import settings


def object_storage_available() -> bool:
    return settings.oss_available


def build_object_key(relative_path: str) -> str:
    clean_parts = [
        part
        for part in PurePosixPath(str(relative_path).replace("\\", "/")).parts
        if part not in {"", ".", "..", "/"}
    ]
    key = str(PurePosixPath(*clean_parts))
    if settings.oss_key_prefix:
        return str(PurePosixPath(settings.oss_key_prefix, key))
    return key


def paper_object_key(file_url: str) -> str | None:
    file_name = Path(file_url or "").name
    if not file_name:
        return None
    return build_object_key(f"papers/{file_name}")


def page_image_object_key(file_url: str, page_number: int, scale: float) -> str | None:
    file_stem = Path(file_url or "").stem
    if not file_stem:
        return None
    scale_key = int(max(0.5, min(float(scale or 2.0), 3.0)) * 100)
    page_prefix = settings.oss_page_image_prefix or "paper-pages"
    return build_object_key(f"{page_prefix}/{file_stem}/p{page_number}-s{scale_key}.png")


def page_image_prefix(file_url: str) -> str | None:
    file_stem = Path(file_url or "").stem
    if not file_stem:
        return None
    page_prefix = settings.oss_page_image_prefix or "paper-pages"
    return build_object_key(f"{page_prefix}/{file_stem}/")


def full_translation_object_key(artifact_path: str | None) -> str | None:
    """Return the private object key for a persisted translated PDF."""
    clean_path = str(artifact_path or "").replace("\\", "/").strip("/")
    if not clean_path or ".." in PurePosixPath(clean_path).parts:
        return None
    return build_object_key(f"full-translations/{clean_path}")


def _bucket():
    import oss2

    auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
    return oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket_name)


def object_exists(object_key: str | None) -> bool:
    if not object_storage_available() or not object_key:
        return False
    try:
        return _bucket().object_exists(object_key)
    except Exception as exc:
        print(f"oss exists check failed for {object_key}: {exc}")
        return False


def upload_file(local_path: Path, object_key: str | None, *, content_type: str = "application/octet-stream") -> bool:
    if not object_storage_available() or not object_key:
        return False
    try:
        headers = {"Content-Type": content_type}
        _bucket().put_object_from_file(object_key, str(local_path), headers=headers)
        return True
    except Exception as exc:
        print(f"oss upload failed for {object_key}: {exc}")
        return False


def upload_bytes(content: bytes, object_key: str | None, *, content_type: str = "application/octet-stream") -> bool:
    if not object_storage_available() or not object_key:
        return False
    try:
        headers = {"Content-Type": content_type}
        _bucket().put_object(object_key, content, headers=headers)
        return True
    except Exception as exc:
        print(f"oss bytes upload failed for {object_key}: {exc}")
        return False


def download_file(object_key: str | None, destination: Path) -> bool:
    if not object_storage_available() or not object_key:
        return False
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        _bucket().get_object_to_file(object_key, str(destination))
        return True
    except Exception as exc:
        print(f"oss download failed for {object_key}: {exc}")
        return False


def download_bytes(object_key: str | None) -> bytes | None:
    if not object_storage_available() or not object_key:
        return None
    try:
        return _bucket().get_object(object_key).read()
    except Exception as exc:
        print(f"oss bytes download failed for {object_key}: {exc}")
        return None


def delete_object(object_key: str | None) -> None:
    if not object_storage_available() or not object_key:
        return
    try:
        _bucket().delete_object(object_key)
    except Exception as exc:
        print(f"oss delete failed for {object_key}: {exc}")


def delete_prefix(prefix: str | None) -> None:
    if not object_storage_available() or not prefix:
        return
    try:
        import oss2

        bucket = _bucket()
        for item in oss2.ObjectIterator(bucket, prefix=prefix):
            bucket.delete_object(item.key)
    except Exception as exc:
        print(f"oss prefix delete failed for {prefix}: {exc}")


def signed_url(object_key: str | None, *, expires: int | None = None) -> str | None:
    if not object_storage_available() or not object_key:
        return None
    if settings.oss_public_base_url and not settings.oss_signed_url_enabled:
        return f"{settings.oss_public_base_url}/{object_key}"
    try:
        ttl = int(expires or settings.oss_signed_url_expire_seconds)
        return _bucket().sign_url("GET", object_key, max(60, ttl), slash_safe=True)
    except Exception as exc:
        print(f"oss sign url failed for {object_key}: {exc}")
        return None
