#!/usr/bin/env python3
"""Acquire a short-lived lab token, verify the protected card, and exec Hermes."""

from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any


MAX_RESPONSE_BYTES = 1_048_576
HTTP_TIMEOUT_SECONDS = 10
EXPECTED_TOKEN_TTL_SECONDS = 900


class LaunchError(RuntimeError):
    pass


def launch(
    *,
    arguments: Sequence[str] = (),
    environ: Mapping[str, str],
    opener: Callable[..., Any] = urllib.request.urlopen,
    exec_fn: Callable[[str, list[str], dict[str, str]], Any] = os.execvpe,
    isatty: Callable[[int], bool] = os.isatty,
) -> None:
    hermes_arguments = parse_arguments(arguments)
    if hermes_arguments == ["--tui"] and not all(isatty(fd) for fd in (0, 1, 2)):
        raise LaunchError("Hermes TUI requires stdin, stdout, and stderr on a real TTY")

    client_id = require(environ, "HERMES_OAUTH_CLIENT_ID")
    secret_file = Path(require(environ, "HERMES_OAUTH_CLIENT_SECRET_FILE"))
    token_url = require(environ, "HERMES_OAUTH_TOKEN_URL")
    gateway_url = require(environ, "HERMES_A2A_GATEWAY_URL").rstrip("/")
    template = Path(require(environ, "HERMES_CONFIG_TEMPLATE"))
    config_path = Path(require(environ, "HERMES_CONFIG_PATH"))
    client_secret = read_secret(secret_file, label="Hermes OAuth client secret")

    access_token = request_access_token(
        token_url,
        client_id,
        client_secret,
        opener=opener,
    )
    card = fetch_agent_card(gateway_url, access_token, opener=opener)
    validate_agent_card(card, gateway_url)
    install_config(template, config_path)

    child_environment = dict(environ)
    child_environment.pop("HERMES_OAUTH_CLIENT_SECRET", None)
    provider_secret_file = child_environment.pop(
        "HERMES_OPENAI_API_KEY_FILE",
        "",
    ).strip()
    if provider_secret_file:
        child_environment["OPENAI_API_KEY"] = read_secret(
            Path(provider_secret_file),
            label="Hermes model provider API key",
        )
    child_environment["HERMES_A2A_ACCESS_TOKEN"] = access_token
    exec_fn("hermes", ["hermes", *hermes_arguments], child_environment)


def parse_arguments(arguments: Sequence[str]) -> list[str]:
    if not arguments:
        return ["--tui"]
    if len(arguments) == 2 and arguments[0] == "--oneshot":
        prompt = arguments[1].strip()
        if not prompt or len(prompt.encode()) > 16_384:
            raise LaunchError("Hermes one-shot prompt must contain 1 to 16384 bytes")
        return ["--oneshot", prompt]
    raise LaunchError("usage: launch-hermes-tui.py [--oneshot PROMPT]")


def request_access_token(
    token_url: str,
    client_id: str,
    client_secret: str,
    *,
    opener: Callable[..., Any],
) -> str:
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "scope": "a2a.discover a2a.invoke",
        }
    ).encode()
    request = urllib.request.Request(
        token_url,
        data=body,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    payload = read_json(request, opener=opener, label="OAuth token response")
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("access_token"), str)
        or not payload["access_token"]
        or payload.get("token_type") != "Bearer"
        or not isinstance(payload.get("expires_in"), int)
        or payload["expires_in"] != EXPECTED_TOKEN_TTL_SECONDS
    ):
        raise LaunchError("OAuth token response was incomplete or invalid")
    return payload["access_token"]


def fetch_agent_card(
    gateway_url: str,
    access_token: str,
    *,
    opener: Callable[..., Any],
) -> dict[str, object]:
    request = urllib.request.Request(
        f"{gateway_url}/.well-known/agent-card.json",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    payload = read_json(request, opener=opener, label="Agent Card response")
    if not isinstance(payload, dict):
        raise LaunchError("Agent Card response was not an object")
    return payload


def validate_agent_card(card: dict[str, object], gateway_url: str) -> None:
    interfaces = card.get("supportedInterfaces")
    if not isinstance(interfaces, list) or not interfaces:
        raise LaunchError("Agent Card has no supported interfaces")
    jsonrpc_interfaces = [
        item
        for item in interfaces
        if isinstance(item, dict) and item.get("protocolBinding") == "JSONRPC"
    ]
    if not any(item.get("protocolVersion") == "1.0" for item in jsonrpc_interfaces):
        raise LaunchError("Agent Card does not advertise A2A 1.0 JSON-RPC")
    advertised_urls = [item.get("url") for item in jsonrpc_interfaces]
    if isinstance(card.get("url"), str):
        advertised_urls.append(card["url"])
    if not advertised_urls or any(
        not isinstance(url, str) or url.rstrip("/") != gateway_url
        for url in advertised_urls
    ):
        raise LaunchError(
            "Agent Card does not keep every JSON-RPC URL on the gateway route"
        )

    oauth = card.get("securitySchemes")
    requirements = card.get("securityRequirements")
    if not isinstance(oauth, dict) or "a2aOAuth" not in oauth:
        raise LaunchError("Agent Card does not advertise the expected OAuth scheme")
    if "a2a.invoke" not in json.dumps(requirements, separators=(",", ":")):
        raise LaunchError("Agent Card does not require the A2A invoke scope")


def read_json(
    request: urllib.request.Request,
    *,
    opener: Callable[..., Any],
    label: str,
) -> object:
    try:
        with opener(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
        raise LaunchError(f"{label} request failed") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise LaunchError(f"{label} exceeded {MAX_RESPONSE_BYTES} bytes")
    try:
        return json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LaunchError(f"{label} was not valid JSON") from error


def install_config(template: Path, target: Path) -> None:
    try:
        source = template.read_text()
    except OSError as error:
        raise LaunchError("Hermes configuration template is unavailable") from error
    if "${HERMES_A2A_ACCESS_TOKEN}" not in source:
        raise LaunchError("Hermes configuration template lost its token placeholder")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(
        mode="w",
        dir=target.parent,
        prefix=".config-",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        handle.write(source)
    temporary.chmod(0o600)
    shutil.move(temporary, target)


def read_secret(path: Path, *, label: str) -> str:
    try:
        secret = path.read_text().strip()
    except OSError as error:
        raise LaunchError(f"{label} is unavailable") from error
    if not secret or len(secret) > 4096 or any(char in secret for char in "\r\n\0"):
        raise LaunchError(f"{label} is invalid")
    return secret


def require(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "").strip()
    if not value:
        raise LaunchError(f"{name} is required")
    return value


def main() -> int:
    try:
        launch(arguments=sys.argv[1:], environ=os.environ)
    except LaunchError as error:
        print(f"Hermes launch failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
