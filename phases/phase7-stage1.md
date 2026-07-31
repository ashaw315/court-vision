# Phase 7 — Stage 1: The Network Plate (static, real data) — Claude Code prompt

> Paste into Claude Code. Read CLAUDE.md (esp. the design section) and the
> frontend-design skill first. Phases 1-5 are done: validated data in Neon, a read API
> serving three grains. This phase builds the frontend. Stage 1 is ONE thing: the
> Creation Network plate, rendered as a React + hand-rolled SVG component, fed by the
> live API, STATIC (no animation, no court, no interaction yet), for the LINEUP grain.

## The design is already resolved — read it, don't reinvent it

`design/creation-network.html` is the resolved design, exported from Claude Design. It
contains BOTH plates (Creation Network + Spatial Signature). **Read it as the source of
truth for tokens and structure.** Extract the real values — do not eyeball or approximate:

- **Palette** (from the file): ground `#F2EDE0`, ink `#1E1B16`, rust `#A8442A` / `#8A3520`,
  dark text `#4A4438`, muted mono `#9A8F7B` / `#7C7261`, light track `#E2DAC7`, and the
  acid-green accent (find its exact hex in the file). Pull the FULL palette from the file.
- **Type**: JetBrains Mono for labels/data, Playfair Display for the serif title + italic
  reading annotations. Letter-spacing ~0.13–0.18em on mono labels; the small sizes (9–14px).
- **Structure**: the plate layout — header (FIG label, catalog no. `N.º 0034`, serif title
  "Creation Network" + italic subhead), the role-space network, and the footer with
  `$B / ENCODING`, `$C / READING`, `$D / ORIGINATION`.
- Note the file uses Design's template syntax (`{{ o.name }}`, `<sc-for>`), and the CSS
  linter flags `{{ }}` — that's expected template noise, not a bug. Those placeholders map
  to the real data fields you'll wire up. Do NOT copy the template engine; rebuild in React.

Set up **design tokens** (CSS variables or a TS tokens module) from these values so the
whole frontend shares one source of truth. This is build-order step 6 (design tokens)
folded into stage 1.

## What to build in Stage 1 (and ONLY this)

The **Creation Network plate** (FIG. 12b, position-as-role) as a React component rendering
REAL data from the API, in its **static resting state**.

Data source: `GET /api/lineup/[groupId]` (the shared `GrainResponse`: edges + shots +
split + players + meta). Use the top lineup (~287 min, groupId
`-1629008-1629611-1629651-1641730-1642856-`) as the initial hardcoded target for stage 1 —
grain switching and pickers are Stage 5.

Render, faithfully to the design:
- **Nodes** = the five players, positioned in **role-space**: vertical axis = creation
  originated (creators toward top, scorers toward bottom). Derive vertical position from how
  much each player originates vs. receives creation (from the edges). Horizontal spread for
  legibility.
- **Node fill** = each player's **assisted split** (the `split` / per-player assisted %): a
  node filled ~80% = 80% assisted. The fill IS the measure, with a hairline at the fill
  level, per the design.
- **Arcs** = directed creation edges (assister → scorer), drawn as the woven hairline
  bundles from the design: **strand density / weight encodes the connection's SHARE of the
  unit's total assisted creation** (arcs sum to 100%). Labels (the % ) only on connections
  ≥ 7%, per the design.
- **Arc color** = shot value: rust/ochre for ordinary, the **acid-green accent for the
  highest-value connections** (the ≥1.42 pts/attempt threshold the design encodes). Green
  stays rare.
- **Footer**: the `$B / ENCODING` legend, `$C / READING` annotation (compute the real
  plain-language insight from the data — e.g. "runs X% of its creation through a single
  connection… concentrated/distributed"), and `$D / ORIGINATION` bars.
- Header framing (FIG label, catalog no., serif title + subhead).

## Technical approach

- **React + hand-rolled SVG.** NOT D3 for rendering/DOM. You MAY use `d3-shape` (arc/path
  generation) and `d3-scale` (role-space positioning) as pure math helpers only. React owns
  the DOM; SVG elements are JSX; full control over every stroke. (This makes Stage 4's
  custom animation natural.)
- Fetch via the existing API. A server component fetching then passing to a client
  component, or a client fetch — your call, but keep the data-fetching clean and typed
  against the `GrainResponse` contract (import the Zod types).
- **No animation, no court plate, no interaction, no grain switching, no pickers.** Those
  are Stages 2-5. Resist building ahead.
- Type everything against the shared contract. The plate consumes `GrainResponse`; don't
  invent new shapes.

## The honest-data details (carry the discipline into the UI)

- **Null assisters / self-created** shots: reflected in the node fill (empty portion =
  self-created), never faked.
- The `$C / READING` insight must be **computed from the real data**, not hardcoded — it
  changes per lineup.
- Percentages: recall `assistedPct` serializes as e.g. `1` not `1.0` — format with an
  explicit `toFixed`/`Intl`, don't string-match.

## Testing

- Component/logic tests where there's real logic: role-space positioning (given edges, are
  creators above scorers?), share computation (do arcs sum to ~100%?), the green-threshold
  selection, the reading-insight text generation. Don't unit-test SVG pixels (visual review).
- Don't let DB/API-dependent tests silently skip (the recurring lesson) — run or fail clearly.

## Constraints

- Faithful to `design/creation-network.html` — a reviewer should see the plate and the
  running component as the same thing.
- Right-sized: this is one plate for one lineup, static. No court, no motion, no nav.
- Do NOT commit. Stop for review with: the running component (screenshot or described),
  how it reads the real top-lineup data, and the tests.

## Definition of done

A React + SVG Creation Network plate rendering the real top-lineup `GrainResponse` from the
live API, static, faithful to the design tokens/structure, with role-space layout, node-fill
split, share-weighted green-accented arcs, and a data-computed reading annotation. Tests
green, no silent skips. Design tokens extracted into a shared source. Stop for review.
