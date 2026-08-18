from __future__ import annotations

import asyncio
import os

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Part,
    Task,
    TaskState,
    TaskStatus,
)
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from reference_agent.commands import CommandEngine, CommandKind


class ReferenceAgentExecutor(AgentExecutor):
    def __init__(self, engine: CommandEngine | None = None) -> None:
        self._engine = engine or CommandEngine()

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
        result = self._engine.handle(context_id, context.get_user_input())

        if result.kind is CommandKind.SLOW:
            await asyncio.sleep(result.delay_seconds)

        if result.kind is CommandKind.FAIL:
            await updater.failed(
                message=updater.new_agent_message(parts=[Part(text=result.text)])
            )
            return

        await updater.add_artifact(
            artifact_id="response",
            name="response",
            parts=[Part(text=result.text)],
            append=False,
            last_chunk=True,
        )
        await updater.complete()

    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        updater = TaskUpdater(
            event_queue,
            context.task_id or "",
            context.context_id or "",
        )
        await updater.cancel(
            message=updater.new_agent_message(parts=[Part(text="canceled")])
        )


def build_agent_card(public_base_url: str) -> AgentCard:
    base_url = public_base_url.rstrip("/")
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
            streaming=False,
            push_notifications=False,
            extended_agent_card=False,
        ),
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="deterministic-interoperability",
                name="Deterministic interoperability commands",
                description="Echo, context memory, failure, delay, and cancellation.",
                tags=["a2a", "testing", "deterministic"],
                examples=[
                    "echo hello",
                    "remember alpha",
                    "context",
                    "fail expected failure",
                    "slow 30",
                ],
                input_modes=["text/plain"],
                output_modes=["text/plain"],
            )
        ],
    )


async def healthz(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def create_app(public_base_url: str) -> Starlette:
    card = build_agent_card(public_base_url)
    handler = DefaultRequestHandler(
        agent_executor=ReferenceAgentExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    return Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            *create_agent_card_routes(card),
            *create_jsonrpc_routes(
                handler,
                "/",
                enable_v0_3_compat=True,
            ),
        ]
    )


app = create_app(
    os.environ.get("PUBLIC_BASE_URL", "http://reference-agent:8090")
)
