# Phase 7 — Stage 6c: Player-Grain Pass (the least-resolved view)

> Paste into Claude Code. Read CLAUDE.md first. Correctness (6a) and legibility (6b) are
> committed. Player grain is the roughest of the three views — this pass resolves it. Three
> real issues: node overlap, the "NO MADE BASKETS" clarity, and making the focal player
> clearly central so player grain visibly differs from team grain. Visual pass — I review by
> eye. Do NOT commit.

## Context: what player grain IS (and how it should differ from team)

Player grain centers ONE player (e.g. Porter Jr.) and shows their creation relationships:
who creates baskets FOR them, and who THEY create for. The focal player is the subject; every
other node is defined by its relationship to them. Right now it looks too much like team grain
(a generic field of nodes) — the focal player doesn't read as the center of the view. Fix that.

## 1. Node overlap / spacing (positioning bug — visible in the screenshots)

Player-grain nodes collide horizontally (WOLF / TRAORE / MARTIN labels overprint each other,
nodes bunch in one band) while there's unused VERTICAL space. Fix the layout:
- Spread the nodes so labels never overlap and nodes have breathing room. There is vertical
  space available — use it.
- Keep the role-space meaning (creators toward top, scorers/receivers toward bottom, focal
  player positioned by their own role), but ensure the spacing algorithm doesn't stack many
  low-involvement teammates into a collision.
- If many teammates cluster at similar role-positions, distribute them (vertical/horizontal
  spread) so every label is readable. Labels must never overprint.

## 2. Clarify "NO MADE BASKETS" (correct data, poor communication)

Many teammate nodes show "NO MADE BASKETS." This is CORRECT — those teammates made no baskets
off the focal player's creation (the relationship is one-directional or empty). But as bare
text it's confusing. Improve the communication (NOT the data):
- Make it clear what "NO MADE BASKETS" means in THIS context — e.g. that this teammate didn't
  score off the focal player (or the focal player didn't score off them), depending on
  direction. Consider phrasing that reads naturally, or a de-emphasis treatment.
- Consider whether nodes with no relationship to the focal player in EITHER direction should
  even be shown prominently — if a node has no arcs to/from the focal player and no made
  baskets, it may be adding noise. Either de-emphasize it, or reconsider the node-inclusion
  rule for player grain (show teammates who actually have a creation relationship with the
  focal player). Use judgment; the goal is a plate that reads clearly, not one padded with
  empty nodes.
- Whatever you do, stay honest: don't hide a real relationship, don't fabricate one. "No made
  baskets" is true; just make it legible or de-noise it.

## 3. Make the focal player clearly the CENTER of the view

Player grain should visibly be "about" the focal player. Right now it doesn't distinguish
itself from team grain. Options (use judgment, stay in the trace-forms language):
- Visually distinguish the focal player's node (a subtle emphasis — it's already the one with
  a filled node and arcs radiating; consider a light ring, a label treatment, or positioning
  that makes them the anchor).
- The header/caption should make the subject explicit (it says "ONE PLAYER" and names them —
  make sure the FOCAL player reads as the subject, not just one of the crowd).
- Consider whether the layout should center on the focal player (them as the hub, relationships
  radiating) rather than spreading everyone in a generic role-band. This is the biggest lever
  for making player grain feel distinct — a focal-player-centric arrangement.

## Constraints

- Stay in the trace-forms palette and language (this is the same plate, refined for the
  player case — not a new design).
- Don't break team or lineup grain — this pass is player-grain-specific; changes to shared
  layout code must not regress the other two. Check all three after.
- Honest data throughout: "no made baskets" stays truthful; no fabricated relationships; the
  node-fill split and arcs stay correct.
- Keep the correctness fixes from 6a intact (reading text, denominators, etc.).
- Do NOT commit — stop for review. I'll look at player grain closely, and spot-check team +
  lineup for regressions.

## Testing

- Node positioning: no label overlaps in player grain (test the spacing logic — given N nodes
  at similar role positions, do they get distributed without collision?).
- Node-inclusion rule (if changed): the right teammates are shown; empty/no-relationship nodes
  handled per the new rule.
- The "no made baskets" handling renders correctly (and the §C reading still handles it — the
  6a fix must not regress).
- Team and lineup grain still render correctly (no regression from shared-layout changes).
- No silently-skipping tests.

## Definition of done

Player grain reads clean: no overlapping labels, nodes well-spaced using the available room;
the focal player is clearly the center/subject of the view (visibly distinct from team grain);
"NO MADE BASKETS" is clear or de-noised without hiding real data; team and lineup grain
unregressed; palette and encodings intact. Suite green. Stop for review.
