from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol
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


class OfficialA2AClient:
    """Discover and invoke one remote agent with the official Python A2A SDK."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        expected_agent_name: str,
        hop: int = 1,
        poll_interval_seconds: float = 0.1,
        timeout_seconds: float = 120,
        http_client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._expected_agent_name = expected_agent_name
        self._hop = hop
        self._poll_interval_seconds = poll_interval_seconds
        self._timeout_seconds = timeout_seconds
        self._http_client_factory = http_client_factory

    async def invoke(self, message: str) -> RemoteTaskResult:
        http_client = self._http_client_factory(
            headers={"Authorization": f"Bearer {self._api_key}"},
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
