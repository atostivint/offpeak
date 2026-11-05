"""Hermes plugin: peak/off-peak pricing windows for LLM providers."""

from __future__ import annotations

from datetime import datetime, timezone

from . import windows

TOOL_SCHEMA = {
    "name": "offpeak_status",
    "description": (
        "Report whether a provider is currently in its peak (2x) or off-peak (half price) "
        "billing window, when the next change happens, and the local time of the windows. "
        "Knows DeepSeek (UTC windows, tokens) and Z.ai GLM (Asia/Shanghai, Coding Plan points). "
        "Use it before starting a batch of expensive work with a model that has time-based pricing."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "Provider id, or 'all'. Defaults to deepseek.",
                "enum": ["deepseek", "zai-glm", "all"],
            },
            "at": {
                "type": "string",
                "description": (
                    "Optional ISO-8601 instant to evaluate instead of now, "
                    "e.g. 2026-11-04T02:30:00Z."
                ),
            },
        },
        "required": [],
    },
}


def _parse_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    value = raw.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def offpeak_status(args: dict | None = None) -> str:
    args = args or {}
    provider = (args.get("provider") or windows.DEFAULT_PROVIDER).strip().lower()
    try:
        when = _parse_at(args.get("at"))
    except ValueError as exc:
        return f"Invalid 'at' value: {exc}"
    if provider == "all":
        return windows.all_providers(when)
    return windows.describe(provider, when)


def _command(raw_args: str) -> str:
    provider = (raw_args or "").strip().lower() or windows.DEFAULT_PROVIDER
    return offpeak_status({"provider": provider})


def register(ctx):
    ctx.register_tool(
        name="offpeak_status",
        toolset="offpeak",
        schema=TOOL_SCHEMA,
        handler=offpeak_status,
        description="Provider peak/off-peak pricing windows (DeepSeek, GLM).",
        emoji="\u23f0",
    )
    ctx.register_command(
        name="offpeak",
        handler=_command,
        description="Show current peak/off-peak window and the next switch.",
        args_hint="[deepseek|zai-glm|all]",
    )
