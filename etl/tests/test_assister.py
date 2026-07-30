"""Tests for assister parsing — the highest-value transform.

Written before the implementation. Fixture descriptions are real strings from
etl/tests/fixtures/s2b_pbp_v3_sample.json (Nets vs PHX, game 0022500610).

The load-bearing rule under test: an ambiguous surname must resolve to
assisterId=None while STILL counting as assisted. A wrong edge is a fabricated claim
about a specific player; a missing edge is merely incomplete.
"""


from transforms.assister import Roster, parse_assist_tag, resolve_assister

# Real Nets roster fragment from the fixture (personId -> surname as play-by-play
# writes it). Note "Porter Jr." carries a suffix and "O'Neale" an apostrophe.
NETS = 1610612751
PHX = 1610612756

NETS_ROSTER = Roster(
    {
        1629008: "Porter Jr.",
        1629611: "Mann",
        1629651: "Claxton",
        1641730: "Clowney",
        1642962: "Powell",
    }
)

PHX_ROSTER = Roster(
    {
        1626164: "Booker",
        1626220: "O'Neale",
        1628415: "Brooks",
        1631109: "Williams",
        1631221: "Gillespie",
    }
)


class TestParseAssistTag:
    """Detecting the (Surname N AST) pattern in the description text."""

    def test_finds_assist_tag_on_real_made_three(self):
        desc = "Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"
        assert parse_assist_tag(desc) == "Mann"

    def test_finds_surname_with_apostrophe(self):
        # Real PHX description — the apostrophe must survive the parse.
        desc = "Booker 1' Running Finger Roll Layup (4 PTS) (O'Neale 1 AST)"
        assert parse_assist_tag(desc) == "O'Neale"

    def test_finds_multiword_surname_with_suffix(self):
        # "Porter Jr." — a period inside the surname must not truncate it.
        desc = "Mann 18' Jump Shot (2 PTS) (Porter Jr. 4 AST)"
        assert parse_assist_tag(desc) == "Porter Jr."

    def test_unassisted_make_has_no_tag(self):
        desc = "Mann 2' Driving Layup (2 PTS)"
        assert parse_assist_tag(desc) is None

    def test_missed_shot_has_no_tag(self):
        desc = "MISS Porter Jr. 26' 3PT Jump Shot"
        assert parse_assist_tag(desc) is None

    def test_does_not_confuse_points_tag_for_assist_tag(self):
        # "(3 PTS)" must never be read as an assist.
        desc = "Powell 25' 3PT Jump Shot (3 PTS)"
        assert parse_assist_tag(desc) is None

    def test_ignores_block_tag(self):
        # Blocks use the same parenthesised shape but are not assists.
        desc = "MISS Claxton 5' Layup (Williams 1 BLK)"
        assert parse_assist_tag(desc) is None


class TestResolveAssister:
    """Mapping a bare surname to a personId within one team's roster."""

    def test_resolves_unique_surname(self):
        assert resolve_assister("Mann", NETS_ROSTER) == (1629611, None)

    def test_resolves_surname_with_apostrophe(self):
        assert resolve_assister("O'Neale", PHX_ROSTER) == (1626220, None)

    def test_resolves_suffixed_surname(self):
        assert resolve_assister("Porter Jr.", NETS_ROSTER) == (1629008, None)

    def test_ambiguous_surname_resolves_to_none_and_warns(self):
        """THE load-bearing case: two rostered players share a surname.

        Must yield None plus a warning, never a guess between them.
        """
        ambiguous = Roster({1629611: "Mann", 9999999: "Mann"})
        person_id, warning = resolve_assister("Mann", ambiguous)
        assert person_id is None
        assert warning is not None
        assert "ambiguous" in warning.lower()

    def test_unknown_surname_resolves_to_none_and_warns(self):
        person_id, warning = resolve_assister("Nobody", NETS_ROSTER)
        assert person_id is None
        assert warning is not None

    def test_does_not_resolve_across_teams(self):
        """A Nets assist must never resolve to a Suns player.

        Real collision in the fixture: "Williams" is on PHX, and the Nets sub
        "SUB: Williams FOR Porter Jr." refers to a different Williams. Resolution is
        scoped to one roster precisely so this cannot cross over.
        """
        person_id, warning = resolve_assister("Williams", NETS_ROSTER)
        assert person_id is None
        assert warning is not None

    def test_matching_is_case_and_whitespace_tolerant(self):
        assert resolve_assister("  mann  ", NETS_ROSTER) == (1629611, None)
