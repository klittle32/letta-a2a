from __future__ import annotations

import base64
import hmac
import json
import os
import time
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote_plus
from uuid import uuid4

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


@dataclass(frozen=True)
class ClientRegistration:
    secret: str
    audience: str
    scopes: frozenset[str]
    role: str
    clock_offset_seconds: int = 0
    token_ttl_seconds: int | None = None


@dataclass(frozen=True)
class AuthServerSettings:
    issuer: str
    clients: dict[str, ClientRegistration]
    token_ttl_seconds: int = 60


class SigningKey:
    def __init__(self) -> None:
        self._private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        self.kid = uuid4().hex

    def jwk(self) -> dict[str, str]:
        numbers = self._private_key.public_key().public_numbers()
        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": self.kid,
            "n": encode_base64url(integer_bytes(numbers.n)),
            "e": encode_base64url(integer_bytes(numbers.e)),
        }

    def sign(self, claims: dict[str, object]) -> str:
        header = {"alg": "RS256", "kid": self.kid, "typ": "JWT"}
        encoded_header = encode_json(header)
        encoded_claims = encode_json(claims)
        signing_input = f"{encoded_header}.{encoded_claims}".encode()
        signature = self._private_key.sign(
            signing_input,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return f"{encoded_header}.{encoded_claims}.{encode_base64url(signature)}"


def create_app(settings: AuthServerSettings | None = None) -> Starlette:
    settings = settings or settings_from_environment()
    if not settings.issuer.startswith(("http://", "https://")):
        raise ValueError("OAUTH_ISSUER must be an HTTP(S) URL")
    if not settings.clients:
        raise ValueError("at least one OAuth client is required")
    if any(
        not registration.secret
        or not registration.audience
        or not registration.scopes
        or not registration.role
        or (
            registration.token_ttl_seconds is not None
            and registration.token_ttl_seconds <= 0
        )
        for registration in settings.clients.values()
    ):
        raise ValueError("OAuth client registrations must be complete")
    if settings.token_ttl_seconds <= 0:
        raise ValueError("OAUTH_TOKEN_TTL_SECONDS must be positive")
    issuer = settings.issuer.rstrip("/")
    signing_key = SigningKey()

    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    async def metadata(_request: Request) -> JSONResponse:
        scopes = sorted(
            {scope for client in settings.clients.values() for scope in client.scopes}
        )
        return no_store_json(
            {
                "issuer": issuer,
                "token_endpoint": f"{issuer}/token",
                "jwks_uri": f"{issuer}/jwks",
                "grant_types_supported": ["client_credentials"],
                "token_endpoint_auth_methods_supported": ["client_secret_basic"],
                "scopes_supported": scopes,
            }
        )

    async def jwks(_request: Request) -> JSONResponse:
        return no_store_json({"keys": [signing_key.jwk()]})

    async def token(request: Request) -> JSONResponse:
        credentials = parse_basic_credentials(request.headers.get("authorization", ""))
        if credentials is None:
            return oauth_error(
                "invalid_client",
                "client_secret_basic authentication is required",
                status_code=401,
                authenticate=True,
            )
        client_id, client_secret = credentials
        registration = settings.clients.get(client_id)
        if registration is None or not hmac.compare_digest(
            registration.secret,
            client_secret,
        ):
            return oauth_error(
                "invalid_client",
                "client authentication failed",
                status_code=401,
                authenticate=True,
            )

        content_type = request.headers.get("content-type", "")
        if not content_type.startswith("application/x-www-form-urlencoded"):
            return oauth_error("invalid_request", "form encoding is required")
        form = parse_qs((await request.body()).decode("utf-8"), keep_blank_values=True)
        if form_value(form, "grant_type") != "client_credentials":
            return oauth_error(
                "unsupported_grant_type",
                "only client_credentials is supported",
            )

        requested_scope = form_value(form, "scope")
        requested_scopes = frozenset(requested_scope.split())
        if not requested_scopes or not requested_scopes.issubset(registration.scopes):
            return oauth_error("invalid_scope", "the requested scope is not allowed")
        canonical_scope = " ".join(sorted(requested_scopes))
        issued_at = int(time.time()) + registration.clock_offset_seconds
        token_ttl_seconds = registration.token_ttl_seconds or settings.token_ttl_seconds
        claims = {
            "iss": issuer,
            "aud": registration.audience,
            "sub": client_id,
            "client_id": client_id,
            "azp": client_id,
            "role": registration.role,
            "scope": canonical_scope,
            "iat": issued_at,
            "nbf": issued_at,
            "exp": issued_at + token_ttl_seconds,
            "jti": str(uuid4()),
        }
        return no_store_json(
            {
                "access_token": signing_key.sign(claims),
                "token_type": "Bearer",
                "expires_in": token_ttl_seconds,
                "scope": canonical_scope,
            }
        )

    return Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route(
                "/.well-known/oauth-authorization-server",
                metadata,
                methods=["GET"],
            ),
            Route("/jwks", jwks, methods=["GET"]),
            Route("/token", token, methods=["POST"]),
        ]
    )


