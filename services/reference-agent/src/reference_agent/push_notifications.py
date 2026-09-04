from __future__ import annotations

import asyncio
import hmac
import logging

from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from a2a.server.context import ServerCallContext
from a2a.server.tasks.inmemory_push_notification_config_store import (
    InMemoryPushNotificationConfigStore,
)
from a2a.server.tasks.push_notification_config_store import (
    PushNotificationConfigStore,
)
from a2a.server.tasks.push_notification_sender import (
    PushNotificationEvent,
    PushNotificationSender,
)
from a2a.types import TaskPushNotificationConfig
from a2a.utils.proto_utils import to_stream_response
from a2a.utils.errors import InvalidParamsError
from google.protobuf.json_format import MessageToDict


logger = logging.getLogger(__name__)
MAX_URL_LENGTH = 2_048
MAX_CREDENTIAL_LENGTH = 1_024


@dataclass(frozen=True)
class PushNotificationPolicy:
    callback_url: str
    bearer_token: str
    timeout_seconds: float = 5

    def __post_init__(self) -> None:
        parsed = urlsplit(self.callback_url)
        if (
            not self.callback_url
            or len(self.callback_url) > MAX_URL_LENGTH
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.geturl() != self.callback_url
        ):
            raise ValueError("configured push callback URL is not canonical")
        if not self.bearer_token or len(self.bearer_token) > MAX_CREDENTIAL_LENGTH:
            raise ValueError("push callback Bearer token has an invalid length")
        if self.timeout_seconds <= 0:
            raise ValueError("push callback timeout must be positive")

    def validate(
        self,
        task_id: str,
        config: TaskPushNotificationConfig,
    ) -> None:
        if config.task_id and config.task_id != task_id:
            raise InvalidParamsError(
                "push callback task ID does not match the target task"
            )
        if config.url != self.callback_url:
            raise InvalidParamsError(
                "push callback URL is not on the deployment allowlist"
            )
        if config.token:
            raise InvalidParamsError("legacy push callback tokens are not accepted")
        if (
            not config.HasField("authentication")
            or config.authentication.scheme != "Bearer"
            or not hmac.compare_digest(
                config.authentication.credentials,
                self.bearer_token,
            )
        ):
            raise InvalidParamsError(
                "push callback requires the configured Bearer credential"
            )


class ValidatingPushNotificationConfigStore(PushNotificationConfigStore):
    def __init__(self, policy: PushNotificationPolicy) -> None:
        self._policy = policy
        self._delegate = InMemoryPushNotificationConfigStore()

    async def set_info(
        self,
        task_id: str,
        notification_config: TaskPushNotificationConfig,
        context: ServerCallContext,
    ) -> None:
        self._policy.validate(task_id, notification_config)
        notification_config.task_id = task_id
        if not notification_config.id:
            notification_config.id = str(uuid4())
        stored = TaskPushNotificationConfig()
        stored.CopyFrom(notification_config)
        await self._delegate.set_info(task_id, stored, context)

    async def get_info(
        self,
        task_id: str,
        context: ServerCallContext,
    ) -> list[TaskPushNotificationConfig]:
        configs = await self._delegate.get_info(task_id, context)
        return [redact_credentials(config) for config in configs]

    async def get_info_for_dispatch(
        self,
        task_id: str,
    ) -> list[TaskPushNotificationConfig]:
        return await self._delegate.get_info_for_dispatch(task_id)

    async def delete_info(
        self,
        task_id: str,
        context: ServerCallContext,
        config_id: str | None = None,
    ) -> None:
        await self._delegate.delete_info(task_id, context, config_id)


class AuthenticatedPushNotificationSender(PushNotificationSender):
    def __init__(
        self,
        client: httpx.AsyncClient | None,
        config_store: ValidatingPushNotificationConfigStore,
        policy: PushNotificationPolicy,
    ) -> None:
        self._client = client
        self._config_store = config_store
        self._policy = policy
        self._chains: dict[str, asyncio.Task[None]] = {}
        self._closed = False

    async def send_notification(
        self,
        task_id: str,
        event: PushNotificationEvent,
    ) -> None:
        if self._closed:
            return
        previous = self._chains.get(task_id)
        delivery = asyncio.create_task(
            self._deliver_after(previous, task_id, event),
            name=f"push-notification-{task_id}",
        )
        self._chains[task_id] = delivery
        delivery.add_done_callback(lambda completed: self._complete(task_id, completed))

    async def wait_for_idle(self, task_id: str) -> None:
        delivery = self._chains.get(task_id)
        if delivery is not None:
            await asyncio.shield(delivery)

    async def aclose(self) -> None:
        self._closed = True
        pending = list(set(self._chains.values()))
        if pending:
            for delivery in pending:
                delivery.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    async def _deliver_after(
        self,
        previous: asyncio.Task[None] | None,
        task_id: str,
        event: PushNotificationEvent,
    ) -> None:
        if previous is not None:
            try:
                await previous
            except Exception:
                logger.warning("Earlier push notification delivery failed")
        try:
            configs = await self._config_store.get_info_for_dispatch(task_id)
            if not configs:
                return
            payload = MessageToDict(to_stream_response(event))
            await asyncio.gather(
                *(self._dispatch(task_id, config, payload) for config in configs)
            )
        except Exception:
            logger.warning("Push notification delivery failed")

    def _complete(
        self,
        task_id: str,
        completed: asyncio.Task[None],
    ) -> None:
        if self._chains.get(task_id) is completed:
            self._chains.pop(task_id, None)
        if not completed.cancelled():
            completed.exception()

    async def _dispatch(
        self,
        task_id: str,
        config: TaskPushNotificationConfig,
        payload: dict[str, object],
    ) -> None:
        try:
            self._policy.validate(task_id, config)
            headers = {
                "Authorization": (
                    f"{config.authentication.scheme} "
                    f"{config.authentication.credentials}"
                ),
                "Content-Type": "application/a2a+json",
            }
            if self._client is not None:
                response = await self._client.post(
                    config.url,
                    json=payload,
                    headers=headers,
                    timeout=self._policy.timeout_seconds,
                    follow_redirects=False,
                )
            else:
                async with httpx.AsyncClient(
                    trust_env=False,
                    follow_redirects=False,
                    timeout=self._policy.timeout_seconds,
                ) as client:
                    response = await client.post(
                        config.url,
                        json=payload,
                        headers=headers,
                    )
            response.raise_for_status()
        except Exception:
            logger.warning("Push notification delivery failed")


def redact_credentials(
    config: TaskPushNotificationConfig,
) -> TaskPushNotificationConfig:
    redacted = TaskPushNotificationConfig()
    redacted.CopyFrom(config)
    redacted.token = ""
    if redacted.HasField("authentication"):
        redacted.authentication.credentials = ""
    return redacted
