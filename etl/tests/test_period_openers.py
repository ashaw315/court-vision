"""Tests for boxscore-anchored per-period opening fives.

Written before the implementation.

Context — the approved DECISION and what the data actually supports:

The instruction was to seed EVERY period's opening five from the boxscore, using
observation only as a cross-check, so that "fewer than 5 players recorded an action"
becomes structurally impossible. The goal is right. Two facts about the endpoint shape
how it can be met, both verified against live data:

  1. `BoxScoreTraditionalV3` at game scope carries NO per-period lineup data — only
     game starters (via `position`) and game totals. It cannot seed periods 2+.
  2. A per-period call (`start_period=N, end_period=N, range_type=1`) DOES say who
     played in that period and for how long. But per-period MINUTES cannot identify who
     OPENED the period: in the validated game's period 2, the openers' minutes ranged
     4:56–10:41 while two non-openers had 7:04. A player can open, sit, and return (high
     total, opener) or open and be pulled early (low total, opener). Ranking by minutes
     gives the wrong five.

So the boxscore anchors WHO PLAYED; the stream says who ENTERED. Combining them
reconstructs the openers exactly and without needing anyone to record an action:

    openers = (played in this period) MINUS (entered as a substitute before ever
                                             being substituted out)

This is boxscore-anchored — the candidate set comes from the boxscore, not from who
happened to touch the ball — so a quiet stretch can no longer lose a period. Verified
against the live game: exactly 5 openers for every period, matching the previous
stream-observation answer in all of periods 2, 3 and 4.
"""

import json
import pathlib

import pytest
from transforms.assister import Roster
from transforms.lineup_intervals import _clock_seconds, build_lineup_intervals
from transforms.roster import (
    build_period_rosters_from_boxscores,
    build_rosters_from_boxscore,
)

FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "scratch" / "fixtures"
NETS = 1610612751


@pytest.fixture
def boxscore():
    with open(FIXTURES / "s3_boxscore_0022500610.json") as f:
        return json.load(f)


@pytest.fixture
def period_boxscores():
    with open(FIXTURES / "s3_boxscore_periods_0022500610.json") as f:
        return {int(k): v for k, v in json.load(f).items()}


class TestPerPeriodParticipation:
    def test_extracts_who_played_each_period(self, period_boxscores):
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)
        assert set(played) == {1, 2, 3, 4}
        # Period 1: the five starters plus whoever came in.
        assert len(played[1]) >= 5

    def test_period_participation_is_a_superset_of_the_opening_five(
        self, period_boxscores
    ):
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)
        for period, players in played.items():
            assert len(players) >= 5, f"period {period} had {len(players)} players"

    def test_records_seconds_played_per_player(self, period_boxscores):
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)
        # Nobody can play more than 12 minutes in a regulation period.
        for period, players in played.items():
            for person_id, seconds in players.items():
                assert 0 < seconds <= 12 * 60 + 1, (
                    f"period {period} player {person_id}: {seconds}s"
                )

    def test_total_seconds_per_period_is_five_players_worth(self, period_boxscores):
        """A sanity anchor: 5 players x 12 minutes = 3600 player-seconds per period."""
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)
        for period, players in played.items():
            total = sum(players.values())
            assert abs(total - 5 * 12 * 60) <= 5, (
                f"period {period}: {total}s, expected ~3600"
            )


