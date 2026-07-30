"""Tests for ShotEvent assembly and the assisted-vs-unassisted split.

Written before the implementation. Runs against the real V3 fixture — no network.
"""

import json
import pathlib

import pytest
from transforms.assister import Roster
from transforms.shot_events import (
    assisted_split,
    build_assist_edges,
    build_shot_events,
)

# Anchored to THIS FILE, not the working directory, so pytest works from anywhere.
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
NETS = 1610612751

NETS_ROSTER = Roster(
    {
        1629008: "Porter Jr.",
        1629611: "Mann",
        1629651: "Claxton",
        1641730: "Clowney",
        1642962: "Powell",
    }
)


@pytest.fixture
def actions():
    with open(FIXTURES / "s2b_pbp_v3_sample.json") as f:
        return json.load(f)


@pytest.fixture
def full_actions():
    """The complete 4-period stream — needed to test eventId uniqueness meaningfully."""
    with open(FIXTURES / "pbp_full_0022500610.json") as f:
        return json.load(f)


# The full roster, so every Nets field goal in the complete stream is in scope.
NETS_FULL_ROSTER = Roster(
    {
        1629008: "Porter Jr.",
        1629611: "Mann",
        1629651: "Claxton",
        1641730: "Clowney",
        1642962: "Powell",
        1630533: "Williams",
        1642874: "Wolf",
        1642849: "Traore",
        1631213: "Martin",
        1630592: "Wilson",
        1642856: "Dëmin",
        1630560: "Thomas",
    }
)


class TestEventIdUniqueness:
    """`eventId` (V3 `actionNumber`) is unique among FIELD-GOAL events in a game — which
    is the only kind ShotEvent holds — but NOT across the full action stream.

    In the validated game 16 of 411 distinct actionNumbers are duplicated, because a
    block or steal shares an actionNumber with the shot or turnover it pairs with,
    differing only by `actionId`. These tests pin down which invariant actually holds, so
    the contract's claim about eventId stays true to the data.
    """

    def test_field_goal_event_ids_are_unique_within_the_game(self, full_actions):
        events = build_shot_events(
            full_actions, "0022500610", NETS, NETS_FULL_ROSTER
        )
        assert events
        event_ids = [e["eventId"] for e in events]
        assert len(event_ids) == len(set(event_ids)), (
            "ShotEvent.eventId must be unique within a game — it is the shotchart "
            "GAME_EVENT_ID join key"
        )

    def test_the_raw_stream_does_contain_duplicate_action_numbers(self, full_actions):
        """Documents WHY the contract cannot claim stream-wide uniqueness.

        If this ever stops being true the contract comment should be revisited — but it
        is a property of the source, not of our code.
        """
        numbers = [a["actionNumber"] for a in full_actions]
        assert len(numbers) != len(set(numbers)), (
            "expected the raw stream to reuse actionNumbers across paired events"
        )

    def test_no_duplicated_action_number_pairs_two_field_goals(self, full_actions):
        """The precise reason FG-level uniqueness survives stream-level duplication."""
        by_number: dict[int, list[dict]] = {}
        for action in full_actions:
            by_number.setdefault(action["actionNumber"], []).append(action)
        for number, group in by_number.items():
            field_goals = [a for a in group if a.get("isFieldGoal") == 1]
            assert len(field_goals) <= 1, (
                f"actionNumber {number} pairs {len(field_goals)} field goals — "
                f"ShotEvent.eventId would no longer be a unique key"
            )

    def test_action_id_is_the_stream_wide_unique_key(self, full_actions):
        """`actionId`, not `actionNumber`, is unique across the whole stream."""
        action_ids = [a["actionId"] for a in full_actions]
        assert len(action_ids) == len(set(action_ids))


