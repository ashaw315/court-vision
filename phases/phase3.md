# Phase 3 — ETL Pipeline (Claude Code prompt)

> Paste into Claude Code. Read CLAUDE.md, STACK.md, and phases/phase2.md first.
> This phase builds the Python ETL that turns raw NBA play-by-play into the contract
> shapes defined in Phase 2. It is the highest-risk phase — two transforms here are the
> hardest code in the project. Build it INCREMENTALLY and TDD the risky transforms.

## Prime directive: stage it, don't build it all at once

Do NOT write the whole 82-game pipeline in one shot. Build in this order, stopping for
review between stages:

1. **Transforms first, TDD'd against saved fixtures — NO network calls.** The parsing and
   derivation logic is where the bugs are. Prove it against the spike fixtures in
   `scratch/fixtures/` (the s2b_*.json files) before pulling anything new.
2. **One-game pull.** Fetch a single Nets game's play-by-play + shot chart, run it through
   the transforms, emit contract-valid JSON. Prove the pipeline end-to-end on one game.
3. **82-game pull.** Only after one game works: loop all Nets regular-season games, rate-
   limited, with checkpointing so a failure mid-run doesn't lose everything.

Stop for review after stage 1, and again after stage 2. Do not proceed to 82 games
without confirmation.

## Environment

- Python ETL lives in `/etl`. Runs LOCALLY (stats.nba.com 403s from cloud IPs — confirmed).
- Use the existing `.venv` (nba_api 1.11.4 already installed). Add deps to a
  `etl/requirements.txt`; don't pollute the Next app.
- Output: contract-valid JSON written to a known location (e.g. `etl/out/` gitignored, or
  `scratch/`), ready for Phase 4 to load into Postgres. ETL does NOT write to the DB
  directly — it emits JSON; Phase 4 loads it. Keep those concerns separate.

## Data sources (validated in spike 2b — do not re-derive)

- **`playbyplayv3`** is the core source. `PlayByPlayV3(game_id=...)` → `d["game"]["actions"]`,
  a list of event objects (NOT `{headers, rows}` — no zipping needed).
- Relevant action fields: `actionNumber`, `clock` (`"PT11M41.00S"`), `period`, `teamId`,
  `personId`, `playerName`, `playerNameI`, `xLegacy`, `yLegacy`, `shotDistance`,
  `shotResult`, `isFieldGoal`, `shotValue`, `actionType`, `subType`, `description`.
- **`shotchartdetail`** (per game via `game_id_nullable`) gives the authoritative shot
  rows in `{headers, rows}` shape. `GAME_EVENT_ID` joins to V3 `actionNumber` at 100%.
- V3 already carries `xLegacy`/`yLegacy` (== shotchart LOC_X/LOC_Y). Decide whether you
  need shotchart at all, or whether V3 alone suffices for located shots. Prefer fewer
  sources if V3 is complete — validate against a fixture before deciding.
- **`teamgamelog`** → the list of Nets game_ids for the season (the loop's driver).
- **`teamdashlineups`** (group_quantity=5) → the above-threshold lineups + minutes +
  `GROUP_ID`. Used to know which units clear the minutes bar.

## The two high-risk transforms — TDD these hard

### A. Assister parsing (assisted-basket attribution)
The assister exists ONLY as free text in the description: `(Surname N AST)`, e.g.
`"Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"`. There is no assister personId in the
data. The transform must:
- Detect the `(Surname N AST)` pattern on made field goals; absence = unassisted.
- Resolve the bare surname to a `personId` **within the set of that team's players on
  court / in the game roster** — not league-wide.
- **Ambiguous surname (two rostered players share it) → `assisterId = null` + logged
  warning. NEVER guess.** (CLAUDE.md guardrail; a wrong edge is a fabricated claim.)
- Preserve the assisted/unassisted distinction even when the assister is unresolved:
  a made basket WITH the tag but an unresolvable surname is still **assisted** (it just
  produces no edge). This matters for the assisted-vs-unassisted split — do not let
  unresolved-assisted baskets fall into "self-created."

Tests (write first, against real fixture descriptions):
- assisted make with resolvable surname → correct assisterId
- unassisted make (no tag) → assisterId null, assisted=false
- missed shot → assisted=false, assisterId null
- **assisted make with ambiguous surname → assisterId null, assisted=TRUE, warning logged**
- the split counts unresolved-assisted as assisted, not self-created

### B. Lineup-interval derivation (on-court five over time)
The highest-risk transform. From substitution events (`actionType: "Substitution"`,
description like `"SUB: Williams FOR Porter Jr."`), reconstruct which five were on court
at every moment, producing `LineupInterval`s.
- Seed each period's starting five (the players on court at period start — derivable from
  who appears before the first sub, or from a period-start state; document the method).
- Apply subs chronologically to advance the on-court set.
- Handle **period resets** (fives re-established each quarter), and edge cases: a player
  subbed out and back in, multiple subs at one stoppage.
- Every `ShotEvent` must map to exactly one `LineupInterval` for its team.

Tests (write first):
- a clean period with a few subs → correct interval boundaries + on-court sets
- period reset → new starting five, not carried over
- a shot event → maps to the correct interval
- sanity: on-court set is always exactly 5, always distinct

> If starting-five derivation from play-by-play proves unreliable, flag it — there may be
> a boxscore/starters endpoint to seed from. Do not silently guess a starting five.

## Other transforms (lower risk)

- **ShotEvent assembly** — map V3 actions (+ shotchart if needed) to the `ShotEvent`
  contract shape. Validate every emitted record against the Zod schema (import the
  contract; fail loudly on mismatch).
- **AssistEdge aggregation** — from ShotEvents, build directed assister→shooter edges with
  `count`/`points`/`made2`/`made3`. Enforce the contract's consistency rules.
- **Player roster** — assemble the player list (personId + canonical name) for the season.

## Contract is the boundary

- The ETL's job is to emit JSON that passes the Phase 2 Zod schemas. Import and run the
  schemas (or mirror them) as a final validation step; a record that doesn't validate is a
  bug, not something to coerce. This makes the contract the enforced interface between
  Python and the rest of the stack.
- Names → personId always. Never emit a name-based join.

## Constraints

- Incremental: transforms (stage 1) → one game (stage 2) → 82 games (stage 3). Stop for
  review after stages 1 and 2.
- TDD the two high-risk transforms (A and B) — tests before implementation.
- Rate-limit the 82-game pull; checkpoint so a mid-run failure resumes. Be a good citizen
  to the endpoint (sleep between calls).
- Do NOT write to Postgres — emit JSON only. Do NOT build API routes or UI.
- Do NOT commit or push. Leave for review.
- Log warnings for every unresolved assister and every lineup-derivation oddity — these
  logs are useful evidence for the write-up (they show the honesty handling working).

## Definition of done (per stage)

- **Stage 1:** transforms implemented, all TDD tests green against fixtures, no network.
- **Stage 2:** one game pulled and emitted as contract-valid JSON; a few real assisted
  shots and lineup intervals spot-checked by eye.
- **Stage 3:** all Nets regular-season games pulled, checkpointed, emitted; a summary
  printed (games processed, shots, assisted %, unresolved-assister count, lineup count).

Print results and stop for review at each stage boundary.