class TestBoxscoreAnchoredOpeners:
    """The opening five for every period, from the boxscore candidate set."""

    def test_derives_five_openers_for_every_period_of_the_real_game(
        self, boxscore, period_boxscores
    ):
        with open(FIXTURES / "s2b_pbp_v3_sample.json") as f:
            pass  # the truncated sample is not used here; the live pbp cache is
        # Use the cached full stream if present, else skip — this asserts on real data.
        cache = FIXTURES.parents[1] / "etl" / "cache" / "pbp_0022500610.json"
        if not cache.exists():
            pytest.skip("full play-by-play cache not present; run etl/run_game.py")
        with open(cache) as f:
            actions = json.load(f)["game"]["actions"]

        team = build_rosters_from_boxscore(boxscore)[NETS]
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)

        intervals, warnings = build_lineup_intervals(
            actions,
            "0022500610",
            NETS,
            team.roster,
            starters=team.starters,
            period_participation=played,
            return_warnings=True,
        )
        by_period = {}
        for interval in intervals:
            by_period.setdefault(interval["period"], []).append(interval)
        assert set(by_period) == {1, 2, 3, 4}, "every period must produce intervals"
        for in_period in by_period.values():
            # Order by seconds remaining, not by the clock STRING — "PT12M00.00S" vs
            # "PT06M04.00S" happens to sort correctly but "PT9M" style would not.
            opener = max(in_period, key=lambda iv: _clock_seconds(iv["startClock"]))
            assert len(opener["onCourt"]) == 5

    def test_period_one_openers_are_the_boxscore_starters(
        self, boxscore, period_boxscores
    ):
        cache = FIXTURES.parents[1] / "etl" / "cache" / "pbp_0022500610.json"
        if not cache.exists():
            pytest.skip("full play-by-play cache not present")
        with open(cache) as f:
            actions = json.load(f)["game"]["actions"]
        team = build_rosters_from_boxscore(boxscore)[NETS]
        played = build_period_rosters_from_boxscores(period_boxscores, NETS)
        intervals = build_lineup_intervals(
            actions, "0022500610", NETS, team.roster,
            starters=team.starters, period_participation=played,
        )
        first = [iv for iv in intervals if iv["period"] == 1][0]
        assert first["onCourt"] == tuple(sorted(team.starters))

    def test_a_period_where_nobody_records_an_action_still_yields_five(self):
        """The structural fix: participation comes from the boxscore, not the stream.

        Under the old observation-only method this period produced NO intervals, losing
        every shot in it. This is the short-OT / garbage-time case.
        """
        roster = Roster({i: chr(64 + i) for i in range(1, 11)})
        # A period with only ONE recorded action but five players in the boxscore.
        actions = [
            {"actionNumber": 1, "period": 5, "clock": "PT05M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "start",
             "isFieldGoal": 0, "description": "Start of OT"},
            {"actionNumber": 2, "period": 5, "clock": "PT04M00.00S", "teamId": NETS,
             "personId": 1, "actionType": "Made Shot", "subType": "Jump Shot",
             "isFieldGoal": 1, "shotResult": "Made", "shotValue": 2,
             "xLegacy": 0, "yLegacy": 0, "shotDistance": 1, "description": "A Layup"},
        ]
        participation = {5: {1: 300, 2: 300, 3: 300, 6: 300, 7: 300}}
        intervals, warnings = build_lineup_intervals(
            actions, "g", NETS, roster, starters=(1, 2, 3, 4, 5),
            period_participation=participation, return_warnings=True,
        )
        assert intervals, "the period must not be lost just because few players acted"
        assert intervals[0]["onCourt"] == (1, 2, 3, 6, 7)

    def test_disagreement_between_boxscore_and_observation_is_reported(self):
        """Not a silent pick — the disagreement is itself a reported finding."""
        roster = Roster({i: chr(64 + i) for i in range(1, 11)})
        actions = [
            {"actionNumber": 1, "period": 2, "clock": "PT12M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "start",
             "isFieldGoal": 0, "description": "Start"},
            # Player 9 acts but the boxscore says they did not play this period.
            {"actionNumber": 2, "period": 2, "clock": "PT11M00.00S", "teamId": NETS,
             "personId": 9, "actionType": "Made Shot", "subType": "J",
             "isFieldGoal": 1, "shotResult": "Made", "shotValue": 2,
             "xLegacy": 0, "yLegacy": 0, "shotDistance": 1, "description": "I Layup"},
        ]
        participation = {2: {1: 720, 2: 720, 3: 720, 4: 720, 5: 720}}
        intervals, warnings = build_lineup_intervals(
            actions, "g", NETS, roster, starters=(1, 2, 3, 4, 5),
            period_participation=participation, return_warnings=True,
        )
        assert any("disagree" in w.lower() or "not in the boxscore" in w.lower()
                   for w in warnings), f"expected a disagreement warning, got {warnings}"

    def test_falls_back_to_observation_when_participation_is_unavailable(self):
        """Per-period boxscores are an extra call per game; absence must degrade, not
        break. Behaviour then matches the previous observation-only method."""
        roster = Roster({i: chr(64 + i) for i in range(1, 11)})
        actions = [
            {"actionNumber": 1, "period": 2, "clock": "PT12M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "start",
             "isFieldGoal": 0, "description": "Start"},
            *[
                {"actionNumber": 2 + i, "period": 2, "clock": "PT11M00.00S",
                 "teamId": NETS, "personId": p, "actionType": "Made Shot",
                 "subType": "J", "isFieldGoal": 1, "shotResult": "Made",
                 "shotValue": 2, "xLegacy": 0, "yLegacy": 0, "shotDistance": 1,
                 "description": "S"}
                for i, p in enumerate((6, 7, 8, 9, 10))
            ],
        ]
        intervals = build_lineup_intervals(
            actions, "g", NETS, roster, starters=(1, 2, 3, 4, 5),
            period_participation=None,
        )
        assert intervals
        assert intervals[0]["onCourt"] == (6, 7, 8, 9, 10)
