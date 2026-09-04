from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


USAGE = (
    "usage: echo TEXT | stream TEXT | remember TEXT | context | fail [TEXT] | "
    "slow SECONDS | ask-letta TEXT"
)


class CommandKind(Enum):
    COMPLETE = "complete"
    STREAM = "stream"
    FAIL = "fail"
    SLOW = "slow"


@dataclass(frozen=True)
class CommandResult:
    kind: CommandKind
    text: str
    delay_seconds: float = 0


class CommandEngine:
    def __init__(self, *, max_slow_seconds: float = 120) -> None:
        self._memory: dict[str, list[str]] = {}
        self._max_slow_seconds = max_slow_seconds

    def handle(self, context_id: str, text: str) -> CommandResult:
        command, separator, argument = text.strip().partition(" ")
        argument = argument.strip()

        if command == "echo" and separator and argument:
            return CommandResult(CommandKind.COMPLETE, argument)

        if command == "stream" and separator and argument:
            return CommandResult(CommandKind.STREAM, argument)

        if command == "remember" and separator and argument:
            self._memory.setdefault(context_id, []).append(argument)
            return CommandResult(CommandKind.COMPLETE, f"remembered: {argument}")

        if command == "context" and not argument:
            remembered = self._memory.get(context_id, [])
            return CommandResult(
                CommandKind.COMPLETE,
                "\n".join(remembered) if remembered else "(empty)",
            )

        if command == "fail":
            return CommandResult(
                CommandKind.FAIL,
                argument or "deterministic failure",
            )

        if command == "slow" and separator:
            try:
                seconds = float(argument)
            except ValueError:
                return CommandResult(CommandKind.FAIL, USAGE)
            if 0 <= seconds <= self._max_slow_seconds:
                return CommandResult(
                    CommandKind.SLOW,
                    f"slept: {seconds:g}",
                    seconds,
                )

        return CommandResult(CommandKind.FAIL, USAGE)
