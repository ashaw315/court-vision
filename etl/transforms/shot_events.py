"""ShotEvent assembly, the assisted-vs-unassisted split, and AssistEdge aggregation.

Emits dicts matching the Phase 2 Zod contract (src/lib/contracts) in camelCase, so the
JSON this ETL writes validates without transformation on the TypeScript side.

Source decision: play-by-play V3 alone, no shotchartdetail.
V3 carries xLegacy/yLegacy, shotResult, shotValue, isFieldGoal, personId, period and
clock — everything ShotEvent needs. Validated against the fixtures: for the 13
overlapping events, coordinates, made-flag and PLAYER_ID agree exactly. The ONE
difference is shotDistance, where V3 rounds the Euclidean distance and shotchart
truncates it (25.52 ft -> V3 26, shotchart 25). Neither is wrong; they differ by
convention. We keep V3's value so the stored distance stays consistent with the stored
coordinates, and we skip a second endpoint call per game.
"""

from __future__ import annotations

import collections
from collections.abc import Iterable
from typing import Any

from .assister import Roster, parse_assist_tag, resolve_assister
from .lineup_intervals import interval_for_event


def build_shot_events(
    actions: Iterable[dict[str, Any]],
    game_id: str,
    team_id: int,
    roster: Roster,
    intervals: list[dict[str, Any]] | None = None,
    return_warnings: bool = False,
):
    """Map V3 action objects to ShotEvent dicts for ONE team.

    Scoped to one team because assister resolution must be: a bare surname is only
    unambiguous within a single roster.

    `intervals` connects this transform to lineup derivation (review finding #3). Each
    emitted ShotEvent carries the `intervalId` of the LineupInterval containing it, which
    is what makes lineup-filtered assists possible downstream. A shot that falls in no
    interval gets `intervalId: None` and a warning — explicitly unattributable rather
    than silently misattributed.
    """
    events: list[dict[str, Any]] = []
    warnings: list[str] = []

    for action in actions:
        if action.get("isFieldGoal") != 1:
            continue  # free throws, rebounds, fouls, subs — not shot events
        if action.get("teamId") != team_id:
            continue
        if not action.get("personId"):
            continue  # no shooter identity; cannot honestly attribute

        made = action.get("shotResult") == "Made"
        shooter_id = action["personId"]

        # A missed shot is never assisted, so the tag is only consulted on makes.
        assisted = False
        assister_id = None
        if made:
            surname = parse_assist_tag(action.get("description", ""))
            if surname is not None:
                # The tag's presence is what makes this an assisted basket. Whether we
                # can NAME the assister is a separate question — see the split.
                assisted = True
                assister_id, warning = resolve_assister(surname, roster)
                if warning:
                    warnings.append(
                        f"game {game_id} event {action.get('actionNumber')}: {warning}"
                    )
                elif assister_id == shooter_id:
                    # Finding #7: a description crediting the shooter with their own
                    # assist is IMPOSSIBLE source data, not a genuine assist whose name
                    # we failed to resolve. Treating it as assisted-but-unresolved
                    # inflated the assisted numerator with a record that cannot be true.
                    # It is excluded from "assisted" entirely.
                    warnings.append(
                        f"game {game_id} event {action.get('actionNumber')}: parsed "
                        f"assister {surname!r} resolved to the shooter — impossible "
                        f"source data, not counted as assisted"
                    )
                    assisted = False
                    assister_id = None

        # Join to the lineup that was on court for this shot (finding #3).
        interval_id = None
        if intervals is not None:
            containing = interval_for_event(
                intervals, action["period"], action["clock"]
            )
            if containing is None:
                warnings.append(
                    f"game {game_id} event {action.get('actionNumber')}: no lineup "
                    f"interval contains period {action['period']} {action['clock']} — "
                    f"emitting intervalId=None (unattributable, not misattributed)"
                )
            else:
                interval_id = containing["intervalId"]

        events.append(
            {
                "gameId": game_id,
                "eventId": action["actionNumber"],
                "period": action["period"],
                "clock": action["clock"],
                "shooterId": shooter_id,
                "locX": action["xLegacy"],
                "locY": action["yLegacy"],
                "shotValue": action["shotValue"],
                "made": made,
                "assisted": assisted,
                "assisterId": assister_id,
                "shotDistance": action["shotDistance"],
                "actionType": action.get("actionType", ""),
                "subType": action.get("subType", ""),
                # The lineup on court for this shot. None = unattributable.
                "intervalId": interval_id,
                # Carried so assisted_split can verify it is not aggregating teams.
                "teamId": team_id,
            }
        )

    if return_warnings:
        return events, warnings
    return events


def assisted_split(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """What fraction of MADE baskets were assisted vs self-created.

    The null-handling rule from CLAUDE.md: a made basket carrying an AST tag whose
    surname could not be resolved is ASSISTED. It produces no network edge, but letting
    it fall into "self-created" would misstate the split — the tag was there.

    Characterises made baskets only. Says nothing about shot difficulty or contest
    level; that would need tracking data we do not have.

    Raises ValueError if the events span more than one team. A split is a claim about a
    specific player or unit; silently averaging two teams together would produce a
    number that describes nobody.
    """
    events = list(events)

    teams = {e["teamId"] for e in events if e.get("teamId") is not None}
    if len(teams) > 1:
        raise ValueError(
            f"assisted_split received events from {len(teams)} teams {sorted(teams)} — "
            f"a split must be scoped to one team, player, or lineup"
        )

    made = [e for e in events if e["made"]]
    assisted = [e for e in made if e["assisted"]]
    unresolved = [e for e in assisted if e["assisterId"] is None]

    return {
        "madeBaskets": len(made),
        "assisted": len(assisted),
        "selfCreated": len(made) - len(assisted),
        "unresolvedAssisted": len(unresolved),
        # None rather than 0.0 when there are no made baskets: "no data" and "0%
        # assisted" are different claims.
        "assistedPct": (len(assisted) / len(made)) if made else None,
    }


def build_assist_edges(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate ShotEvents into directed assister→shooter edges.

    Derived, never a primary source — an edge exists only if real assisted made baskets
    are behind it. Shots whose assister went unresolved contribute to the split but
    cannot contribute an edge; that is the honest cost of refusing to guess.
    """
    pairs: dict[tuple[int, int], dict[str, int]] = collections.defaultdict(
        lambda: {"made2": 0, "made3": 0}
    )

    for index, event in enumerate(events):
        # Report malformed input rather than raising a bare KeyError from deep inside
        # the loop — a caller needs to know WHICH record and WHICH field.
        missing = [
            field
            for field in ("made", "assisted", "assisterId", "shooterId", "shotValue")
            if field not in event
        ]
        if missing:
            raise ValueError(
                f"build_assist_edges: event at index {index} is missing required "
                f"field(s) {missing}: {event!r}"
            )

        if not (event["made"] and event["assisted"]):
            continue
        assister_id = event["assisterId"]
        if assister_id is None:
            continue
        if assister_id == event["shooterId"]:
            continue
        key = (assister_id, event["shooterId"])
        if event["shotValue"] == 3:
            pairs[key]["made3"] += 1
        else:
            pairs[key]["made2"] += 1

    edges = []
    for (assister_id, shooter_id), tally in pairs.items():
        made2, made3 = tally["made2"], tally["made3"]
        edges.append(
            {
                "assisterId": assister_id,
                "shooterId": shooter_id,
                "count": made2 + made3,
                "points": 2 * made2 + 3 * made3,
                "made2": made2,
                "made3": made3,
            }
        )

    edges.sort(key=lambda e: (-e["count"], e["assisterId"], e["shooterId"]))
    return edges
