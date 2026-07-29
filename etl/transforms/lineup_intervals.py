"""Lineup-interval derivation — reconstructing the on-court five over time.

The highest-risk transform in the project. Play-by-play never states who is on court;
it only reports CHANGES (substitutions). The five must be reconstructed.

Method:

1. **Seed period 1 from the boxscore's authoritative starting five** (see
   transforms/roster.py). Stream-derived starters were removed in response to review
   finding #2: a starter who recorded no action before being substituted out was
   invisible, the derived five came back short, and the WHOLE PERIOD was dropped.

2. **Apply substitutions chronologically.** V3 writes them as
   `"SUB: <incoming> FOR <outgoing>"`, with `personId` set to the OUTGOING player
   (verified against fixture event #67: personId 1629008 Porter Jr., description
   "SUB: Williams FOR Porter Jr."). The incoming player appears only as a bare
   surname, so it carries the same resolution hazard as the assister — and the same
   never-guess rule.

3. **Determine each period's opening five independently.**

   Stage 2, against a complete 4-period stream, disproved the previous assumption that
   the five carries across a period boundary. Coaches re-choose freely at the break and
   **NO substitution events are emitted for it** — in the validated game Porter Jr. was
   subbed out at P1 6:04, never subbed back in during P1, and was on court to open P2.
   Carrying forward therefore produced a five contradicted by the very next events, and
   the resulting "outgoing player was not on court" refusal cascaded: periods 3 and 4
   emitted nothing at all and 51 of 81 shots lost attribution.

   Period-start events carry no lineup (`"Start of 3rd Period (8:59 PM EST)"`), so the
   opening five is observed from the stream: a player who ACTS before ever being
   substituted in during that period must have been on court when it began. Verified on
   the complete stream — all four periods yield exactly five, and period 1's observed
   five matches the boxscore starters exactly, which cross-validates the method against
   an independent source.

   Period 1 uses the boxscore starters outright (authoritative), and disagreement with
   observation is reported rather than silently preferred either way.

**What happens when a substitution cannot be resolved (finding #1).** If the incoming
surname does not resolve to exactly one rostered player, the on-court five becomes
UNKNOWN from that moment until the next period boundary re-seeds it. Those intervals
are dropped and logged. The previous behaviour — leaving the set unchanged — emitted an
interval asserting the OUTGOING player was still playing, which is fabrication: a
warning in a log does not undo a false record in the database.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from .assister import Roster

_SUB = re.compile(r"^SUB:\s+(?P<incoming>.+?)\s+FOR\s+(?P<outgoing>.+?)\s*$")

# Actions that prove presence on court. A substitution is excluded deliberately: being
# subbed IN is what makes a player present from that point, not before.
_PRESENCE_EXCLUDED = {"Substitution", "period", "Timeout", "Jump Ball"}


def parse_substitution(description: str) -> tuple[str, str] | None:
    """Return (incoming_surname, outgoing_surname), or None if not a substitution."""
    if not description:
        return None
    match = _SUB.match(description.strip())
    if not match:
        return None
    return match.group("incoming").strip(), match.group("outgoing").strip()


def _clock_seconds(clock: str) -> float:
    """ISO-8601 duration "PT11M41.00S" -> seconds remaining (float).

    Used only for ordering and containment; the raw string is what gets emitted, so a
    rounding difference here can never corrupt a stored value.
    """
    match = re.match(r"^PT(?:(\d+)M)?([\d.]+)S$", clock)
    if not match:
        return 0.0
    minutes = int(match.group(1) or 0)
    return minutes * 60 + float(match.group(2))


def build_lineup_intervals(
    actions: Iterable[dict[str, Any]],
    game_id: str,
    team_id: int,
    roster: Roster,
    starters: tuple[int, ...] | None = None,
    period_participation: dict[int, dict[int, int]] | None = None,
    return_warnings: bool = False,
):
    """Derive LineupIntervals for ONE team across all periods in the action stream.

    `starters` is the boxscore's authoritative starting five (see roster.py), used for
    period 1.

    `period_participation` is {period: {personId: secondsPlayed}} from per-period
    boxscore calls. When supplied it anchors each period's opening five to the boxscore
    rather than to whoever happened to record an action, which makes the "fewer than five
    players acted" failure structurally impossible. When absent, derivation falls back to
    observation alone and says so.
    """
    actions = list(actions)
    warnings: list[str] = []
    intervals: list[dict[str, Any]] = []

    periods = sorted({a["period"] for a in actions if a.get("period")})

    if starters is None:
        warnings.append(
            f"game {game_id} team {team_id}: no boxscore starting five supplied — "
            f"emitting no lineup intervals rather than guessing who was on court"
        )
        return ([], warnings) if return_warnings else []

    # Each period is derived independently — the five does NOT carry across a boundary
    # (see module docstring). A failure in one period can no longer cascade into the next.
    for period in periods:
        period_actions = [a for a in actions if a.get("period") == period]
        period_intervals, period_warnings = _build_period(
            period_actions,
            game_id,
            team_id,
            roster,
            period,
            starters,
            (period_participation or {}).get(period),
        )
        intervals.extend(period_intervals)
        warnings.extend(period_warnings)

    if return_warnings:
        return intervals, warnings
    return intervals


def _build_period(
    period_actions: list[dict[str, Any]],
    game_id: str,
    team_id: int,
    roster: Roster,
    period: int,
    starters: tuple[int, ...],
    participation: dict[int, int] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []

    # Order by the stream's own sequence; actionNumber is monotonic within a game.
    ordered = sorted(period_actions, key=lambda a: a["actionNumber"])

    subs = [
        a for a in ordered
        if a.get("actionType") == "Substitution" and a.get("teamId") == team_id
    ]

    observed = _observe_opening_five(ordered, team_id, roster, subs)
    seeded = _seed_opening_five(participation, roster, subs)

    if period == 1:
        # The boxscore is authoritative for who started the GAME.
        opening_five = set(starters)
        source = "boxscore starters"
    elif seeded is not None:
        opening_five = set(seeded)
        source = "boxscore participation"
    elif observed is not None:
        opening_five = set(observed)
        source = "stream observation (no per-period boxscore supplied)"
        warnings.append(
            f"game {game_id} period {period}: no per-period boxscore participation "
            f"available — opening five derived from stream observation alone, which can "
            f"fail when fewer than five players record an action"
        )
    else:
        # Cannot establish who opened this period. Emit nothing for it rather than
        # guess; the failure stays contained to this period.
        warnings.append(
            f"game {game_id} period {period}: could not establish an opening five from "
            f"either the boxscore or the stream — emitting no intervals for this period"
        )
        return [], warnings

    # Observation is a CROSS-CHECK against the seed, never a silent override. A
    # disagreement is reported: one of the two sources is wrong about this period and a
    # human should know which.
    if observed is not None and set(observed) != opening_five:
        warnings.append(
            f"game {game_id} period {period}: opening five from {source} "
            f"{sorted(opening_five)} disagrees with stream observation "
            f"{sorted(observed)} — using {source}"
        )

    # Anyone who acts in this period but is absent from the boxscore's participation set
    # is a contradiction between two supposedly authoritative sources.
    if participation:
        acted = {
            a.get("personId")
            for a in ordered
            if a.get("teamId") == team_id
            and a.get("actionType") not in _PRESENCE_EXCLUDED
            and a.get("personId")
        }
        ghosts = sorted(pid for pid in acted if pid not in participation)
        if ghosts:
            warnings.append(
                f"game {game_id} period {period}: player(s) {ghosts} recorded an action "
                f"but are not in the boxscore participation for this period"
            )

    period_start = _period_start_clock(ordered, period)
    period_end = _period_end_clock(ordered)

    on_court: set[int] | None = set(opening_five)
    intervals: list[dict[str, Any] | None] = []
    open_clock = period_start

    # Group simultaneous substitutions: several subs at one stoppage share a clock and
    # must produce ONE boundary, not a chain of zero-length intervals.
    for clock, group in _group_by_clock(subs):
        # A substitution at the exact period-start instant (finding #6) must not emit a
        # zero-length interval; the five it would describe never played.
        if clock != open_clock:
            intervals.append(
                _interval(game_id, period, open_clock, clock, on_court, warnings, team_id)
            )
            open_clock = clock

        for sub_action in group:
            on_court = _apply_sub(
                on_court, sub_action, roster, game_id, period, warnings
            )
            if on_court is None:
                # Unresolvable from here on. Emit nothing further for this period.
                break
        if on_court is None:
            break

    if on_court is not None:
        intervals.append(
            _interval(game_id, period, open_clock, period_end, on_court, warnings, team_id)
        )

    valid = [iv for iv in intervals if iv is not None]
    return valid, warnings


def _seed_opening_five(
    participation: dict[int, int] | None,
    roster: Roster,
    subs: list[dict[str, Any]],
) -> tuple[int, ...] | None:
    """The period's opening five, anchored to the boxscore.

        openers = (played this period) MINUS (entered as a substitute before ever
                                              being substituted out)

    The candidate set comes from the boxscore, so a player who was on court but recorded
    no action is still included — which is what makes a short or quiet period safe. The
    stream is consulted only for the DIRECTION of each substitution, which is exactly
    what it reliably reports.

    A player who is subbed in and later subbed out did not open. A player subbed OUT
    first evidently did open, even if they also return later, which is why the
    first-appearance order matters rather than mere membership.

    Returns None if the arithmetic does not land on exactly five, so the caller can fall
    back or refuse rather than emit a wrong five.
    """
    if not participation:
        return None

    entered_before_leaving: set[int] = set()
    left_already: set[int] = set()

    for sub_action in subs:
        parsed = parse_substitution(sub_action.get("description", ""))
        if not parsed:
            continue
        incoming_surname, _outgoing = parsed
        candidates = roster.candidates(incoming_surname)
        incoming_id = candidates[0] if len(candidates) == 1 else None
        outgoing_id = sub_action.get("personId") or None

        if (
            incoming_id is not None
            and incoming_id not in left_already
            and incoming_id not in entered_before_leaving
        ):
            entered_before_leaving.add(incoming_id)
        if outgoing_id:
            left_already.add(outgoing_id)

    openers = {
        person_id
        for person_id in participation
        if person_id not in entered_before_leaving
    }

    if len(openers) != 5:
        return None
    return tuple(sorted(openers))


def _observe_opening_five(
    ordered: list[dict[str, Any]],
    team_id: int,
    roster: Roster,
    subs: list[dict[str, Any]],
) -> tuple[int, ...] | None:
    """Observe which five were on court when this period began.

    A player who ACTS before ever being substituted in during the period must have been
    on court at its start. The comparison is positional (actionNumber), not a flat
    exclusion, because a player can open the period, be subbed out, and return — merely
    appearing as an incoming substitute does not disqualify them from having opened it.

    Also treats a player subbed OUT before recording any action as an opener: they were
    evidently on court, they simply did nothing first. `personId` on a substitution is
    the outgoing player, which makes this directly observable — and it closes the
    "quiet starter" gap that review finding #2 was about.

    Returns None if fewer than five can be established, so the caller can refuse rather
    than guess.
    """
    # personId -> actionNumber of their FIRST substitution-in this period.
    first_sub_in: dict[int, int] = {}
    for sub_action in subs:
        parsed = parse_substitution(sub_action.get("description", ""))
        if not parsed:
            continue
        candidates = roster.candidates(parsed[0])
        if len(candidates) == 1:
            first_sub_in.setdefault(candidates[0], sub_action["actionNumber"])

    observed: list[int] = []

    def note(person_id: int) -> None:
        if person_id and person_id in roster.by_person_id and person_id not in observed:
            observed.append(person_id)

    for action in ordered:
        if len(observed) == 5:
            break
        if action.get("teamId") != team_id:
            continue

        # A player subbed out before acting was on court from the period's start.
        if action.get("actionType") == "Substitution":
            outgoing_id = action.get("personId")
            if outgoing_id and outgoing_id not in observed:
                subbed_in_at = first_sub_in.get(outgoing_id)
                if subbed_in_at is None or action["actionNumber"] < subbed_in_at:
                    note(outgoing_id)
            continue

        if action.get("actionType") in _PRESENCE_EXCLUDED:
            continue

        person_id = action.get("personId")
        if not person_id or person_id in observed:
            continue
        subbed_in_at = first_sub_in.get(person_id)
        if subbed_in_at is not None and action["actionNumber"] > subbed_in_at:
            continue  # first action follows their substitution in — not an opener
        note(person_id)

    if len(observed) != 5:
        return None
    return tuple(sorted(observed))


def _group_by_clock(subs: list[dict[str, Any]]):
    """Yield (clock, [subs]) in stream order, collapsing same-clock substitutions."""
    grouped: list[tuple[str, list[dict[str, Any]]]] = []
    for sub_action in subs:
        clock = sub_action["clock"]
        if grouped and grouped[-1][0] == clock:
            grouped[-1][1].append(sub_action)
        else:
            grouped.append((clock, [sub_action]))
    return grouped


def _apply_sub(
    on_court: set[int],
    sub_action: dict[str, Any],
    roster: Roster,
    game_id: str,
    period: int,
    warnings: list[str],
) -> set[int] | None:
    """Advance the on-court five by one substitution.

    Returns None when the substitution cannot be resolved. That propagates as "the five
    is unknown from here", and the caller stops emitting intervals for the period.

    Finding #1: this previously returned `on_court` unchanged, which meant the emitted
    interval still listed the OUTGOING player as being on court. The player had left;
    claiming otherwise is a fabricated record, and the accompanying log warning does not
    undo it. Refusing to emit is the only honest option — a gap is incomplete, a stale
    five is wrong.
    """
    parsed = parse_substitution(sub_action.get("description", ""))
    if parsed is None:
        warnings.append(
            f"game {game_id} period {period} event {sub_action.get('actionNumber')}: "
            f"unparseable substitution {sub_action.get('description')!r} — on-court five "
            f"is now unknown, dropping the rest of the period"
        )
        return None

    incoming_surname, _outgoing_surname = parsed

    # The outgoing player is carried structurally as personId — trust it over the text.
    outgoing_id = sub_action.get("personId") or None

    candidates = roster.candidates(incoming_surname)
    if len(candidates) != 1:
        reason = "ambiguous" if candidates else "unknown"
        warnings.append(
            f"game {game_id} period {period} event {sub_action.get('actionNumber')}: "
            f"{reason} incoming substitute {incoming_surname!r} "
            f"({len(candidates)} roster matches) — refusing to guess; on-court five is "
            f"now unknown, dropping the rest of the period"
        )
        return None

    incoming_id = candidates[0]

    updated = set(on_court)
    if outgoing_id in updated:
        updated.discard(outgoing_id)
    else:
        # The outgoing player was not where we thought they were, so our model of the
        # five is already wrong. Do not paper over it by simply adding the incoming.
        warnings.append(
            f"game {game_id} period {period} event {sub_action.get('actionNumber')}: "
            f"outgoing player {outgoing_id} was not on court {sorted(on_court)} — "
            f"on-court five is now unknown, dropping the rest of the period"
        )
        return None
    updated.add(incoming_id)

    if len(updated) != 5:
        warnings.append(
            f"game {game_id} period {period} event {sub_action.get('actionNumber')}: "
            f"substitution produced {len(updated)} players, not 5 — on-court five is "
            f"now unknown, dropping the rest of the period"
        )
        return None

    return updated


def _interval(
    game_id: str,
    period: int,
    start_clock: str,
    end_clock: str,
    on_court: set[int],
    warnings: list[str],
    team_id: int,
) -> dict[str, Any] | None:
    if len(on_court) != 5:
        warnings.append(
            f"game {game_id} period {period} {start_clock}->{end_clock}: on-court set "
            f"has {len(on_court)} players, not 5 — dropping this interval rather than "
            f"emitting a fabricated five"
        )
        return None
    return {
        "gameId": game_id,
        "intervalId": f"{game_id}:{team_id}:{period}:{start_clock}",
        "period": period,
        "startClock": start_clock,
        "endClock": end_clock,
        "onCourt": tuple(sorted(on_court)),
    }


def _period_start_clock(ordered: list[dict[str, Any]], period: int) -> str:
    """The clock at which a period OPENS — not when its first action was recorded.

    Finding #5: this used to fall back to the largest observed clock, so with no explicit
    period-start event the first interval began at (say) 11:00 and a shot at 11:30 mapped
    to nothing. The period's true opening is a known constant: 12:00 in regulation, 5:00
    in overtime.
    """
    for action in ordered:
        if action.get("actionType") == "period" and action.get("subType") == "start":
            return action["clock"]

    nominal = "PT12M00.00S" if period <= 4 else "PT05M00.00S"

    # If the stream somehow starts EARLIER than nominal (unexpected), respect the data.
    clocks = [a["clock"] for a in ordered if a.get("clock")]
    if clocks:
        earliest = max(clocks, key=_clock_seconds)
        if _clock_seconds(earliest) > _clock_seconds(nominal):
            return earliest
    return nominal


def _period_end_clock(ordered: list[dict[str, Any]]) -> str:
    for action in reversed(ordered):
        if action.get("actionType") == "period" and action.get("subType") == "end":
            return action["clock"]
    clocks = [a["clock"] for a in ordered if a.get("clock")]
    if not clocks:
        return "PT00M00.00S"
    return min(clocks, key=_clock_seconds)


def interval_for_event(
    intervals: list[dict[str, Any]], period: int, clock: str
) -> dict[str, Any] | None:
    """Find the interval containing a moment. Clocks count DOWN within a period.

    Convention: an interval covers [startClock, endClock] on the descending clock, i.e.
    start >= at >= end, and the EARLIER interval wins a tie at a shared boundary. So a
    shot at the exact instant of a substitution belongs to the OUTGOING five — the shot
    happened, then play stopped for the substitution.

    A tenth defect found while fixing #3: the previous half-open `end < at <= start` rule
    silently dropped any shot at exactly `endClock`. Because the final interval of a
    period ends at PT00M00.00S, that meant a buzzer-beater — and any shot landing exactly
    on a substitution boundary — mapped to no lineup at all.
    """
    at = _clock_seconds(clock)
    candidates = [
        interval
        for interval in intervals
        if interval["period"] == period
        and _clock_seconds(interval["endClock"]) <= at <= _clock_seconds(interval["startClock"])
    ]
    if not candidates:
        return None
    # Earliest-starting interval wins a boundary tie (the outgoing five).
    return max(candidates, key=lambda iv: _clock_seconds(iv["startClock"]))
