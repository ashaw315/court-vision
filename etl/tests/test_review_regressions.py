"""Permanent regression tests for the 8 defects found in adversarial review.

Each test is named for its finding and fails against the pre-fix implementation. These
are the tests that SHOULD have existed in stage 1 — the original suite passed because it
only exercised cases the implementation already handled.

Kept in one file so the review findings stay traceable as a set.
"""

import pytest
from transforms.assister import Roster, resolve_assister
from transforms.lineup_intervals import (
    _clock_seconds,
    build_lineup_intervals,
    interval_for_event,
)
from transforms.shot_events import (
    assisted_split,
    build_assist_edges,
    build_shot_events,
)
from verify import verify_game

NETS = 1610612751
OTHER = 1610612756

# A 7-man roster; 1-5 start.
# A 10-man roster; 1-5 start. Sized like a real one (the fixture game's Nets had 12) so
# tests can use bench players 6-10 without accidentally referencing an off-roster id —
# players not on the roster are correctly ignored by the derivation, which once made a
# test look like a logic failure when it was really bad test data.
ROSTER = Roster(
    {1: "A", 2: "B", 3: "C", 4: "D", 5: "E",
     6: "F", 7: "G", 8: "H", 9: "I", 10: "J"}
)
STARTERS = (1, 2, 3, 4, 5)


def shot(n, period, clock, person_id, made=True, value=2, desc="Shot"):
    return {
        "actionNumber": n,
        "period": period,
        "clock": clock,
        "teamId": NETS,
        "personId": person_id,
        "actionType": "Made Shot" if made else "Missed Shot",
        "subType": "Jump Shot",
        "isFieldGoal": 1,
        "shotResult": "Made" if made else "Missed",
        "shotValue": value,
        "xLegacy": 10,
        "yLegacy": 20,
        "shotDistance": 2,
        "description": desc,
    }


def sub(n, period, clock, out_person_id, incoming, outgoing):
    return {
        "actionNumber": n,
        "period": period,
        "clock": clock,
        "teamId": NETS,
        "personId": out_person_id,
        "actionType": "Substitution",
        "subType": "",
        "isFieldGoal": 0,
        "description": f"SUB: {incoming} FOR {outgoing}",
    }


def period_start(n, period, clock="PT12M00.00S"):
    return {
        "actionNumber": n,
        "period": period,
        "clock": clock,
        "teamId": 0,
        "personId": 0,
        "actionType": "period",
        "subType": "start",
        "isFieldGoal": 0,
        "description": f"Start of period {period}",
    }


class TestFinding1UnresolvedSubMustNotEmitStaleFive:
    """CRITICAL. An unresolved incoming substitute used to leave the on-court set
    unchanged, so the emitted interval still asserted the OUTGOING player was playing.
    A warning in a log does not undo a false record."""

    def test_no_interval_claims_the_departed_player_is_present(self):
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "Unknownguy", "A"),  # player 1 leaves
            shot(11, 1, "PT07M00.00S", 2),
        ]
        intervals, warnings = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS, return_warnings=True
        )
        assert warnings, "the unresolvable substitute must still be logged"
        after = [iv for iv in intervals if iv["startClock"] == "PT08M00.00S"]
        for iv in after:
            assert 1 not in iv["onCourt"], (
                "player 1 was subbed out — no interval may claim they were on court"
            )

    def test_the_pre_sub_interval_is_still_emitted(self):
        """Dropping the unresolvable stretch must not discard known-good history."""
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "Unknownguy", "A"),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert any(
            iv["startClock"] == "PT12M00.00S"
            and iv["endClock"] == "PT08M00.00S"
            and iv["onCourt"] == tuple(sorted(STARTERS))
            for iv in intervals
        )


