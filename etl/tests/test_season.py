"""Tests for season-level aggregation.

Written before the implementation. Stage 3 adds NO transform logic — these functions
aggregate the already-validated per-game output. Two pieces are genuinely new:

  * `build_lineups` — the above-threshold five-man units. Per CLAUDE.md the threshold is
    forced by the data (a rebuilding roster ran 250 distinct fives but only ~5 cleared 50
    minutes), so units below it are noise and must not enter the dataset.
  * `aggregate_season` — merging per-game payloads into the Phase 4 load shape, including
    the season honesty stats.
"""

import pytest
from season import (
    ASSISTED_PCT_SANITY_RANGE,
    LINEUP_EMIT_FLOOR_MINUTES,
    aggregate_season,
    build_lineups,
)

NETS = 1610612751


def interval(game_id, period, start, end, on_court, suffix=""):
    return {
        "gameId": game_id,
        "intervalId": f"{game_id}:{NETS}:{period}:{start}{suffix}",
        "period": period,
        "startClock": start,
        "endClock": end,
        "onCourt": tuple(sorted(on_court)),
    }


def shot(game_id, event_id, shooter, *, made=True, assisted=False, assister=None,
         value=2, interval_id=None):
    return {
        "gameId": game_id,
        "eventId": event_id,
        "period": 1,
        "clock": "PT11M00.00S",
        "shooterId": shooter,
        "locX": 0,
        "locY": 0,
        "shotValue": value,
        "made": made,
        "assisted": assisted,
        "assisterId": assister,
        "shotDistance": 1,
        "actionType": "Made Shot" if made else "Missed Shot",
        "subType": "Jump Shot",
        "teamId": NETS,
        "intervalId": interval_id,
    }


class TestEmitFloorVsDisplayThreshold:
    """The ETL emits down to a low FLOOR; the display threshold is a frontend concern.

    Originally the ETL emitted only units clearing 50 minutes, which baked a presentation
    decision into the dataset — changing the UI's mind would have meant re-running the
    whole season pull. The emit floor is now 25 minutes, and every record carries its own
    `minutes` so the frontend can apply any threshold and show sample size honestly.

    The two numbers mean different things and should not be conflated:
      * EMIT FLOOR (25 min) — below this a unit is a handful of scattered possessions and
        genuinely isn't a subject; it stays out of the data.
      * DISPLAY THRESHOLD (frontend) — which of the emitted units to surface, and how to
        caveat the thin ones.
    """

    def test_the_default_emit_floor_is_25_minutes(self):
        assert LINEUP_EMIT_FLOOR_MINUTES == 25.0

    def test_sub_50_minute_units_are_emitted(self):
        """The point of the change: a 30-minute unit must survive into the output.

        Under the old 50-minute emit threshold this unit vanished and the frontend had no
        way to get it back without a fresh season pull.
        """
        intervals = [
            # 30 minutes: above the 25 floor, below the old 50 threshold.
            interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g3", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
        ]
        lineups = build_lineups(intervals, {})  # default floor
        assert len(lineups) == 1
        assert lineups[0]["minutes"] == pytest.approx(30.0)

    def test_minutes_are_carried_on_every_record_for_ui_filtering(self):
        """The UI needs the number itself, not just membership above some line."""
        intervals = [
            # ~40 min
            interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g3", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g4", 1, "PT12M00.00S", "PT08M00.00S", (1, 2, 3, 4, 5)),
            # 28 min: above the 25 floor, below a 30 display threshold.
            interval("g1", 2, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 6)),
            interval("g2", 2, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 6)),
            interval("g3", 2, "PT12M00.00S", "PT08M00.00S", (1, 2, 3, 4, 6)),
        ]
        lineups = build_lineups(intervals, {})
        assert len(lineups) == 2
        for lineup in lineups:
            assert isinstance(lineup["minutes"], float)
            assert lineup["minutes"] >= LINEUP_EMIT_FLOOR_MINUTES
        # A frontend applying a 50-minute display threshold would show neither; applying
        # 30 would show one. Both remain possible without re-running the ETL.
        assert sum(1 for lu in lineups if lu["minutes"] >= 50) == 0
        assert sum(1 for lu in lineups if lu["minutes"] >= 30) == 1

    def test_units_below_the_emit_floor_are_still_excluded(self):
        """The floor is lower, not absent — genuine noise stays out."""
        intervals = [
            interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g3", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
            # 6 minutes together — below the floor.
            interval("g1", 2, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 6)),
        ]
        lineups = build_lineups(intervals, {})
        assert [lu["personIds"] for lu in lineups] == [(1, 2, 3, 4, 5)]

    def test_the_reported_floor_matches_what_was_applied(self):
        """The honesty report must not claim a threshold the data doesn't reflect."""
        intervals = [
            interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g3", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
        ]
        game = {
            "gameId": "g1", "teamId": NETS, "shotEvents": [], "assistEdges": [],
            "lineupIntervals": intervals, "players": [], "starters": [1, 2, 3, 4, 5],
            "warnings": [],
        }
        season = aggregate_season([game])
        assert season["honesty"]["lineupEmitFloorMinutes"] == LINEUP_EMIT_FLOOR_MINUTES
        assert season["honesty"]["lineupsEmitted"] == len(season["lineups"])


