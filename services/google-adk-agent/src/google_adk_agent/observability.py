from __future__ import annotations

import json

from collections.abc import Awaitable, Callable
from typing import Any


MAX_OBSERVED_BODY_BYTES = 1_048_576


class RequestObservationMiddleware:
    """Record correlation identifiers without recording headers or message text."""

    def __init__(
        self,
        app: Callable[..., Awaitable[None]],
        *,
        observations: list[dict[str, object]],
    ) -> None:
        self.app = app
        self.observations = observations

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        if scope.get("type") != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return

        body, replay_receive = await buffer_request_body(receive)
        observation = parse_observation(scope, body)
        response_body = bytearray()

        async def observe_send(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.body":
                chunk = message.get("body", b"")
                if len(response_body) <= MAX_OBSERVED_BODY_BYTES:
                    response_body.extend(
                        chunk[: MAX_OBSERVED_BODY_BYTES + 1 - len(response_body)]
                    )
            await send(message)

        await self.app(scope, replay_receive, observe_send)
        if observation is not None:
            observation["responseContextId"] = response_context_id(bytes(response_body))
            self.observations.append(observation)
            print(
                json.dumps(
                    {"event": "google_adk_a2a_request", **observation},
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                flush=True,
            )


async def buffer_request_body(
    receive: Callable[[], Awaitable[dict[str, Any]]],
) -> tuple[bytes, Callable[[], Awaitable[dict[str, Any]]]]:
    body = bytearray()
    messages: list[dict[str, Any]] = []
    while True:
        message = await receive()
        messages.append(message)
        if message.get("type") != "http.request":
            break
        chunk = message.get("body", b"")
        if len(body) <= MAX_OBSERVED_BODY_BYTES:
            body.extend(chunk[: MAX_OBSERVED_BODY_BYTES + 1 - len(body)])
        if not message.get("more_body", False):
            break

    index = 0

    async def replay() -> dict[str, Any]:
        nonlocal index
        if index < len(messages):
            message = messages[index]
            index += 1
            return message
        return {"type": "http.disconnect"}

    return bytes(body), replay


def parse_observation(
    scope: dict[str, Any],
    body: bytes,
) -> dict[str, object] | None:
    if len(body) > MAX_OBSERVED_BODY_BYTES:
        return None
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("method") != "SendMessage":
        return None
    params = payload.get("params")
    message = params.get("message") if isinstance(params, dict) else None
    if not isinstance(message, dict):
        return None
    headers = {
        key.decode("latin-1").lower() for key, _value in scope.get("headers", [])
    }
    return {
        "requestId": string_or_none(payload.get("id")),
        "messageId": string_or_none(message.get("messageId")),
        "contextId": string_or_none(message.get("contextId")),
        "authorizationPresent": "authorization" in headers,
    }


def string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def response_context_id(body: bytes) -> str | None:
    if len(body) > MAX_OBSERVED_BODY_BYTES:
        return None
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return None
    for candidate in (result.get("task"), result.get("message"), result):
        if isinstance(candidate, dict):
            context_id = string_or_none(candidate.get("contextId"))
            if context_id:
                return context_id
    return None
