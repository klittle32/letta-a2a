from __future__ import annotations

import os

import pytest

from google_adk_agent.runtime import install_provider_secret


def test_installs_provider_key_from_a_runtime_secret(tmp_path, monkeypatch) -> None:
    secret_file = tmp_path / "openai-key"
    secret_file.write_text("provider-private\n")
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(secret_file))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    install_provider_secret(os.environ)

    assert os.environ["OPENAI_API_KEY"] == "provider-private"
    assert os.environ["OPENAI_API_KEY_FILE"] == str(secret_file)


@pytest.mark.parametrize("value", ["", "line-one\nline-two", "x" * 4097])
def test_rejects_invalid_provider_secrets(tmp_path, monkeypatch, value) -> None:
    secret_file = tmp_path / "openai-key"
    secret_file.write_text(value)
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(secret_file))

    with pytest.raises(ValueError, match="provider API key"):
        install_provider_secret(os.environ)
