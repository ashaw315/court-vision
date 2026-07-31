# Phase 7 — Stage 4.5: Density/Motion Polish Pass

> Paste into Claude Code. Read CLAUDE.md first. Stages 1-4 are committed. This is a
> focused polish/regression pass on the EXISTING plates and interaction — NOT new
> features, NOT grain switching (Stage 5). Five fixes, in priority order.

## 1. RESTORE the dotted-line treatment for low-share connections (regression — highest priority)

In the resolved design (and Stage 1), low-share connections rendered as **delicate dotted
hairlines** while heavy connections rendered as solid woven strand-bundles. Somewhere in
the Stage 3/4 work (likely the StrandBundle refactor or the dashoffset draw-in animation),
the dotted treatment was lost — now all connections read as similar solid-ish strands, and
the plate looks busy/knotted.

- Restore: **small-share connections = fine dotted/dashed hairlines** (receding); **large-
  share connections = solid woven strand bundles** (dominant). This is per the design's
  §B ENCODING ("density · share of unit creation") and the reference drawing's dotted-vs-
  solid vocabulary.
- Make sure the animation's stroke-dashoffset draw-in does NOT clobber the dashed style of
  dotted arcs (a draw-in and a dashed pattern both use stroke-dasharray — reconcile them so
  dotted arcs stay dotted after drawing).

## 2. STRENGTHEN the density-as-magnitude perception (core encoding)

Right now the difference between a 14.1% connection and a 7% connection is too subtle —
"density = magnitude" is the network's PRIMARY read, and you can't currently *feel* which
connections are dominant. Fix the perceptual gap:
- Widen the visual contrast between tiers so a dominant connection clearly reads as
  dominant. Options (use judgment, keep it faithful to the design): increase the strand-
  count range, widen the bundle spread for big connections, and (via #1) let small ones
  recede as dotted. The top connection (Claxton→Porter Jr., 14.1%) should visibly POP as
  the thickest channel.
- The goal: at a glance, without reading labels, a viewer can rank connections by weight.
- Don't break the ≥7% label rule or the green high-value accent — those are working.

## 3. Add the 72-games footnote/asterisk (honesty)

The scope line says "72 GAMES" — surprising without context (an NBA season is 82). Add an
asterisk on the scope line and a footnote in the bottom key explaining it:
- e.g. scope line: "2025-26 REGULAR SEASON · 72 GAMES*"
- footnote (bottom key, mono, small): "* 72 of 82 games. 10 excluded for contradictory
  source substitution timestamps — see methodology."
- Pull the numbers (72, and ideally the 82 and the 10) from data/config, not hardcoded
  literals. This footnote is where the data-integrity decision surfaces in the tool — it's
  a credibility signal, not an apology.

## 4. Slow the network draw-in animation

The volume-order draw-in is currently too fast to perceive the heaviest-first sequence.
- Increase total duration to ~2.5–3s so the volume-order build *reads* (the whole point is
  seeing structure announce itself). Keep the stagger; each arc still draws reasonably
  quickly, but the sequence should be perceptible, not a blur.
- Still respect prefers-reduced-motion (static, immediate — unchanged).

## 5. Animate the court plate slide-in / slide-out

The court currently appears/disappears abruptly on select/clear. Add motion:
- On connection-select: the court plate **slides in** beside the network (a smooth
  reveal/translate + fade), reinforcing the "summoned detail" relationship.
- On clear/deselect: the court **slides out** (reverse).
- Keep it quick and deliberate (consistent with the efficient pace). Respect
  prefers-reduced-motion (appear/disappear instantly, no slide).

## Constraints

- This is polish on EXISTING components — do NOT rebuild plates, do NOT add grain switching
  or pickers (Stage 5). Fixes #1 and #2 are regressions/encoding corrections; #3 is honesty;
  #4-5 are motion tuning.
- The static resting composition after any animation must still match the resolved design.
- Do NOT commit. Stop for review (this is a visual/feel pass — I'll review by looking).

## Testing

- The dotted vs solid classification (given a share, is it dotted or solid at the right
  threshold?).
- The magnitude tiers / strand-count mapping (a bigger share yields more strands / wider
  spread).
- The footnote renders real counts from data (72/82/10), not hardcoded.
- Reduced-motion still renders static for both the draw-in and the new court slide.
- No silently-skipping tests.

## Definition of done

Low-share connections read as receding dotted hairlines; dominant connections clearly pop;
the network is legible, not knotted; the 72-games footnote explains the exclusion from
real data; the draw-in is slowed to a perceptible volume-order build; the court slides in/out
on select/clear; reduced-motion respected throughout. Static end-states unchanged. Tests
green, no skips. Stop for review.
