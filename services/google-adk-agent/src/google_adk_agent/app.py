from __future__ import annotations

import os

from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.agents import Agent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    ClientCredentialsOAuthFlow,
    OAuth2SecurityScheme,
    OAuthFlows,
    SecurityRequirement,
    SecurityScheme,
    StringList,
)
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from google_adk_agent.model import DeterministicTextModel
from google_adk_agent.observability import RequestObservationMiddleware


def build_agent_card(
    public_base_url: str,
    oauth_public_base_url: str,
) -> AgentCard:
    invocation_url = f"{public_base_url.rstrip('/')}/"
    oauth_base_url = oauth_public_base_url.rstrip("/")
    return AgentCard(
        name="Google ADK Conversation Agent",
        description="Small text-only Google ADK agent for A2A context continuation.",
        version="0.1.0",
        supported_interfaces=[
            AgentInterface(
                url=invocation_url,
                protocol_binding="JSONRPC",
                protocol_version="1.0",
            )
        ],
        capabilities=AgentCapabilities(
            streaming=False,
            push_notifications=False,
            extended_agent_card=False,
        ),
        security_schemes={
            "a2aOAuth": SecurityScheme(
                oauth2_security_scheme=OAuth2SecurityScheme(
                    description=(
                        "OAuth 2.0 client credentials enforced by agentgateway."
                    ),
                    flows=OAuthFlows(
                        client_credentials=ClientCredentialsOAuthFlow(
                            token_url=f"{oauth_base_url}/token",
                            scopes={
                                "a2a.discover": (
                                    "Discover an A2A agent through the lab gateway."
                                ),
                                "a2a.invoke": (
                                    "Invoke an A2A agent through the lab gateway."
                                ),
                            },
                        )
                    ),
                    oauth2_metadata_url=(
                        f"{oauth_base_url}/.well-known/oauth-authorization-server"
                    ),
                )
            )
        },
        security_requirements=[
            SecurityRequirement(schemes={"a2aOAuth": StringList(list=["a2a.invoke"])})
        ],
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="conversation-memory",
                name="Conversation memory",
                description=(
                    "Answer plain-text requests and recall prior turns when the "
                    "caller reuses an A2A context ID."
                ),
                tags=["conversation", "context", "text"],
                examples=[
                    "Remember the codeword ORCHID.",
                    "What codeword did I ask you to remember?",
                ],
                input_modes=["text/plain"],
                output_modes=["text/plain"],
            )
        ],
    )


def create_model_from_environment() -> BaseLlm:
    mode = os.environ.get("ADK_MODEL_MODE", "live")
    if mode == "fake":
        return DeterministicTextModel()
    if mode != "live":
        raise ValueError("ADK_MODEL_MODE must be 'fake' or 'live'")
    return LiteLlm(model=os.environ.get("ADK_MODEL", "openai/gpt-4.1-nano"))


def create_app(
    *,
    model: BaseLlm | None = None,
    public_base_url: str = "http://google-adk-agent:8000",
    oauth_public_base_url: str = "http://127.0.0.1:9001",
):
    root_agent = Agent(
        name="google_adk_conversation_agent",
        description="Text-only A2A conversation-continuation agent.",
        model=model or create_model_from_environment(),
        instruction=(
            "Answer in plain text. When asked to remember a codeword, retain it "
            "for a later turn in the same conversation."
        ),
    )
    session_service = InMemorySessionService()
    runner = Runner(
        app_name=root_agent.name,
        agent=root_agent,
        session_service=session_service,
    )
    application = to_a2a(
        root_agent,
        host="0.0.0.0",
        port=8000,
        protocol="http",
        agent_card=build_agent_card(public_base_url, oauth_public_base_url),
        runner=runner,
    )

    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    observations: list[dict[str, object]] = []
    application.routes.append(Route("/healthz", healthz, methods=["GET"]))
    application.add_middleware(
        RequestObservationMiddleware,
        observations=observations,
    )
    application.state.request_observations = observations
    application.state.session_service = session_service
    return application


app = create_app(
    public_base_url=os.environ.get(
        "PUBLIC_BASE_URL",
        "http://google-adk-agent:8000",
    ),
    oauth_public_base_url=os.environ.get(
        "OAUTH_PUBLIC_BASE_URL",
        "http://127.0.0.1:9001",
    ),
)
