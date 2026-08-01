# Phase 7 — Stage 6b: Legibility & Contrast Pass

> Paste into Claude Code. Read CLAUDE.md first. Correctness is done (6a committed). This is
> a VISUAL polish pass: several elements are too low-contrast to read clearly. Fix legibility
> ENTIRELY WITHIN the existing trace-forms palette — do NOT introduce new brand colors (no
> Brooklyn Nets navy/red/black). The palette is the project's signature and the green =
> high-value encoding must not be disturbed. This is a look pass — I review by eye.

## The problem

On real screens, several things are too faint to read with clarity:
- The muted mono labels (the gray annotation text, §-section labels, axis labels like
  "ORIGINATES CREATION") sit too light against the bone ground.
- The dotted low-share connections can be hard to see (they should RECEDE, but still be
  perceptible — right now some are near-invisible).
- The §D origination bars and their light track are low-contrast.
- Small percentage labels on faint arcs can be hard to read.

The goal: raise contrast so everything is comfortably readable, WITHOUT losing the
trace-forms restraint (this is not "make it bold and loud" — it's "make the quiet things
legible, not invisible").

## What to do — within the palette

1. **Audit the token contrast.** Go through the design tokens (src/lib/design/tokens.ts) and
   check each text/line color against the bone ground (#F2EDE0) for contrast. The mutest
   grays (e.g. #9A8F7B, #7C7261) are likely too light for small text. Darken the muted
   tones enough to be clearly readable while keeping them clearly SUBORDINATE to the ink
   (#1E1B16) and rust — a legible mid-tone, not black.
2. **Dotted connections**: raise their minimum opacity / darken the dotted stroke so the
   faintest connections are still perceptible as delicate dashes — receding, not vanishing.
   Keep the density-as-magnitude contrast intact (small still reads smaller than large).
3. **§D origination bars**: darken the bar fill and/or the track so the bars read clearly
   against the ground; make the percentages legible.
4. **Arc % labels**: ensure the small percentage labels are readable even on the faintest
   arcs (darken the label text if needed; labels are data, they should be clear).
5. **Keep the green accent exactly as-is** in hue/meaning (high shot value). Only adjust its
   value if it too is hard to see — but do not change what it means or make it frequent.
6. **The dimmed/unselected state** (from the earlier note): when a connection is selected and
   others dim, the dimmed arcs should RECEDE but stay legible — raise the dimmed-state
   minimum opacity so the ghost network's structure is still readable, not erased.

## Constraints

- **No new brand colors.** Everything stays in the bone / rust / ochre / muted-gray / single
  acid-green trace-forms system. If you introduce any hex outside that family, that's wrong.
- Don't change encodings or meanings — only the VALUES (lightness/opacity) for legibility.
- Don't make it loud. The aesthetic is restrained; the fix is "legible quiet," not "bold."
- Apply changes at the TOKEN level where possible so all views benefit consistently (team,
  lineup, player, court, footer).
- Respect the static resting composition — this is contrast tuning, not layout.
- Do NOT commit — stop for review (I'll look at all three grains + the court).

## Testing

- If any contrast values are encoded as tested constants, update those tests.
- No new logic to test heavily here — it's visual. Don't add hollow tests. Do keep the
  suite green (no regressions from token changes).

## Definition of done

Muted labels, dotted connections, origination bars, and arc % labels are all comfortably
readable against the bone ground; the dimmed-selection state recedes but stays legible;
everything stays within the trace-forms palette (no brand colors); the green accent and all
encodings are unchanged in meaning; restraint preserved. Suite green. Stop for review across
all three grains and the court.
