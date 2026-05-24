from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


def convert_legacy_doc_to_docx_bytes(content: bytes, source_name: str = "template.doc") -> bytes:
    suffix = Path(source_name).suffix or ".doc"
    with tempfile.TemporaryDirectory(prefix="paper-format-doc-") as tmpdir:
        temp_dir = Path(tmpdir)
        source_path = temp_dir / f"source{suffix}"
        target_path = temp_dir / "converted.docx"
        source_path.write_bytes(content)

        script = _build_word_conversion_script(str(source_path), str(target_path))
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if completed.returncode != 0 or not target_path.exists():
            stderr = (completed.stderr or completed.stdout or "").strip()
            raise RuntimeError(stderr or "无法将 .doc 模板转换为 .docx。")
        return target_path.read_bytes()


def _build_word_conversion_script(source_path: str, target_path: str) -> str:
    escaped_source = source_path.replace("'", "''")
    escaped_target = target_path.replace("'", "''")
    return f"""
$ErrorActionPreference = 'Stop'
$source = '{escaped_source}'
$target = '{escaped_target}'
$word = $null
$doc = $null
try {{
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $doc = $word.Documents.Open($source, $false, $true)
  $doc.SaveAs([ref] $target, [ref] 16)
  $doc.Close()
  $word.Quit()
}} catch {{
  try {{ if ($doc) {{ $doc.Close() }} }} catch {{}}
  try {{ if ($word) {{ $word.Quit() }} }} catch {{}}
  throw
}}
"""
