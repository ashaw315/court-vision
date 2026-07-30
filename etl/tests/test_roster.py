"""Tests for authoritative roster + starters from the boxscore.

Written before the implementation.

Fixes review findings #2 and #4 at the root. Previously both the roster and each
period's starting five were inferred from the play-by-play stream, which meant:
  #4 the roster only ever contained players who ACTED (5 of 12 on the fixture), and
     resolution was order-dependent;
  #2 a starter who recorded no action before being subbed out was invisible, so the
     derived five came back short and the WHOLE PERIOD was dropped.

The boxscore states both facts outright. Fixture: s3_boxscore_0022500610.json —
BoxScoreTraditionalV3 for the same Nets/PHX game as the play-by-play fixture.
"""

import json
import pathlib

import pytest
from transforms.roster import build_rosters_from_boxscore

# Anchored to THIS FILE, not the working directory, so pytest works from anywhere.
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
NETS = 1610612751
PHX = 1610612756


@pytest.fixture
def boxscore():
    with open(FIXTURES / "s3_boxscore_0022500610.json") as f:
        return json.load(f)


class TestBuildRosters:
    def test_returns_both_teams(self, boxscore):
        rosters = build_rosters_from_boxscore(boxscore)
        assert set(rosters) == {NETS, PHX}

    def test_roster_is_complete_not_just_players_who_acted(self, boxscore):
        """The regression test for #4.

        Deriving from the stream found 5 Nets players. The real roster is 12 — including
        players who never recorded an action. An assister who has not yet shot must
        still resolve.
        """
        nets = build_rosters_from_boxscore(boxscore)[NETS]
        assert len(nets.roster) == 12

    def test_includes_the_nets_williams_that_stream_derivation_missed(self, boxscore):
        """The concrete failure from the review.

        The fixture substitution "SUB: Williams FOR Porter Jr." was unresolvable because
        Z. Williams never acted in the truncated stream. The boxscore has him.
        """
        nets = build_rosters_from_boxscore(boxscore)[NETS]
        assert nets.roster.candidates("Williams") == [1630533]

    def test_does_not_confuse_the_two_teams_williams(self, boxscore):
        """Both teams have a Williams — a real cross-team collision."""
        rosters = build_rosters_from_boxscore(boxscore)
        assert rosters[NETS].roster.candidates("Williams") == [1630533]
        assert rosters[PHX].roster.candidates("Williams") == [1631109]

    def test_identifies_exactly_five_starters(self, boxscore):
        rosters = build_rosters_from_boxscore(boxscore)
        for team_id in (NETS, PHX):
            assert len(rosters[team_id].starters) == 5

    def test_starters_are_the_real_nets_five(self, boxscore):
        nets = build_rosters_from_boxscore(boxscore)[NETS]
        assert nets.starters == (1629008, 1629611, 1629651, 1641730, 1642962)

    def test_starters_are_sorted_for_canonical_identity(self, boxscore):
        rosters = build_rosters_from_boxscore(boxscore)
        for team in rosters.values():
            assert list(team.starters) == sorted(team.starters)

    def test_uses_family_name_matching_play_by_play_surnames(self, boxscore):
        """Resolution compares against description text, which carries bare surnames."""
        nets = build_rosters_from_boxscore(boxscore)[NETS]
        assert nets.roster.candidates("Porter Jr.") == [1629008]
        assert nets.roster.candidates("Dëmin") == [1642856]

    def test_raises_when_a_team_lacks_five_starters(self):
        """Never silently proceed with a partial five — that is a guess."""
        broken = {
            "boxScoreTraditional": {
                "homeTeam": {
                    "teamId": NETS,
                    "players": [
                        {"personId": 1, "familyName": "A", "position": "G"},
                        {"personId": 2, "familyName": "B", "position": ""},
                    ],
                },
                "awayTeam": {"teamId": PHX, "players": []},
            }
        }
        with pytest.raises(ValueError, match="starters"):
            build_rosters_from_boxscore(broken)
