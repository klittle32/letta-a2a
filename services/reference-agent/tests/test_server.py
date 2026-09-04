import asyncio

import httpx

from reference_agent.server import build_agent_card, create_app, serialize_agent_card


def test_agent_card_advertises_only_implemented_protocols() -> None:
    card = build_agent_card("http://reference-agent:8090")

    assert card.name == "Independent Reference Agent"
    assert [item.protocol_version for item in card.supported_interfaces] == [
        "1.0",
        "0.3",
    ]
    assert card.capabilities.streaming is False
    assert card.supported_interfaces[0].url == "http://reference-agent:8090/"
    bearer = card.security_schemes["a2aLabBearer"].http_auth_security_scheme
    assert bearer.scheme == "Bearer"
    assert bearer.bearer_format == "opaque"
    assert bearer.description == "Static lab-only Bearer key enforced by agentgateway."
    assert list(card.security_requirements[0].schemes) == ["a2aLabBearer"]
    assert list(card.security_requirements[0].schemes["a2aLabBearer"].list) == []
    serialized = serialize_agent_card(card)
    assert serialized["securitySchemes"] == {
        "a2aLabBearer": {
            "httpAuthSecurityScheme": {
                "description": "Static lab-only Bearer key enforced by agentgateway.",
                "scheme": "Bearer",
                "bearerFormat": "opaque",
            }
        }
    }
    assert "security" not in serialized
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
            assert (
                card.json()["securitySchemes"]["a2aLabBearer"][
                    "httpAuthSecurityScheme"
                ]["scheme"]
                == "Bearer"
            )
            assert "scheme" not in card.json()["securitySchemes"]["a2aLabBearer"]
            assert "security" not in card.json()

    asyncio.run(exercise_routes())
