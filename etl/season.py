"""Season-level aggregation: many per-game payloads -> the Phase 4 load shape.

Adds NO transform logic. Every ShotEvent, AssistEdge and LineupInterval here was produced
and verified by the stage-1/2 transforms on a single game; this module concatenates,
de-duplicates, re-derives season-scope aggregates, and computes the honesty report.

Two things are genuinely new and therefore TDD'd (etl/tests/test_season.py):
  * `build_lineups` — five-man units above the EMIT FLOOR, summed across the season. The
    display threshold is a separate, frontend concern; see LINEUP_EMIT_FLOOR_MINUTES.
  * `aggregate_season` — the merge plus the honesty stats.
"""

from __future__ import annotations

import collections
from typing import Any

from transforms.lineup_intervals import _clock_seconds
from transforms.shot_events import assisted_split, build_assist_edges

# The EMIT FLOOR: minutes a five-man unit must clear to enter the dataset at all.
#
# Deliberately distinct from the DISPLAY THRESHOLD, which is a frontend concern:
#
#   * Emit floor (here, 25 min) — below this a "unit" is a handful of scattered
#     possessions across a season and genuinely isn't a subject. It stays out of the data.
#     On the real season this yields 21 units out of 608 distinct fives.
#   * Display threshold (frontend) — which of the emitted units to surface, and how to
#     caveat the thin ones. The UI owns that call.
#
# The floor used to be 50, which baked a presentation decision into the dataset: changing
# the UI's mind would have required re-running the whole season pull. Emitting to 25 and
# carrying `minutes` on every record means any threshold can be applied downstream, and
# sample size stays visible so the UI can be honest about it.
#
# Still forced by the data rather than taste: per CLAUDE.md the Nets ran 250+ distinct
# fives with only a handful clearing 50 minutes — a rebuilding team's distribution. That
# reasoning is write-up material either way; what changed is WHERE the cut is applied.
LINEUP_EMIT_FLOOR_MINUTES = 25.0

# A season assisted share outside this band means something is systematically wrong —
# league-average assisted-basket rate sits around 55-65%. Reported, never enforced: the
# dataset is still emitted so a human can inspect it.
ASSISTED_PCT_SANITY_RANGE = (0.45, 0.75)


def build_lineups(
    intervals: list[dict[str, Any]],
    display_names: dict[int, str],
    threshold_minutes: float = LINEUP_EMIT_FLOOR_MINUTES,
) -> list[dict[str, Any]]:
    """Aggregate LineupIntervals into `Lineup` records above the emit floor.

    Minutes are summed from real derived interval durations — the same durations that
    reconcile to boxscore minutes to the second — rather than taken from
    `teamdashlineups`. One fewer endpoint, and it stays consistent with the intervals the
    shots actually join to.
    """
    seconds: dict[tuple[int, ...], float] = collections.defaultdict(float)

    for interval in intervals:
        five = tuple(sorted(interval["onCourt"]))
        duration = _clock_seconds(interval["startClock"]) - _clock_seconds(
            interval["endClock"]
        )
        seconds[five] += duration

    lineups = []
    for five, total_seconds in seconds.items():
        minutes = total_seconds / 60.0
        if minutes < threshold_minutes:
            continue
        lineups.append(
            {
                # The dash-delimited sorted person-id string, leading and trailing
                # dashes included — the same identity form `teamdashlineups` uses.
                "groupId": "-" + "-".join(str(p) for p in five) + "-",
                "personIds": five,
                "minutes": minutes,
                # Fall back to the id so a display name is never empty; the contract
                # requires non-empty strings, and an unnamed player is a reporting gap
                # rather than a reason to drop a real unit.
                "displayNames": [display_names.get(p, str(p)) for p in five],
            }
        )

    lineups.sort(key=lambda lu: -lu["minutes"])
    return lineups


def aggregate_season(
    games: list[dict[str, Any]],
    threshold_minutes: float = LINEUP_EMIT_FLOOR_MINUTES,
) -> dict[str, Any]:
    """Merge per-game payloads into the season dataset plus the honesty report."""
    shot_events: list[dict[str, Any]] = []
    intervals: list[dict[str, Any]] = []
    players: dict[int, str] = {}

    for game in games:
        shot_events.extend(game["shotEvents"])
        intervals.extend(game["lineupIntervals"])
        for player in game["players"]:
            # First spelling wins; identity is personId, so a later variant changes
            # nothing that matters.
            players.setdefault(player["personId"], player["displayName"])

    # Edges are re-derived over the WHOLE season, not concatenated from per-game lists —
    # otherwise the same ordered pair would appear once per game, which is not the
    # one-row-per-pair shape the contract describes.
    assist_edges = build_assist_edges(shot_events)
    split = assisted_split(shot_events)
    lineups = build_lineups(intervals, players, threshold_minutes=threshold_minutes)

    attributed = sum(1 for s in shot_events if s.get("intervalId") is not None)
    coverage = (attributed / len(shot_events)) if shot_events else None

    assisted_pct = split["assistedPct"]
    low, high = ASSISTED_PCT_SANITY_RANGE
    plausible = None if assisted_pct is None else (low <= assisted_pct <= high)

    return {
        "shotEvents": shot_events,
        "assistEdges": assist_edges,
        "lineupIntervals": intervals,
        "lineups": lineups,
        "players": [
            {"personId": pid, "displayName": name}
            for pid, name in sorted(players.items())
        ],
        "assistedSplit": split,
        "honesty": {
            "games": len(games),
            "shots": len(shot_events),
            "attributed": attributed,
            "attributionCoverage": coverage,
            "madeBaskets": split["madeBaskets"],
            "assisted": split["assisted"],
            "selfCreated": split["selfCreated"],
            "unresolvedAssisted": split["unresolvedAssisted"],
            "assistedPct": assisted_pct,
            "assistedPctPlausible": plausible,
            "assistedPctSanityRange": list(ASSISTED_PCT_SANITY_RANGE),
            "lineupIntervals": len(intervals),
            "lineupEmitFloorMinutes": threshold_minutes,
            "lineupsEmitted": len(lineups),
            "players": len(players),
            "assistEdges": len(assist_edges),
        },
    }
