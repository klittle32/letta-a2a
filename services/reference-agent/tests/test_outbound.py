import asyncio

import httpx
import pytest

from reference_agent.outbound import (
    ClientCredentialsTokenProvider,
    OfficialA2AClient,
    build_send_request,
)
from reference_agent.server import create_app


def test_outbound_request_marks_the_delegation_hop() -> None:
    request = build_send_request("do work", hop=1)

    assert request.configuration.return_immediately is True
    assert (
        request.metadata.fields["lettaA2aLab"].struct_value.fields["hop"].number_value
        == 1
    )


def test_outbound_request_rejects_an_invalid_hop() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        build_send_request("do work", hop=-1)


def test_official_client_discovers_sends_polls_and_extracts_results() -> None:
    async def exercise() -> None:
        target = create_app("http://remote-agent")

        def client_factory(**kwargs: object) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=target),
                base_url="http://remote-agent",
                **kwargs,
            )

        completed = await OfficialA2AClient(
            endpoint="http://remote-agent",
            token_provider=StaticTokenProvider("oauth-access-token"),
            expected_agent_name="Independent Reference Agent",
            poll_interval_seconds=0.001,
            http_client_factory=client_factory,
        ).invoke("echo FROM_EXTERNAL")

        assert completed.agent_name == "Independent Reference Agent"
        assert completed.state == "TASK_STATE_COMPLETED"
        assert completed.text == "FROM_EXTERNAL"
        assert completed.poll_count > 0

        failed = await OfficialA2AClient(
            endpoint="http://remote-agent",
            token_provider=StaticTokenProvider("oauth-access-token"),
            expected_agent_name="Independent Reference Agent",
            poll_interval_seconds=0.001,
            http_client_factory=client_factory,
        ).invoke("fail REMOTE_FAILURE")

        assert failed.state == "TASK_STATE_FAILED"
        assert failed.text == "REMOTE_FAILURE"

    asyncio.run(exercise())


def test_official_client_rejects_an_unexpected_agent_card() -> None:
    async def exercise() -> None:
        target = create_app("http://remote-agent")

        def client_factory(**kwargs: object) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=target),
                base_url="http://remote-agent",
                **kwargs,
            )

        client = OfficialA2AClient(
            endpoint="http://remote-agent",
            token_provider=StaticTokenProvider("oauth-access-token"),
            expected_agent_name="Agent A",
            http_client_factory=client_factory,
        )

        try:
            await client.invoke("echo should-not-run")
        except ValueError as error:
            assert "expected Agent A" in str(error)
        else:
            raise AssertionError("unexpected Agent Card was accepted")

    asyncio.run(exercise())


def test_official_client_applies_one_deadline_to_the_whole_invocation() -> None:
    async def exercise() -> None:
        target = create_app("http://remote-agent")
        request_started = asyncio.Event()
        request_finished_delay = asyncio.Event()

        async def delayed_target(
            scope: dict[str, object],
            receive: object,
            send: object,
        ) -> None:
            request_started.set()
            await asyncio.sleep(0.03)
            request_finished_delay.set()
            await target(scope, receive, send)  # type: ignore[arg-type]

        def client_factory(**kwargs: object) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=delayed_target),
                base_url="http://remote-agent",
                **kwargs,
            )

        client = OfficialA2AClient(
            endpoint="http://remote-agent",
            token_provider=StaticTokenProvider("oauth-access-token"),
            expected_agent_name="Independent Reference Agent",
            poll_interval_seconds=0.001,
            timeout_seconds=0.01,
            http_client_factory=client_factory,
        )

        with pytest.raises(TimeoutError):
            await client.invoke("slow 1")
        assert request_started.is_set()
        assert not request_finished_delay.is_set()

    asyncio.run(exercise())


def test_client_credentials_provider_caches_and_refreshes_tokens() -> None:
    async def exercise() -> None:
        request_count = 0
        now = 1_000.0

        async def token_endpoint(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            request_count += 1
            assert request.headers["authorization"] == (
                "Basic b3BlcmF0b3ItY2xpZW50Om9wZXJhdG9yLXNlY3JldA=="
            )
            assert request.content.decode() == (
                "grant_type=client_credentials&scope=a2a.invoke"
            )
            return httpx.Response(
                200,
                json={
                    "access_token": f"access-{request_count}",
                    "token_type": "Bearer",
                    "expires_in": 60,
                    "scope": "a2a.invoke",
                },
            )

        provider = ClientCredentialsTokenProvider(
            token_url="http://auth-server/token",
            client_id="operator-client",
            client_secret="operator-secret",
            scope="a2a.invoke",
            refresh_skew_seconds=5,
            http_client_factory=lambda **kwargs: httpx.AsyncClient(
                transport=httpx.MockTransport(token_endpoint),
                **kwargs,
            ),
            clock=lambda: now,
        )

        assert await provider.get_access_token() == "access-1"
        assert await provider.get_access_token() == "access-1"
        assert request_count == 1

        now += 56
        assert await provider.get_access_token() == "access-2"
        assert request_count == 2

    asyncio.run(exercise())


def test_invocation_deadline_cancels_an_inflight_token_exchange() -> None:
    async def exercise() -> None:
        exchange_started = asyncio.Event()
        exchange_canceled = asyncio.Event()

        async def hanging_token_endpoint(_request: httpx.Request) -> httpx.Response:
            exchange_started.set()
            try:
                await asyncio.sleep(60)
            finally:
                exchange_canceled.set()
            raise AssertionError("canceled token exchange resumed")

        token_provider = ClientCredentialsTokenProvider(
            token_url="http://auth-server/token",
            client_id="operator-client",
            client_secret="operator-secret",
            scope="a2a.invoke",
            http_client_factory=lambda **kwargs: httpx.AsyncClient(
                transport=httpx.MockTransport(hanging_token_endpoint),
                **kwargs,
            ),
        )
        target = create_app("http://remote-agent")

        def client_factory(**kwargs: object) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=target),
                base_url="http://remote-agent",
                **kwargs,
            )

        client = OfficialA2AClient(
            endpoint="http://remote-agent",
            token_provider=token_provider,
            expected_agent_name="Independent Reference Agent",
            timeout_seconds=0.01,
            http_client_factory=client_factory,
        )

        with pytest.raises(TimeoutError):
            await client.invoke("echo should-not-run")
        assert exchange_started.is_set()
        assert exchange_canceled.is_set()

    asyncio.run(exercise())


class StaticTokenProvider:
    def __init__(self, token: str) -> None:
        self._token = token

    async def get_access_token(self) -> str:
        return self._token
