"""format_team_game: the per-team-game progress line, for fresh AND cached games.

A cached game used to print only "cached", so a re-run hid every excluded game and its
reasons. Fresh and cached sides now go through the same report.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from run_season import format_team_game  # noqa: E402


def payload(checks, problems=()):
    return {
        "verification": {
            "checks": [{"name": n, "passed": ok, "detail": d} for n, ok, d in checks],
            "problems": list(problems),
            "counts": {"shots": 95, "intervals": 24},
        }
    }


LABEL = "[   8/20] 0022500128 2025-10-29"


def test_passing_fresh_game_is_one_ok_line():
    lines = format_team_game(LABEL, "BOS", payload([("intervalIds are unique", True, "")]))
    assert lines == [f"{LABEL}  BOS ok   shots= 95 intervals= 24"]


def test_failing_cached_game_still_lists_its_reasons():
    lines = format_team_game(
        LABEL, "BOS",
        payload([("intervalIds are unique", False, ""),
                  ("shot attribution coverage", False, "2 shots")]),
        cached=True,
    )
    assert lines[0] == f"{LABEL}  BOS FAIL shots= 95 intervals= 24  (cached)"
    assert lines[1:] == [
        "       !! check failed: intervalIds are unique",
        "       !! check failed: shot attribution coverage (2 shots)",
    ]


def test_passing_cached_game_is_marked_cached():
    lines = format_team_game(LABEL, "NYK", payload([]), cached=True)
    assert lines == [f"{LABEL}  NYK ok   shots= 95 intervals= 24  (cached)"]