class TestBuildShotEvents:
    def test_extracts_only_field_goals(self, actions):
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        # 27 FG events in the sample, 13 of which are the Nets'.
        assert events
        assert all(e["gameId"] == "0022500610" for e in events)
        # Free throws are not field goals and must never appear.
        assert all(e["shotValue"] in (2, 3) for e in events)

    def test_scopes_to_one_team(self, actions):
        nets = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        shooters = {e["shooterId"] for e in nets}
        assert shooters <= set(NETS_ROSTER.by_person_id)

    def test_resolves_a_real_assisted_shot(self, actions):
        """Event 10: "Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"."""
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        shot = next(e for e in events if e["eventId"] == 10)
        assert shot["shooterId"] == 1642962  # Powell
        assert shot["made"] is True
        assert shot["assisted"] is True
        assert shot["assisterId"] == 1629611  # Mann
        assert shot["shotValue"] == 3
        assert (shot["locX"], shot["locY"]) == (49, 246)

    def test_unassisted_make_has_null_assister(self, actions):
        """Event 72: "Mann 2' Driving Layup (2 PTS)" — a real unassisted make."""
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        shot = next(e for e in events if e["eventId"] == 72)
        assert shot["made"] is True
        assert shot["assisted"] is False
        assert shot["assisterId"] is None

    def test_missed_shot_is_never_assisted(self, actions):
        """Event 7: "MISS Porter Jr. 26' 3PT Jump Shot"."""
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        shot = next(e for e in events if e["eventId"] == 7)
        assert shot["made"] is False
        assert shot["assisted"] is False
        assert shot["assisterId"] is None

    def test_uses_v3_distance_convention(self, actions):
        """V3 rounds Euclidean distance; shotchart truncates it.

        Event 7 is at (-136, 216) = 25.52 ft: V3 says 26, shotchart says 25. We keep
        V3's value so distance stays consistent with the coordinates we store.
        """
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        assert next(e for e in events if e["eventId"] == 7)["shotDistance"] == 26

    def test_unresolved_assister_stays_assisted(self):
        """The honesty rule: tag present but surname unresolvable → assisted, no edge."""
        action = {
            "actionNumber": 999,
            "clock": "PT05M00.00S",
            "period": 1,
            "teamId": NETS,
            "personId": 1642962,
            "isFieldGoal": 1,
            "shotResult": "Made",
            "shotValue": 3,
            "xLegacy": 49,
            "yLegacy": 246,
            "shotDistance": 25,
            "actionType": "Made Shot",
            "subType": "Jump Shot",
            "description": "Powell 25' 3PT Jump Shot (3 PTS) (Nobody 1 AST)",
        }
        events = build_shot_events([action], "0022500610", NETS, NETS_ROSTER)
        shot = events[0]
        assert shot["assisted"] is True, "tag was present — this is an assisted basket"
        assert shot["assisterId"] is None, "unresolvable surname must not be guessed"

    def test_never_self_assists(self, actions):
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        assert all(e["assisterId"] != e["shooterId"] for e in events)


class TestAssistedSplit:
    def test_counts_unresolved_assisted_as_assisted_not_self_created(self):
        """Guards the split against the null-handling trap in CLAUDE.md."""
        events = [
            {"made": True, "assisted": True, "assisterId": 1629611},
            {"made": True, "assisted": True, "assisterId": None},  # unresolved
            {"made": True, "assisted": False, "assisterId": None},  # self-created
            {"made": False, "assisted": False, "assisterId": None},  # miss
        ]
        split = assisted_split(events)
        assert split["madeBaskets"] == 3, "misses are excluded from the split"
        assert split["assisted"] == 2, "unresolved-assisted counts as assisted"
        assert split["selfCreated"] == 1
        assert split["unresolvedAssisted"] == 1

    def test_split_is_made_baskets_only(self):
        events = [{"made": False, "assisted": False, "assisterId": None}] * 5
        split = assisted_split(events)
        assert split["madeBaskets"] == 0
        assert split["assistedPct"] is None, "no made baskets → no percentage, not zero"


class TestBuildAssistEdges:
    def test_aggregates_a_pair_across_shots(self):
        events = [
            {"made": True, "assisted": True, "assisterId": 1629611,
             "shooterId": 1642962, "shotValue": 3},
            {"made": True, "assisted": True, "assisterId": 1629611,
             "shooterId": 1642962, "shotValue": 3},
            {"made": True, "assisted": True, "assisterId": 1629611,
             "shooterId": 1642962, "shotValue": 2},
        ]
        edges = build_assist_edges(events)
        assert len(edges) == 1
        edge = edges[0]
        assert edge["count"] == 3
        assert edge["made3"] == 2
        assert edge["made2"] == 1
        assert edge["points"] == 8  # 2*1 + 3*2

    def test_direction_matters(self):
        events = [
            {"made": True, "assisted": True, "assisterId": 1629611,
             "shooterId": 1642962, "shotValue": 2},
            {"made": True, "assisted": True, "assisterId": 1642962,
             "shooterId": 1629611, "shotValue": 2},
        ]
        edges = build_assist_edges(events)
        assert len(edges) == 2, "A→B and B→A are distinct edges"

    def test_excludes_unresolved_and_unassisted(self):
        events = [
            {"made": True, "assisted": True, "assisterId": None,
             "shooterId": 1642962, "shotValue": 2},
            {"made": True, "assisted": False, "assisterId": None,
             "shooterId": 1642962, "shotValue": 2},
        ]
        assert build_assist_edges(events) == []

    def test_real_fixture_edges_are_internally_consistent(self, actions):
        events = build_shot_events(actions, "0022500610", NETS, NETS_ROSTER)
        for edge in build_assist_edges(events):
            assert edge["count"] == edge["made2"] + edge["made3"]
            assert edge["points"] == 2 * edge["made2"] + 3 * edge["made3"]
            assert edge["assisterId"] != edge["shooterId"]
