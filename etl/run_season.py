"""Stage 3: run the whole Nets regular season through the validated pipeline.

    .venv/bin/python etl/run_season.py [--limit N] [--force]

This adds no transform logic. Each game goes through exactly the stage-1/2 path
(fetch -> roster -> intervals -> shot events -> verify_game), and this script handles
volume: checkpointing, per-game validation, loud-but-non-fatal failure, and the season
honesty report.

Three properties carry the weight:

  1. **Per-game validation.** Every game runs the full verify_game suite. A game that
     fails any check is recorded against its game_id with the specific reason — never
     absorbed into an aggregate. A bad game 47 stays identifiable.

  2. **Resumability.** Raw responses cache under etl/cache/ and processed output persists
     per game under etl/out/games/. A crash, network blip or Ctrl-C at game 70 resumes at
     game 70, not game 1. Re-running is cheap and safe.

  3. **Loud, isolated failure.** One bad game logs and the run CONTINUES. The final
     manifest lists successes and failures with reasons. A partial dataset with a clear
     failure list is the correct outcome; a silent 79/82 that looks complete is not.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from nba_client import (  # noqa: E402
    NETS_TEAM_ID,
    fetch_boxscore,
    fetch_nets_game_ids,
    fetch_period_boxscores,
    fetch_play_by_play,
)
from season import aggregate_season  # noqa: E402
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
GAMES_DIR = OUT / "games"


def process_game(game_id: str) -> dict:
    """Run ONE game through the validated pipeline. Returns the payload + verification.

    Raises on an unrecoverable error; the caller logs and continues.
    """
    actions = fetch_play_by_play(game_id, cache_dir=CACHE)
    boxscore = fetch_boxscore(game_id, cache_dir=CACHE)
    periods = sorted({a["period"] for a in actions if a.get("period")})
    period_boxscores = fetch_period_boxscores(game_id, periods, cache_dir=CACHE)

    rosters = build_rosters_from_boxscore(boxscore)
    if NETS_TEAM_ID not in rosters:
        raise ValueError(f"Nets absent from boxscore (teams: {sorted(rosters)})")
    team = rosters[NETS_TEAM_ID]

    participation = build_period_rosters_from_boxscores(period_boxscores, NETS_TEAM_ID)

    intervals, interval_warnings = build_lineup_intervals(
        actions, game_id, NETS_TEAM_ID, team.roster,
        starters=team.starters, period_participation=participation,
        return_warnings=True,
    )
    shot_events, shot_warnings = build_shot_events(
        actions, game_id, NETS_TEAM_ID, team.roster,
        intervals=intervals, return_warnings=True,
    )
    edges = build_assist_edges(shot_events)
    split = assisted_split(shot_events)

    report = verify_game(
        shot_events, intervals, actions, NETS_TEAM_ID, team.starters,
        set(team.roster.by_person_id),
        boxscore_seconds=boxscore_seconds_by_player(boxscore, NETS_TEAM_ID),
    )

    warnings = interval_warnings + shot_warnings
    return {
        "gameId": game_id,
        "teamId": NETS_TEAM_ID,
        "periods": periods,
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
        # Long-tail signals, recorded per game so the season report can count them.
        "signals": {
            "overtime": [p for p in periods if p > 4],
            "ambiguousAssister": [
                w for w in warnings if "ambiguous assister" in w
            ],
            "unresolvedAssister": [
                w for w in warnings if "unresolved assister" in w
            ],
            "substitutionAnomaly": [
                w for w in warnings
                if "incoming substitute" in w or "was not on court" in w
                or "unparseable substitution" in w
            ],
            "openerDisagreement": [w for w in warnings if "disagree" in w.lower()],
            "ghostPlayers": [
                w for w in warnings if "not in the boxscore participation" in w
            ],
        },
    }


def game_failures(payload: dict) -> list[str]:
    """The specific reasons this game failed validation. Empty means it passed."""
    reasons = [
        f"check failed: {c['name']}" + (f" ({c['detail']})" if c["detail"] else "")
        for c in payload["verification"]["checks"]
        if not c["passed"]
    ]
    # Problems can include findings with no corresponding named check (e.g. the
    # minutes-reconciliation-skipped notice).
    named = {r.split(":", 1)[1].strip().split(" (")[0] for r in reasons}
    for problem in payload["verification"]["problems"]:
        if not any(problem.startswith(n) for n in named):
            reasons.append(f"problem: {problem}")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                        help="process at most N games (smoke-test the loop)")
    parser.add_argument("--force", action="store_true",
                        help="reprocess games that already have persisted output")
    args = parser.parse_args()

    GAMES_DIR.mkdir(parents=True, exist_ok=True)

    print("=== Stage 3: full season run ===\n")
    games = fetch_nets_game_ids(cache_dir=CACHE)
    if args.limit:
        games = games[: args.limit]
    print(f"{len(games)} regular-season games\n")

    succeeded: list[str] = []
    failed: list[tuple[str, list[str]]] = []
    errored: list[tuple[str, str]] = []
    payloads: list[dict] = []

    for index, game in enumerate(games, start=1):
        game_id = game["gameId"]
        label = f"[{index:>2}/{len(games)}] {game_id} {game['gameDate']:>13} {game['matchup']}"
        out_path = GAMES_DIR / f"{game_id}.json"

        # Checkpoint: a completed game is skipped entirely on a re-run.
        if out_path.exists() and not args.force:
            with open(out_path) as f:
                payload = json.load(f)
            payloads.append(payload)
            reasons = game_failures(payload)
            status = "cached OK" if not reasons else f"cached FAIL ({len(reasons)})"
            if reasons:
                failed.append((game_id, reasons))
            else:
                succeeded.append(game_id)
            print(f"{label}  {status}")
            continue

        try:
            payload = process_game(game_id)
        except KeyboardInterrupt:
            print("\n\ninterrupted — completed games are persisted; re-run to resume")
            return 130
        except Exception as error:  # noqa: BLE001 - one bad game must not end the run
            message = f"{type(error).__name__}: {error}"
            errored.append((game_id, message))
            print(f"{label}  ERROR  {message}")
            traceback.print_exc(limit=2)
            continue

        # Persist BEFORE judging, so a verification failure is still resumable and
        # inspectable rather than needing a re-fetch.
        with open(out_path, "w") as f:
            json.dump(payload, f)
        payloads.append(payload)

        reasons = game_failures(payload)
        counts = payload["verification"]["counts"]
        summary = (
            f"shots={counts['shots']:>3} attributed={counts['attributed']:>3} "
            f"intervals={counts['intervals']:>3} P={len(payload['periods'])}"
        )
        if reasons:
            failed.append((game_id, reasons))
            print(f"{label}  FAIL   {summary}")
            for reason in reasons:
                print(f"       !! {reason}")
        else:
            succeeded.append(game_id)
            extra = ""
            if payload["signals"]["overtime"]:
                extra += f" OT{payload['signals']['overtime']}"
            if payload["signals"]["ambiguousAssister"]:
                extra += f" ambig×{len(payload['signals']['ambiguousAssister'])}"
            print(f"{label}  ok     {summary}{extra}")

    # ---------------- season aggregate ----------------
    valid = [p for p in payloads if not game_failures(p)]
    season = aggregate_season(valid)

    season_path = OUT / "season.json"
    with open(season_path, "w") as f:
        json.dump(season, f)

    manifest = {
        "gamesInSchedule": len(games),
        "succeeded": succeeded,
        "failedValidation": [
            {"gameId": g, "reasons": r} for g, r in failed
        ],
        "erroredFetching": [{"gameId": g, "error": e} for g, e in errored],
        "aggregatedFrom": len(valid),
        "honesty": season["honesty"],
        "longTail": _long_tail(payloads),
    }
    manifest_path = OUT / "season_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    _print_report(manifest, season, len(games))
    print(f"\nwrote {season_path.relative_to(REPO)}")
    print(f"wrote {manifest_path.relative_to(REPO)}")
    print(f"per-game output in {GAMES_DIR.relative_to(REPO)}/ ({len(payloads)} files)")

    # Non-zero if anything failed — a partial dataset must not read as a clean run.
    return 0 if not (failed or errored) else 1


def _long_tail(payloads: list[dict]) -> dict:
    """Which games triggered each long-tail case."""
    tally: dict[str, list[str]] = collections.defaultdict(list)
    for payload in payloads:
        for key, hits in payload.get("signals", {}).items():
            if hits:
                tally[key].append(payload["gameId"])
    return dict(tally)


def _print_report(manifest: dict, season: dict, scheduled: int) -> None:
    honesty = manifest["honesty"]
    print("\n" + "=" * 72)
    print("SEASON HONESTY REPORT")
    print("=" * 72)
    print(f"  games in schedule          {scheduled}")
    print(f"  succeeded                  {len(manifest['succeeded'])}")
    print(f"  failed validation          {len(manifest['failedValidation'])}")
    print(f"  errored fetching           {len(manifest['erroredFetching'])}")
    print(f"  aggregated from            {manifest['aggregatedFrom']} games")
    print()
    print(f"  shot events                {honesty['shots']}")
    cov = honesty["attributionCoverage"]
    print(f"  attributed to a lineup     {honesty['attributed']}"
          + (f"  ({cov:.2%})" if cov is not None else ""))
    print()
    print(f"  made baskets               {honesty['madeBaskets']}")
    print(f"  assisted                   {honesty['assisted']}")
    print(f"  self-created               {honesty['selfCreated']}")
    print(f"  unresolved assister        {honesty['unresolvedAssisted']}"
          "   <- never guessed")
    pct = honesty["assistedPct"]
    if pct is not None:
        low, high = honesty["assistedPctSanityRange"]
        verdict = "plausible" if honesty["assistedPctPlausible"] else "*** IMPLAUSIBLE ***"
        print(f"  assisted share             {pct:.1%}  (sanity {low:.0%}-{high:.0%}: {verdict})")
    print()
    print(f"  assist edges               {honesty['assistEdges']}")
    print(f"  lineup intervals           {honesty['lineupIntervals']}")
    print(f"  lineups emitted (>= {honesty['lineupEmitFloorMinutes']:.0f} min)  "
          f"{honesty['lineupsEmitted']}")
    # The frontend applies its own display threshold; show what it has to work with.
    for display_threshold in (50, 40, 30):
        above = sum(
            1 for lu in season["lineups"] if lu["minutes"] >= display_threshold
        )
        print(f"    of which >= {display_threshold} min        {above}")
    print(f"  players                    {honesty['players']}")

    print("\n" + "-" * 72)
    print("LONG TAIL (games that triggered each case)")
    print("-" * 72)
    labels = {
        "overtime": "overtime (periods > 4)",
        "ambiguousAssister": "ambiguous assister -> null (never guessed)",
        "unresolvedAssister": "unresolved assister -> null",
        "substitutionAnomaly": "substitution anomaly",
        "openerDisagreement": "boxscore/observation disagreement",
        "ghostPlayers": "acted but absent from boxscore participation",
    }
    tail = manifest["longTail"]
    for key, label in labels.items():
        hits = tail.get(key, [])
        print(f"  {label:<48} {len(hits):>3} game(s)")
        if hits:
            print(f"       {', '.join(hits[:8])}{' ...' if len(hits) > 8 else ''}")

    if manifest["failedValidation"] or manifest["erroredFetching"]:
        print("\n" + "-" * 72)
        print("FAILURE MANIFEST")
        print("-" * 72)
        for entry in manifest["failedValidation"]:
            print(f"  {entry['gameId']}  VALIDATION")
            for reason in entry["reasons"]:
                print(f"      {reason}")
        for entry in manifest["erroredFetching"]:
            print(f"  {entry['gameId']}  FETCH  {entry['error']}")
    else:
        print("\n  no failures")

    top = season["lineups"][:5]
    if top:
        print("\n" + "-" * 72)
        print("TOP FIVE-MAN UNITS BY MINUTES")
        print("-" * 72)
        for lineup in top:
            names = ", ".join(lineup["displayNames"])
            print(f"  {lineup['minutes']:>7.1f} min  {names}")


if __name__ == "__main__":
    raise SystemExit(main())
