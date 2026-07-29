"""Authoritative roster and starting five, from the boxscore.

Fixes review findings #2 and #4 at their root.

Both facts used to be INFERRED from the play-by-play stream, and both inferences were
unsound:

  #4  The roster could only ever contain players who recorded an action. On the
      validated game the stream revealed 5 of 12 Nets; an assister who had not yet
      shot was unresolvable, and resolution was order-dependent (processing the stream
      incrementally lost a real assist).
  #2  A starter who recorded no action before being substituted out was invisible, so
      the derived five came back short and the entire period was dropped. A quiet
      defensive specialist is routine, so this would silently delete quarters across
      a season.

`BoxScoreTraditionalV3` states both outright, in one call per game:
  boxScoreTraditional.{homeTeam,awayTeam}.players[] with
    personId    — identity
    familyName  — the bare surname, the same form play-by-play descriptions use
    position    — non-empty for exactly the five starters (verified on the fixture:
                  BKN and PHX each yield exactly 5)

Note the sibling `starters` key on each team is a STATS aggregate (minutes, points,
...), not a player list — it cannot be used for identity.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .assister import Roster


def parse_minutes(value: str | None) -> int:
    """Boxscore minutes ("36:35", or "PT36M35.00S") -> whole seconds. Blank -> 0."""
    if not value:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    iso = re.match(r"^PT(?:(\d+)M)?([\d.]+)S$", text)
    if iso:
        return round(int(iso.group(1) or 0) * 60 + float(iso.group(2)))
    if ":" in text:
        minutes, seconds = text.split(":", 1)
        return int(minutes) * 60 + round(float(seconds))
    return round(float(text) * 60)


@dataclass(frozen=True)
class TeamGameRoster:
    """One team's roster and starting five for a single game."""

    team_id: int
    roster: Roster
    starters: tuple[int, ...]


def build_rosters_from_boxscore(boxscore: dict[str, Any]) -> dict[int, TeamGameRoster]:
    """Extract both teams' rosters and starting fives from a BoxScoreTraditionalV3 dict.

    Raises ValueError if a team does not yield exactly five starters. That is a refusal,
    not a defect: proceeding with four or six would mean guessing who was on court, and
    CLAUDE.md forbids guessing a starting five.
    """
    box = boxscore.get("boxScoreTraditional") or {}
    rosters: dict[int, TeamGameRoster] = {}

    for side in ("homeTeam", "awayTeam"):
        team = box.get(side)
        if not team:
            continue

        team_id = team["teamId"]
        players = team.get("players") or []

        by_person_id: dict[int, str] = {}
        starters: list[int] = []

        for player in players:
            person_id = player.get("personId")
            surname = (player.get("familyName") or "").strip()
            if not person_id or not surname:
                continue
            by_person_id[person_id] = surname
            # A non-empty position marks a starter; bench players carry "".
            if (player.get("position") or "").strip():
                starters.append(person_id)

        if len(starters) != 5:
            raise ValueError(
                f"team {team_id}: boxscore yielded {len(starters)} starters, expected 5 "
                f"— refusing to guess a starting five"
            )

        rosters[team_id] = TeamGameRoster(
            team_id=team_id,
            roster=Roster(by_person_id),
            starters=tuple(sorted(starters)),
        )

    return rosters


def _team_side(boxscore: dict[str, Any], team_id: int) -> dict[str, Any] | None:
    box = boxscore.get("boxScoreTraditional") or {}
    for side in ("homeTeam", "awayTeam"):
        team = box.get(side)
        if team and team.get("teamId") == team_id:
            return team
    return None


def build_period_rosters_from_boxscores(
    period_boxscores: dict[int, dict[str, Any]], team_id: int
) -> dict[int, dict[int, int]]:
    """Who played in each period, and for how many seconds.

    Input is {period: BoxScoreTraditionalV3 dict} from per-period calls
    (`start_period=N, end_period=N, range_type=1`).

    This is the boxscore-anchored candidate set for each period's opening five. It does
    NOT identify the openers by itself — per-period minutes cannot, because a player who
    opens, sits and returns can out-minute one who opened and was pulled early (verified
    on real data: period 2 openers ranged 4:56-10:41 while non-openers had 7:04). The
    stream's substitution events supply the ENTERED-later set; the difference is exact.

    Returns {period: {personId: secondsPlayed}}, omitting players with no minutes.
    """
    participation: dict[int, dict[int, int]] = {}

    for period, boxscore in period_boxscores.items():
        team = _team_side(boxscore, team_id)
        if not team:
            continue
        played: dict[int, int] = {}
        for player in team.get("players") or []:
            person_id = player.get("personId")
            seconds = parse_minutes((player.get("statistics") or {}).get("minutes"))
            if person_id and seconds > 0:
                played[person_id] = seconds
        if played:
            participation[int(period)] = played

    return participation


def boxscore_seconds_by_player(
    boxscore: dict[str, Any], team_id: int
) -> dict[int, int]:
    """Whole-game seconds played per personId, for the minutes-reconciliation check."""
    team = _team_side(boxscore, team_id)
    if not team:
        return {}
    result: dict[int, int] = {}
    for player in team.get("players") or []:
        person_id = player.get("personId")
        seconds = parse_minutes((player.get("statistics") or {}).get("minutes"))
        if person_id and seconds > 0:
            result[person_id] = seconds
    return result
