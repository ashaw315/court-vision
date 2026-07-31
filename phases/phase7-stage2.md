# Phase 7 — Stage 2: The Court Plate / Spatial Signature (static, real data)

> Paste into Claude Code. Read CLAUDE.md and the frontend-design skill first. Stage 1
> (the Creation Network plate) is committed. Stage 2 builds the COMPANION plate: the
> Spatial Signature court view for ONE creation connection, static, real shot data. No
> interaction linking it to the network yet — that's Stage 3.

## Read the design — the court plate already exists in the reference

`design/creation-network.html` contains BOTH plates. Stage 1 used the Creation Network
(FIG. 12b). Stage 2 uses the **Spatial Signature court plate (FIG. 12c)** — the second
`<doc-page>` in that file. Read it as the source of truth for tokens and structure:
- Same palette/type as Stage 1 (already in `src/lib/design/tokens.ts` — reuse it, don't
  redefine). The two plates MUST look like a matched pair.
- The court plate's structure: header (FIG. 12c label, catalog no., serif title "Spatial
  Signature" + italic subhead), a half-court rendered as a delicate plate (hairlines,
  paper ground — NOT a realistic or dashboard court), shots plotted as marks, and the
  footer (`$E / ENCODING`, `$F / READING`, and the small rim/mid/three tally).
- Note the design crops the half-court at ~40 ft with a dashed crop edge; 2-pointers are
  open rust rings, 3-pointers are acid-green discs with a thin outer ring. Match this.

## What to build in Stage 2 (and ONLY this)

The **Spatial Signature plate** as a React + hand-rolled SVG component, rendering the real
made baskets of ONE creation connection at their true court locations, static.

Data: the shots come from the same `GrainResponse` (the `shots` array). For Stage 2, pick
ONE connection to render — e.g. the top lineup's biggest connection (Claxton → Porter Jr.).
Filter the lineup's shots to the made, assisted baskets where assister = Claxton and shooter
= Porter Jr. (Stage 3 will make the connection selectable; here it's hardcoded to prove the
render). Confirm the count matches what the network plate's arc says for that connection.

Render, faithfully to the design:
- **A half-court** in the plate aesthetic: thin hairlines for the key, three-point arc,
  restricted area, etc. Delicate, paper, hand-drawn feel — not a realistic court, not a
  dashboard. Crop at ~40 ft with the dashed crop edge per the design.
- **The made baskets** plotted at their real (locX, locY) locations. **2-pointers = open
  rust rings; 3-pointers = acid-green discs with a thin outer ring** (consistent with the
  network's green = high shot value).
- **Header**: FIG. 12c label, catalog no., serif title + italic subhead.
- **Caption** (mono): the connection and its share, e.g.
  "CLAXTON → PORTER JR. · 14.1% OF UNIT CREATION · N BASKETS".
- **Footer**: `$E / ENCODING` note (what the marks mean), `$F / READING` (a computed
  plain-language spatial insight — e.g. "two thirds land inside the paint; the threes come
  from the corners and left wing"), and the small tally (rim / mid / three / points).

## The coordinate transform — get this right

Shot `locX`/`locY` are in the raw NBA space: **tenths of a foot, origin at the basket**
(x roughly -250..250, y roughly -50..470). You must transform these into the court SVG's
coordinate space so shots land in the correct spots relative to the drawn court. Be careful
and explicit about:
- The scale (tenths-of-a-foot → SVG units), and that the court dimensions match (NBA court
  is 50 ft wide; the key, arc radius, etc. have known real dimensions).
- Orientation: origin at the basket, which end of the court, y increasing away from the
  hoop. A shot at LOC_X -229, LOC_Y 1 (a left-corner three from an earlier spike) must land
  at the left corner behind the arc — use a known shot like that to sanity-check the
  transform visually.
- Test the transform: a known corner-three coordinate maps to the corner behind the arc; a
  rim shot (small distance) maps near the hoop.

## Honest-data discipline

- Only made baskets appear (the tool is about created scoring; no misses — consistent with
  the whole project's scope).
- The rim/mid/three tally and the reading insight are **computed from the real shots**, not
  hardcoded — they change per connection.
- 2 vs 3 classification: use `shotValue` from the data, don't re-derive from distance.

## Technical approach

- React + hand-rolled SVG, reusing the Stage 1 tokens. `d3-shape`/`d3-scale` as pure math
  helpers only if useful (e.g. the arc path, the coordinate scale). No D3 rendering.
- Type against the `GrainResponse` / `ShotEvent` contract.
- **No interaction, no linking to the network, no animation, no grain switching.** Static
  plate for one hardcoded connection. Stage 3 links it; Stage 4 animates it.

## Testing

- The coordinate transform (known coordinates → expected court regions) — the highest-value
  test here.
- The 2/3 classification and the tally computation (rim/mid/three counts) against known
  shots.
- The reading-insight generation. No SVG-pixel tests. No silently-skipping tests.

## Constraints

- Faithful to the FIG. 12c court plate in `design/creation-network.html`; pairs visually
  with the Stage 1 network plate.
- Right-sized: one plate, one hardcoded connection, static.
- Do NOT commit. Stop for review with the running component (screenshot) showing the real
  Claxton→Porter Jr. baskets on the court, and the tests.

## Definition of done

A React + SVG Spatial Signature plate rendering one connection's real made baskets at true
court locations, faithful to the design, with a correct coordinate transform (sanity-checked
against a known shot), 2/3 marks, computed tally + reading, matching the Stage 1 plate's
look. Tests green, no skips. Stop for review.
