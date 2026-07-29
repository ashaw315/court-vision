"""Tests for the verification harness itself.

Written before the fixes. The re-review found that verify_game — whose entire job is to
REPORT problems — crashed on one of them, and that total attribution loss produced no
direct failure. A verifier that dies on bad data, or stays quiet about it, is worse than
no verifier: it converts a reportable anomaly into a crashed batch run, or into a clean
bill of health.
"""


from verify import ATTRIBUTION_THRESHOLD, verify_game

NETS = 1610612751
ROSTER_IDS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
STARTERS = (1, 2, 3, 4, 5)


def interval(interval_id, period, start, end, on_court):
    return {
        "gameId": "g",
        "intervalId": interval_id,
        "period": period,
        "startClock": start,
        "endClock": end,
        "onCourt": tuple(sorted(on_court)),
    }


def shot(event_id, period, clock, shooter, interval_id, assister=None):
    return {
        "gameId": "g",
        "eventId": event_id,
        "period": period,
        "clock": clock,
        "shooterId": shooter,
        "locX": 0,
        "locY": 0,
        "shotValue": 2,
        "made": True,
        "assisted": assister is not None,
        "assisterId": assister,
        "shotDistance": 1,
        "actionType": "Made Shot",
        "subType": "Jump Shot",
        "teamId": NETS,
        "intervalId": interval_id,
    }


def action(n, period, clock, person_id=1):
    return {
        "actionNumber": n,
        "period": period,
        "clock": clock,
        "teamId": NETS,
        "personId": person_id,
        "actionType": "Made Shot",
        "isFieldGoal": 1,
        "description": "S",
    }


def failed(report):
    return [name for name, passed, _ in report["checks"] if not passed]


CLEAN_INTERVALS = [
    interval("iv1", 1, "PT12M00.00S", "PT06M00.00S", (1, 2, 3, 4, 5)),
    interval("iv2", 1, "PT06M00.00S", "PT00M00.00S", (2, 3, 4, 5, 6)),
]
CLEAN_SHOTS = [
    shot(1, 1, "PT11M00.00S", 1, "iv1"),
    shot(2, 1, "PT05M00.00S", 6, "iv2"),
]
CLEAN_ACTIONS = [action(1, 1, "PT11M00.00S"), action(2, 1, "PT05M00.00S", 6)]
# 12 minutes of a single period: two players x 6 min each, five on court.
CLEAN_MINUTES = {1: 360, 2: 720, 3: 720, 4: 720, 5: 720, 6: 360}


