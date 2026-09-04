from __future__ import annotations

import asyncio
import os

from contextlib import asynccontextmanager

import httpx

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    ClientCredentialsOAuthFlow,
    OAuth2SecurityScheme,
    OAuthFlows,
    Part,
    SecurityRequirement,
    SecurityScheme,
    StringList,
    Task,
    TaskState,
    TaskStatus,
)
from google.protobuf.json_format import MessageToDict
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from reference_agent.commands import CommandEngine, CommandKind, CommandResult
from reference_agent.outbound import (
    ClientCredentialsTokenProvider,
    OfficialA2AClient,
    OutboundA2AClient,
)
from reference_agent.push_notifications import (
    AuthenticatedPushNotificationSender,
    PushNotificationPolicy,
    ValidatingPushNotificationConfigStore,
)


class ReferenceAgentExecutor(AgentExecutor):
    def __init__(
        self,
        engine: CommandEngine | None = None,
        outbound_client: OutboundA2AClient | None = None,
    ) -> None:
        self._engine = engine or CommandEngine()
        self._outbound_client = outbound_client
        self._last_slow_task_id: str | None = None
        self._last_canceled_task_id: str | None = None

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        task_id = context.task_id or ""
        context_id = context.context_id or ""
        history = [context.message] if context.message is not None else []
        await event_queue.enqueue_event(
            Task(
                id=task_id,
                context_id=context_id,
                status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
                history=history,
            )
        )

        updater = TaskUpdater(event_queue, task_id, context_id)
        await updater.start_work()
        text = context.get_user_input().strip()
        command, separator, argument = text.partition(" ")
        argument = argument.strip()
        if command == "ask-letta" and separator and argument:
            result = await self._invoke_letta(argument)
        elif text == "last-slow":
            result = CommandResult(
                CommandKind.COMPLETE,
                self._last_slow_task_id or "(none)",
            )
        elif text == "last-canceled":
            result = CommandResult(
                CommandKind.COMPLETE,
                self._last_canceled_task_id or "(none)",
            )
        else:
            result = self._engine.handle(context_id, text)

        if result.kind is CommandKind.SLOW:
            self._last_slow_task_id = task_id
            await asyncio.sleep(result.delay_seconds)

        if result.kind is CommandKind.FAIL:
            await updater.failed(
                message=updater.new_agent_message(parts=[Part(text=result.text)])
            )
            return

        chunks = (
            list(result.text) if result.kind is CommandKind.STREAM else [result.text]
        )
        for index, chunk in enumerate(chunks):
            await updater.add_artifact(
                artifact_id="response",
                name="response",
                parts=[Part(text=chunk)],
                append=index > 0,
                last_chunk=index == len(chunks) - 1,
            )
        await updater.complete()

    async def _invoke_letta(self, message: str) -> CommandResult:
        if self._outbound_client is None:
            return CommandResult(CommandKind.FAIL, "Letta delegation is not configured")
        try:
            remote = await self._outbound_client.invoke(message)
        except Exception as error:
            return CommandResult(
                CommandKind.FAIL,
                f"Agent A delegation failed: {error}",
            )
        if remote.state != "TASK_STATE_COMPLETED":
            detail = remote.text or "no failure detail"
            return CommandResult(
                CommandKind.FAIL,
                f"{remote.agent_name} {remote.state}: {detail}",
            )
        return CommandResult(CommandKind.COMPLETE, remote.text)

    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        self._last_canceled_task_id = context.task_id or ""
        updater = TaskUpdater(
            event_queue,
            context.task_id or "",
            context.context_id or "",
        )
        await updater.cancel(
            message=updater.new_agent_message(parts=[Part(text="canceled")])
        )


