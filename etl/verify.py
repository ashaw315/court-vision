"""Structural verification of a game's derived output.

The lineup-interval derivation is the highest-risk code in the project, so these checks
state what must be true and report what isn't. Every finding is returned rather than
raised — the point is a full picture of what the model does and does not fit.

Each check maps to a claim the tool makes downstream. If a check fails, some claim in the
UI would be false.

Two properties this module must have, both learned the hard way in adversarial review:

  1. It must NEVER crash on bad data. A verifier whose job is to report problems used to
     raise KeyError on a dangling intervalId — turning a reportable anomaly into a dead
     batch run. Every lookup here is guarded.
  2. Silent degradation must FAIL, not merely be countable. Total attribution loss once
     produced no failing check; it was visible only in a printed number, and the run's
     non-zero exit came from unrelated checks. Coverage is now an explicit check.
"""

from __future__ import annotations

import collections
from typing import Any

from transforms.lineup_intervals import _clock_seconds, interval_for_event

# Every field-goal attempt should fall inside some lineup interval. Anything materially
# below this means the derivation has holes, which is a bug rather than a data quirk.
ATTRIBUTION_THRESHOLD = 0.995

# Derived minutes are compared to the boxscore within this tolerance. The validated game
# matches to the exact second across all ten players, so this is deliberately tight —
# it exists for clock-rounding at period ends, not to absorb real errors.
MINUTES_TOLERANCE_SECONDS = 2


