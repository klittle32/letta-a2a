from __future__ import annotations

import re

from collections.abc import AsyncGenerator

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types


CODEWORD_PATTERN = re.compile(r"\bcodeword\s+([A-Z][A-Z0-9_-]*)\b", re.IGNORECASE)


class DeterministicTextModel(BaseLlm):
    """Provider-free model whose reply proves whether ADK supplied history."""

    model: str = "deterministic-text"

    @classmethod
    def supported_models(cls) -> list[str]:
        return [r"deterministic-text"]

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        user_messages = user_texts(llm_request)
        current = user_messages[-1] if user_messages else ""
        if current == "FAIL_DETERMINISTIC":
            raise RuntimeError("deterministic model failure")

        if "what codeword" in current.lower():
            remembered = next(
                (
                    match.group(1).upper()
                    for text in reversed(user_messages[:-1])
                    if "remember" in text.lower()
                    and (match := CODEWORD_PATTERN.search(text))
                ),
                "UNKNOWN",
            )
            reply = remembered
        elif "remember" in current.lower():
            match = CODEWORD_PATTERN.search(current)
            reply = f"STORED: {match.group(1).upper()}" if match else "UNKNOWN"
        else:
            reply = f"ADK: {current}" if current else "ADK: (empty)"

        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=reply)],
            ),
            partial=False,
            turn_complete=True,
        )


def user_texts(llm_request: LlmRequest) -> list[str]:
    messages: list[str] = []
    for content in llm_request.contents:
        if content.role != "user":
            continue
        text = "".join(
            part.text or "" for part in content.parts or [] if part.text is not None
        ).strip()
        if text:
            messages.append(text)
    return messages
