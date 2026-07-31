# Phase 7 — Stage 4: The Animation (the "play") + scope-line fix

> Paste into Claude Code. Read CLAUDE.md first. Stage 3 is committed: the instrument works
> (click a connection → court resolves beside the network, others dim). Stage 4 adds the
> motion — the "play" — on top of the working interaction, and fixes one honesty gap (the
> plates don't state their time scope). Still NO grain switching / pickers (Stage 5).

## Part A — The animation (the "play")

The motion is polish on an already-working instrument. Two moments of animation, each tied
to an action:

### 1. Network load animation
On load (and on grain/lineup change later), the network arcs **draw themselves in
volume-order** — heaviest connection first, then lighter ones cascading in — settling into
the static resting state. Nodes can fade/scale in first, then arcs draw.
- **Volume-order**: biggest share connections animate first (the structure announces itself
  before the detail fills in).
- **Efficient pace**: quick (the whole draw-in completes in ~1.5–2.5s total), not a long
  hypnotic build — the user studies this repeatedly, so it should delight once then settle
  fast. Stagger the arcs; each individual arc draws quickly.
- The strand-bundles can draw via stroke-dashoffset (the woven hairlines "growing" along
  their path), which fits the trace-forms plotted-line feel.
- End state is EXACTLY the Stage 1 static resting plate — animation only affects the
  transition in, never the final composition.

### 2. Court shots bloom on connection-select
When a connection is selected and the court resolves, its made baskets **bloom** at their
locations — a quick staggered appearance (scale/fade in), not all at once. Settles into the
Stage 2 static court. Quick and light, consistent with the network's efficient pace.

### Motion rules (from CLAUDE.md design guidance)
- **Respect `prefers-reduced-motion`**: if set, NO draw-in / bloom — render the final static
  state immediately. This is non-negotiable (accessibility + the honest fallback).
- Motion is deliberate and tied to actions — no ambient/idle animation, no looping, nothing
  that reads as decorative AI-generated movement.
- Don't animate on every re-render — only on load, grain/lineup change, and connection
  select. A re-render from an unrelated state change must not re-trigger the play.
- Keep it performant: these are SVG transitions; avoid layout thrash. Prefer transform/opacity
  and stroke-dashoffset.

## Part B — The scope-line honesty fix (do this too)

The plates currently show figures like "26 baskets · 57 points" with **no time scope stated**.
A reader can't tell if that's one game or a season. It's the whole 2025-26 regular season
(72 validated games). Surface the scope so the numbers are unambiguous:
- Add a small mono scope line to BOTH plates (e.g. under the caption or in the header meta):
  "2025-26 REGULAR SEASON · 72 GAMES" (use the real validated game count from the data/meta,
  don't hardcode a wrong number).
- This is an honesty fix, not decoration — every number on these plates is season-total, and
  the plate must say so. Pull the season label / game count from the data or a config, so it
  stays true if the dataset changes.

## Constraints

- Animation is a TRANSITION layer over the existing static plates — do NOT rebuild the
  plates or change their resting composition. The static end-state must be identical to
  Stages 1-3.
- Still the hardcoded top lineup — no grain switching, no pickers (Stage 5).
- `prefers-reduced-motion` fully respected (static, immediate).
- Do NOT commit. Stop for review.

## Testing

- Reduced-motion: with the preference set, the final static state renders with no animation
  (test the branch/logic, not pixels).
- Volume-order: the animation sequence orders connections by share (test the ordering
  function).
- The play triggers on load/select but NOT on unrelated re-renders (test the trigger logic).
- Scope line renders the real season/game-count from data, not a hardcoded literal.
- No silently-skipping tests.

## Definition of done

Network arcs draw in volume-order on load (quick, staggered, settling to the exact static
plate); court shots bloom on selection; `prefers-reduced-motion` renders static immediately;
motion only on load/select, not idle or incidental re-renders; both plates state their time
scope from real data. Tests green, no skips. Stop for review — this is the stage that makes
it *move*.