def build_agent_card(
    public_base_url: str,
    *,
    oauth_public_base_url: str,
) -> AgentCard:
    base_url = public_base_url.rstrip("/")
    oauth_base_url = oauth_public_base_url.rstrip("/")
    invocation_url = f"{base_url}/"
    return AgentCard(
        name="Independent Reference Agent",
        description="Deterministic non-Letta A2A interoperability fixture.",
        version="0.1.0",
        supported_interfaces=[
            AgentInterface(
                url=invocation_url,
                protocol_binding="JSONRPC",
                protocol_version="1.0",
            ),
            AgentInterface(
                url=invocation_url,
                protocol_binding="JSONRPC",
                protocol_version="0.3",
            ),
        ],
        capabilities=AgentCapabilities(
            streaming=True,
            push_notifications=True,
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
                id="deterministic-interoperability",
                name="Deterministic interoperability commands",
                description=(
                    "Echo, ordered streaming, context memory, failure, delay, "
                    "cancellation, and test observations."
                ),
                tags=["a2a", "testing", "deterministic"],
                examples=[
                    "echo hello",
                    "stream hello",
                    "remember alpha",
                    "context",
                    "fail expected failure",
                    "slow 30",
                    "last-slow",
                    "last-canceled",
                ],
                input_modes=["text/plain"],
                output_modes=["text/plain"],
            ),
            AgentSkill(
                id="letta-delegation",
                name="Delegate to Letta",
                description=(
                    "Discover Agent A, send it an asynchronous A2A task, "
                    "poll to completion, and return its text artifact."
                ),
                tags=["a2a", "letta", "delegation"],
                examples=["ask-letta Reply with exactly hello"],
                input_modes=["text/plain"],
                output_modes=["text/plain"],
            ),
        ],
    )


def serialize_agent_card(card: AgentCard) -> dict[str, object]:
    """Serialize the 1.0 card without the SDK helper's legacy field injection."""
    return MessageToDict(card)


async def healthz(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def create_app(
    public_base_url: str,
    *,
    oauth_public_base_url: str = "http://127.0.0.1:9000",
    outbound_client: OutboundA2AClient | None = None,
    push_http_client: httpx.AsyncClient | None = None,
    push_callback_url: str = "http://webhook-receiver:8100/callbacks/a2a",
    push_callback_token: str = "a2a-lab-callback-secret",
) -> Starlette:
    card = build_agent_card(
        public_base_url,
        oauth_public_base_url=oauth_public_base_url,
    )
    if outbound_client is None:
        token_provider = ClientCredentialsTokenProvider(
            token_url=os.environ.get(
                "OAUTH_TOKEN_URL",
                "http://auth-server:9000/token",
            ),
            client_id=os.environ.get("OAUTH_CLIENT_ID", "reference-agent-client"),
            client_secret=os.environ.get(
                "OAUTH_CLIENT_SECRET",
                "reference-agent-client-secret",
            ),
            scope=os.environ.get("OAUTH_SCOPE", "a2a.discover a2a.invoke"),
        )
        outbound_client = OfficialA2AClient(
            endpoint=os.environ.get(
                "A2A_LETTA_URL",
                "http://agentgateway:4000/a2a/agent-a",
            ),
            token_provider=token_provider,
            expected_agent_name="Agent A",
        )
    push_policy = PushNotificationPolicy(
        callback_url=push_callback_url,
        bearer_token=push_callback_token,
    )
    push_store = ValidatingPushNotificationConfigStore(push_policy)
    owns_push_http_client = push_http_client is None
    if push_http_client is None:
        push_http_client = httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            timeout=push_policy.timeout_seconds,
        )
    push_sender = AuthenticatedPushNotificationSender(
        push_http_client,
        push_store,
        push_policy,
    )
    handler = DefaultRequestHandler(
        agent_executor=ReferenceAgentExecutor(outbound_client=outbound_client),
        task_store=InMemoryTaskStore(),
        agent_card=card,
        push_config_store=push_store,
        push_sender=push_sender,
    )

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        try:
            yield
        finally:
            try:
                await handler.aclose()
            finally:
                try:
                    await push_sender.aclose()
                finally:
                    if owns_push_http_client:
                        await push_http_client.aclose()

    async def get_agent_card(_request: Request) -> JSONResponse:
        return JSONResponse(serialize_agent_card(card))

    application = Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route(
                "/.well-known/agent-card.json",
                get_agent_card,
                methods=["GET"],
            ),
            *create_jsonrpc_routes(
                handler,
                "/",
                enable_v0_3_compat=True,
            ),
        ],
        lifespan=lifespan,
    )
    application.state.a2a_handler = handler
    application.state.push_http_client = push_http_client
    application.state.push_sender = push_sender
    return application


app = create_app(
    os.environ.get("PUBLIC_BASE_URL", "http://reference-agent:8090"),
    oauth_public_base_url=os.environ.get(
        "OAUTH_PUBLIC_BASE_URL",
        "http://127.0.0.1:9000",
    ),
    push_callback_url=os.environ.get(
        "PUSH_CALLBACK_URL",
        "http://webhook-receiver:8100/callbacks/a2a",
    ),
    push_callback_token=os.environ.get(
        "PUSH_CALLBACK_TOKEN",
        "a2a-lab-callback-secret",
    ),
)
