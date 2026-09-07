import pytest
from test_automation import response
from test_career import CAREER
from test_career import career as career

from job_helper_api.database import now_ms


@pytest.mark.parametrize("window", ["7", "14", "30", None])
def test_get_analytics_converts_only_supported_query_windows(career, window):
    cutoff = now_ms() - 1000
    params = {"cutoff": str(cutoff)}
    if window is not None:
        params["windowDays"] = window
    result = response(career.get(CAREER + "/analytics", params=params))
    expected = 14 if window is None else int(window)
    assert result["windowDays"] == expected
    assert type(result["windowDays"]) is int
    assert result["cutoff"] == cutoff
    for metric in result["metrics"].values():
        assert metric["windowDays"] == expected and metric["cutoff"] == cutoff


def test_get_analytics_without_query_uses_default_window_and_current_cutoff(career):
    before = now_ms()
    result = response(career.get(CAREER + "/analytics"))
    assert result["windowDays"] == 14
    assert before <= result["cutoff"] <= now_ms()


@pytest.mark.parametrize("window", ["8", "abc", "14.0", "7.0", "014", "+14", " 14", "", "0", "-7"])
def test_get_analytics_rejects_invalid_or_noncanonical_windows(career, window):
    response(career.get(CAREER + "/analytics", params={"windowDays": window}), 422)


@pytest.mark.parametrize("cutoff", ["0", "-1", "abc"])
def test_get_analytics_rejects_invalid_cutoff(career, cutoff):
    response(career.get(CAREER + "/analytics", params={"windowDays": "14", "cutoff": cutoff}), 422)
