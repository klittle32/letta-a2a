from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient

from google_adk_agent.app import create_app
from google_adk_agent.model import DeterministicTextModel


def test_agent_card_declares_text_only_a2a_1_oauth() -> None:
    app = create_app(model=DeterministicTextModel())

    with TestClient(app) as client:
        response = client.get("/.well-known/agent-card.json")

    assert response.status_code == 200
    card = response.json()
    assert card["name"] == "Google ADK Conversation Agent"
    assert card["supportedInterfaces"] == [
        {
            "url": "http://google-adk-agent:8000/",
            "protocolBinding": "JSONRPC",
            "protocolVersion": "1.0",
        }
    ]
    assert card["capabilities"] == {
        "streaming": False,
        "pushNotifications": False,
        "extendedAgentCard": False,
    }
    assert card["defaultInputModes"] == ["text/plain"]
    assert card["defaultOutputModes"] == ["text/plain"]
    oauth = card["securitySchemes"]["a2aOAuth"]["oauth2SecurityScheme"]
    assert oauth["flows"]["clientCredentials"] == {
        "tokenUrl": "http://127.0.0.1:9001/token",
        "scopes": {
            "a2a.discover": "Discover an A2A agent through the lab gateway.",
            "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
        },
    }
    assert card["securityRequirements"] == [
        {"schemes": {"a2aOAuth": {"list": ["a2a.invoke"]}}}
    ]
    assert "security" not in card


def test_same_context_continues_the_adk_session() -> None:
    app = create_app(model=DeterministicTextModel())

    with TestClient(app) as client:
        first = send(client, "Remember the codeword ORCHID and reply STORED.")
        assert task_state(first) == "TASK_STATE_COMPLETED"
        assert artifact_text(first) == "STORED: ORCHID"
        context_id = str(first["contextId"])

        second = send(client, "What codeword did I ask you to remember?", context_id)
        assert task_state(second) == "TASK_STATE_COMPLETED"
        assert artifact_text(second) == "ORCHID"
        assert second["contextId"] == context_id

        isolated = send(client, "What codeword did I ask you to remember?")
        assert task_state(isolated) == "TASK_STATE_COMPLETED"
        assert artifact_text(isolated) == "UNKNOWN"
        assert isolated["contextId"] != context_id

    assert len(app.state.request_observations) == 3
    assert len({item["requestId"] for item in app.state.request_observations}) == 3
    assert len({item["messageId"] for item in app.state.request_observations}) == 3
    assert [item["contextId"] for item in app.state.request_observations] == [
        None,
        context_id,
        None,
    ]
    assert [item["responseContextId"] for item in app.state.request_observations] == [
        context_id,
        context_id,
        isolated["contextId"],
    ]
    assert all(
        not item["authorizationPresent"] for item in app.state.request_observations
    )


def test_malformed_input_and_model_failure_are_bounded() -> None:
    app = create_app(model=DeterministicTextModel())

    with TestClient(app) as client:
        malformed = rpc(
            client,
            "SendMessage",
            {
                "message": {
                    "messageId": str(uuid4()),
                    "role": "ROLE_USER",
                    "parts": [],
                }
            },
        )
        assert "error" in malformed

        failed = send(client, "FAIL_DETERMINISTIC")
        assert task_state(failed) == "TASK_STATE_FAILED"
        assert "deterministic model failure" in status_text(failed)


def test_health_route_does_not_require_a_model_call() -> None:
    app = create_app(model=DeterministicTextModel())

    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"status": "ok"}


def send(
    client: TestClient,
    text: str,
    context_id: str | None = None,
) -> dict[str, object]:
    message: dict[str, object] = {
        "messageId": str(uuid4()),
        "role": "ROLE_USER",
        "parts": [{"text": text}],
    }
    if context_id:
        message["contextId"] = context_id
    payload = rpc(client, "SendMessage", {"message": message})
    assert "error" not in payload, payload
    result = payload["result"]
    assert isinstance(result, dict)
    task = result.get("task", result)
    assert isinstance(task, dict)
    return task


def rpc(
    client: TestClient,
    method: str,
    params: dict[str, object],
) -> dict[str, object]:
    response = client.post(
        "/",
        headers={"A2A-Version": "1.0"},
        json={
            "jsonrpc": "2.0",
            "id": str(uuid4()),
            "method": method,
            "params": params,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert isinstance(payload, dict)
    return payload


def task_state(task: dict[str, object]) -> str:
    status = task.get("status")
    assert isinstance(status, dict)
    return str(status.get("state", ""))


def artifact_text(task: dict[str, object]) -> str:
    artifacts = task.get("artifacts")
    assert isinstance(artifacts, list) and artifacts
    artifact = artifacts[0]
    assert isinstance(artifact, dict)
    parts = artifact.get("parts")
    assert isinstance(parts, list)
    return "".join(
        str(part.get("text", "")) for part in parts if isinstance(part, dict)
    )


def status_text(task: dict[str, object]) -> str:
    status = task.get("status")
    assert isinstance(status, dict)
    message = status.get("message")
    assert isinstance(message, dict)
    parts = message.get("parts")
    assert isinstance(parts, list)
    return "".join(
        str(part.get("text", "")) for part in parts if isinstance(part, dict)
    )
