from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest


ROOT = Path(__file__).parents[3]
LAUNCHER_PATH = ROOT / "scripts" / "launch-hermes-tui.py"


def load_launcher():
    spec = importlib.util.spec_from_file_location("launch_hermes_tui", LAUNCHER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, payload: object) -> None:
        self.body = json.dumps(payload).encode()

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, limit: int) -> bytes:
        return self.body[:limit]


def valid_card(gateway_url: str) -> dict[str, object]:
    return {
        "name": "Google ADK Conversation Agent",
        "supportedInterfaces": [
            {
                "url": f"{gateway_url}/",
                "protocolBinding": "JSONRPC",
                "protocolVersion": "1.0",
            }
        ],
        "securitySchemes": {
            "a2aOAuth": {
                "oauth2SecurityScheme": {
                    "flows": {
                        "clientCredentials": {
                            "tokenUrl": "http://127.0.0.1:9001/token",
                            "scopes": {
                                "a2a.discover": "discover",
                                "a2a.invoke": "invoke",
                            },
                        }
                    }
                }
            }
        },
        "securityRequirements": [{"schemes": {"a2aOAuth": {"list": ["a2a.invoke"]}}}],
    }


def test_launcher_fetches_token_preflights_card_and_execs_tui(tmp_path, capsys) -> None:
    launcher = load_launcher()
    secret_file = tmp_path / "secret"
    secret_file.write_text("super-private\n")
    template = tmp_path / "template.yaml"
    template.write_text("token: ${HERMES_A2A_ACCESS_TOKEN}\n")
    target = tmp_path / "state" / "config.yaml"
    gateway_url = "http://agentgateway:4000/a2a/google-adk"
    requests: list[Any] = []
    responses = iter(
        [
            FakeResponse(
                {
                    "access_token": "header.payload.signature",
                    "token_type": "Bearer",
                    "expires_in": 900,
                }
            ),
            FakeResponse(valid_card(gateway_url)),
        ]
    )

    def opener(request, *, timeout):
        requests.append((request, timeout))
        return next(responses)

    executed: list[tuple[str, list[str], dict[str, str]]] = []
    launcher.launch(
        environ={
            "HERMES_OAUTH_CLIENT_ID": "hermes-client",
            "HERMES_OAUTH_CLIENT_SECRET_FILE": str(secret_file),
            "HERMES_OAUTH_TOKEN_URL": "http://auth-server:9000/token",
            "HERMES_A2A_GATEWAY_URL": gateway_url,
            "HERMES_CONFIG_TEMPLATE": str(template),
            "HERMES_CONFIG_PATH": str(target),
        },
        opener=opener,
        exec_fn=lambda file, argv, env: executed.append((file, argv, env)),
        isatty=lambda fd: True,
    )

    assert requests[0][0].full_url == "http://auth-server:9000/token"
    assert requests[1][0].full_url == f"{gateway_url}/.well-known/agent-card.json"
    assert requests[1][0].headers["Authorization"] == (
        "Bearer header.payload.signature"
    )
    assert executed[0][0:2] == ("hermes", ["hermes", "--tui"])
    assert executed[0][2]["HERMES_A2A_ACCESS_TOKEN"] == "header.payload.signature"
    assert "super-private" not in executed[0][2].values()
    assert target.read_text() == template.read_text()
    assert oct(target.stat().st_mode & 0o777) == "0o600"
    captured = capsys.readouterr()
    assert "super-private" not in captured.out
    assert "super-private" not in captured.err
    assert "header.payload.signature" not in captured.out
    assert "header.payload.signature" not in captured.err