def settings_from_environment() -> AuthServerSettings:
    audience = os.environ.get("OAUTH_AUDIENCE", "letta-a2a-gateway")
    clients: dict[str, ClientRegistration] = {}

    def register(
        client_id_variable: str,
        client_secret_variable: str,
        *,
        default_client_id: str,
        default_client_secret: str,
        scopes: frozenset[str],
        role: str,
    ) -> None:
        client_id = os.environ.get(client_id_variable, default_client_id)
        if client_id in clients:
            raise ValueError(f"duplicate OAuth client ID: {client_id}")
        clients[client_id] = ClientRegistration(
            secret=os.environ.get(client_secret_variable, default_client_secret),
            audience=audience,
            scopes=scopes,
            role=role,
        )

    full_access = frozenset({"a2a.discover", "a2a.invoke"})
    register(
        "OAUTH_CLIENT_ID",
        "OAUTH_CLIENT_SECRET",
        default_client_id="operator-client",
        default_client_secret="operator-client-secret",
        scopes=full_access,
        role="operator",
    )
    register(
        "OAUTH_BRIDGE_CLIENT_ID",
        "OAUTH_BRIDGE_CLIENT_SECRET",
        default_client_id="bridge-client",
        default_client_secret="bridge-client-secret",
        scopes=full_access,
        role="agent",
    )
    register(
        "OAUTH_REFERENCE_CLIENT_ID",
        "OAUTH_REFERENCE_CLIENT_SECRET",
        default_client_id="reference-agent-client",
        default_client_secret="reference-agent-client-secret",
        scopes=full_access,
        role="agent",
    )
    register(
        "OAUTH_OBSERVER_CLIENT_ID",
        "OAUTH_OBSERVER_CLIENT_SECRET",
        default_client_id="observer-client",
        default_client_secret="observer-client-secret",
        scopes=frozenset({"a2a.discover"}),
        role="observer",
    )
    register(
        "OAUTH_DENIED_CLIENT_ID",
        "OAUTH_DENIED_CLIENT_SECRET",
        default_client_id="denied-invoker-client",
        default_client_secret="denied-invoker-client-secret",
        scopes=frozenset({"a2a.invoke"}),
        role="untrusted",
    )
    stale_client_secret = os.environ.get("OAUTH_STALE_CLIENT_SECRET", "")
    if stale_client_secret:
        clients["stale-client"] = ClientRegistration(
            secret=stale_client_secret,
            audience=audience,
            scopes=full_access,
            role="operator",
            clock_offset_seconds=-300,
        )

    def register_optional_agent(
        client_id_variable: str,
        client_secret_variable: str,
        *,
        default_client_id: str,
    ) -> None:
        client_secret = os.environ.get(client_secret_variable, "")
        if not client_secret:
            return
        client_id = os.environ.get(client_id_variable, default_client_id)
        if client_id in clients:
            raise ValueError(f"duplicate OAuth client ID: {client_id}")
        clients[client_id] = ClientRegistration(
            secret=client_secret,
            audience=audience,
            scopes=full_access,
            role="agent",
            token_ttl_seconds=900,
        )

    hermes_client_secret = os.environ.get("OAUTH_HERMES_CLIENT_SECRET", "")
    if hermes_client_secret:
        hermes_client_id = os.environ.get(
            "OAUTH_HERMES_CLIENT_ID",
            "hermes-client",
        )
        if hermes_client_id in clients:
            raise ValueError(f"duplicate OAuth client ID: {hermes_client_id}")
        clients[hermes_client_id] = ClientRegistration(
            secret=hermes_client_secret,
            audience=audience,
            scopes=full_access,
            role="agent",
            token_ttl_seconds=int(
                os.environ.get("OAUTH_HERMES_TOKEN_TTL_SECONDS", "900")
            ),
        )
    register_optional_agent(
        "OAUTH_LETTA_CODE_CLIENT_ID",
        "OAUTH_LETTA_CODE_CLIENT_SECRET",
        default_client_id="letta-code-client",
    )
    register_optional_agent(
        "OAUTH_CODEX_CLIENT_ID",
        "OAUTH_CODEX_CLIENT_SECRET",
        default_client_id="codex-client",
    )
    return AuthServerSettings(
        issuer=os.environ.get("OAUTH_ISSUER", "http://127.0.0.1:9000"),
        clients=clients,
        token_ttl_seconds=int(os.environ.get("OAUTH_TOKEN_TTL_SECONDS", "60")),
    )


def parse_basic_credentials(header: str) -> tuple[str, str] | None:
    scheme, separator, encoded = header.partition(" ")
    if not separator or scheme.lower() != "basic" or not encoded:
        return None
    try:
        decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    client_id, separator, client_secret = decoded.partition(":")
    if not separator or not client_id:
        return None
    return unquote_plus(client_id), unquote_plus(client_secret)


def form_value(form: dict[str, list[str]], name: str) -> str:
    values = form.get(name, [])
    return values[0] if len(values) == 1 else ""


def oauth_error(
    error: str,
    description: str,
    *,
    status_code: int = 400,
    authenticate: bool = False,
) -> JSONResponse:
    headers = {"Cache-Control": "no-store", "Pragma": "no-cache"}
    if authenticate:
        headers["WWW-Authenticate"] = 'Basic realm="token"'
    return JSONResponse(
        {"error": error, "error_description": description},
        status_code=status_code,
        headers=headers,
    )


def no_store_json(content: object) -> JSONResponse:
    return JSONResponse(
        content,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


def integer_bytes(value: int) -> bytes:
    return value.to_bytes((value.bit_length() + 7) // 8, "big")


def encode_json(value: object) -> str:
    serialized = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    return encode_base64url(serialized)


def encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


app = create_app()
