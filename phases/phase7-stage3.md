# Phase 7 — Stage 3: The Interaction (network ↔ court) — Claude Code prompt

> Paste into Claude Code. Read CLAUDE.md first. Stages 1-2 are committed: two static
> plates (Creation Network + Spatial Signature) rendering real data, reading as a matched
> pair. Stage 3 fuses them into ONE instrument: clicking a connection on the network
> resolves the court to that connection's shots, side-by-side, with the rest of the network
> dimmed. This is the stage that turns two pictures into a tool. Still NO animation (Stage 4)
> and NO grain switching / pickers (Stage 5).

## The interaction model (already designed — build exactly this)

- **Resting state: the network plate alone**, front and center (the court is NOT shown until
  a connection is selected). The network is the index.
- **Click a connection (an arc) on the network** → the **court plate resolves beside the
  network** (side-by-side, both visible at once — the user explicitly wants to read
  structure and space together, not one-at-a-time), showing that connection's real made
  baskets. The court is the drill-down/detail view.
- **On selection, the rest of the network dims/recedes** so the selected arc is emphasized
  and clearly tied to the court view. The selected arc stays full-strength; unselected arcs
  fade back.
- **Click a different connection** → the court re-resolves to the new connection; the newly
  selected arc emphasizes, the previous one returns to the dimmed field.
- **Deselect** (click the selected arc again, or a clear affordance) → court hides, network
  returns to full resting state.

## Layout

- Resting: network centered, using the space (as in Stage 1).
- Selected: network + court **side by side** (network left, court right, or a sensible
  split), both fully readable. On smaller widths this can stack, but the default/desktop
  target is side-by-side (the whole point is seeing both together).
- The transition between resting and selected should be clean — Stage 4 will make it
  animated; for now a simple appear/reflow is fine (no motion polish yet).

## What to wire (the plumbing)

The pieces already exist and are parameterized:
- `selectConnection(data, assisterId, shooterId)` (from Stage 2) already produces the
  court's shot set for a given connection — feed it the selection.
- The network already renders arcs; each arc corresponds to an `AssistEdge`
  (assisterId → shooterId).

Build:
- **Selection state** (React state) at the instrument level: which connection (if any) is
  selected. Lift state to a parent that owns both plates.
- **Clickable arcs**: each network arc is a click target that sets the selected connection.
  Make the hit area usable (arcs are thin — ensure a comfortable click/hover target, e.g. an
  invisible wider stroke behind the visible one).
- **Dimming**: on selection, unselected arcs (and optionally unrelated nodes) reduce opacity;
  the selected arc and its two endpoint nodes stay full.
- **The court panel**: appears on selection, fed by `selectConnection`, hidden when nothing
  is selected.
- **Consistency**: the court's caption/count must match the clicked arc (the Stage 2
  reconciliation test already guarantees the data agrees; make sure the UI passes the SAME
  selection to both).

## Interaction quality (basic, not full polish)

- **Hover affordance**: arcs should indicate they're clickable on hover (subtle emphasis /
  cursor), so users know the network is interactive.
- **Keyboard**: arcs should be focusable and selectable via keyboard (Enter/Space), and the
  selected state visible on focus. (Full a11y polish is Stage 6, but don't build a
  mouse-only trap that Stage 6 has to retrofit — make arcs real buttons/focusable elements
  now.)
- **Clear selected state**: it should be obvious which connection is currently selected
  (beyond just the court being shown) — the emphasized arc carries this.

## Constraints

- Reuse the Stage 1 and Stage 2 components — this stage is WIRING, not rebuilding the plates.
  If a plate needs a prop (e.g. `dimmed`, `selected`, `onSelectConnection`), add it cleanly.
- Still the hardcoded top lineup — no grain switching, no pickers (Stage 5).
- **No animation / motion polish** — Stage 4. A plain appear/reflow on select is fine.
- Type the selection against the contract (an assister/shooter id pair, or the edge itself).
- Do NOT commit. Stop for review.

## Testing

- Selection logic: clicking an edge sets the right connection; `selectConnection` gets the
  right ids; deselect clears it.
- The court renders the selected connection's shots and the count matches the selected edge.
- Dimming state is applied to unselected arcs on selection (test the state/prop logic, not
  pixels).
- Keyboard selection works (focusable, Enter/Space selects).
- No silently-skipping tests.

## Definition of done

Clicking any connection on the network resolves the court beside it with that connection's
real baskets, dims the rest of the network, emphasizes the selected arc; clicking another
re-resolves; deselect returns to resting. Arcs are focusable/keyboard-selectable. Plates
reused, not rebuilt. Tests green, no skips. Stop for review — this is the first stage that
should *feel* like the tool.
