"""Schedule logic tests (no Hermes imports needed)."""

from datetime import datetime, timezone

import pytest

import windows


def _dt(text: str) -> datetime:
    return datetime.fromisoformat(text).astimezone(timezone.utc)


SCHEDULES = windows.load_schedules()
DEEPSEEK = SCHEDULES["providers"]["deepseek"]
GLM = SCHEDULES["providers"]["zai-glm"]


@pytest.mark.parametrize(
    "instant,expected",
    [
        ("2026-11-03T01:00:00+00:00", True),   # Tuesday, peak window 1 opens
        ("2026-11-03T00:59:00+00:00", False),  # one minute before
        ("2026-11-03T03:59:00+00:00", True),   # last minute of window 1
        ("2026-11-03T04:00:00+00:00", False),  # window 1 closed
        ("2026-11-03T06:30:00+00:00", True),   # window 2
        ("2026-11-03T10:00:00+00:00", False),  # window 2 closed
        ("2026-11-07T02:00:00+00:00", False),  # Saturday: off-peak all day
        ("2026-11-08T07:00:00+00:00", False),  # Sunday
    ],
)
def test_deepseek_peak(instant, expected):
    assert windows.is_peak(DEEPSEEK, _dt(instant)) is expected


def test_next_change_from_offpeak_is_peak_start():
    change, becomes_peak = windows.next_change(DEEPSEEK, _dt("2026-11-03T00:00:00+00:00"))
    assert becomes_peak is True
    assert change == _dt("2026-11-03T01:00:00+00:00")


def test_next_change_from_peak_is_offpeak():
    change, becomes_peak = windows.next_change(DEEPSEEK, _dt("2026-11-03T02:00:00+00:00"))
    assert becomes_peak is False
    assert change == _dt("2026-11-03T04:00:00+00:00")


def test_friday_peak_ends_into_weekend():
    change, becomes_peak = windows.next_change(DEEPSEEK, _dt("2026-11-06T09:30:00+00:00"))
    assert becomes_peak is False
    assert change == _dt("2026-11-06T10:00:00+00:00")


def test_glm_peak_is_shanghai_afternoon_only():
    # 14:00-18:00 Asia/Shanghai == 06:00-10:00 UTC in November.
    assert windows.is_peak(GLM, _dt("2026-11-03T07:00:00+00:00")) is True
    assert windows.is_peak(GLM, _dt("2026-11-03T11:00:00+00:00")) is False
    assert windows.is_peak(GLM, _dt("2026-11-07T07:30:00+00:00")) is False  # Saturday


def test_describe_reports_state_and_source():
    text = windows.describe("deepseek", _dt("2026-11-03T00:00:00+00:00"), SCHEDULES)
    assert "OFF-PEAK" in text
    assert "peak starts" in text
    assert "01:00-04:00" in text
    assert "api-docs.deepseek.com" in text


def test_unknown_provider_is_reported():
    assert "Unknown provider" in windows.describe("nope", None, SCHEDULES)
