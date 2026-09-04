import asyncio

import httpx

from reference_agent.webhook_receiver import create_app
from reference_agent.webhook_receiver import MAX_BODY_BYTES


TOKEN = "receiver-secret"
OBSERVER_TOKEN = "observer-secret"


def test_receiver_authenticates_deduplicates_and_keeps_terminal_state() -> None:
    async def exercise() -> None:
        transport = httpx.ASGITransport(app=create_app(TOKEN, OBSERVER_TOKEN))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            payload = terminal_payload()
            missing = await client.post("/callbacks/a2a", json=payload)
            wrong = await client.post(
                "/callbacks/a2a",
                headers={"Authorization": "Bearer wrong"},
                json=payload,
            )
            assert missing.status_code == 401
            assert wrong.status_code == 401

            headers = {
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/a2a+json",
            }
            first = await client.post("/callbacks/a2a", headers=headers, json=payload)
            duplicate = await client.post(
                "/callbacks/a2a", headers=headers, json=payload
            )
            late_working = await client.post(
                "/callbacks/a2a",
                headers=headers,
                json=working_payload(),
            )
            assert first.status_code == 202
            assert duplicate.status_code == 200
            assert late_working.status_code == 202

            unauthenticated = await client.get(
                "/notifications", params={"taskId": "task-1"}
            )
            assert unauthenticated.status_code == 401
            observed = await client.get(
                "/notifications",
                params={"taskId": "task-1"},
                headers={"Authorization": f"Bearer {OBSERVER_TOKEN}"},
            )
            body = observed.json()
            assert body["currentState"] == "TASK_STATE_COMPLETED"
            assert len(body["notifications"]) == 2
            terminal = next(
                item
                for item in body["notifications"]
                if item["payload"]["statusUpdate"]["status"]["state"]
                == "TASK_STATE_COMPLETED"
            )
            assert terminal["deliveryCount"] == 2
            assert TOKEN not in str(body)

    asyncio.run(exercise())


def test_receiver_rejects_unsupported_malformed_and_oversized_payloads() -> None:
    async def exercise() -> None:
        transport = httpx.ASGITransport(app=create_app(TOKEN, OBSERVER_TOKEN))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            auth = {"Authorization": f"Bearer {TOKEN}"}
            unsupported = await client.post(
                "/callbacks/a2a",
                headers={**auth, "Content-Type": "text/plain"},
                content=b"{}",
            )
            malformed = await client.post(
                "/callbacks/a2a",
                headers={**auth, "Content-Type": "application/a2a+json"},
                content=b'{"unknown": {}}',
            )
            oversized = await client.post(
                "/callbacks/a2a",
                headers={**auth, "Content-Type": "application/a2a+json"},
                content=b"x" * (MAX_BODY_BYTES + 1),
            )

            assert unsupported.status_code == 415
            assert malformed.status_code == 400
            assert oversized.status_code == 413

    asyncio.run(exercise())


def terminal_payload() -> dict[str, object]:
    return {
        "statusUpdate": {
            "taskId": "task-1",
            "contextId": "context-1",
            "status": {"state": "TASK_STATE_COMPLETED"},
        }
    }


def working_payload() -> dict[str, object]:
    return {
        "statusUpdate": {
            "taskId": "task-1",
            "contextId": "context-1",
            "status": {"state": "TASK_STATE_WORKING"},
        }
    }
