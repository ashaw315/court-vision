# Phase 7 — Stage 6a: Consolidated Adversarial Review (attack the whole MVP)

> Paste into Claude Code. Read CLAUDE.md first. The MVP is feature-complete (Stages 1-5
> committed): three grains, navigation, network+court, interaction, animation, density
> handling. Before polishing, ATTACK the assembled instrument as a whole. This is a
> review/report pass — FIND problems, don't fix them yet (fixes come after I review the
> findings). Report findings only; do not commit.

## Mindset

You wrote this code and your tests pass. That is exactly the problem — the tests were
written by the same mind that wrote the implementation, so they check the cases you already
handled. Attack the cases you did NOT think of. Prior stages' adversarial passes found real,
severe bugs (the 0.19 coordinate scale, silent-skip tests, the "assisted miss" fabrication,
cross-grain false labels). Assume more exist. Be genuinely antagonistic.

## Priority 1 — Data-accuracy: the last inch (rendered value == computed value)

The data is verified from source through the API (box-score reconciliation, contract
validation, seed verification). The UNVERIFIED gap is the last inch: does the value the
component COMPUTED actually match the pixel/label/mark the user SEES? Attack this hard,
across ALL THREE GRAINS:
- For a given connection, does the arc's displayed % / count match the court's plotted mark
  count AND the court's tally (rim+mid+three)? Pick several connections in each grain and
  cross-check the numbers end to end.
- Do the node-fill percentages rendered match the computed assisted-split for that player?
- Does the §D origination bar list match the actual origination shares? (In the player-grain
  screenshot, §C reading says "Williams on — assisted" with a blank — is that a real bug
  where a value is missing/undefined?)
- Does the §C reading text's numbers match §D and the arcs? (e.g. "top three carry X%")
- Is there anywhere a number is formatted/rounded inconsistently, or a share computed
  against the wrong denominator (whole team vs drawn subgraph)?
- Find at least one way a "right number, wrong place" or "right number, wrong denominator"
  bug could occur and prove whether it does.

## Priority 2 — Cross-grain correctness & honesty

The plate makes claims; are they TRUE in every grain? Prior review found "five-man unit",
"all connections shown", "100% of assisted creation" were false at team/player grain.
- Sweep for MORE claims that are true for one grain and false for another (captions,
  encoding notes, reading text, footer labels).
- Player grain specifically: it shows many "NO MADE BASKETS" teammates. Is that label
  correct and meaningful, or is it a confusing artifact? Does the player-grain reading text
  handle players with no made baskets correctly (the blank "— assisted" suggests NOT)?
- Does the connection cap (top-N) ever HIDE the currently-selectable/selected connection, or
  hide a connection the reading text references? (If §C says "led by X to Y" but that arc was
  capped out, that's a contradiction.)
- Do the honest nulls (unassisted, unattributable, no-made-baskets) render correctly
  everywhere, or does one path show 0% / a sentinel / a blank?

## Priority 3 — Interaction & state integration (the stuff Stage 5 added)

- Switch grain WHILE a connection is selected — does the court clear, or can stale court data
  from the previous grain persist for a frame / at all?
- Fast-switch grains and units (spam clicks) — does request-token sequencing actually prevent
  a slow response overwriting a newer scope? Try to force a race.
- Select a connection, change the lineup MIN threshold, or change the picker — is selection
  state cleared/consistent?
- Can you select a connection that then doesn't exist after a grain/unit change (dangling
  selection)?
- The coordinate transform now runs for EVERY connection in EVERY grain (not just the
  hardcoded one it was built with). Find a connection whose shots stress it — all threes, all
  rim, a shot near the 40ft crop — and confirm they render correctly and nothing clips
  silently.

## Priority 4 — Edge cases in real data

- A player/lineup/connection with very few baskets (1-2). Does the split math, the reading
  text, the tally all stay sane (no divide-by-zero, no "NaN%", no "1 of 1 = 100%" that
  misleads)?
- The player-grain node overlap (visible in the screenshot: WOLF/TRAORE/MARTIN labels
  colliding) — is this purely visual (Priority: polish) or does it indicate a positioning
  logic bug?
- Any grain/unit where the plate renders empty, broken, or with a console error?

## What to report

For each finding: what it is, which grain/view, whether it's a real bug or cosmetic, the
severity, and how you'd verify/fix it. Separate CORRECTNESS bugs (fix before polish) from
COSMETIC/polish items (defer to the polish passes). Include the things you check that turn
out FINE — negative results are informative.

## Constraints

- This is a FIND-only pass. Report; do not fix or commit. I'll triage the findings and we'll
  fix in order.
- Attack via the real running app across all three grains (drive the browser), not just unit
  tests — the last-inch and integration bugs live in the rendered app.
- Be honest about what you can't verify.

Report the findings, sorted correctness-first. Stop.
