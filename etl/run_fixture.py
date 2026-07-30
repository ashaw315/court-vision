"""Stage 1 driver: run the transforms over the saved fixture and emit contract JSON.

No network calls. This exists to prove the transform chain end-to-end against real
saved data, and to produce a JSON file that the real Phase 2 Zod schemas can validate
(see validate_contract.mjs). Stage 2 replaces the fixture read with a live pull.

    .venv/bin/python etl/run_fixture.py
    node etl/validate_contract.mjs etl/out/fixture_stage1.json
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from transforms.lineup_intervals import build_lineup_intervals
from transforms.roster import build_rosters_from_boxscore
from transforms.shot_events import assisted_split, build_assist_edges, build_shot_events

REPO = pathlib.Path(__file__).resolve().parents[1]
# The tracked test fixtures — same frozen data the suite uses, so this driver works on
# a fresh clone without a prior pipeline run.
FIXTURES = REPO / "etl" / "tests" / "fixtures"
OUT = REPO / "etl" / "out"

NETS = 1610612751
GAME_ID = "0022500610"


def main() -> int:
    with open(FIXTURES / "s2b_pbp_v3_sample.json") as f:
        actions = json.load(f)
    with open(FIXTURES / f"s3_boxscore_{GAME_ID}.json") as f:
        boxscore = json.load(f)

    # Roster and starting five come from the boxscore, not from the stream (review
    # findings #2 and #4). Stream derivation found 5 of 12 Nets players and dropped any
    # period whose starters were quiet.
    team = build_rosters_from_boxscore(boxscore)[NETS]
    roster = team.roster
    print(f"roster from boxscore: {len(roster)} players")
    for person_id, name in sorted(roster.by_person_id.items()):
        mark = " (starter)" if person_id in team.starters else ""
        print(f"  {person_id}  {name}{mark}")

    # Intervals first — shot events join to them.
    intervals, interval_warnings = build_lineup_intervals(
        actions, GAME_ID, NETS, roster, starters=team.starters, return_warnings=True
    )
    shot_events, shot_warnings = build_shot_events(
        actions, GAME_ID, NETS, roster, intervals=intervals, return_warnings=True
    )
    edges = build_assist_edges(shot_events)
    split = assisted_split(shot_events)

    attributed = sum(1 for e in shot_events if e["intervalId"] is not None)
    print(f"\nshot events:      {len(shot_events)}")
    print(f"  with lineup:    {attributed} / {len(shot_events)}")
    print(f"assist edges:     {len(edges)}")
    print(f"lineup intervals: {len(intervals)}")
    print(f"\nassisted split:   {json.dumps(split)}")

    # Demonstrate the capability the interval join exists for: assists scoped to one
    # five-man unit rather than to the whole team.
    print("\nlineup-filtered assist edges:")
    for interval in intervals:
        in_interval = [
            e for e in shot_events if e["intervalId"] == interval["intervalId"]
        ]
        scoped = build_assist_edges(in_interval)
        print(f"  {interval['intervalId']}  onCourt={interval['onCourt']}")
        print(f"    shots={len(in_interval)} edges={len(scoped)}")
        for edge in scoped:
            print(
                f"      {edge['assisterId']} -> {edge['shooterId']}: "
                f"{edge['count']} basket(s), {edge['points']} pts"
            )

    warnings = shot_warnings + interval_warnings
    print(f"\nwarnings ({len(warnings)}):")
    for warning in warnings:
        print(f"  {warning}")
    if not warnings:
        print("  (none — every assister and substitute in this sample resolved)")

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "gameId": GAME_ID,
        "teamId": NETS,
        "shotEvents": shot_events,
        "assistEdges": edges,
        # onCourt is a tuple in Python; JSON renders it as an array, which is what the
        # contract's five-element tuple schema expects.
        "lineupIntervals": [dict(iv) for iv in intervals],
        "players": [
            {"personId": pid, "displayName": name}
            for pid, name in sorted(roster.by_person_id.items())
        ],
        "assistedSplit": split,
        "warnings": warnings,
    }
    out_path = OUT / "fixture_stage1.json"
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nwrote {out_path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
