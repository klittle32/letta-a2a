from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


MAX_BODY_BYTES = 1_048_576
TERMINAL_STATES = {
    "TASK_STATE_COMPLETED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
}
STATE_ORDER = {
    "TASK_STATE_UNSPECIFIED": 0,
    "TASK_STATE_SUBMITTED": 1,
    "TASK_STATE_WORKING": 2,
    "TASK_STATE_INPUT_REQUIRED": 3,
    "TASK_STATE_AUTH_REQUIRED": 3,
    "TASK_STATE_COMPLETED": 4,
    "TASK_STATE_FAILED": 4,
    "TASK_STATE_CANCELED": 4,
    "TASK_STATE_REJECTED": 4,
}


@dataclass
class NotificationRecord:
    fingerprint: str
    payload: dict[str, object]
    delivery_count: int = 1


class NotificationLedger:
    def __init__(self) -> None:
        self._records: dict[tuple[str, str], NotificationRecord] = {}
        self._task_fingerprints: dict[str, list[str]] = {}
        self._task_states: dict[str, str] = {}

    def record(self, payload: dict[str, object]) -> tuple[bool, str]:
        task_id, state = inspect_payload(payload)
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        key = (task_id, fingerprint)
        existing = self._records.get(key)
        if existing is not None:
            existing.delivery_count += 1
            return True, task_id

        self._records[key] = NotificationRecord(fingerprint, payload)
        self._task_fingerprints.setdefault(task_id, []).append(fingerprint)
        if state:
            current = self._task_states.get(task_id)
            if current not in TERMINAL_STATES and (
                current is None
                or STATE_ORDER.get(state, 0) >= STATE_ORDER.get(current, 0)
            ):
                self._task_states[task_id] = state
        return False, task_id

    def snapshot(self, task_id: str) -> dict[str, object]:
        records = [
            self._records[(task_id, fingerprint)]
            for fingerprint in self._task_fingerprints.get(task_id, [])
        ]
        return {
            "taskId": task_id,
            "currentState": self._task_states.get(task_id),
            "notifications": [
                {
                    "fingerprint": record.fingerprint,
                    "deliveryCount": record.delivery_count,
                    "payload": record.payload,
                }
                for record in records
            ],
        }


def create_app(callback_token: str, observer_token: str) -> Starlette:
    if not callback_token:
        raise ValueError("PUSH_CALLBACK_TOKEN is required")
    if not observer_token:
        raise ValueError("PUSH_OBSERVER_TOKEN is required")
    ledger = NotificationLedger()

    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    async def receive(request: Request) -> JSONResponse:
        expected = f"Bearer {callback_token}"
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        content_type = request.headers.get("content-type", "").split(";", 1)[0]
        if content_type not in {"application/a2a+json", "application/json"}:
            return JSONResponse(
                {"error": "unsupported content type"},
                status_code=415,
            )
        try:
            content_length = int(request.headers.get("content-length", "0") or "0")
        except ValueError:
            return JSONResponse({"error": "invalid content length"}, status_code=400)
        if content_length > MAX_BODY_BYTES:
            return JSONResponse({"error": "payload too large"}, status_code=413)
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return JSONResponse({"error": "payload too large"}, status_code=413)
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError
            duplicate, task_id = ledger.record(payload)
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "invalid A2A event"}, status_code=400)
        return JSONResponse(
            {"accepted": True, "duplicate": duplicate, "taskId": task_id},
            status_code=200 if duplicate else 202,
        )

    async def notifications(request: Request) -> JSONResponse:
        expected = f"Bearer {observer_token}"
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        task_id = request.query_params.get("taskId", "")
        if not task_id:
            return JSONResponse({"error": "taskId is required"}, status_code=400)
        return JSONResponse(ledger.snapshot(task_id))

    return Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/callbacks/a2a", receive, methods=["POST"]),
            Route("/notifications", notifications, methods=["GET"]),
        ]
    )


def inspect_payload(payload: dict[str, object]) -> tuple[str, str | None]:
    variants = [
        name
        for name in ("task", "message", "statusUpdate", "artifactUpdate")
        if name in payload
    ]
    if len(variants) != 1:
        raise ValueError("payload must contain one A2A stream variant")
    variant = variants[0]
    event = payload[variant]
    if not isinstance(event, dict):
        raise ValueError("A2A stream variant must be an object")
    task_id = event.get("id") if variant == "task" else event.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise ValueError("A2A stream variant has no task ID")
    status = event.get("status")
    state = status.get("state") if isinstance(status, dict) else None
    if variant in {"task", "statusUpdate"} and state not in STATE_ORDER:
        raise ValueError("task status has an unrecognized state")
    return task_id, state if isinstance(state, str) else None


app = create_app(
    os.environ.get("PUSH_CALLBACK_TOKEN", "a2a-lab-callback-secret"),
    os.environ.get("PUSH_OBSERVER_TOKEN", "a2a-lab-observer-secret"),
)
