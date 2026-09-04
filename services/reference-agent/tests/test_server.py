import asyncio

import httpx

from reference_agent.server import build_agent_card, create_app


def test_agent_card_advertises_only_implemented_protocols() -> None:
    card = build_agent_card("http://reference-agent:8090")

    assert card.name == "Independent Reference Agent"
    assert [item.protocol_version for item in card.supported_interfaces] == [
        "1.0",
        "0.3",
    ]
    assert card.capabilities.streaming is False
    assert card.supported_interfaces[0].url == "http://reference-agent:8090/"
    delegation = next(skill for skill in card.skills if skill.id == "letta-delegation")
    assert delegation.examples == ["ask-letta Reply with exactly hello"]


def test_health_and_agent_card_routes() -> None:
    async def exercise_routes() -> None:
        transport = httpx.ASGITransport(app=create_app("http://reference-agent:8090"))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            health = await client.get("/healthz")
            assert health.json() == {"status": "ok"}

            card = await client.get("/.well-known/agent-card.json")
            assert card.status_code == 200
            assert card.json()["name"] == "Independent Reference Agent"

    asyncio.run(exercise_routes())
