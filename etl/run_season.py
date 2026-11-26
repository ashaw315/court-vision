"""Stage 3: run a league season through the validated pipeline, for any set of teams.

    .venv/bin/python etl/run_season.py --season 2025-26 [--teams BKN,BOS] [--limit N] [--force]

Each game is fetched ONCE (play-by-play + boxscores) and both sides are processed from
that single fetch, so a full league season is ~1,230 games of requests, not 2,460.

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
    fetch_boxscore,
    fetch_league_games,
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


def process_game(game_id: str, team_ids: list[int]) -> dict[int, dict]:
    """Run ONE game through the validated pipeline for each requested team.

    The network fetches happen once; each team is then processed independently, so one
    side failing verification never touches the other. Returns {team_id: payload}.
    A team missing from the boxscore raises for the whole game — that is a source
    problem, not a per-team one.
    """
    actions = fetch_play_by_play(game_id, cache_dir=CACHE)
    boxscore = fetch_boxscore(game_id, cache_dir=CACHE)
    periods = sorted({a["period"] for a in actions if a.get("period")})
    period_boxscores = fetch_period_boxscores(game_id, periods, cache_dir=CACHE)
    rosters = build_rosters_from_boxscore(boxscore)

    payloads: dict[int, dict] = {}
    for team_id in team_ids:
        if team_id not in rosters:
            raise ValueError(f"team {team_id} absent from boxscore (teams: {sorted(rosters)})")
        payloads[team_id] = _process_team(
            game_id, team_id, rosters[team_id], actions, boxscore, period_boxscores, periods
        )
    return payloads


def _process_team(game_id, team_id, team, actions, boxscore, period_boxscores, periods) -> dict:
    participation = build_period_rosters_from_boxscores(period_boxscores, team_id)

    intervals, interval_warnings = build_lineup_intervals(
        actions, game_id, team_id, team.roster,
        starters=team.starters, period_participation=participation,
        return_warnings=True,
    )
    shot_events, shot_warnings = build_shot_events(
        actions, game_id, team_id, team.roster,
        intervals=intervals, return_warnings=True,
    )
    edges = build_assist_edges(shot_events)
    split = assisted_split(shot_events)

    report = verify_game(
        shot_events, intervals, actions, team_id, team.starters,
        set(team.roster.by_person_id),
        boxscore_seconds=boxscore_seconds_by_player(boxscore, team_id),
    )

    warnings = interval_warnings + shot_warnings
    return {
        "gameId": game_id,
        "teamId": team_id,
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


def _iso_to_catalog_date(iso: str) -> str:
    """'2025-11-07' -> 'NOV 07, 2025' (the form the loaded games table already uses)."""
    year, month, day = iso[:10].split("-")
    names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
             "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    return f"{names[int(month) - 1]} {day}, {year}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", required=True, help="e.g. 2025-26")
    parser.add_argument("--teams", default=None,
                        help="comma-separated abbreviations (default: all 30)")
    parser.add_argument("--limit", type=int, default=None,
                        help="process at most N games (smoke-test the loop)")
    parser.add_argument("--force", action="store_true",
                        help="reprocess games that already have persisted output")
    args = parser.parse_args()

    season = args.season
    season_dir = OUT / season
    games_dir = season_dir / "games"
    teams_dir = season_dir / "teams"
    games_dir.mkdir(parents=True, exist_ok=True)
    teams_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Stage 3: {season} season run ===\n")
    schedule = fetch_league_games(season, cache_dir=CACHE)

    abbreviations: dict[int, str] = {}
    for game in schedule:
        for team_id, side in game["sides"].items():
            abbreviations[team_id] = side["abbreviation"]
    wanted_abbr = (
        {t.strip().upper() for t in args.teams.split(",")} if args.teams else None
    )
    if wanted_abbr:
        unknown = wanted_abbr - set(abbreviations.values())
        if unknown:
            print(f"unknown team abbreviation(s): {sorted(unknown)}")
            return 2
    wanted_ids = {
        tid for tid, abbr in abbreviations.items()
        if wanted_abbr is None or abbr in wanted_abbr
    }

    # Only games involving a requested team are worth fetching.
    games = [g for g in schedule if wanted_ids & set(g["sides"])]
    if args.limit:
        games = games[: args.limit]
    print(f"{len(games)} games involve the requested teams "
          f"({len(wanted_ids)} team(s))\n")

    payloads: dict[int, list[dict]] = collections.defaultdict(list)
    errored: list[tuple[str, int, str]] = []
    game_records: dict[str, dict] = {}

    for index, game in enumerate(games, start=1):
        game_id = game["gameId"]
        sides = {tid: s for tid, s in game["sides"].items() if tid in wanted_ids}
        game_records[game_id] = {
            "gameId": game_id,
            "season": season,
            "gameDate": _iso_to_catalog_date(game["gameDate"]),
            "playedOn": game["gameDate"][:10],
            "matchup": next(iter(game["sides"].values()))["matchup"],
            "homeTeamId": game["homeTeamId"],
            "awayTeamId": game["awayTeamId"],
        }
        label = f"[{index:>4}/{len(games)}] {game_id} {game['gameDate']}"

        # Checkpoint per team-game; fetch only if some requested side is missing.
        todo = []
        for team_id in sides:
            path = games_dir / f"{game_id}_{team_id}.json"
            if path.exists() and not args.force:
                with open(path) as f:
                    payloads[team_id].append(json.load(f))
            else:
                todo.append(team_id)
        if not todo:
            print(f"{label}  cached")
            continue

        try:
            fresh = process_game(game_id, todo)
        except KeyboardInterrupt:
            print("\n\ninterrupted — completed games are persisted; re-run to resume")
            return 130
        except Exception as error:  # noqa: BLE001 - one bad game must not end the run
            message = f"{type(error).__name__}: {error}"
            for team_id in todo:
                errored.append((game_id, team_id, message))
            print(f"{label}  ERROR  {message}")
            traceback.print_exc(limit=2)
            continue

        for team_id, payload in fresh.items():
            # Persist BEFORE judging, so a verification failure is still resumable and
            # inspectable rather than needing a re-fetch.
            with open(games_dir / f"{game_id}_{team_id}.json", "w") as f:
                json.dump(payload, f)
            payloads[team_id].append(payload)
            reasons = game_failures(payload)
            counts = payload["verification"]["counts"]
            tag = "ok  " if not reasons else "FAIL"
            print(f"{label}  {abbreviations[team_id]} {tag} shots={counts['shots']:>3} "
                  f"intervals={counts['intervals']:>3}")
            for reason in reasons:
                print(f"       !! {reason}")

    # ---------------- per-team season aggregate ----------------
    manifest_teams: dict[str, dict] = {}
    for team_id in sorted(payloads, key=lambda t: abbreviations[t]):
        abbr = abbreviations[team_id]
        team_payloads = payloads[team_id]
        valid = [p for p in team_payloads if not game_failures(p)]
        failed = [
            {"gameId": p["gameId"], "reasons": game_failures(p)}
            for p in team_payloads if game_failures(p)
        ]
        fetch_errors = [
            {"gameId": g, "error": e} for g, t, e in errored if t == team_id
        ]
        aggregate = aggregate_season(valid)
        team_games = [
            game_records[p["gameId"]] for p in sorted(
                team_payloads, key=lambda p: game_records[p["gameId"]]["playedOn"])
        ]
        out = {
            "season": season,
            "teamId": team_id,
            "abbreviation": abbr,
            "scheduled": len(team_payloads) + len(fetch_errors),
            "games": team_games,
            # One audit row per team-game — passed or not, with the reasons.
            "validation": [
                {
                    "gameId": p["gameId"],
                    "teamId": team_id,
                    "passed": not game_failures(p),
                    "reasons": game_failures(p),
                }
                for p in team_payloads
            ] + [
                {"gameId": e["gameId"], "teamId": team_id, "passed": False,
                 "reasons": [f"fetch error: {e['error']}"]}
                for e in fetch_errors
            ],
            "aggregate": aggregate,
            "longTail": _long_tail(team_payloads),
        }
        with open(teams_dir / f"{abbr}.json", "w") as f:
            json.dump(out, f)
        manifest_teams[abbr] = {
            "scheduled": out["scheduled"],
            "validated": len(valid),
            "excluded": len(failed) + len(fetch_errors),
            "failedValidation": failed,
            "erroredFetching": fetch_errors,
            "honesty": aggregate["honesty"],
        }
        print(f"{abbr}: {len(valid)}/{out['scheduled']} games validated "
              f"-> {(teams_dir / (abbr + '.json')).relative_to(REPO)}")

    manifest_path = season_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump({"season": season, "teams": manifest_teams}, f, indent=2)
    print(f"\nwrote {manifest_path.relative_to(REPO)}")

    # Exclusions are reported, never fatal: a team-game that fails validation is left out
    # of that team's numbers and listed in its audit table. Only fetch errors are an
    # incomplete run that should be repeated.
    return 0 if not errored else 1


def _long_tail(payloads: list[dict]) -> dict:
    """Which games triggered each long-tail case."""
    tally: dict[str, list[str]] = collections.defaultdict(list)
    for payload in payloads:
        for key, hits in payload.get("signals", {}).items():
            if hits:
                tally[key].append(payload["gameId"])
    return dict(tally)


if __name__ == "__main__":
    raise SystemExit(main())
