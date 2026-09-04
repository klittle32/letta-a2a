import pytest

from reference_agent.commands import CommandEngine, CommandKind


def test_echo_returns_exact_text() -> None:
    engine = CommandEngine()

    result = engine.handle("ctx-1", "echo exact response")

    assert result.kind is CommandKind.COMPLETE
    assert result.text == "exact response"


def test_stream_returns_text_for_incremental_delivery() -> None:
    result = CommandEngine().handle("ctx-1", "stream ABC")

    assert result.kind is CommandKind.STREAM
    assert result.text == "ABC"


def test_context_memory_is_isolated_and_ordered() -> None:
    engine = CommandEngine()

    assert engine.handle("ctx-1", "remember alpha").text == "remembered: alpha"
    assert engine.handle("ctx-1", "remember beta").text == "remembered: beta"
    assert engine.handle("ctx-1", "context").text == "alpha\nbeta"
    assert engine.handle("ctx-2", "context").text == "(empty)"


def test_failure_and_slow_commands_are_deterministic() -> None:
    engine = CommandEngine(max_slow_seconds=30)

    failure = engine.handle("ctx-1", "fail REFERENCE_FAILURE")
    assert failure.kind is CommandKind.FAIL
    assert failure.text == "REFERENCE_FAILURE"

    slow = engine.handle("ctx-1", "slow 12.5")
    assert slow.kind is CommandKind.SLOW
    assert slow.delay_seconds == 12.5
    assert slow.text == "slept: 12.5"


@pytest.mark.parametrize(
    "command",
    ["", "unknown value", "echo", "remember", "slow nope", "slow 31"],
)
def test_invalid_commands_fail_with_usage(command: str) -> None:
    result = CommandEngine(max_slow_seconds=30).handle("ctx-1", command)

    assert result.kind is CommandKind.FAIL
    assert result.text.startswith("usage:")
