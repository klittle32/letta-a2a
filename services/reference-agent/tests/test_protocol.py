import asyncio
from uuid import uuid4

import httpx

from reference_agent.server import create_app


async def rpc(
    client: httpx.AsyncClient,
    method: str,
    params: dict[str, object],
) -> dict[str, object]:
    response = await client.post(
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
    assert "error" not in payload, payload
    return payload


def task_from(payload: dict[str, object]) -> dict[str, object]:
    result = payload["result"]
    assert isinstance(result, dict)
    task = result.get("task", result)
    assert isinstance(task, dict)
    return task


async def send(
    client: httpx.AsyncClient,
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
    return task_from(
        await rpc(
            client,
            "SendMessage",
            {
                "message": message,
                "configuration": {"returnImmediately": True},
            },
        )
    )


async def wait_for_terminal(
    client: httpx.AsyncClient,
    task: dict[str, object],
) -> dict[str, object]:
    for _ in range(100):
        state = str(task.get("status", {}).get("state", ""))  # type: ignore[union-attr]
        if state.endswith(("COMPLETED", "FAILED", "CANCELED", "REJECTED")):
            return task
        await asyncio.sleep(0.01)
        task = task_from(await rpc(client, "GetTask", {"id": task["id"]}))
    raise AssertionError(f"task {task['id']} did not reach a terminal state")


def test_jsonrpc_tasks_cover_echo_context_and_failure() -> None:
    async def exercise() -> None:
        transport = httpx.ASGITransport(app=create_app("http://reference-agent:8090"))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            echo = await wait_for_terminal(client, await send(client, "echo EXACT"))
            assert echo["status"]["state"] == "TASK_STATE_COMPLETED"  # type: ignore[index]
            assert echo["artifacts"][0]["parts"][0]["text"] == "EXACT"  # type: ignore[index]

            remembered = await wait_for_terminal(
                client,
                await send(client, "remember CONTEXT_VALUE"),
            )
            recalled = await wait_for_terminal(
                client,
                await send(client, "context", str(remembered["contextId"])),
            )
            assert recalled["artifacts"][0]["parts"][0]["text"] == "CONTEXT_VALUE"  # type: ignore[index]

            failed = await wait_for_terminal(
                client,
                await send(client, "fail EXPECTED_FAILURE"),
            )
            assert failed["status"]["state"] == "TASK_STATE_FAILED"  # type: ignore[index]
            assert failed["status"]["message"]["parts"][0]["text"] == "EXPECTED_FAILURE"  # type: ignore[index]

    asyncio.run(exercise())


def test_canceled_task_remains_terminal_after_original_deadline() -> None:
    async def exercise() -> None:
        transport = httpx.ASGITransport(app=create_app("http://reference-agent:8090"))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            slow = await send(client, "slow 0.1")
            observed_slow = await wait_for_terminal(
                client,
                await send(client, "last-slow"),
            )
            assert observed_slow["artifacts"][0]["parts"][0]["text"] == slow["id"]  # type: ignore[index]

            canceled = task_from(await rpc(client, "CancelTask", {"id": slow["id"]}))
            assert canceled["status"]["state"] == "TASK_STATE_CANCELED"  # type: ignore[index]
            observed_cancel = await wait_for_terminal(
                client,
                await send(client, "last-canceled"),
            )
            assert observed_cancel["artifacts"][0]["parts"][0]["text"] == slow["id"]  # type: ignore[index]

            await asyncio.sleep(0.15)
            stable = task_from(await rpc(client, "GetTask", {"id": slow["id"]}))
            assert stable["status"]["state"] == "TASK_STATE_CANCELED"  # type: ignore[index]

    asyncio.run(exercise())