def verify_game(
    shot_events: list[dict[str, Any]],
    intervals: list[dict[str, Any]],
    actions: list[dict[str, Any]],
    team_id: int,
    starters: tuple[int, ...],
    roster_ids: set[int],
    boxscore_seconds: dict[int, int] | None = None,
    extra_problems: list[str] | None = None,
) -> dict[str, Any]:
    """Run every structural check. Returns {checks, problems, counts}."""
    checks: list[tuple[str, bool, str]] = []
    problems: list[str] = list(extra_problems or [])

    def check(name: str, passed: bool, detail: str = "") -> None:
        checks.append((name, passed, detail))
        if not passed:
            problems.append(f"{name}: {detail}" if detail else name)

    periods_in_stream = sorted({a["period"] for a in actions if a.get("period")})
    periods_with_intervals = sorted({iv["period"] for iv in intervals})

    # --- every period is represented -------------------------------------------------
    missing = [p for p in periods_in_stream if p not in periods_with_intervals]
    check(
        "every period produces at least one interval",
        not missing,
        f"periods with no intervals: {missing}" if missing else "",
    )

    # --- the five is always exactly five distinct, rostered players -------------------
    bad_size = [iv["intervalId"] for iv in intervals if len(iv["onCourt"]) != 5]
    check("every interval has exactly 5 players", not bad_size, f"{bad_size[:5]}")

    bad_distinct = [
        iv["intervalId"] for iv in intervals if len(set(iv["onCourt"])) != 5
    ]
    check("every interval's 5 are distinct", not bad_distinct, f"{bad_distinct[:5]}")

    off_roster = [
        (iv["intervalId"], sorted(set(iv["onCourt"]) - roster_ids))
        for iv in intervals
        if not set(iv["onCourt"]) <= roster_ids
    ]
    check(
        "every on-court player is on the boxscore roster",
        not off_roster,
        f"{off_roster[:3]}",
    )

    check(
        "onCourt is canonically sorted",
        all(list(iv["onCourt"]) == sorted(iv["onCourt"]) for iv in intervals),
    )

    check(
        "intervalIds are unique",
        len({iv["intervalId"] for iv in intervals}) == len(intervals),
    )

    # --- period 1 opens with the boxscore starting five ------------------------------
    if periods_with_intervals:
        first_period = [
            iv for iv in intervals if iv["period"] == min(periods_with_intervals)
        ]
        opener = max(first_period, key=lambda iv: _clock_seconds(iv["startClock"]))
        check(
            "period 1 opens with the boxscore starting five",
            tuple(opener["onCourt"]) == tuple(sorted(starters)),
            f"got {opener['onCourt']}, boxscore says {tuple(sorted(starters))}",
        )

    # --- intervals tile each period without gaps or overlaps -------------------------
    # Structural, not a substring scan of the problems list (an unrelated message
    # containing the word "gap" used to be enough to fail this).
    tiling_faults: list[str] = []
    for period in periods_with_intervals:
        in_period = sorted(
            (iv for iv in intervals if iv["period"] == period),
            key=lambda iv: -_clock_seconds(iv["startClock"]),
        )
        for iv in in_period:
            start, end = _clock_seconds(iv["startClock"]), _clock_seconds(iv["endClock"])
            if start < end:
                tiling_faults.append(
                    f"period {period} {iv['intervalId']}: clock runs backwards "
                    f"({iv['startClock']} -> {iv['endClock']})"
                )
            elif start == end:
                tiling_faults.append(
                    f"period {period} {iv['intervalId']}: zero-length interval"
                )
        for earlier, later in zip(in_period, in_period[1:], strict=False):
            if earlier["endClock"] != later["startClock"]:
                gap = _clock_seconds(earlier["endClock"]) - _clock_seconds(
                    later["startClock"]
                )
                kind = "gap" if gap > 0 else "overlap"
                tiling_faults.append(
                    f"period {period}: {kind} of {abs(gap):.1f}s — "
                    f"{earlier['intervalId']} ends {earlier['endClock']} but "
                    f"{later['intervalId']} starts {later['startClock']}"
                )
    check(
        "intervals tile each period contiguously",
        not tiling_faults,
        "; ".join(tiling_faults[:3]),
    )

    # --- shot attribution ------------------------------------------------------------
    by_id = {iv["intervalId"]: iv for iv in intervals}
    attributed = [s for s in shot_events if s.get("intervalId") is not None]
    unattributed = [s for s in shot_events if s.get("intervalId") is None]

    # Dangling references are found FIRST so later checks can skip them safely.
    dangling = [
        s["eventId"] for s in attributed if s["intervalId"] not in by_id
    ]
    check(
        "every attributed shot points at a real interval",
        not dangling,
        f"{len(dangling)} shot(s) reference a missing interval; eventIds {dangling[:5]}",
    )
    resolvable = [s for s in attributed if s["intervalId"] in by_id]

    coverage = (len(attributed) / len(shot_events)) if shot_events else 1.0
    check(
        "shot attribution coverage",
        coverage >= ATTRIBUTION_THRESHOLD,
        f"only {len(attributed)}/{len(shot_events)} shots ({coverage:.1%}) map to a "
        f"lineup; threshold is {ATTRIBUTION_THRESHOLD:.1%}",
    )

    multi = []
    for shot in shot_events:
        matches = [
            iv
            for iv in intervals
            if iv["period"] == shot["period"]
            and _clock_seconds(iv["endClock"])
            <= _clock_seconds(shot["clock"])
            <= _clock_seconds(iv["startClock"])
        ]
        if len(matches) > 1:
            # Ambiguity is acceptable only at a shared boundary, where
            # interval_for_event applies a documented tie-break.
            resolved = interval_for_event(intervals, shot["period"], shot["clock"])
            if resolved is None or shot.get("intervalId") != resolved["intervalId"]:
                multi.append((shot["eventId"], [m["intervalId"] for m in matches]))
    check("no shot maps ambiguously to multiple intervals", not multi, f"{multi[:5]}")

    # --- the shooter and assister were actually on court -----------------------------
    shooter_absent = [
        (s["eventId"], s["shooterId"], by_id[s["intervalId"]]["onCourt"])
        for s in resolvable
        if s["shooterId"] not in by_id[s["intervalId"]]["onCourt"]
    ]
    check(
        "the shooter is on court for their own shot",
        not shooter_absent,
        f"{len(shooter_absent)} shots; first few {shooter_absent[:3]}",
    )

    assister_absent = [
        (s["eventId"], s["assisterId"], by_id[s["intervalId"]]["onCourt"])
        for s in resolvable
        if s.get("assisterId") is not None
        and s["assisterId"] not in by_id[s["intervalId"]]["onCourt"]
    ]
    check(
        "the assister is on court for the shot they assisted",
        not assister_absent,
        f"{len(assister_absent)} shots; first few {assister_absent[:3]}",
    )

    # --- boundary cases the reviews flagged ------------------------------------------
    period_openers = [
        s
        for s in shot_events
        if any(
            iv["period"] == s["period"] and iv["startClock"] == s["clock"]
            for iv in intervals
        )
    ]
    check(
        "shots at an interval's opening instant are attributed",
        all(s.get("intervalId") is not None for s in period_openers),
        f"{[s['eventId'] for s in period_openers if s.get('intervalId') is None][:5]}",
    )

    buzzer = [s for s in shot_events if _clock_seconds(s["clock"]) == 0.0]
    check(
        "buzzer-beaters (clock 00.0) are attributed",
        all(s.get("intervalId") is not None for s in buzzer),
        f"{[s['eventId'] for s in buzzer if s.get('intervalId') is None][:5]}",
    )

    # --- minutes reconciliation (the strongest available validation) ------------------
    # Membership checks prove WHO; this proves WHEN. A boundary shifted by 30s keeps the
    # right five in every interval and still corrupts every duration downstream, and
    # nothing else here would notice.
    derived_seconds: dict[int, float] = collections.defaultdict(float)
    for iv in intervals:
        duration = _clock_seconds(iv["startClock"]) - _clock_seconds(iv["endClock"])
        for person_id in iv["onCourt"]:
            derived_seconds[person_id] += duration

    if boxscore_seconds:
        mismatches = []
        for person_id, expected in sorted(boxscore_seconds.items()):
            actual = derived_seconds.get(person_id, 0.0)
            if abs(actual - expected) > MINUTES_TOLERANCE_SECONDS:
                mismatches.append(
                    f"player {person_id}: boxscore {expected}s vs derived {actual:.0f}s "
                    f"({actual - expected:+.0f}s)"
                )
        # A player with derived time who the boxscore says never played.
        for person_id, actual in sorted(derived_seconds.items()):
            if person_id not in boxscore_seconds and actual > MINUTES_TOLERANCE_SECONDS:
                mismatches.append(
                    f"player {person_id}: derived {actual:.0f}s but absent from boxscore"
                )
        check(
            "derived minutes match the boxscore",
            not mismatches,
            "; ".join(mismatches[:5]),
        )
    else:
        problems.append(
            "minutes reconciliation skipped — no boxscore minutes supplied; the "
            "strongest available validation did not run"
        )

    return {
        "checks": checks,
        "problems": problems,
        "counts": {
            "periods": periods_in_stream,
            "intervals": len(intervals),
            "intervalsPerPeriod": dict(
                collections.Counter(iv["period"] for iv in intervals)
            ),
            "shots": len(shot_events),
            "attributed": len(attributed),
            "unattributed": len(unattributed),
            "attributionCoverage": round(coverage, 4),
            "periodOpeners": len(period_openers),
            "buzzerBeaters": len(buzzer),
            "derivedPlayerSeconds": round(sum(derived_seconds.values())),
        },
    }