class TestBaseline:
    def test_clean_input_passes_everything(self):
        report = verify_game(
            CLEAN_SHOTS, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert failed(report) == []
        assert report["problems"] == []


class TestDanglingIntervalId:
    """Re-review #1. A shot pointing at a nonexistent interval used to raise KeyError
    from the shooter-on-court check, after the dangling check had already detected it."""

    def test_dangling_interval_id_does_not_raise(self):
        shots = [dict(CLEAN_SHOTS[0], intervalId="BOGUS"), CLEAN_SHOTS[1]]
        report = verify_game(  # must not raise
            shots, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "every attributed shot points at a real interval" in failed(report)

    def test_dangling_interval_id_is_reported_not_silently_skipped(self):
        shots = [dict(CLEAN_SHOTS[0], intervalId="BOGUS"), CLEAN_SHOTS[1]]
        report = verify_game(
            shots, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert any("BOGUS" in p or "real interval" in p for p in report["problems"])

    def test_downstream_checks_still_run_after_a_dangling_reference(self):
        """A dangling id must not prevent the remaining checks from evaluating."""
        shots = [dict(CLEAN_SHOTS[0], intervalId="BOGUS"), CLEAN_SHOTS[1]]
        report = verify_game(
            shots, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        names = [name for name, _, _ in report["checks"]]
        assert "the shooter is on court for their own shot" in names


class TestAttributionCoverage:
    """Re-review #2. Stage 2's first run attributed 30 of 81 shots and still passed 11
    of 14 checks — the non-zero exit came from unrelated failures. Coverage collapse
    must be a direct, loud failure."""

    def test_total_attribution_loss_hard_fails(self):
        shots = [dict(s, intervalId=None) for s in CLEAN_SHOTS]
        report = verify_game(
            shots, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "shot attribution coverage" in failed(report)

    def test_partial_attribution_below_threshold_fails(self):
        # 1 of 4 attributed = 25%, well below the threshold.
        shots = [
            CLEAN_SHOTS[0],
            dict(CLEAN_SHOTS[1], eventId=3, intervalId=None),
            dict(CLEAN_SHOTS[1], eventId=4, intervalId=None),
            dict(CLEAN_SHOTS[1], eventId=5, intervalId=None),
        ]
        report = verify_game(
            shots, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "shot attribution coverage" in failed(report)

    def test_full_attribution_passes(self):
        report = verify_game(
            CLEAN_SHOTS, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "shot attribution coverage" not in failed(report)

    def test_threshold_is_strict(self):
        """Guards against the threshold being loosened into meaninglessness."""
        assert ATTRIBUTION_THRESHOLD >= 0.99


class TestMinutesReconciliation:
    """The strongest available validation: derived interval seconds per player must
    match boxscore minutes. Catches boundary errors that membership checks cannot —
    a shifted boundary keeps the right five and still corrupts every duration."""

    def test_matching_minutes_pass(self):
        report = verify_game(
            CLEAN_SHOTS, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "derived minutes match the boxscore" not in failed(report)

    def test_a_shifted_boundary_is_caught(self):
        """Membership is untouched; only the boundary moves. Nothing else detects this."""
        shifted = [
            interval("iv1", 1, "PT12M00.00S", "PT05M00.00S", (1, 2, 3, 4, 5)),
            interval("iv2", 1, "PT05M00.00S", "PT00M00.00S", (2, 3, 4, 5, 6)),
        ]
        report = verify_game(
            CLEAN_SHOTS, shifted, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "derived minutes match the boxscore" in failed(report)

    def test_a_swapped_player_is_caught_by_minutes(self):
        swapped = [
            CLEAN_INTERVALS[0],
            interval("iv2", 1, "PT06M00.00S", "PT00M00.00S", (2, 3, 4, 5, 7)),
        ]
        report = verify_game(
            CLEAN_SHOTS, swapped, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
        )
        assert "derived minutes match the boxscore" in failed(report)

    def test_check_is_skipped_when_no_boxscore_minutes_supplied(self):
        """Absent input must not masquerade as a pass."""
        report = verify_game(
            CLEAN_SHOTS, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=None,
        )
        names = [name for name, _, _ in report["checks"]]
        assert "derived minutes match the boxscore" not in names
        assert any("minutes reconciliation skipped" in p for p in report["problems"])


class TestContiguityIsStructural:
    """Re-review #4. Contiguity was decided by substring-scanning the problems list."""

    def test_a_gap_is_detected(self):
        gapped = [
            interval("iv1", 1, "PT12M00.00S", "PT07M00.00S", (1, 2, 3, 4, 5)),
            interval("iv2", 1, "PT06M00.00S", "PT00M00.00S", (2, 3, 4, 5, 6)),
        ]
        report = verify_game(
            CLEAN_SHOTS, gapped, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
        )
        assert "intervals tile each period contiguously" in failed(report)

    def test_an_overlap_is_detected(self):
        overlapping = [
            interval("iv1", 1, "PT12M00.00S", "PT05M00.00S", (1, 2, 3, 4, 5)),
            interval("iv2", 1, "PT06M00.00S", "PT00M00.00S", (2, 3, 4, 5, 6)),
        ]
        report = verify_game(
            CLEAN_SHOTS, overlapping, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
        )
        assert "intervals tile each period contiguously" in failed(report)

    def test_a_zero_length_interval_is_detected(self):
        zero = [
            interval("iv1", 1, "PT12M00.00S", "PT12M00.00S", (1, 2, 3, 4, 5)),
            interval("iv2", 1, "PT12M00.00S", "PT00M00.00S", (2, 3, 4, 5, 6)),
        ]
        report = verify_game(
            CLEAN_SHOTS, zero, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
        )
        assert "intervals tile each period contiguously" in failed(report)

    def test_a_backwards_interval_is_detected(self):
        backwards = [
            interval("iv1", 1, "PT06M00.00S", "PT12M00.00S", (1, 2, 3, 4, 5)),
        ]
        report = verify_game(
            CLEAN_SHOTS, backwards, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
        )
        assert "intervals tile each period contiguously" in failed(report)

    def test_an_unrelated_problem_mentioning_gap_does_not_fail_contiguity(self):
        """The old substring scan would mislabel any problem containing 'gap/overlap'."""
        report = verify_game(
            CLEAN_SHOTS, CLEAN_INTERVALS, CLEAN_ACTIONS, NETS, STARTERS, ROSTER_IDS,
            boxscore_seconds=CLEAN_MINUTES,
            extra_problems=["a gap/overlap in some unrelated subsystem"],
        )
        assert "intervals tile each period contiguously" not in failed(report)