class TestBuildLineups:
    """Five-man units aggregated from LineupIntervals."""

    def test_sums_seconds_across_games_into_minutes(self):
        # Same five in two games: 6 min + 4 min = 10 min.
        intervals = [
            interval("g1", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT08M00.00S", (1, 2, 3, 4, 5)),
        ]
        lineups = build_lineups(intervals, {}, threshold_minutes=0)
        assert len(lineups) == 1
        assert lineups[0]["minutes"] == pytest.approx(10.0)

    def test_group_id_is_the_dash_delimited_sorted_form(self):
        intervals = [interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (5, 3, 1, 4, 2))]
        lineups = build_lineups(intervals, {}, threshold_minutes=0)
        assert lineups[0]["groupId"] == "-1-2-3-4-5-"
        assert lineups[0]["personIds"] == (1, 2, 3, 4, 5)

    def test_excludes_units_below_the_threshold(self):
        """The threshold is forced by the data, not cosmetic — sub-threshold units are
        noise and must not enter the dataset at all."""
        intervals = [
            # 30 minutes together.
            interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g2", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5)),
            interval("g3", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
            # 6 minutes together — noise.
            interval("g1", 2, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 6)),
        ]
        lineups = build_lineups(intervals, {}, threshold_minutes=25)
        assert len(lineups) == 1
        assert lineups[0]["personIds"] == (1, 2, 3, 4, 5)

    def test_display_names_come_from_the_player_map(self):
        names = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E"}
        intervals = [interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5))]
        lineups = build_lineups(intervals, names, threshold_minutes=0)
        assert lineups[0]["displayNames"] == ["A", "B", "C", "D", "E"]

    def test_sorted_by_minutes_descending(self):
        intervals = [
            interval("g1", 1, "PT12M00.00S", "PT02M00.00S", (1, 2, 3, 4, 5)),
            interval("g1", 2, "PT12M00.00S", "PT08M00.00S", (1, 2, 3, 4, 6)),
        ]
        lineups = build_lineups(intervals, {}, threshold_minutes=0)
        assert [lu["minutes"] for lu in lineups] == sorted(
            [lu["minutes"] for lu in lineups], reverse=True
        )

    def test_missing_display_name_falls_back_to_the_id(self):
        """Never crash on an unnamed player, and never emit an empty display name —
        the contract requires non-empty strings."""
        intervals = [interval("g1", 1, "PT12M00.00S", "PT00M00.00S", (1, 2, 3, 4, 5))]
        lineups = build_lineups(intervals, {1: "A"}, threshold_minutes=0)
        assert all(name for name in lineups[0]["displayNames"])


