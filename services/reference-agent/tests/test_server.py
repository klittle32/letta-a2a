import asyncio

import httpx

from reference_agent.server import build_agent_card, create_app, serialize_agent_card


def test_agent_card_advertises_only_implemented_protocols() -> None:
    card = build_agent_card(
        "http://reference-agent:8090",
        oauth_public_base_url="http://127.0.0.1:9000",
    )

    assert card.name == "Independent Reference Agent"
    assert [item.protocol_version for item in card.supported_interfaces] == [
        "1.0",
        "0.3",
    ]
    assert card.capabilities.streaming is False
    assert card.supported_interfaces[0].url == "http://reference-agent:8090/"
    oauth = card.security_schemes["a2aOAuth"].oauth2_security_scheme
    assert oauth.description == "OAuth 2.0 client credentials enforced by agentgateway."
    assert oauth.oauth2_metadata_url == (
        "http://127.0.0.1:9000/.well-known/oauth-authorization-server"
    )
    assert oauth.flows.client_credentials.token_url == "http://127.0.0.1:9000/token"
    assert oauth.flows.client_credentials.scopes == {
        "a2a.discover": "Discover an A2A agent through the lab gateway.",
        "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
    }
    assert list(card.security_requirements[0].schemes) == ["a2aOAuth"]
    assert list(card.security_requirements[0].schemes["a2aOAuth"].list) == [
        "a2a.invoke"
    ]
    serialized = serialize_agent_card(card)
    assert serialized["securitySchemes"] == {
        "a2aOAuth": {
            "oauth2SecurityScheme": {
                "description": (
                    "OAuth 2.0 client credentials enforced by agentgateway."
                ),
                "flows": {
                    "clientCredentials": {
                        "tokenUrl": "http://127.0.0.1:9000/token",
                        "scopes": {
                            "a2a.discover": (
                                "Discover an A2A agent through the lab gateway."
                            ),
                            "a2a.invoke": (
                                "Invoke an A2A agent through the lab gateway."
                            ),
                        },
                    }
                },
                "oauth2MetadataUrl": (
                    "http://127.0.0.1:9000/.well-known/oauth-authorization-server"
                ),
            }
        }
    }
    assert "security" not in serialized
    delegation = next(skill for skill in card.skills if skill.id == "letta-delegation")
    assert delegation.examples == ["ask-letta Reply with exactly hello"]


def test_health_and_agent_card_routes() -> None:
    async def exercise_routes() -> None:
        transport = httpx.ASGITransport(
            app=create_app(
                "http://reference-agent:8090",
                oauth_public_base_url="http://127.0.0.1:9000",
            )
        )
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
                card.json()["securitySchemes"]["a2aOAuth"]["oauth2SecurityScheme"][
                    "flows"
                ]["clientCredentials"]["tokenUrl"]
                == "http://127.0.0.1:9000/token"
            )
            assert "scheme" not in card.json()["securitySchemes"]["a2aOAuth"]
            assert "security" not in card.json()

    asyncio.run(exercise_routes())