class TestFinding2QuietStarterMustNotDropAPeriod:
    """CRITICAL. A starter who records no action before being subbed out was invisible
    to stream derivation, so the five came back short and the entire period was
    dropped. Starters now come from the boxscore."""

    def test_period_survives_when_a_starter_never_acts(self):
        events = [
            period_start(1, 3),
            # Only four starters act; player 5 is quiet then leaves.
            *[shot(2 + i, 3, "PT11M00.00S", p) for i, p in enumerate((1, 2, 3, 4))],
            sub(10, 3, "PT09M00.00S", 5, "F", "E"),
            shot(11, 3, "PT08M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert intervals, "the period must not vanish because a starter was quiet"
        assert intervals[0]["onCourt"] == tuple(sorted(STARTERS))
        assert 5 not in intervals[-1]["onCourt"], "the quiet starter was subbed out"
        assert 6 in intervals[-1]["onCourt"]

    def test_shots_in_such_a_period_remain_attributable(self):
        events = [
            period_start(1, 3),
            *[shot(2 + i, 3, "PT11M00.00S", p) for i, p in enumerate((1, 2, 3, 4))],
            sub(10, 3, "PT09M00.00S", 5, "F", "E"),
            shot(11, 3, "PT08M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert interval_for_event(intervals, 3, "PT08M00.00S") is not None


class TestFinding3ShotEventsCarryIntervalId:
    """CRITICAL. The two transforms never met: interval_for_event was dead code and
    ShotEvent had no link to a lineup. Lineup-filtered assists — the capability the
    whole PlayByPlayV3 rewrite was for — did not exist in the pipeline."""

    def test_shot_event_carries_the_containing_interval_id(self):
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "F", "A"),
            shot(11, 1, "PT07M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        shots = build_shot_events(
            events, "g", NETS, ROSTER, intervals=intervals
        )
        assert shots
        for s in shots:
            assert "intervalId" in s

    def test_shot_joins_to_exactly_one_interval(self):
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "F", "A"),
            shot(11, 1, "PT07M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        shots = build_shot_events(events, "g", NETS, ROSTER, intervals=intervals)
        by_id = {iv["intervalId"]: iv for iv in intervals}
        early = next(s for s in shots if s["clock"] == "PT11M00.00S")
        late = next(s for s in shots if s["clock"] == "PT07M00.00S")
        assert early["intervalId"] in by_id
        assert late["intervalId"] in by_id
        assert early["intervalId"] != late["intervalId"], (
            "shots either side of a substitution belong to different lineups"
        )
        # The late shot's lineup must be the post-sub five.
        assert 6 in by_id[late["intervalId"]]["onCourt"]

    def test_unattributable_shot_gets_null_interval_id_and_is_logged(self):
        """Explicitly unattributable, never silently wrong."""
        events = [shot(1, 1, "PT11M00.00S", 1)]
        shots, warnings = build_shot_events(
            events, "g", NETS, ROSTER, intervals=[], return_warnings=True
        )
        assert shots[0]["intervalId"] is None
        assert any("interval" in w.lower() for w in warnings)

    def test_lineup_filtered_assist_edges_are_possible(self):
        """The capability this all exists for: assists scoped to one lineup."""
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            shot(8, 1, "PT10M00.00S", 2, desc="B Layup (2 PTS) (A 1 AST)"),
            sub(10, 1, "PT08M00.00S", 1, "F", "A"),
            shot(11, 1, "PT07M00.00S", 6, desc="F Layup (2 PTS) (B 1 AST)"),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        shots = build_shot_events(events, "g", NETS, ROSTER, intervals=intervals)
        first_id = intervals[0]["intervalId"]
        in_first = [s for s in shots if s["intervalId"] == first_id]
        edges = build_assist_edges(in_first)
        assert edges == [
            {"assisterId": 1, "shooterId": 2, "count": 1, "points": 2,
             "made2": 1, "made3": 0}
        ]


class TestFinding5ShotBeforeFirstRecordedAction:
    """A shot earlier than the first recorded action mapped to None, because the
    period's opening clock fell back to the largest OBSERVED clock."""

    def test_shot_before_first_action_maps_to_opening_interval(self):
        # No period-start event; first action is at 11:00.
        events = [
            *[shot(1 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "F", "A"),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert intervals[0]["startClock"] == "PT12M00.00S", (
            "the period opens at 12:00 regardless of when the first action is recorded"
        )
        assert interval_for_event(intervals, 1, "PT11M30.00S") is not None

    def test_overtime_opens_at_five_minutes(self):
        events = [
            period_start(1, 5, "PT05M00.00S"),
            *[shot(2 + i, 5, "PT04M00.00S", p) for i, p in enumerate(STARTERS)],
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert intervals[0]["startClock"] == "PT05M00.00S"


class TestFinding6SubAtPeriodStartInstant:
    """A substitution at the exact period-start clock dropped the starting five."""

    def test_starting_five_is_not_lost(self):
        events = [
            period_start(1, 1),
            sub(2, 1, "PT12M00.00S", 1, "F", "A"),
            *[shot(3 + i, 1, "PT11M00.00S", p) for i, p in enumerate((2, 3, 4, 5, 6))],
        ]
        intervals, warnings = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS, return_warnings=True
        )
        assert intervals, "a sub at 12:00 must not erase the period"
        # No zero-length interval should be emitted for the instant itself.
        assert all(
            iv["startClock"] != iv["endClock"] for iv in intervals
        ), "no zero-length intervals"
        # The five that actually played is the post-sub one.
        assert 6 in intervals[0]["onCourt"]
        assert 1 not in intervals[0]["onCourt"]


class TestFinding7SelfAssistMustNotInflateTheSplit:
    """A description crediting the shooter is impossible source data, not a genuine
    assist with an unresolvable name. It used to count in the assisted numerator."""

    def test_self_assist_is_excluded_from_assisted(self):
        events = [
            shot(1, 1, "PT11M00.00S", 1, desc="A Layup (2 PTS) (A 1 AST)"),
        ]
        shots, warnings = build_shot_events(
            events, "g", NETS, ROSTER, return_warnings=True
        )
        assert shots[0]["assisted"] is False, (
            "a self-assist is a data error, not an assisted basket"
        )
        assert shots[0]["assisterId"] is None
        assert any("shooter" in w.lower() for w in warnings)

        split = assisted_split(shots)
        assert split["assisted"] == 0
        assert split["selfCreated"] == 1
        assert split["assistedPct"] == 0.0

    def test_genuinely_unresolvable_assist_still_counts_as_assisted(self):
        """The distinction that matters: unknown NAME vs impossible RECORD."""
        events = [
            shot(1, 1, "PT11M00.00S", 1, desc="A Layup (2 PTS) (Nobody 1 AST)"),
        ]
        shots = build_shot_events(events, "g", NETS, ROSTER)
        assert shots[0]["assisted"] is True
        assert shots[0]["assisterId"] is None
        split = assisted_split(shots)
        assert split["assisted"] == 1
        assert split["unresolvedAssisted"] == 1


class TestFinding8SurnameNormalisation:
    """A roster surname written without its trailing period never matched a
    description that had one — a silent miss counted as 'unresolved'."""

    def test_trailing_period_variance_still_matches(self):
        roster = Roster({1: "Porter Jr", 2: "X"})
        assert resolve_assister("Porter Jr.", roster) == (1, None)

    def test_reverse_direction_also_matches(self):
        roster = Roster({1: "Porter Jr.", 2: "X"})
        assert resolve_assister("Porter Jr", roster) == (1, None)

    def test_internal_periods_are_still_normalised(self):
        roster = Roster({1: "J.J. Barea"})
        assert resolve_assister("JJ Barea", roster) == (1, None)

    def test_distinct_surnames_do_not_collapse(self):
        """Normalisation must not fuse genuinely different players."""
        roster = Roster({1: "Porter Jr.", 2: "Porter"})
        assert resolve_assister("Porter Jr.", roster) == (1, None)
        assert resolve_assister("Porter", roster) == (2, None)

    def test_ambiguity_after_normalisation_is_still_refused(self):
        roster = Roster({1: "Porter Jr", 2: "Porter Jr."})
        person_id, warning = resolve_assister("Porter Jr.", roster)
        assert person_id is None
        assert "ambiguous" in warning.lower()


class TestFinding11FiveDoesNotCarryAcrossPeriods:
    """CRITICAL, found by stage 2 against the first COMPLETE 4-period stream.

    The model assumed the on-court five carries across a period boundary. It does not:
    coaches re-choose freely at the break and NO substitution events describe it. In the
    validated game Porter Jr. was subbed out at P1 6:04, never subbed back in during P1,
    and opened P2 on court.

    Carrying forward produced a five the next events contradicted, which tripped the
    "outgoing player was not on court" refusal and CASCADED: periods 3 and 4 emitted
    nothing and 51 of 81 shots lost lineup attribution.
    """

    def test_player_absent_at_period_end_can_open_the_next_period(self):
        """The P2 five is deliberately DIFFERENT from both the P1-closing five and the
        boxscore starters, so this test can distinguish observation from either
        carry-forward or fall-back-to-starters. (An earlier version of this test used a
        P2 five identical to the starters and therefore proved nothing.)
        """
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            # Player 1 leaves in P1 and never returns during P1.
            sub(10, 1, "PT06M00.00S", 1, "F", "A"),  # 6 in for 1
            shot(11, 1, "PT05M00.00S", 6),
            # P1 therefore CLOSES with (2,3,4,5,6).
            # P2 opens with (1,2,3,7,8): player 1 is back with NO substitution event
            # saying so, and 7/8 are new. This equals neither the closing five nor the
            # starters (1,2,3,4,5).
            period_start(20, 2),
            *[shot(21 + i, 2, "PT11M00.00S", p) for i, p in enumerate((1, 2, 3, 7, 8))],
        ]
        intervals, warnings = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS, return_warnings=True
        )
        p2 = [iv for iv in intervals if iv["period"] == 2]
        assert p2, "period 2 must produce intervals"
        assert p2[0]["onCourt"] == (1, 2, 3, 7, 8), (
            "period 2's five is observed from its own events — not carried forward "
            f"from P1's closing five (2,3,4,5,6) nor fallen back to the starters "
            f"{tuple(sorted(STARTERS))}; got {p2[0]['onCourt']}"
        )
        assert 1 in p2[0]["onCourt"], "player 1 returned without a substitution event"
        assert 6 not in p2[0]["onCourt"], "player 6 did not open period 2"

    def test_a_broken_period_does_not_cascade_into_later_periods(self):
        """Each period is derived independently, so one failure stays contained."""
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            # Unresolvable sub breaks period 1 from here.
            sub(10, 1, "PT06M00.00S", 1, "Zzz", "A"),
            # Period 2 is perfectly well described.
            period_start(20, 2),
            *[shot(21 + i, 2, "PT11M00.00S", p) for i, p in enumerate((2, 3, 4, 5, 6))],
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert [iv for iv in intervals if iv["period"] == 2], (
            "period 2 must survive a failure in period 1"
        )

    def test_quiet_opener_is_observed_from_being_subbed_out(self):
        """A player who acts not at all but IS subbed out was evidently on court.

        `personId` on a substitution is the outgoing player, which makes this directly
        observable — closing the quiet-starter gap for periods 2+ where there is no
        boxscore five to fall back on.
        """
        # The five here is (7,2,3,4,8) — distinct from the starters, so a fall-back to
        # starters would give the wrong answer and this test would catch it.
        events = [
            period_start(1, 2),
            # Only four act; player 8 does nothing but is subbed out.
            *[shot(2 + i, 2, "PT11M00.00S", p) for i, p in enumerate((7, 2, 3, 4))],
            sub(10, 2, "PT09M00.00S", 8, "F", "H"),
            shot(11, 2, "PT08M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        assert intervals
        assert intervals[0]["onCourt"] == tuple(sorted((7, 2, 3, 4, 8))), (
            "the quiet player is observed as an opener via their substitution out, and "
            f"the five is not the boxscore starters; got {intervals[0]['onCourt']}"
        )

    def test_period_one_prefers_the_boxscore_and_reports_disagreement(self):
        # Observation would see 6 first (a stand-in), but the boxscore is authoritative.
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate((6, 2, 3, 4, 5))],
        ]
        intervals, warnings = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS, return_warnings=True
        )
        assert intervals[0]["onCourt"] == tuple(sorted(STARTERS)), "boxscore wins"
        assert any("disagree" in w.lower() for w in warnings), (
            f"the disagreement must be reported, not silently resolved; got {warnings}"
        )


class TestFinding12DiacriticFolding:
    """CRITICAL, found by the stage-3 full-season run — the first bug volume exposed.

    The boxscore spells surnames with diacritics; play-by-play descriptions spell the same
    players in plain ASCII. Real Nets/opponent examples:

        boxscore 'Dëmin'    description 'Demin'
        boxscore 'Diabaté'  description 'Diabate'
        boxscore 'Salaün'   description 'Salaun'

    `_normalise` dropped periods but not diacritics, so these never matched. The damage was
    NOT limited to a missing assist edge — it cascaded:

      * the assister resolved to None (never-guess path firing on a player we CAN identify),
      * and, worse, `_seed_opening_five` could not subtract that player from the boxscore
        participation set, so it computed SIX openers instead of five, returned None, and
        the whole period degraded to observation or was dropped.

    On game 0022500080 that meant 27 of 88 shots unattributed (69.3% coverage) and minutes
    short by up to 571 seconds for one player. Three of the first three games failed
    identically.
    """

    def test_ascii_description_matches_diacritic_roster(self):
        roster = Roster({1642856: "Dëmin", 2: "Other"})
        assert resolve_assister("Demin", roster) == (1642856, None)

    def test_diacritic_description_matches_ascii_roster(self):
        """Fold both directions — neither source is canonical."""
        roster = Roster({1642856: "Demin", 2: "Other"})
        assert resolve_assister("Dëmin", roster) == (1642856, None)

    def test_real_season_examples_all_fold(self):
        roster = Roster({1: "Dëmin", 2: "Diabaté", 3: "Salaün"})
        assert resolve_assister("Demin", roster) == (1, None)
        assert resolve_assister("Diabate", roster) == (2, None)
        assert resolve_assister("Salaun", roster) == (3, None)

    def test_folding_does_not_fuse_genuinely_different_surnames(self):
        """Diacritic folding must not create NEW ambiguity between distinct players."""
        roster = Roster({1: "Dëmin", 2: "Domin"})
        assert resolve_assister("Demin", roster) == (1, None)
        assert resolve_assister("Domin", roster) == (2, None)

    def test_a_genuine_post_folding_collision_is_still_refused(self):
        """If two rostered players fold to the same surname, still never guess."""
        roster = Roster({1: "Dëmin", 2: "Demin"})
        person_id, warning = resolve_assister("Demin", roster)
        assert person_id is None
        assert "ambiguous" in warning.lower()

    def test_substitution_with_a_folded_surname_seeds_five_openers(self):
        """The cascade guard: an unfoldable name broke opener seeding, not just assists."""
        roster = Roster({1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "Dëmin"})
        events = [
            period_start(1, 2),
            *[shot(2 + i, 2, "PT11M00.00S", p) for i, p in enumerate((1, 2, 3, 4))],
            # 'Demin' (ASCII) comes in for player 5, whose roster entry is 'Dëmin'.
            sub(10, 2, "PT08M00.00S", 5, "Demin", "E"),
            shot(11, 2, "PT07M00.00S", 6),
        ]
        # Boxscore participation lists SIX players for the period: the five who opened
        # plus the substitute. Only correct folding subtracts the substitute.
        participation = {2: {1: 660, 2: 660, 3: 660, 4: 660, 5: 480, 6: 180}}
        intervals, warnings = build_lineup_intervals(
            events, "g", NETS, roster, starters=(1, 2, 3, 4, 5),
            period_participation=participation, return_warnings=True,
        )
        assert intervals, "the period must not degrade because a name had a diaeresis"
        assert intervals[0]["onCourt"] == (1, 2, 3, 4, 5)
        assert not any("refusing to guess" in w for w in warnings)


class TestFinding13OutOfOrderSubstitutionClocks:
    """Stage-3 finding: SOURCE DATA sometimes mis-stamps a substitution's clock.

    In 10 of the 82 games exactly ONE substitution carries a clock EARLIER in the period
    than the substitution before it, despite a higher `actionNumber`. Real example, game
    0022500335 period 4:

        #614  PT07M12.00S  SUB: Wolf FOR Demin
        #620  PT10M46.00S  SUB: Williams FOR Wolf     <- 3.5 minutes EARLIER
        #621  PT10M46.00S  SUB: Mann FOR Saraf

    Because intervals are opened in `actionNumber` order, a backwards clock produces an
    interval whose end precedes its start, which then overlaps its neighbours and corrupts
    every duration after it. The verifier catches this precisely — all 10 affected games
    failed `intervals tile each period contiguously`, and all 72 unaffected games passed,
    a perfect 1:1 correlation with zero false positives.

    NOT FIXED HERE, deliberately. Reconstructing the true intent means guessing which of
    two contradictory stamps is right, and CLAUDE.md's rule is that we do not guess about
    real players. These tests pin the CURRENT behaviour: the anomaly is DETECTED and the
    game is excluded from the aggregate, rather than silently producing wrong minutes.
    Whoever fixes it should decide the policy first — see etl/README.md.
    """

    def _events_with_backwards_sub(self):
        return [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT08M00.00S", 1, "F", "A"),
            # Higher actionNumber, but a clock EARLIER in the period. Source anomaly.
            sub(20, 1, "PT10M00.00S", 2, "G", "B"),
            shot(30, 1, "PT02M00.00S", 6),
        ]

    def test_the_verifier_detects_the_resulting_broken_tiling(self):
        """The guard that made this findable at all."""
        intervals = build_lineup_intervals(
            self._events_with_backwards_sub(), "g", NETS, ROSTER, starters=STARTERS
        )
        report = verify_game(
            [], intervals, self._events_with_backwards_sub(), NETS, STARTERS,
            set(ROSTER.by_person_id),
        )
        failed = [name for name, passed, _ in report["checks"] if not passed]
        assert "intervals tile each period contiguously" in failed, (
            "a backwards substitution clock must be reported, not absorbed"
        )

    def test_a_backwards_clock_produces_a_detectably_inverted_interval(self):
        """Pins the mechanism: end precedes start, which is what tiling detects."""
        intervals = build_lineup_intervals(
            self._events_with_backwards_sub(), "g", NETS, ROSTER, starters=STARTERS
        )
        inverted = [
            iv for iv in intervals
            if _clock_seconds(iv["startClock"]) < _clock_seconds(iv["endClock"])
        ]
        assert inverted, "expected an inverted interval from the mis-stamped clock"

    def test_well_ordered_substitutions_still_tile_cleanly(self):
        """Guards against a future 'fix' that flags healthy games too."""
        events = [
            period_start(1, 1),
            *[shot(2 + i, 1, "PT11M00.00S", p) for i, p in enumerate(STARTERS)],
            sub(10, 1, "PT10M00.00S", 2, "G", "B"),
            sub(20, 1, "PT08M00.00S", 1, "F", "A"),
            shot(30, 1, "PT02M00.00S", 6),
        ]
        intervals = build_lineup_intervals(
            events, "g", NETS, ROSTER, starters=STARTERS
        )
        report = verify_game(
            [], intervals, events, NETS, STARTERS, set(ROSTER.by_person_id),
        )
        failed = [name for name, passed, _ in report["checks"] if not passed]
        assert "intervals tile each period contiguously" not in failed


class TestRobustnessFixes:
    """build_assist_edges must report malformed input; assisted_split must not
    silently aggregate across teams."""

    def test_malformed_event_reports_rather_than_raising_keyerror(self):
        malformed = [{"made": True, "assisted": True, "assisterId": 1}]  # no shooterId
        with pytest.raises(ValueError, match="shooterId"):
            build_assist_edges(malformed)

    def test_assisted_split_rejects_mixed_teams(self):
        mixed = [
            {"made": True, "assisted": True, "assisterId": 2, "teamId": NETS},
            {"made": True, "assisted": True, "assisterId": 3, "teamId": OTHER},
        ]
        with pytest.raises(ValueError, match="team"):
            assisted_split(mixed)

    def test_assisted_split_accepts_single_team(self):
        single = [
            {"made": True, "assisted": True, "assisterId": 2, "teamId": NETS},
            {"made": True, "assisted": False, "assisterId": None, "teamId": NETS},
        ]
        split = assisted_split(single)
        assert split["madeBaskets"] == 2
        assert split["assisted"] == 1
