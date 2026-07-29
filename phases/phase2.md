# Phase 2 — Data Contract (Claude Code prompt)

> Paste into Claude Code. CLAUDE.md and STACK.md are in the repo root — read them first.
> This phase defines ONLY the shared data contract: TypeScript types + Zod schemas.
> No ETL, no DB, no fetching, no UI. This is the spine every later phase conforms to.

## Context: the concept was validated by two spikes

The concept changed based on real data. Do not model the old season-aggregate passing
shapes. The validated design:

- **PlayByPlayV3** (`playbyplayv3`) returns per-game event data. `shotchartdetail.
  GAME_EVENT_ID` joins to V3 `actionNumber` at 100% (41/41 made shots in the test game).
- Every made shot can be tied to its real court location AND its assister. The assister
  is embedded in the event `description` text as a `(LastName N AST)` pattern — e.g.
  `"Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"`. Unassisted baskets have no `AST`
  tag.
- V3 also carries `xLegacy`/`yLegacy` (same coords as shotchartdetail's LOC_X/LOC_Y),
  `shotResult`, `shotValue`, `isFieldGoal` — so play-by-play may be a near-complete
  source on its own.
- Because this is per-game data, assists can be honestly filtered by game, date range,
  and lineup-on-court. The old "season-level, not lineup-filtered" caveat is GONE — but
  only once we derive on-court lineups from substitution events (the hard part, Phase 3+).

**Build strategy: incremental.** Full 82-game robustness is the target, but we get one
game rendering end-to-end first, then scale to 82, then add lineup-on-court filtering.
The contract defined here is the FULL destination shape — the ETL populates it in stages
without changing these types.

## Deliverable

A single well-organized contract module under `src/lib/contracts/` (split into files if
it reads better) exporting: Zod schemas as the source of truth, with TypeScript types
inferred from them (`z.infer`). Everything downstream — ETL output validation, DB row
mapping, API responses, frontend props — imports from here.

## The entities (grounded in real spike data)

Define Zod schemas + inferred types for each. Field names below map to what the
endpoints actually return; normalize casing to camelCase in the contract.

### `Player`
- `personId: number` — the canonical join key EVERYWHERE. Never join on name.
- `displayName: string` — canonical display form (choose one; `playerNameI` style
  "N. Claxton" is reasonable). Note in a comment that source data has 3 name variants
  (`playerName`, `playerNameI`, and the description's bare last name) and only `personId`
  is reliable.

### `ShotEvent` — the atomic unit
From the V3 + shotchart join. One per field-goal attempt.
- `gameId: string`
- `eventId: number` — V3 `actionNumber` / shotchart `GAME_EVENT_ID` (the join key).
- `period: number`
- `clock: string` — V3 ISO-8601 duration form `"PT11M41.00S"` (keep raw; parse at edge).
- `shooterId: number`
- `locX: number`, `locY: number` — tenths of a foot, origin at basket. Keep raw; convert
  to SVG space in the frontend, not here.
- `shotValue: 2 | 3`
- `made: boolean`
- `assisted: boolean`
- `assisterId: number | null` — resolved from the `(Name N AST)` description via name→
  personId mapping (Phase 3). Null when unassisted or when the shot is missed.
- `shotDistance: number`
- `actionType: string`, `subType: string` — shot descriptor ("Jump Shot", "Driving
  Layup"); useful for later shot-type context. Optional to surface, but carry it.

> Note: `assisterId` resolution depends on parsing description text and mapping a bare
> last name to a `personId` within the game's roster. The contract just types the result;
> the parser + tests live in Phase 3. Type `assisterId` as nullable and document that
> ambiguous parses resolve to null + a logged warning (never a guess).

### `AssistEdge` — derived, never raw
Computed by aggregating `ShotEvent`s where `assisted === true`. Represents a directed
assister→shooter relationship over some scope (team / lineup / game / season).
- `assisterId: number`
- `shooterId: number`
- `count: number` — assisted made baskets on this pair.
- `points: number` — points created (2s and 3s summed).
- `made2: number`, `made3: number` — breakdown, so the frontend can weight/color edges.
- Comment: this entity is ALWAYS derived from ShotEvents for a given scope, never stored
  as a primary source. Keeps the "this is real assisted baskets" honesty structural.

### `LineupInterval` — the spine of lineup-filtered capability
A contiguous stretch of a single game during which a fixed five was on court, derived
from substitution events (Phase 3+; the highest-risk transform).
- `gameId: string`
- `intervalId: string` — stable id (e.g. `gameId:period:startClock`).
- `period: number`
- `startClock: string`, `endClock: string`
- `onCourt: [number, number, number, number, number]` — five `personId`s (sorted).
- Comment: every `ShotEvent` falls within exactly one `LineupInterval` for its team.
  This is how assists attribute to lineups honestly. Deriving it correctly is the hard
  part — the contract only types the result.

### `Lineup` — an above-threshold five-man unit
- `groupId: string` — dash-delimited sorted person-id string (from `teamdashlineups`),
  e.g. `"-1629008-1629611-1629651-1641730-1642856-"`. Identity.
- `personIds: [number, number, number, number, number]` — sorted.
- `minutes: number`
- `displayNames: string[]` — for UI, derived from Players.
- Comment: only lineups above the minutes threshold (~50 min → ~5 Nets units) ever enter
  the data. Threshold is forced by the data (rebuilding team), not arbitrary — say so in
  the README.

### Scope/grain enums
- `Grain = "player" | "lineup" | "team"` — the three views.
- Any shared filter shape (e.g. `{ gameId?, dateFrom?, dateTo? }`) for the per-game /
  date-range capability that play-by-play now enables.

## Guardrails (from CLAUDE.md — enforce in the contract)

- Observational only — no fields for grades, ratings, projections, or recommendations.
- No fabricated data — `assisterId` is nullable and null-on-uncertainty, never a guess.
- Honest labeling — comments should make clear what each entity does and does not claim
  (e.g. AssistEdge = assisted made baskets, not "all ball movement").
- `personId` is the only join key; document the name-variant hazard.

## Testing (Phase 2 is types, so tests are light)

- Add a few Zod parse tests: a valid `ShotEvent` fixture parses; an invalid one (missing
  `shooterId`, bad `shotValue`) fails. Use a couple of real rows from `scratch/fixtures/`
  (the spike output) as the valid fixtures where possible.
- Do NOT test the parser/derivation logic here — that's Phase 3.

## Constraints

- Zod schemas are the source of truth; infer TS types from them (`z.infer`), don't
  hand-write parallel interfaces.
- Do NOT create DB tables, ETL code, API routes, or components. Contract only.
- Do NOT commit or push. Leave for review.
- Keep it clean and well-commented — this file is read by every later phase and is a
  strong signal of code quality for the take-home.

## Definition of done

A reviewed, well-organized `src/lib/contracts/` exporting Zod schemas + inferred types
for Player, ShotEvent, AssistEdge, LineupInterval, Lineup, plus the Grain/filter shapes.
A handful of Zod parse tests, green. Nothing else built. Print the contract files and the
test results for review.
