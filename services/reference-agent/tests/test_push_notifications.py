import asyncio
import json

import httpx
import pytest

from a2a.server.context import ServerCallContext
from a2a.types import (
    AuthenticationInfo,
    TaskPushNotificationConfig,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
)
from a2a.utils.errors import InvalidParamsError

from reference_agent.push_notifications import (
    AuthenticatedPushNotificationSender,
    PushNotificationPolicy,
    ValidatingPushNotificationConfigStore,
)


CALLBACK_URL = "http://webhook-receiver:8100/callbacks/a2a"
CALLBACK_TOKEN = "callback-secret"


def policy() -> PushNotificationPolicy:
    return PushNotificationPolicy(
        callback_url=CALLBACK_URL,
        bearer_token=CALLBACK_TOKEN,
        timeout_seconds=1,
    )


def push_config(**overrides: object) -> TaskPushNotificationConfig:
    values: dict[str, object] = {
        "id": "callback-1",
        "task_id": "task-1",
        "url": CALLBACK_URL,
        "authentication": AuthenticationInfo(
            scheme="Bearer",
            credentials=CALLBACK_TOKEN,
        ),
    }
    values.update(overrides)
    return TaskPushNotificationConfig(**values)


def test_store_accepts_exact_callback_and_redacts_user_reads() -> None:
    async def exercise() -> None:
        store = ValidatingPushNotificationConfigStore(policy())
        config = push_config(task_id="")

        await store.set_info("task-1", config, ServerCallContext())

        assert config.task_id == "task-1"
        visible = await store.get_info("task-1", ServerCallContext())
        assert len(visible) == 1
        assert visible[0].authentication.scheme == "Bearer"
        assert visible[0].authentication.credentials == ""
        dispatch = await store.get_info_for_dispatch("task-1")
        assert dispatch[0].authentication.credentials == CALLBACK_TOKEN

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "config",
    [
        push_config(url="http://169.254.169.254/latest/meta-data"),
        push_config(url=f"{CALLBACK_URL}?redirect=internal"),
        push_config(url=f"{CALLBACK_URL}#fragment"),
        push_config(
            authentication=AuthenticationInfo(
                scheme="Basic", credentials=CALLBACK_TOKEN
            )
        ),
        push_config(
            authentication=AuthenticationInfo(
                scheme="bearer", credentials=CALLBACK_TOKEN
            )
        ),
        push_config(
            authentication=AuthenticationInfo(scheme="Bearer", credentials="wrong")
        ),
        push_config(token=CALLBACK_TOKEN),
        push_config(task_id="other-task"),
    ],
)
def test_store_rejects_callback_confusion_and_ssrf(
    config: TaskPushNotificationConfig,
) -> None:
    async def exercise() -> None:
        store = ValidatingPushNotificationConfigStore(policy())
        with pytest.raises(InvalidParamsError):
            await store.set_info("task-1", config, ServerCallContext())
        assert await store.get_info("task-1", ServerCallContext()) == []

    asyncio.run(exercise())


def test_sender_uses_bearer_a2a_json_and_contains_delivery_failure() -> None:
    async def exercise() -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(503)

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
            trust_env=False,
        )
        store = ValidatingPushNotificationConfigStore(policy())
        await store.set_info("task-1", push_config(), ServerCallContext())
        sender = AuthenticatedPushNotificationSender(client, store, policy())
        event = TaskStatusUpdateEvent(
            task_id="task-1",
            context_id="context-1",
            status=TaskStatus(state=TaskState.TASK_STATE_COMPLETED),
        )

        await sender.send_notification("task-1", event)
        await sender.wait_for_idle("task-1")

        assert len(requests) == 1
        assert requests[0].headers["authorization"] == f"Bearer {CALLBACK_TOKEN}"
        assert requests[0].headers["content-type"] == "application/a2a+json"
        assert json.loads(requests[0].content)["statusUpdate"]["status"]["state"] == (
            "TASK_STATE_COMPLETED"
        )
        await client.aclose()

    asyncio.run(exercise())


def test_sender_returns_before_delivery_and_preserves_per_task_order() -> None:
    async def exercise() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()
        states: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            states.append(
                json.loads(request.content)["statusUpdate"]["status"]["state"]
            )
            if len(states) == 1:
                entered.set()
                await release.wait()
            return httpx.Response(204)

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
            trust_env=False,
        )
        store = ValidatingPushNotificationConfigStore(policy())
        await store.set_info("task-1", push_config(), ServerCallContext())
        sender = AuthenticatedPushNotificationSender(client, store, policy())

        await sender.send_notification(
            "task-1",
            status_event(TaskState.TASK_STATE_WORKING),
        )
        await asyncio.wait_for(entered.wait(), timeout=1)
        await sender.send_notification(
            "task-1",
            status_event(TaskState.TASK_STATE_COMPLETED),
        )
        await asyncio.sleep(0)
        assert states == ["TASK_STATE_WORKING"]

        release.set()
        await sender.wait_for_idle("task-1")
        assert states == ["TASK_STATE_WORKING", "TASK_STATE_COMPLETED"]
        await client.aclose()

    asyncio.run(exercise())


def status_event(state: TaskState) -> TaskStatusUpdateEvent:
    return TaskStatusUpdateEvent(
        task_id="task-1",
        context_id="context-1",
        status=TaskStatus(state=state),
    )
