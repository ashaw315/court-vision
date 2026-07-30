"""Tests for lineup-interval derivation — the highest-RISK transform.

Written before the implementation.

Fixture limitation, stated plainly: s2b_pbp_v3_sample.json is a truncated 60-event
sample covering period 1 only, to 4:19, containing just TWO substitutions and no
period boundary. It can prove starting-five derivation and a single sub, and it is
used for exactly that below. Period resets, re-entry, and simultaneous subs cannot be
proven from it, so those use synthetic event streams in the real V3 shape. Stage 2
(one full game) is where this transform meets a complete substitution stream.

Substitution shape confirmed from the fixture:
    description = "SUB: <incoming surname> FOR <outgoing surname>"
    personId    = the OUTGOING player (verified: #67 has personId 1629008
                  Porter Jr., and reads "SUB: Williams FOR Porter Jr.")
The incoming player appears only as a bare surname — same resolution hazard, and the
same never-guess rule, as the assister.
"""

import json
import pathlib

import pytest
from transforms.assister import Roster
from transforms.lineup_intervals import (
    build_lineup_intervals,
    interval_for_event,
    parse_substitution,
)

# Anchored to THIS FILE, not the working directory, so pytest works from anywhere.
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
NETS = 1610612751

# The real Nets starting five in the fixture game.
NETS_ROSTER = Roster(
    {
        1629008: "Porter Jr.",
        1629611: "Mann",
        1629651: "Claxton",
        1641730: "Clowney",
        1642962: "Powell",
        1631109: "Williams",  # the Nets' Williams — comes in for Porter Jr.
        1630703: "Sharpe",
    }
)
STARTERS = (1629008, 1629611, 1629651, 1641730, 1642962)


@pytest.fixture
def actions():
    with open(FIXTURES / "s2b_pbp_v3_sample.json") as f:
        return json.load(f)


def sub(action_number, period, clock, out_person_id, incoming, outgoing):
    return {
        "actionNumber": action_number,
        "period": period,
        "clock": clock,
        "teamId": NETS,
        "personId": out_person_id,
        "actionType": "Substitution",
        "subType": "",
        "isFieldGoal": 0,
        "description": f"SUB: {incoming} FOR {outgoing}",
    }


def shot(action_number, period, clock, person_id):
    return {
        "actionNumber": action_number,
        "period": period,
        "clock": clock,
        "teamId": NETS,
        "personId": person_id,
        "actionType": "Made Shot",
        "subType": "Jump Shot",
        "isFieldGoal": 1,
        "shotResult": "Made",
        "shotValue": 2,
        "xLegacy": 10,
        "yLegacy": 20,
        "shotDistance": 2,
        "description": "Shot",
    }


class TestParseSubstitution:
    def test_parses_real_fixture_substitution(self):
        desc = "SUB: Williams FOR Porter Jr."
        assert parse_substitution(desc) == ("Williams", "Porter Jr.")

    def test_parses_suffixed_incoming_name(self):
        assert parse_substitution("SUB: Porter Jr. FOR Mann") == ("Porter Jr.", "Mann")

    def test_returns_none_for_non_substitution(self):
        assert parse_substitution("Mann 2' Driving Layup (2 PTS)") is None


