"""Assister parsing — resolving the assisting player from free-text descriptions.

The assister is not a structured field anywhere in the NBA data. It exists only inside
the play-by-play description, as a bare surname in an `(Surname N AST)` tag:

    "Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"

So every assist edge in Court Vision rests on this parse. The governing rule, from
CLAUDE.md: an ambiguous or unresolvable surname yields None plus a warning, and is
NEVER guessed. A wrong edge is a fabricated claim about a specific player; a missing
edge is merely incomplete.
"""

from __future__ import annotations

import re

# The assist tag. Deliberately anchored on the literal " AST)" suffix so sibling tags
# with the same parenthesised shape — "(3 PTS)", "(Williams 1 BLK)" — cannot match.
# The surname group allows internal periods, apostrophes, hyphens and spaces so
# "Porter Jr." and "O'Neale" survive intact.
_ASSIST_TAG = re.compile(r"\(([A-Za-z][A-Za-z.'\- ]*?)\s+\d+\s+AST\)")


class Roster:
    """A team's players for one game, for surname → personId resolution.

    Resolution is deliberately scoped to ONE team. The fixture contains a real
    cross-team surname collision: "Williams" is on both Phoenix and Brooklyn, and a
    league-wide lookup would happily attribute a Nets assist to a Suns player.
    """

    def __init__(self, by_person_id: dict[int, str]):
        self.by_person_id = dict(by_person_id)
        # surname (normalised) -> list of personIds carrying it
        self._by_surname: dict[str, list[int]] = {}
        for person_id, surname in self.by_person_id.items():
            self._by_surname.setdefault(_normalise(surname), []).append(person_id)

    def candidates(self, surname: str) -> list[int]:
        return list(self._by_surname.get(_normalise(surname), ()))

    def __len__(self) -> int:
        return len(self.by_person_id)


def _normalise(name: str) -> str:
    """Fold a surname for comparison.

    Review finding #8: the source is not consistent about periods. A roster surname
    written "Porter Jr" never matched a description that said "Porter Jr.", and the miss
    was silently counted as "unresolved" — indistinguishable from a genuinely unknown
    player. Periods are therefore dropped entirely, so "Porter Jr", "Porter Jr.",
    "J.J. Barea" and "JJ Barea" all fold together.

    Apostrophes and hyphens are PRESERVED: they distinguish real, different names
    (O'Neale, Hayes-Davis, Gilgeous-Alexander) rather than varying by convention.
    Crucially, dropping periods does not fuse distinct players — "Porter Jr." and
    "Porter" still normalise differently, because the suffix itself remains.
    """
    folded = name.strip().lower().replace(".", "")
    return re.sub(r"\s+", " ", folded).strip()


def parse_assist_tag(description: str) -> str | None:
    """Return the assisting player's surname from a description, or None.

    None means "no assist tag present", which covers both unassisted makes and missed
    shots. It does NOT mean "unresolvable" — that distinction is made by
    resolve_assister, and it matters for the assisted-vs-unassisted split.
    """
    if not description:
        return None
    match = _ASSIST_TAG.search(description)
    if not match:
        return None
    return match.group(1).strip()


def resolve_assister(surname: str, roster: Roster) -> tuple[int | None, str | None]:
    """Resolve a surname to a personId within one team's roster.

    Returns (person_id, warning). Exactly one of the two is non-None:
      - unique match          -> (person_id, None)
      - ambiguous or unknown  -> (None, warning)

    Ambiguity is never broken by a heuristic. Picking the more prolific passer, or the
    first match, would silently invent an edge attributed to a real, named player.
    """
    candidates = roster.candidates(surname)

    if len(candidates) == 1:
        return candidates[0], None

    if not candidates:
        return None, (
            f"unresolved assister: surname {surname!r} not found on this team's "
            f"roster ({len(roster)} players) — emitting assisterId=None"
        )

    return None, (
        f"ambiguous assister: surname {surname!r} matches {len(candidates)} rostered "
        f"players {sorted(candidates)} — refusing to guess, emitting assisterId=None"
    )
