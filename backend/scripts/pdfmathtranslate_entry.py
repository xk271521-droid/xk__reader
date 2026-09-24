"""Compatibility entry point for the isolated PDFMathTranslate runtime.

pdf2zh 1.9.11 pins BabelDOC below 0.3. That BabelDOC release still invokes
``numpy.fromstring`` on binary PyMuPDF buffers, an API removed in NumPy 2.
Keep the workaround outside the API process and only alter the binary-buffer
case; regular text parsing remains delegated to NumPy unchanged.
"""

from __future__ import annotations

from typing import Any


def _install_numpy_binary_fromstring_compatibility() -> None:
    import numpy

    original_fromstring = numpy.fromstring

    try:
        original_fromstring(b"\x00", dtype=numpy.uint8)
    except ValueError:

        def fromstring_compat(
            value: Any,
            dtype: Any = float,
            count: int = -1,
            sep: str = "",
        ) -> Any:
            if sep == "" and isinstance(value, (bytes, bytearray, memoryview)):
                return numpy.frombuffer(value, dtype=dtype, count=count)
            return original_fromstring(value, dtype=dtype, count=count, sep=sep)

        numpy.fromstring = fromstring_compat


def _disable_qwen_thinking_for_short_translation_calls() -> None:
    """Avoid paying for hidden reasoning tokens in Qwen3 translation calls."""
    from pdf2zh.translator import OpenAITranslator

    if getattr(OpenAITranslator, "_xk_thinking_patch", False):
        return

    original_init = OpenAITranslator.__init__

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        model = str(getattr(self, "model", "") or "").lower()
        if "qwen3" in model:
            self.options["extra_body"] = {
                **dict(self.options.get("extra_body") or {}),
                "enable_thinking": False,
            }

    OpenAITranslator.__init__ = patched_init
    OpenAITranslator._xk_thinking_patch = True


def main() -> None:
    _install_numpy_binary_fromstring_compatibility()
    _disable_qwen_thinking_for_short_translation_calls()
    from pdf2zh.pdf2zh import main as pdf2zh_main

    pdf2zh_main()


if __name__ == "__main__":
    main()
