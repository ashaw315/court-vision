"""Thin, polite wrapper around the NBA stats endpoints.

Runs LOCALLY only — stats.nba.com returns 403 from cloud IPs. The deployed app never
calls these; it reads from Postgres.

Two responsibilities, deliberately kept out of the transforms so those stay pure and
testable against fixtures with no network:
  1. fetching (with a courteous delay and a bounded retry),
  2. caching raw responses to disk, so re-running the pipeline while iterating on
     transforms does not re-hit the endpoint.
"""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

from nba_api.stats.endpoints import (
    boxscoretraditionalv3,
    playbyplayv3,
    teamgamelog,
)

NETS_TEAM_ID = 1610612751
SEASON = "2025-26"

# Be a good citizen. The endpoint is undocumented and unmetered; hammering it is both
# rude and a good way to get blocked. One request per this many seconds, minimum.
REQUEST_DELAY_SECONDS = 2.0
TIMEOUT_SECONDS = 60
MAX_ATTEMPTS = 3

_last_request_at = 0.0


def _throttle() -> None:
    global _last_request_at
    elapsed = time.monotonic() - _last_request_at
    if elapsed < REQUEST_DELAY_SECONDS:
        time.sleep(REQUEST_DELAY_SECONDS - elapsed)
    _last_request_at = time.monotonic()


def _fetch(label: str, call) -> dict[str, Any]:
    """Run an endpoint call with throttling and bounded retry/backoff."""
    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        _throttle()
        try:
            return call()
        except Exception as error:  # noqa: BLE001 - endpoint raises a variety of types
            last_error = error
            is_final = attempt == MAX_ATTEMPTS
            if is_final:
                # Do not sleep, and do not claim a retry that will not happen — at
                # 82-game scale that is both wasted time and a false log line to
                # diagnose from.
                print(f"  {label}: attempt {attempt} failed "
                      f"({type(error).__name__}); no attempts remain")
                break
            backoff = REQUEST_DELAY_SECONDS * (2**attempt)
            print(f"  {label}: attempt {attempt} of {MAX_ATTEMPTS} failed "
                  f"({type(error).__name__}), retrying in {backoff:.0f}s")
            time.sleep(backoff)
    raise RuntimeError(f"{label}: failed after {MAX_ATTEMPTS} attempts") from last_error


def _cached(cache_path: pathlib.Path | None, label: str, call):
    if cache_path and cache_path.exists():
        print(f"  {label}: using cached {cache_path.name}")
        with open(cache_path) as f:
            return json.load(f)

    payload = _fetch(label, call)

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(payload, f)
        print(f"  {label}: fetched and cached {cache_path.name}")
    return payload


def fetch_nets_game_ids(cache_dir: pathlib.Path | None = None) -> list[dict[str, str]]:
    """Regular-season game ids for the Nets, oldest first."""
    cache_path = (cache_dir / f"gamelog_{SEASON.replace('/', '-')}.json") if cache_dir else None

    def call():
        return teamgamelog.TeamGameLog(
            team_id=NETS_TEAM_ID,
            season=SEASON,
            season_type_all_star="Regular Season",
            timeout=TIMEOUT_SECONDS,
        ).get_dict()

    payload = _cached(cache_path, "teamgamelog", call)
    result_set = payload["resultSets"][0]
    headers = result_set["headers"]
    games = [dict(zip(headers, row, strict=False)) for row in result_set["rowSet"]]
    games.reverse()  # endpoint returns newest first
    return [
        {"gameId": g["Game_ID"], "gameDate": g["GAME_DATE"], "matchup": g["MATCHUP"]}
        for g in games
    ]


def fetch_play_by_play(
    game_id: str, cache_dir: pathlib.Path | None = None
) -> list[dict[str, Any]]:
    """The game's action stream. Returns game.actions — a list of event objects."""
    cache_path = (cache_dir / f"pbp_{game_id}.json") if cache_dir else None

    def call():
        return playbyplayv3.PlayByPlayV3(
            game_id=game_id, timeout=TIMEOUT_SECONDS
        ).get_dict()

    payload = _cached(cache_path, f"playbyplayv3 {game_id}", call)
    return payload["game"]["actions"]


def fetch_boxscore(game_id: str, cache_dir: pathlib.Path | None = None) -> dict[str, Any]:
    """Traditional boxscore — the authoritative roster and starting five."""
    cache_path = (cache_dir / f"boxscore_{game_id}.json") if cache_dir else None

    def call():
        return boxscoretraditionalv3.BoxScoreTraditionalV3(
            game_id=game_id, timeout=TIMEOUT_SECONDS
        ).get_dict()

    return _cached(cache_path, f"boxscoretraditionalv3 {game_id}", call)


def fetch_period_boxscores(
    game_id: str, periods: list[int], cache_dir: pathlib.Path | None = None
) -> dict[int, dict[str, Any]]:
    """Per-period boxscores — who played in each period, and for how long.

    One call per period (so 4 for a regulation game, more with overtime). This is what
    anchors each period's opening five to the boxscore instead of to whoever happened to
    record a play-by-play action; see transforms/lineup_intervals._seed_opening_five.

    Note the cost: at 82 games this is ~330 extra requests. Worth it — without it a quiet
    stretch silently drops a whole period of lineup attribution.
    """
    result: dict[int, dict[str, Any]] = {}
    for period in periods:
        cache_path = (
            (cache_dir / f"boxscore_{game_id}_p{period}.json") if cache_dir else None
        )

        def call(period=period):
            return boxscoretraditionalv3.BoxScoreTraditionalV3(
                game_id=game_id,
                start_period=period,
                end_period=period,
                range_type=1,
                timeout=TIMEOUT_SECONDS,
            ).get_dict()

        result[period] = _cached(
            cache_path, f"boxscore {game_id} period {period}", call
        )
    return result
