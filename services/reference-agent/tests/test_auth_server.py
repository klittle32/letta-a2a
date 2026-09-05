import asyncio
import base64
import json
import time

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from reference_agent.auth_server import (
    AuthServerSettings,
    ClientRegistration,
    create_app,
    settings_from_environment,
)


def test_metadata_jwks_and_client_credentials_token() -> None:
    async def exercise() -> None:
        settings = AuthServerSettings(
            issuer="http://127.0.0.1:9000",
            clients={
                "operator-client": ClientRegistration(
                    secret="operator-secret",
                    audience="letta-a2a-gateway",
                    scopes=frozenset({"a2a.discover", "a2a.invoke"}),
                    role="operator",
                )
            },
            token_ttl_seconds=60,
        )
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://auth-server",
        ) as client:
            metadata = await client.get("/.well-known/oauth-authorization-server")
            assert metadata.status_code == 200
            assert metadata.json() == {
                "issuer": "http://127.0.0.1:9000",
                "token_endpoint": "http://127.0.0.1:9000/token",
                "jwks_uri": "http://127.0.0.1:9000/jwks",
                "grant_types_supported": ["client_credentials"],
                "token_endpoint_auth_methods_supported": ["client_secret_basic"],
                "scopes_supported": ["a2a.discover", "a2a.invoke"],
            }

            jwks = (await client.get("/jwks")).json()
            assert len(jwks["keys"]) == 1
            assert jwks["keys"][0]["use"] == "sig"
            assert jwks["keys"][0]["alg"] == "RS256"

            response = await client.post(
                "/token",
                auth=("operator-client", "operator-secret"),
                data={
                    "grant_type": "client_credentials",
                    "scope": "a2a.discover a2a.invoke",
                },
            )
            assert response.status_code == 200
            token_response = response.json()
            assert token_response["token_type"] == "Bearer"
            assert token_response["expires_in"] == 60
            assert token_response["scope"] == "a2a.discover a2a.invoke"
            assert response.headers["cache-control"] == "no-store"

            header, claims, signature = decode_jwt(token_response["access_token"])
            assert header["alg"] == "RS256"
            assert header["kid"] == jwks["keys"][0]["kid"]
            assert claims["iss"] == "http://127.0.0.1:9000"
            assert claims["aud"] == "letta-a2a-gateway"
            assert claims["sub"] == "operator-client"
            assert claims["client_id"] == "operator-client"
            assert claims["role"] == "operator"
            assert claims["scope"] == "a2a.discover a2a.invoke"
            assert claims["exp"] - claims["iat"] == 60
            assert claims["iat"] <= int(time.time()) <= claims["exp"]

            signing_input = ".".join(
                token_response["access_token"].split(".")[:2]
            ).encode()
            public_key = public_key_from_jwk(jwks["keys"][0])
            public_key.verify(
                signature,
                signing_input,
                padding.PKCS1v15(),
                hashes.SHA256(),
            )

    asyncio.run(exercise())


def test_token_endpoint_rejects_bad_clients_grants_and_scopes() -> None:
    async def exercise() -> None:
        settings = AuthServerSettings(
            issuer="http://127.0.0.1:9000",
            clients={
                "operator-client": ClientRegistration(
                    secret="operator-secret",
                    audience="letta-a2a-gateway",
                    scopes=frozenset({"a2a.discover", "a2a.invoke"}),
                    role="operator",
                )
            },
            token_ttl_seconds=60,
        )
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://auth-server",
        ) as client:
            wrong_secret = await client.post(
                "/token",
                auth=("operator-client", "wrong"),
                data={"grant_type": "client_credentials", "scope": "a2a.invoke"},
            )
            assert wrong_secret.status_code == 401
            assert wrong_secret.json()["error"] == "invalid_client"
            assert "operator-secret" not in wrong_secret.text

            wrong_grant = await client.post(
                "/token",
                auth=("operator-client", "operator-secret"),
                data={"grant_type": "authorization_code", "scope": "a2a.invoke"},
            )
            assert wrong_grant.status_code == 400
            assert wrong_grant.json()["error"] == "unsupported_grant_type"

            wrong_scope = await client.post(
                "/token",
                auth=("operator-client", "operator-secret"),
                data={"grant_type": "client_credentials", "scope": "admin"},
            )
            assert wrong_scope.status_code == 400
            assert wrong_scope.json()["error"] == "invalid_scope"

    asyncio.run(exercise())


