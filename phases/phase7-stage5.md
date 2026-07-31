# Phase 7 — Stage 5: Grains & Navigation (the last core MVP piece)

> Paste into Claude Code. Read CLAUDE.md first. Stages 1-4.5 are committed: the instrument
> works (network + court, interaction, animation, density) for ONE hardcoded lineup. Stage 5
> adds the navigation that makes it a real tool across all three data scopes. This is where
> the shared GrainResponse pays off — the SAME instrument renders all three grains; you are
> wiring navigation, NOT building three UIs.

## The structure (already designed — build exactly this)

Three grains, one instrument, driven by a selector + pickers:
- **Team** (default landing) — the whole Nets rotation as one creation network. No picker
  (there's one team). `GET /api/team`.
- **Lineup** — one five-man unit. A picker chooses which (of the ~21 above the emit floor).
  `GET /api/lineups?minMinutes=NN` populates the picker; `GET /api/lineup/[groupId]` loads it.
- **Player** — one player's creation network (who they create for / who creates for them).
  A picker chooses which. `GET /api/players` populates it; `GET /api/player/[personId]`
  loads it.

The instrument (network plate + court drill-down + interaction + animation) is UNCHANGED —
it just receives a different `GrainResponse`. Do NOT fork the plate per grain.

## What to build

1. **Grain selector** — a segmented control (Team / Lineup / Player) in the trace-forms
   language (mono type, the palette; a plate-appropriate control, not a generic UI kit
   toggle). Switching grain loads that grain's data into the instrument.
2. **Unit pickers**:
   - Lineup mode → a picker listing available lineups (from `/api/lineups`), showing each
     unit's players + minutes so the user can choose by sample size. Default the display to
     units ≥ 50 min (the ~5 substantial units), with the ability to go down to the emit
     floor (25 min, ~21 units). This is the emit-floor-vs-display-threshold decision paying
     off — the frontend owns the cutoff.
   - Player mode → a picker listing rotation players (from `/api/players`).
   - Team mode → no picker.
3. **Default landing = Team grain.** On first load, show the team creation network.
4. **Loading/empty states** — while a grain/unit loads, a clean loading state (not a jarring
   flash); if a request fails, a clean error state (not a crash or blank).

## Team-grain density — the real risk, handle it

Team grain is ~15 rotation players and potentially MANY connections — the plate was designed
for 5 nodes. At 15 nodes with all connections, the role-space layout could become spaghetti.
The Stage 4.5 density work (dotted receding small connections) helps, but likely isn't
enough alone. Handle it:
- **Cap the displayed connections to the top-N by share** (e.g. top 12-18 meaningful
  creation channels), NOT every trickle. This is honest: show the team's SIGNIFICANT
  creation structure, and note it (e.g. "showing top N of M connections" in the header or
  §A line). The dotted small connections can still appear faintly if legible; the point is
  the plate must stay READABLE.
- **Threshold the nodes** if needed — only rotation players above a minutes/creation floor,
  so the 12th man who touched the ball twice isn't plotted.
- Role-space layout with ~15 nodes needs more horizontal room / careful spacing — creators
  band up top, scorers band down low, spread horizontally.
- **Watch-point for review:** does team grain read as an elegant "here's how the Nets create
  offense" plate, or as a knot? If it's still too dense after top-N + thresholding, we thin
  further or reconsider the team default. Report honestly how it looks.

## Reuse / architecture

- The instrument component takes a `GrainResponse` + a grain type and renders — it already
  does. Lift grain + selection state to a top-level container.
- The role-space positioning, node-fill, arcs, court, interaction, animation all work off
  the contract shape — they should NOT need per-grain forks. If a grain needs a param (e.g.
  a connection cap for team), pass it as a prop.
- Player grain may want a slightly different framing (one focal player) — but still the same
  plate/encoding. Keep it minimal; don't over-design a new view.
- The animation (draw-in) re-triggers on grain/unit CHANGE — this is a legitimate data
  change (unlike select/hover). Note: the draw-in is currently on the Stage 6 fix list;
  don't break it further, and make sure grain-change is a valid trigger point for when it's
  fixed.

## Constraints

- One instrument, three data scopes — NOT three separate UIs. Reuse aggressively.
- Right-sized: a selector, two pickers, loading/error states, team-density handling. No
  cross-grain click-through yet (that's optional post-MVP polish — noted, not built).
- Keep the trace-forms language in the nav chrome (selector/pickers) — they inherit the
  tokens, they don't look like a generic component library.
- Do NOT commit. Stop for review.

## Testing

- Grain switching loads the right endpoint and feeds the instrument the right shape.
- Pickers populate from the right endpoints; selecting a unit/player loads it.
- The lineup picker's display threshold (default 50, down to 25) filters correctly.
- Team-grain connection cap (top-N by share) selects the right connections.
- Loading and error states render (not crash/blank).
- No silently-skipping tests (DB/API-dependent tests run or fail clearly).

## Definition of done

Team grain loads by default as a readable creation network; a grain selector switches
Team/Lineup/Player; lineup and player pickers choose the unit; the same instrument (plate +
court + interaction + animation) renders all three from the shared GrainResponse; team
density is handled (top-N connections, thresholded nodes) and reads as a plate not a knot;
loading/error states are clean; nav chrome is in the trace-forms language. Tests green, no
skips. Stop for review — after this, the MVP is feature-complete (Stage 6 is quality floor +
the deferred polish).