class TestStartingFive:
    def test_derives_starting_five_from_real_fixture(self, actions):
        """The five Nets who act before the first substitution are the starters."""
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        assert intervals
        assert intervals[0]["onCourt"] == tuple(sorted(STARTERS))

    def test_first_interval_starts_at_period_open(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        assert intervals[0]["startClock"] == "PT12M00.00S"
        assert intervals[0]["period"] == 1

    def test_real_substitution_closes_an_interval_and_opens_the_next(self, actions):
        """Fixture sub #67 at 6:04 — Williams in for Porter Jr."""
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        first, second = intervals[0], intervals[1]
        assert first["endClock"] == "PT06M04.00S"
        assert second["startClock"] == "PT06M04.00S"
        assert 1629008 not in second["onCourt"], "Porter Jr. went out"
        assert 1631109 in second["onCourt"], "Williams came in"

    def test_ignores_opponent_substitutions(self, actions):
        """Sub #68 is a PHX sub — it must not disturb the Nets' on-court five."""
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        # Only the one Nets sub in this sample → exactly 2 intervals.
        assert len(intervals) == 2


class TestInvariants:
    def test_every_interval_has_exactly_five_distinct_players(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        for iv in intervals:
            assert len(iv["onCourt"]) == 5
            assert len(set(iv["onCourt"])) == 5

    def test_on_court_is_sorted_for_canonical_identity(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        for iv in intervals:
            assert list(iv["onCourt"]) == sorted(iv["onCourt"])

    def test_interval_ids_are_unique(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        ids = [iv["intervalId"] for iv in intervals]
        assert len(ids) == len(set(ids))


class TestPeriodBoundary:
    """Each period's opening five is derived independently.

    This class has now been rewritten TWICE by evidence, which is worth recording:

      1. Originally it asserted each period re-derives its five by observation.
      2. That was replaced with carry-forward when boxscore starters were introduced
         (review finding #2), on the reasoning that whoever finished a period opens the
         next.
      3. Stage 2, against the first COMPLETE 4-period stream, disproved carry-forward
         outright: coaches re-choose at the break and NO substitution events describe
         it. Porter Jr. was subbed out at P1 6:04, never subbed back in during P1, and
         opened P2 on court. So observation-per-period is correct after all — but it
         needed the full 12-man boxscore roster to work, which is what #4 supplied.

    See TestFinding11FiveDoesNotCarryAcrossPeriods in test_review_regressions.py.
    """

    def test_each_period_derives_its_own_opening_five(self):
        events = [
            {"actionNumber": 1, "period": 1, "clock": "PT12M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "start",
             "isFieldGoal": 0, "description": "Start of 1st Period"},
            *[shot(2 + i, 1, "PT11M00.00S", pid) for i, pid in enumerate(STARTERS)],
            {"actionNumber": 20, "period": 2, "clock": "PT12M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "start",
             "isFieldGoal": 0, "description": "Start of 2nd Period"},
            # A DIFFERENT five opens period 2, with no substitution events for the break.
            shot(21, 2, "PT11M30.00S", 1631109),  # Williams
            shot(22, 2, "PT11M20.00S", 1630703),  # Sharpe
            shot(23, 2, "PT11M10.00S", 1629611),  # Mann
            shot(24, 2, "PT11M00.00S", 1629651),  # Claxton
            shot(25, 2, "PT10M50.00S", 1642962),  # Powell
        ]
        intervals = build_lineup_intervals(
            events, "0022500610", NETS, NETS_ROSTER, starters=STARTERS
        )
        p1 = [iv for iv in intervals if iv["period"] == 1]
        p2 = [iv for iv in intervals if iv["period"] == 2]
        assert p1 and p2
        assert p1[0]["onCourt"] == tuple(sorted(STARTERS)), "P1 uses boxscore starters"
        assert p2[0]["onCourt"] == tuple(
            sorted((1631109, 1630703, 1629611, 1629651, 1642962))
        ), "P2 is observed independently, not carried forward"
        assert p2[0]["startClock"] == "PT12M00.00S", "period 2 reopens at 12:00"

    def test_period_one_interval_closes_at_period_end(self):
        events = [
            *[shot(1 + i, 1, "PT11M00.00S", pid) for i, pid in enumerate(STARTERS)],
            {"actionNumber": 50, "period": 1, "clock": "PT00M00.00S", "teamId": 0,
             "personId": 0, "actionType": "period", "subType": "end",
             "isFieldGoal": 0, "description": "End of 1st Period"},
        ]
        intervals = build_lineup_intervals(events, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        assert intervals[-1]["endClock"] == "PT00M00.00S"


class TestSubstitutionEdgeCases:
    """Synthetic: none of these appear in the truncated fixture."""

    def test_simultaneous_subs_at_one_stoppage_collapse_to_one_boundary(self):
        events = [
            *[shot(1 + i, 1, "PT11M00.00S", pid) for i, pid in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1629008, "Williams", "Porter Jr."),
            sub(11, 1, "PT08M00.00S", 1629611, "Sharpe", "Mann"),
            shot(12, 1, "PT07M00.00S", 1631109),
        ]
        intervals = build_lineup_intervals(events, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        at_eight = [iv for iv in intervals if iv["startClock"] == "PT08M00.00S"]
        assert len(at_eight) == 1, "two subs at the same clock = one new interval"
        on = at_eight[0]["onCourt"]
        assert 1629008 not in on and 1629611 not in on
        assert 1631109 in on and 1630703 in on
        # No zero-length interval left behind between the two subs.
        assert all(iv["startClock"] != iv["endClock"] for iv in intervals)

    def test_player_subbed_out_and_back_in(self):
        events = [
            *[shot(1 + i, 1, "PT11M00.00S", pid) for i, pid in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1629008, "Williams", "Porter Jr."),
            sub(20, 1, "PT04M00.00S", 1631109, "Porter Jr.", "Williams"),
            shot(21, 1, "PT03M00.00S", 1629008),
        ]
        intervals = build_lineup_intervals(events, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        assert 1629008 in intervals[-1]["onCourt"], "Porter Jr. returned"
        assert 1631109 not in intervals[-1]["onCourt"]
        assert intervals[-1]["onCourt"] == tuple(sorted(STARTERS))

    def test_unresolvable_incoming_surname_is_flagged_never_guessed(self):
        """Same honesty rule as the assister: no guessing an identity."""
        events = [
            *[shot(1 + i, 1, "PT11M00.00S", pid) for i, pid in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1629008, "Unknownguy", "Porter Jr."),
        ]
        intervals, warnings = build_lineup_intervals(
            events, "0022500610", NETS, NETS_ROSTER, starters=STARTERS,
            return_warnings=True
        )
        assert warnings, "an unresolvable substitution must be logged"
        # The interval must not silently contain a fabricated player or a 4-man unit.
        for iv in intervals:
            assert len(iv["onCourt"]) == 5


class TestIntervalForEvent:
    def test_shot_maps_to_the_interval_containing_it(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        # Event 10 (10:58, period 1) precedes the 6:04 sub → first interval.
        early = interval_for_event(intervals, period=1, clock="PT10M58.00S")
        assert early["intervalId"] == intervals[0]["intervalId"]
        # Event 250 territory: after the sub → second interval.
        late = interval_for_event(intervals, period=1, clock="PT05M00.00S")
        assert late["intervalId"] == intervals[1]["intervalId"]

    def test_every_fixture_shot_maps_to_exactly_one_interval(self, actions):
        intervals = build_lineup_intervals(actions, "0022500610", NETS, NETS_ROSTER, starters=STARTERS)
        nets_shots = [
            a for a in actions
            if a.get("isFieldGoal") == 1 and a.get("teamId") == NETS
        ]
        assert nets_shots
        for s in nets_shots:
            matches = [
                iv for iv in intervals
                if interval_for_event([iv], s["period"], s["clock"]) is not None
            ]
            assert len(matches) == 1, f"event {s['actionNumber']} matched {len(matches)}"