def test_distinct_clients_receive_registered_identity_and_permissions() -> None:
    async def exercise() -> None:
        settings = AuthServerSettings(
            issuer="http://127.0.0.1:9000",
            clients={
                "observer-client": ClientRegistration(
                    secret="observer-secret",
                    audience="letta-a2a-gateway",
                    scopes=frozenset({"a2a.discover"}),
                    role="observer",
                ),
                "denied-invoker-client": ClientRegistration(
                    secret="denied-secret",
                    audience="letta-a2a-gateway",
                    scopes=frozenset({"a2a.invoke"}),
                    role="untrusted",
                ),
            },
        )
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://auth-server",
        ) as client:
            observer = await client.post(
                "/token",
                auth=("observer-client", "observer-secret"),
                data={"grant_type": "client_credentials", "scope": "a2a.discover"},
            )
            assert observer.status_code == 200
            observer_claims = decode_jwt(observer.json()["access_token"])[1]
            assert observer_claims["sub"] == "observer-client"
            assert observer_claims["role"] == "observer"
            assert observer_claims["scope"] == "a2a.discover"

            denied_invoker = await client.post(
                "/token",
                auth=("denied-invoker-client", "denied-secret"),
                data={"grant_type": "client_credentials", "scope": "a2a.invoke"},
            )
            assert denied_invoker.status_code == 200
            denied_claims = decode_jwt(denied_invoker.json()["access_token"])[1]
            assert denied_claims["sub"] == "denied-invoker-client"
            assert denied_claims["role"] == "untrusted"
            assert denied_claims["scope"] == "a2a.invoke"

            observer_cannot_escalate = await client.post(
                "/token",
                auth=("observer-client", "observer-secret"),
                data={"grant_type": "client_credentials", "scope": "a2a.invoke"},
            )
            assert observer_cannot_escalate.status_code == 400
            assert observer_cannot_escalate.json()["error"] == "invalid_scope"

    asyncio.run(exercise())


def test_optional_hermes_client_has_agent_permissions_and_its_own_ttl(
    monkeypatch,
) -> None:
    monkeypatch.setenv("OAUTH_HERMES_CLIENT_ID", "hermes-test-client")
    monkeypatch.setenv("OAUTH_HERMES_CLIENT_SECRET", "private-hermes-secret")
    monkeypatch.setenv("OAUTH_HERMES_TOKEN_TTL_SECONDS", "900")
    settings = settings_from_environment()

    registration = settings.clients["hermes-test-client"]
    assert registration.role == "agent"
    assert registration.scopes == frozenset({"a2a.discover", "a2a.invoke"})
    assert registration.token_ttl_seconds == 900

    async def exercise() -> None:
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://auth-server",
        ) as client:
            response = await client.post(
                "/token",
                auth=("hermes-test-client", "private-hermes-secret"),
                data={
                    "grant_type": "client_credentials",
                    "scope": "a2a.discover a2a.invoke",
                },
            )
        assert response.status_code == 200
        payload = response.json()
        claims = decode_jwt(payload["access_token"])[1]
        assert payload["expires_in"] == 900
        assert claims["exp"] - claims["iat"] == 900
        assert claims["sub"] == "hermes-test-client"
        assert claims["role"] == "agent"

    asyncio.run(exercise())


def test_hermes_client_is_not_registered_without_a_secret(monkeypatch) -> None:
    monkeypatch.delenv("OAUTH_HERMES_CLIENT_SECRET", raising=False)

    settings = settings_from_environment()

    assert "hermes-client" not in settings.clients


def decode_jwt(token: str) -> tuple[dict[str, object], dict[str, object], bytes]:
    encoded_header, encoded_claims, encoded_signature = token.split(".")
    return (
        json.loads(decode_base64url(encoded_header)),
        json.loads(decode_base64url(encoded_claims)),
        decode_base64url(encoded_signature),
    )


def decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def public_key_from_jwk(jwk: dict[str, str]) -> rsa.RSAPublicKey:
    return rsa.RSAPublicNumbers(
        e=int.from_bytes(decode_base64url(jwk["e"]), "big"),
        n=int.from_bytes(decode_base64url(jwk["n"]), "big"),
    ).public_key()
