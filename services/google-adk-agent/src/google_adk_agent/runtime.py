from __future__ import annotations

from collections.abc import MutableMapping
from pathlib import Path


def install_provider_secret(environ: MutableMapping[str, str]) -> None:
    path_value = environ.get("OPENAI_API_KEY_FILE", "").strip()
    if not path_value:
        raise ValueError("OPENAI_API_KEY_FILE is required for the provider API key")
    try:
        value = Path(path_value).read_text().strip()
    except OSError as error:
        raise ValueError("provider API key secret is unavailable") from error
    if not value or len(value) > 4096 or any(char in value for char in "\r\n\0"):
        raise ValueError("provider API key secret is invalid")
    environ["OPENAI_API_KEY"] = value