def test_launcher_requires_a_real_tty_before_requesting_a_token(tmp_path) -> None:
    launcher = load_launcher()
    called = False

    def opener(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("network must not run")

    with pytest.raises(launcher.LaunchError, match="real TTY"):
        launcher.launch(
            environ={},
            opener=opener,
            exec_fn=lambda *_args: None,
            isatty=lambda fd: fd != 1,
        )
    assert called is False


def test_launcher_supports_a_bounded_noninteractive_live_proof(tmp_path) -> None:
    launcher = load_launcher()
    secret_file = tmp_path / "secret"
    secret_file.write_text("private")
    template = tmp_path / "template.yaml"
    template.write_text("token: ${HERMES_A2A_ACCESS_TOKEN}\n")
    gateway_url = "http://agentgateway:4000/a2a/google-adk"
    responses = iter(
        [
            FakeResponse(
                {
                    "access_token": "header.payload.signature",
                    "token_type": "Bearer",
                    "expires_in": 900,
                }
            ),
            FakeResponse(valid_card(gateway_url)),
        ]
    )
    executed: list[list[str]] = []

    launcher.launch(
        arguments=("--oneshot", "Use a2a_call against google-adk."),
        environ={
            "HERMES_OAUTH_CLIENT_ID": "hermes-client",
            "HERMES_OAUTH_CLIENT_SECRET_FILE": str(secret_file),
            "HERMES_OAUTH_TOKEN_URL": "http://auth-server:9000/token",
            "HERMES_A2A_GATEWAY_URL": gateway_url,
            "HERMES_CONFIG_TEMPLATE": str(template),
            "HERMES_CONFIG_PATH": str(tmp_path / "config.yaml"),
        },
        opener=lambda *_args, **_kwargs: next(responses),
        exec_fn=lambda _file, argv, _env: executed.append(argv),
        isatty=lambda _fd: False,
    )

    assert executed == [
        ["hermes", "--oneshot", "Use a2a_call against google-adk."],
    ]


def test_launcher_loads_the_model_key_from_a_runtime_secret(tmp_path) -> None:
    launcher = load_launcher()
    oauth_secret = tmp_path / "oauth-secret"
    oauth_secret.write_text("private")
    provider_secret = tmp_path / "provider-secret"
    provider_secret.write_text("provider-private")
    template = tmp_path / "template.yaml"
    template.write_text("token: ${HERMES_A2A_ACCESS_TOKEN}\n")
    gateway_url = "http://agentgateway:4000/a2a/google-adk"
    responses = iter(
        [
            FakeResponse(
                {
                    "access_token": "header.payload.signature",
                    "token_type": "Bearer",
                    "expires_in": 900,
                }
            ),
            FakeResponse(valid_card(gateway_url)),
        ]
    )
    executed: list[dict[str, str]] = []

    launcher.launch(
        arguments=("--oneshot", "Call the peer."),
        environ={
            "HERMES_OAUTH_CLIENT_ID": "hermes-client",
            "HERMES_OAUTH_CLIENT_SECRET_FILE": str(oauth_secret),
            "HERMES_OPENAI_API_KEY_FILE": str(provider_secret),
            "HERMES_OAUTH_TOKEN_URL": "http://auth-server:9000/token",
            "HERMES_A2A_GATEWAY_URL": gateway_url,
            "HERMES_CONFIG_TEMPLATE": str(template),
            "HERMES_CONFIG_PATH": str(tmp_path / "config.yaml"),
        },
        opener=lambda *_args, **_kwargs: next(responses),
        exec_fn=lambda _file, _argv, env: executed.append(env),
        isatty=lambda _fd: False,
    )

    assert executed[0]["OPENAI_API_KEY"] == "provider-private"
    assert "HERMES_OPENAI_API_KEY_FILE" not in executed[0]


@pytest.mark.parametrize(
    "token_payload",
    [
        {},
        {"access_token": "token", "token_type": "Basic", "expires_in": 900},
        {"access_token": "token", "token_type": "Bearer", "expires_in": 0},
        {"access_token": "token", "token_type": "Bearer", "expires_in": 1},
    ],
)
def test_launcher_fails_closed_on_invalid_token_response(
    tmp_path, token_payload
) -> None:
    launcher = load_launcher()
    secret_file = tmp_path / "secret"
    secret_file.write_text("private")

    with pytest.raises(launcher.LaunchError, match="token response"):
        launcher.launch(
            environ={
                "HERMES_OAUTH_CLIENT_ID": "hermes-client",
                "HERMES_OAUTH_CLIENT_SECRET_FILE": str(secret_file),
                "HERMES_OAUTH_TOKEN_URL": "http://auth-server:9000/token",
                "HERMES_A2A_GATEWAY_URL": ("http://agentgateway:4000/a2a/google-adk"),
                "HERMES_CONFIG_TEMPLATE": str(tmp_path / "missing"),
                "HERMES_CONFIG_PATH": str(tmp_path / "config.yaml"),
            },
            opener=lambda *_args, **_kwargs: FakeResponse(token_payload),
            exec_fn=lambda *_args: pytest.fail("must not execute Hermes"),
            isatty=lambda _fd: True,
        )


def test_launcher_rejects_a_card_that_bypasses_the_gateway(tmp_path) -> None:
    launcher = load_launcher()
    secret_file = tmp_path / "secret"
    secret_file.write_text("private")
    gateway_url = "http://agentgateway:4000/a2a/google-adk"
    card = valid_card(gateway_url)
    card["supportedInterfaces"][0]["url"] = "http://google-adk-agent:8000/"  # type: ignore[index]
    responses = iter(
        [
            FakeResponse(
                {
                    "access_token": "header.payload.signature",
                    "token_type": "Bearer",
                    "expires_in": 900,
                }
            ),
            FakeResponse(card),
        ]
    )

    with pytest.raises(launcher.LaunchError, match="gateway route"):
        launcher.launch(
            environ={
                "HERMES_OAUTH_CLIENT_ID": "hermes-client",
                "HERMES_OAUTH_CLIENT_SECRET_FILE": str(secret_file),
                "HERMES_OAUTH_TOKEN_URL": "http://auth-server:9000/token",
                "HERMES_A2A_GATEWAY_URL": gateway_url,
                "HERMES_CONFIG_TEMPLATE": str(tmp_path / "missing"),
                "HERMES_CONFIG_PATH": str(tmp_path / "config.yaml"),
            },
            opener=lambda *_args, **_kwargs: next(responses),
            exec_fn=lambda *_args: pytest.fail("must not execute Hermes"),
            isatty=lambda _fd: True,
        )