class TestAggregateSeason:
    def _game(self, game_id, shots, intervals=(), players=(), failed=False):
        return {
            "gameId": game_id,
            "teamId": NETS,
            "shotEvents": list(shots),
            "assistEdges": [],
            "lineupIntervals": list(intervals),
            "players": list(players),
            "starters": [1, 2, 3, 4, 5],
            "warnings": [],
        }

    def test_concatenates_shot_events_across_games(self):
        games = [
            self._game("g1", [shot("g1", 1, 1), shot("g1", 2, 2)]),
            self._game("g2", [shot("g2", 1, 1)]),
        ]
        season = aggregate_season(games, threshold_minutes=0)
        assert len(season["shotEvents"]) == 3

    def test_dedupes_players_across_games_by_person_id(self):
        """A player appears in every game they play; the season roster holds them once."""
        games = [
            self._game("g1", [], players=[{"personId": 1, "displayName": "A"}]),
            self._game("g2", [], players=[
                {"personId": 1, "displayName": "A"},
                {"personId": 2, "displayName": "B"},
            ]),
        ]
        season = aggregate_season(games, threshold_minutes=0)
        assert len(season["players"]) == 2
        assert {p["personId"] for p in season["players"]} == {1, 2}

    def test_rebuilds_assist_edges_from_the_full_season_not_per_game_sums(self):
        """Edges must be re-derived over all ShotEvents.

        Concatenating per-game edge lists would emit the same pair repeatedly — one row
        per game — which the contract's one-row-per-ordered-pair shape does not describe.
        """
        games = [
            self._game("g1", [shot("g1", 1, 2, assisted=True, assister=1, value=3)]),
            self._game("g2", [shot("g2", 1, 2, assisted=True, assister=1, value=2)]),
        ]
        season = aggregate_season(games, threshold_minutes=0)
        assert len(season["assistEdges"]) == 1
        edge = season["assistEdges"][0]
        assert edge["count"] == 2
        assert edge["points"] == 5
        assert edge["made3"] == 1 and edge["made2"] == 1

    def test_season_split_counts_made_baskets_across_all_games(self):
        games = [
            self._game("g1", [
                shot("g1", 1, 2, assisted=True, assister=1),
                shot("g1", 2, 2),                      # self-created
                shot("g1", 3, 2, made=False),          # miss
            ]),
            self._game("g2", [shot("g2", 1, 2, assisted=True, assister=1)]),
        ]
        season = aggregate_season(games, threshold_minutes=0)
        split = season["assistedSplit"]
        assert split["madeBaskets"] == 3
        assert split["assisted"] == 2
        assert split["selfCreated"] == 1

    def test_unresolved_assisted_counts_as_assisted_season_wide(self):
        """The honesty rule survives aggregation: a tagged-but-unresolvable assist is
        assisted, and is reported separately so the cost of never guessing is visible."""
        games = [self._game("g1", [
            shot("g1", 1, 2, assisted=True, assister=None),
            shot("g1", 2, 2, assisted=True, assister=1),
        ])]
        season = aggregate_season(games, threshold_minutes=0)
        assert season["assistedSplit"]["assisted"] == 2
        assert season["assistedSplit"]["unresolvedAssisted"] == 1

    def test_reports_attribution_coverage_across_the_season(self):
        games = [self._game("g1", [
            shot("g1", 1, 2, interval_id="iv1"),
            shot("g1", 2, 2, interval_id=None),
        ])]
        season = aggregate_season(games, threshold_minutes=0)
        assert season["honesty"]["shots"] == 2
        assert season["honesty"]["attributed"] == 1
        assert season["honesty"]["attributionCoverage"] == pytest.approx(0.5)

    def test_flags_an_assisted_pct_outside_the_sanity_range(self):
        """A season assisted share far from ~55-65% signals a systemic bug, not a quirk.

        The flag is a REPORT, not an exception — the dataset is still emitted so a human
        can look at it.
        """
        low, high = ASSISTED_PCT_SANITY_RANGE
        # Every basket self-created -> 0%, far below the range.
        games = [self._game("g1", [shot("g1", i, 2) for i in range(1, 11)])]
        season = aggregate_season(games, threshold_minutes=0)
        assert season["honesty"]["assistedPctPlausible"] is False
        assert 0.0 < low < high < 1.0

    def test_accepts_a_plausible_assisted_pct(self):
        # 6 of 10 assisted = 60%, inside the range.
        shots = [shot("g1", i, 2, assisted=True, assister=1) for i in range(1, 7)]
        shots += [shot("g1", i, 2) for i in range(7, 11)]
        season = aggregate_season([self._game("g1", shots)], threshold_minutes=0)
        assert season["honesty"]["assistedPctPlausible"] is True

    def test_empty_season_does_not_crash(self):
        season = aggregate_season([], threshold_minutes=0)
        assert season["shotEvents"] == []
        assert season["honesty"]["shots"] == 0
        assert season["honesty"]["assistedPctPlausible"] is None
