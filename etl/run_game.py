"""Stage 2: pull ONE game live, transform it, verify it, emit contract-valid JSON.

    .venv/bin/python etl/run_game.py [GAME_ID]
    npx vitest run tests/etl-output.test.ts      # validates the emitted JSON

Raw responses are cached under etl/cache/ so re-runs while iterating on transforms do
not re-hit the endpoint. Delete the cache to force a genuine re-fetch.

This is the first time lineup-interval derivation meets a COMPLETE 4-period stream, so
the run is verification-first: verify.py asserts the structural claims the tool makes
downstream, and anything that does not fit the model is printed rather than smoothed
over.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from nba_client import (  # noqa: E402
    NETS_TEAM_ID,
    fetch_boxscore,
    fetch_period_boxscores,
    fetch_play_by_play,
)
from transforms.lineup_intervals import build_lineup_intervals  # noqa: E402
from transforms.roster import (  # noqa: E402
    boxscore_seconds_by_player,
    build_period_rosters_from_boxscores,
    build_rosters_from_boxscore,
)
from transforms.shot_events import (  # noqa: E402
    assisted_split,
    build_assist_edges,
    build_shot_events,
)
from verify import verify_game  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[1]
CACHE = REPO / "etl" / "cache"
OUT = REPO / "etl" / "out"

DEFAULT_GAME_ID = "0022500610"  # BKN vs PHX — same game as the stage-1 fixtures


def main() -> int:
    game_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GAME_ID
    print(f"=== Stage 2: single game {game_id} ===\n")

    print("fetching:")
    actions = fetch_play_by_play(game_id, cache_dir=CACHE)
    boxscore = fetch_boxscore(game_id, cache_dir=CACHE)
    periods = sorted({a["period"] for a in actions if a.get("period")})
    # One extra call per period. This is what anchors each period's opening five to the
    # boxscore rather than to whoever happened to record an action.
    period_boxscores = fetch_period_boxscores(game_id, periods, cache_dir=CACHE)
    print(f"  {len(actions)} play-by-play actions, periods {periods}\n")

    rosters = build_rosters_from_boxscore(boxscore)
    if NETS_TEAM_ID not in rosters:
        print(f"ERROR: Nets not in this boxscore (teams: {sorted(rosters)})")
        return 1
    team = rosters[NETS_TEAM_ID]

    print(f"roster (boxscore): {len(team.roster)} players")
    for person_id, surname in sorted(
        team.roster.by_person_id.items(), key=lambda kv: kv[1]
    ):
        mark = "  <- starter" if person_id in team.starters else ""
        print(f"  {person_id}  {surname}{mark}")
    print()

    participation = build_period_rosters_from_boxscores(period_boxscores, NETS_TEAM_ID)
    print("per-period participation (boxscore):")
    for period in sorted(participation):
        print(f"  P{period}: {len(participation[period])} players played")
    print()

    # Intervals first; shot events join to them.
    intervals, interval_warnings = build_lineup_intervals(
        actions,
        game_id,
        NETS_TEAM_ID,
        team.roster,
        starters=team.starters,
        period_participation=participation,
        return_warnings=True,
    )
    shot_events, shot_warnings = build_shot_events(
        actions,
        game_id,
        NETS_TEAM_ID,
        team.roster,
        intervals=intervals,
        return_warnings=True,
    )
    edges = build_assist_edges(shot_events)
    split = assisted_split(shot_events)

    # ---------------- verification (the point of this stage) ----------------
    report = verify_game(
        shot_events,
        intervals,
        actions,
        NETS_TEAM_ID,
        team.starters,
        set(team.roster.by_person_id),
        boxscore_seconds=boxscore_seconds_by_player(boxscore, NETS_TEAM_ID),
    )

    print("--- structural verification ---")
    for name, passed, detail in report["checks"]:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
        if not passed and detail:
            print(f"         {detail}")

    counts = report["counts"]
    print(f"\n  periods: {counts['periods']}")
    print(f"  intervals: {counts['intervals']}  per period: {counts['intervalsPerPeriod']}")
    print(f"  shots: {counts['shots']}  attributed: {counts['attributed']}  "
          f"unattributable: {counts['unattributed']}")
    print(f"  interval-opening shots: {counts['periodOpeners']}  "
          f"buzzer-beaters: {counts['buzzerBeaters']}")

    if report["problems"]:
        print(f"\n  !! {len(report['problems'])} structural problem(s):")
        for problem in report["problems"]:
            print(f"     {problem}")
    else:
        print("\n  no structural problems")

    # ---------------- the split ----------------
    print("\n--- assisted vs self-created (full game, Nets) ---")
    print(f"  made baskets:        {split['madeBaskets']}")
    print(f"  assisted:            {split['assisted']}")
    print(f"  self-created:        {split['selfCreated']}")
    print(f"  unresolved assister: {split['unresolvedAssisted']}")
    pct = split["assistedPct"]
    print(f"  assisted share:      {pct:.1%}" if pct is not None else "  assisted share: n/a")

    # ---------------- warnings ----------------
    warnings = interval_warnings + shot_warnings
    print(f"\n--- warnings ({len(warnings)}) ---")
    for warning in warnings:
        print(f"  {warning}")
    if not warnings:
        print("  (none)")

    # ---------------- spot checks ----------------
    print("\n--- spot check: assisted shots (first 8) ---")
    names = team.roster.by_person_id
    for shot in [s for s in shot_events if s["assisted"]][:8]:
        assister = names.get(shot["assisterId"], "UNRESOLVED")
        shooter = names.get(shot["shooterId"], "?")
        print(
            f"  P{shot['period']} {shot['clock']:>13}  "
            f"{assister:>12} -> {shooter:<12} "
            f"{shot['shotValue']}pt @ ({shot['locX']:>4},{shot['locY']:>3})  "
            f"{shot['intervalId']}"
        )

    print("\n--- spot check: lineup intervals ---")
    for interval in intervals:
        on_court = ", ".join(names.get(p, str(p)) for p in interval["onCourt"])
        in_interval = [s for s in shot_events if s["intervalId"] == interval["intervalId"]]
        made = sum(1 for s in in_interval if s["made"])
        scoped_edges = build_assist_edges(in_interval)
        print(
            f"  P{interval['period']} {interval['startClock']:>13} -> "
            f"{interval['endClock']:<13} shots={len(in_interval):>2} made={made:>2} "
            f"edges={len(scoped_edges):>2}  [{on_court}]"
        )

    print("\n--- top assist edges (whole game) ---")
    for edge in edges[:10]:
        print(
            f"  {names.get(edge['assisterId'], '?'):>12} -> "
            f"{names.get(edge['shooterId'], '?'):<12} "
            f"{edge['count']:>2} baskets  {edge['points']:>2} pts  "
            f"({edge['made2']}x2, {edge['made3']}x3)"
        )

    # ---------------- emit ----------------
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "gameId": game_id,
        "teamId": NETS_TEAM_ID,
        "shotEvents": shot_events,
        "assistEdges": edges,
        "lineupIntervals": [dict(iv) for iv in intervals],
        "players": [
            {"personId": pid, "displayName": name}
            for pid, name in sorted(team.roster.by_person_id.items())
        ],
        "assistedSplit": split,
        "starters": list(team.starters),
        "warnings": warnings,
        "verification": {
            "checks": [
                {"name": n, "passed": p, "detail": d} for n, p, d in report["checks"]
            ],
            "problems": report["problems"],
            "counts": report["counts"],
        },
    }
    out_path = OUT / f"game_{game_id}.json"
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nwrote {out_path.relative_to(REPO)}")

    # Also refresh the path the contract test reads.
    stage1_path = OUT / "fixture_stage1.json"
    with open(stage1_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {stage1_path.relative_to(REPO)} (validated by tests/etl-output.test.ts)")

    failed = [name for name, passed, _ in report["checks"] if not passed]
    if failed or report["problems"]:
        print(f"\nVERIFICATION INCOMPLETE: {len(failed)} failed check(s), "
              f"{len(report['problems'])} problem(s)")
        return 1
    print("\nall structural checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
