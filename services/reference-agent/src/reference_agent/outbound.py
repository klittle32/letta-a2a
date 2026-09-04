from __future__ import annotations

import asyncio
import base64
import time
from collections.abc import AsyncGenerator, Callable, Iterable
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote_plus
from uuid import uuid4

import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.types import (
    GetTaskRequest,
    Message,
    Part,
    Role,
    SendMessageConfiguration,
    SendMessageRequest,
    Task,
    TaskState,
)


SETTLED_STATES = {
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,
    TaskState.TASK_STATE_REJECTED,
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
}


@dataclass(frozen=True)
class RemoteTaskResult:
    agent_name: str
    task_id: str
    context_id: str
    state: str
    text: str
    poll_count: int


class OutboundA2AClient(Protocol):
    async def invoke(self, message: str) -> RemoteTaskResult: ...


class AccessTokenProvider(Protocol):
    async def get_access_token(self) -> str: ...


class ClientCredentialsTokenProvider:
    def __init__(
        self,
        *,
        token_url: str,
        client_id: str,
        client_secret: str,
        scope: str,
        refresh_skew_seconds: float = 5,
        http_client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not token_url.startswith(("http://", "https://")):
            raise ValueError("OAuth token URL must use HTTP(S)")
        if not client_id or not client_secret or not scope:
            raise ValueError("OAuth client ID, client secret, and scope are required")
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._refresh_skew_seconds = refresh_skew_seconds
        self._http_client_factory = http_client_factory
        self._clock = clock
        self._cached_token: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def get_access_token(self) -> str:
        if self._cached_token and self._expires_at > (
            self._clock() + self._refresh_skew_seconds
        ):
            return self._cached_token

        async with self._lock:
            if self._cached_token and self._expires_at > (
                self._clock() + self._refresh_skew_seconds
            ):
                return self._cached_token
            async with self._http_client_factory(timeout=httpx.Timeout(10)) as client:
                response = await client.post(
                    self._token_url,
                    headers={
                        "Authorization": (
                            "Basic "
                            + base64.b64encode(
                                (
                                    f"{quote_plus(self._client_id)}:"
                                    f"{quote_plus(self._client_secret)}"
                                ).encode()
                            ).decode()
                        )
                    },
                    data={
                        "grant_type": "client_credentials",
                        "scope": self._scope,
                    },
                )
            try:
                payload = response.json()
            except ValueError as error:
                if not response.is_success:
                    raise RuntimeError(
                        f"OAuth token exchange failed ({response.status_code})"
                    ) from error
                raise RuntimeError(
                    "OAuth token endpoint returned a non-JSON response"
                ) from error
            if not response.is_success:
                code = payload.get("error") if isinstance(payload, dict) else None
                suffix = f": {code}" if isinstance(code, str) else ""
                raise RuntimeError(
                    f"OAuth token exchange failed ({response.status_code}){suffix}"
                )
            access_token = payload.get("access_token")
            token_type = payload.get("token_type")
            expires_in = payload.get("expires_in")
            if (
                not isinstance(access_token, str)
                or not access_token
                or not isinstance(token_type, str)
                or token_type.lower() != "bearer"
                or not isinstance(expires_in, (int, float))
                or isinstance(expires_in, bool)
                or expires_in <= 0
            ):
                raise RuntimeError(
                    "OAuth token endpoint did not return a valid access_token, "
                    "token_type, and expires_in"
                )
            self._cached_token = access_token
            self._expires_at = self._clock() + expires_in
            return access_token


class OAuthBearerAuth(httpx.Auth):
    def __init__(self, token_provider: AccessTokenProvider) -> None:
        self._token_provider = token_provider

    async def async_auth_flow(
        self, request: httpx.Request
    ) -> AsyncGenerator[httpx.Request, None]:
        access_token = await self._token_provider.get_access_token()
        request.headers["Authorization"] = f"Bearer {access_token}"
        yield request


class OfficialA2AClient:
    """Discover and invoke one remote agent with the official Python A2A SDK."""

    def __init__(
        self,
        *,
        endpoint: str,
        token_provider: AccessTokenProvider,
        expected_agent_name: str,
        hop: int = 1,
        poll_interval_seconds: float = 0.1,
        timeout_seconds: float = 120,
        http_client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._token_provider = token_provider
        self._expected_agent_name = expected_agent_name
        self._hop = hop
        self._poll_interval_seconds = poll_interval_seconds
        self._timeout_seconds = timeout_seconds
        self._http_client_factory = http_client_factory

    async def invoke(self, message: str) -> RemoteTaskResult:
        http_client = self._http_client_factory(
            auth=OAuthBearerAuth(self._token_provider),
            timeout=httpx.Timeout(self._timeout_seconds),
        )
        try:
            async with asyncio.timeout(self._timeout_seconds):
                return await self._invoke_with_http_client(http_client, message)
        finally:
            if not http_client.is_closed:
                await http_client.aclose()

    async def _invoke_with_http_client(
        self,
        http_client: httpx.AsyncClient,
        message: str,
    ) -> RemoteTaskResult:
        card = await A2ACardResolver(
            http_client,
            self._endpoint,
        ).get_agent_card()
        if card.name != self._expected_agent_name:
            raise ValueError(
                f"expected {self._expected_agent_name} Agent Card, got {card.name}"
            )

        client = ClientFactory(
            ClientConfig(
                streaming=False,
                polling=True,
                httpx_client=http_client,
            )
        ).create(card)
        try:
            request = build_send_request(message, hop=self._hop)
            initial: Task | None = None
            async for response in client.send_message(request):
                if response.HasField("task"):
                    initial = response.task
                    break
                if response.HasField("message"):
                    return RemoteTaskResult(
                        agent_name=card.name,
                        task_id="",
                        context_id=response.message.context_id,
                        state="TASK_STATE_COMPLETED",
                        text=_parts_text(response.message.parts),
                        poll_count=0,
                    )

            if initial is None:
                raise RuntimeError("remote agent returned neither a task nor a message")

            task = initial
            poll_count = 0
            while task.status.state not in SETTLED_STATES:
                await asyncio.sleep(self._poll_interval_seconds)
                task = await client.get_task(GetTaskRequest(id=task.id))
                poll_count += 1

            return RemoteTaskResult(
                agent_name=card.name,
                task_id=task.id,
                context_id=task.context_id,
                state=TaskState.Name(task.status.state),
                text=_task_text(task),
                poll_count=poll_count,
            )
        finally:
            await client.close()


def build_send_request(message: str, *, hop: int) -> SendMessageRequest:
    if hop < 0:
        raise ValueError("delegation hop must be non-negative")
    return SendMessageRequest(
        message=Message(
            message_id=str(uuid4()),
            role=Role.ROLE_USER,
            parts=[Part(text=message)],
        ),
        configuration=SendMessageConfiguration(return_immediately=True),
        metadata={"lettaA2aLab": {"hop": hop}},
    )


def _task_text(task: Task) -> str:
    artifact_text = "".join(_parts_text(artifact.parts) for artifact in task.artifacts)
    if artifact_text:
        return artifact_text
    if task.status.HasField("message"):
        return _parts_text(task.status.message.parts)
    return ""


def _parts_text(parts: Iterable[Part]) -> str:
    return "".join(part.text for part in parts if part.HasField("text"))
