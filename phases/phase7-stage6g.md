# Phase 7 — Stage 6g: Info / Methodology Side Panel

> Paste into Claude Code. Read CLAUDE.md first. The tool is feature-complete, correct,
> deployed, and verified. This pass adds the ONE remaining high-value feature: a side panel
> that orients a non-technical reader (how to read the chart), disambiguates the tricky terms,
> and states the data methodology/caveats honestly — in the trace-forms language. It directly
> serves the brief's "useful to decision-makers." Visual pass — I review by eye. Do NOT commit.

## Why this exists

A front-office reader (a scout/coach/exec, not an engineer) needs to (1) understand what the
plate shows and how to read it, (2) not be tripped by terms that mean two things ("assisted"),
and (3) trust the numbers by seeing the data caveats stated plainly. Right now that context
lives only in your head and in scattered footnotes. This panel consolidates it into one
honest, well-designed place.

## The choreography (the interaction)

- **On load / resting state**: the info panel is OPEN, occupying the currently-empty left/side
  space (there's real unused room to the left of the network — use it). It shows the reading
  guide + methodology.
- **When a connection is selected** (court slides in): the info panel COLLAPSES to a slim tab
  / edge affordance, making room for the court. The court and info panel share the space —
  they don't fight.
- **Click the collapsed tab**: the info panel re-opens (over or beside the current view — your
  judgment, keep it clean).
- All motion respects prefers-reduced-motion (instant open/close, no slide).

## Content — three sections, in the trace-forms language (mono/serif, the palette)

### 1. HOW TO READ THIS (orientation)
Plain-English, plate-appropriate. Explain the encodings a newcomer needs:
- What the plate shows: how a team / lineup / player CREATES made baskets (who sets up whom).
- **Nodes** = players; vertical position = role (creators toward top, scorers/receivers toward
  bottom); in player grain, the subject is at the centre.
- **Node fill** = the player's assisted split (how much they rely on teammates to score) —
  EMPTY = self-creator, FULL = mostly assisted. (Note the player-grain caveat: not measurable
  there.)
- **Arcs** = creation connections (who creates for whom); DENSITY = share of the unit's
  creation (thicker/denser = bigger); GREEN = high shot-value connections (more 3s).
- **The court plate** (when shown) = where THAT connection's made baskets landed.
Keep it concise and readable — a guide, not an essay.

### 2. TWO KINDS OF "ASSISTED" (the disambiguation)
State plainly that "assisted" appears in two senses so a reader doesn't conflate them:
- **Assisted split** (node fill / "scores X% off teammates"): of a player's OWN made baskets,
  how many were set up by a teammate.
- **Share of assisted creation** (arc %): of the UNIT's total assisted baskets, how much this
  connection accounts for.
These are different measures; the panel makes the distinction explicit.

### 3. ABOUT THE DATA (methodology / honesty — this is a credibility section)
State the real provenance and caveats plainly. This is where the data-integrity story becomes
visible to the reader:
- Source: NBA play-by-play, 2025-26 regular season. Made, assisted baskets only (the tool is
  about created scoring — not shot attempts, misses, or self-created offense except as the
  node-fill split).
- **72 of 82 games**: 10 excluded for contradictory source substitution timestamps (rather
  than guess a lineup, those games were left out).
- **No per-connection game count on the court**: connection-level data doesn't record which
  games a connection's baskets came from, so the court shows season scope only (an honest
  limitation, not an omission).
- Assist attribution comes from parsing play-by-play; unresolvable assisters are left null,
  never guessed.
- (Optional, if it fits cleanly) a one-line note that figures reconcile to official box-score
  totals — the credibility capstone.
Pull real numbers (72, 82, 10, season label) from data/config, not hardcoded literals.

## Design constraints

- **Trace-forms language throughout**: mono labels, serif where the plates use it, the bone/
  rust/muted palette, plate-style section headers (like the §-sections). The panel should look
  like part of the same document, not a bolted-on UI drawer.
- Restrained and legible (the 6b contrast standards apply — readable, not loud).
- The panel must not crowd or shrink the network plate uncomfortably when open; if space is
  tight, the collapse-on-select choreography is what resolves it.
- Do NOT change the plates themselves or any data/encoding — this is additive context.
- Keep it honest: every claim in the panel must be true (this is the same discipline as the
  label audits — the panel is more prose, so be careful it doesn't introduce a new false or
  misleading statement).

## Constraints (process)

- Reuse the design tokens; no new colors; no Nets palette.
- Don't regress the three grains, the court, or the interaction. Check all after.
- Respect prefers-reduced-motion for the open/collapse.
- Do NOT commit — stop for review (I'll look at all states: panel open on load, collapsed on
  court-select, re-opened).

## Testing

- Panel open/collapse state logic (opens on load, collapses on connection-select, re-opens on
  tab click).
- Reduced-motion path (instant, no slide).
- Methodology numbers render from real data/config (72/82/10), not hardcoded.
- Content renders in all three grains (the reading guide adapts or stays general; the "not
  measurable here" node-fill caveat is accurate per grain).
- No silently-skipping tests; suite stays green.

## Definition of done

A trace-forms-styled info panel: open on load in the side space with reading guide + the two-
"assisted" clarification + honest methodology (real numbers); collapses to a tab when the
court is summoned and re-opens on click; motion respects reduced-motion; looks like part of
the same document; no regressions; every claim true. Suite green. Stop for review.
