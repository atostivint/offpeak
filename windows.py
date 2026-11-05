"""Provider peak/off-peak pricing windows.

Pure standard library: no Hermes imports, so the logic is testable on its own.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_FILE = Path(__file__).with_name("data") / "schedules.json"
LOCAL_TZ = "Europe/Paris"
DEFAULT_PROVIDER = "deepseek"


def load_schedules(path: Path | str | None = None) -> dict:
    """Return the parsed schedule file ({"providers": {...}})."""
    with open(path or DATA_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _fmt_window(start: int, end: int) -> str:
    return f"{start // 60:02d}:{start % 60:02d}-{end // 60:02d}:{end % 60:02d}"


def is_peak(schedule: dict, when: datetime) -> bool:
    """True when `when` falls inside a peak window of the provider's own clock."""
    local = when.astimezone(ZoneInfo(schedule["timezone"]))
    minute_of_day = local.hour * 60 + local.minute
    weekday = local.weekday()
    for window in schedule["peak_windows"]:
        start, end = _minutes(window["start"]), _minutes(window["end"])
        days = window["days"]
        if end > start:
            if weekday in days and start <= minute_of_day < end:
                return True
        else:  # window crosses midnight, so it may have opened the previous day
            if weekday in days and minute_of_day >= start:
                return True
            if (weekday - 1) % 7 in days and minute_of_day < end:
                return True
    return False


def next_change(schedule: dict, when: datetime) -> tuple[datetime, bool]:
    """Return (instant of the next transition, becomes_peak)."""
    current = is_peak(schedule, when)
    probe = when.replace(second=0, microsecond=0)
    # A week of minutes covers every weekly-repeating schedule.
    for _ in range(8 * 24 * 60):
        probe += timedelta(minutes=1)
        if is_peak(schedule, probe) != current:
            return probe.replace(second=0, microsecond=0), not current
    raise RuntimeError("schedule never changes state within 8 days")


def _local(instant: datetime) -> str:
    return instant.astimezone(ZoneInfo(LOCAL_TZ)).strftime("%a %d %b %H:%M %Z")


def describe(provider: str, when: datetime | None = None, schedules: dict | None = None) -> str:
    """Human-readable status block for one provider."""
    schedules = schedules or load_schedules()
    providers = schedules["providers"]
    if provider not in providers:
        return f"Unknown provider {provider!r}. Known: {', '.join(sorted(providers))}."
    schedule = providers[provider]
    now = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
    peak = is_peak(schedule, now)
    change, becomes_peak = next_change(schedule, now)
    minutes = int((change - now).total_seconds() // 60)

    tz = ZoneInfo(schedule["timezone"])
    peak_label = schedule.get("peak_label", "2x rates")
    offpeak_label = schedule.get("offpeak_label", "half rates")
    state = f"PEAK ({peak_label})" if peak else f"OFF-PEAK ({offpeak_label})"
    lines = [
        f"{schedule['label']}: {state}",
        f"Now: {_local(now)} / {now.astimezone(tz).strftime('%H:%M')} {schedule['timezone']}",
        "Peak windows (%s, Mon-Fri): %s" % (
            schedule["timezone"],
            ", ".join(
                _fmt_window(_minutes(w["start"]), _minutes(w["end"]))
                for w in schedule["peak_windows"]
            ),
        ),
        f"Next change: {'peak starts' if becomes_peak else 'off-peak starts'} "
        f"in {minutes // 60}h{minutes % 60:02d} ({_local(change)})",
    ]
    for model, rates in sorted(schedule.get("models", {}).items()):
        if rates.get("peak") and rates.get("offpeak"):
            lines.append(
                f"  {model}: peak {rates['peak']['input']:.2f}/"
                f"{rates['peak']['output']:.2f} — off-peak "
                f"{rates['offpeak']['input']:.2f}/{rates['offpeak']['output']:.2f} "
                f"({schedule['unit']}, in/out)"
            )
    for note in schedule.get("notes", []):
        lines.append(f"Note: {note}")
    lines.append(f"Rates verified {schedule['verified']} — source: {schedule['source']}")
    return "\n".join(lines)


def all_providers(when: datetime | None = None) -> str:
    schedules = load_schedules()
    return "\n\n".join(
        describe(name, when, schedules) for name in sorted(schedules["providers"])
    )
