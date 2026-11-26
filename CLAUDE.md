# CLAUDE.md

Operating notes for building Court Vision with Claude. Read before writing code.

## Current state

Court Vision started as a Nets-only take-home (2025-26). It is now a league-wide tool:
**every NBA team, selectable by season** (target: 2023-24, 2024-25, 2025-26), with the
original creation network plus defence, head-to-head matchups, a location-based shot-value
model, a game-by-game timeline and year-over-year trends. The Nets-only and
"observational, no advisory features" limits belonged to the assignment and no longer apply.
The data-honesty rules below still do.

```
src/db/schema.ts      teams, team_seasons, games, game_team_validation, player_team_seasons,
                      lineups, lineup_intervals, shot_events, assist_edges (season + team scoped)
src/db/load.ts        npm run db:load -- --season 2025-26 [--teams BKN] [--dry-run]
src/db/seed.ts        reloads the committed Nets 2025-26 sample (data/season.json) for tests/CI
src/lib/api/          queries.ts (grains), analysis.ts (timeline/defence/matchup/trend/value)
src/lib/model/        expected-points.ts — the shot-value model
src/app/              / (league index), /[season]/[team], .../analysis, .../vs/[opponent], /api/*
etl/                  run_season.py --season 2025-26 [--teams BKN,BOS]  (runs locally)
```

- Every API route takes `?season=2025-26&team=BKN` (defaults: current default season, BKN).
  A team-season that is not loaded is a 404, never an empty result.
- Tests that touch the database assume the **Nets 2025-26 sample** (`tests/helpers/scope.ts`).
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, ETL tests, and the database/API tests
  against a dedicated Neon branch via the `TEST_DATABASE_URL` secret. Never point it at production.
- stats.nba.com blocks cloud IPs: the ETL runs on a local machine; the deployed app reads Postgres.
- Migrations that add NOT NULL columns to populated tables are hand-edited (add nullable,
  backfill, tighten). Record hand-applied migrations in `drizzle.__drizzle_migrations`.

### Backfill

```
.venv/bin/python etl/run_season.py --season 2025-26      # ~1,230 games, resumable
npm run db:load -- --season 2025-26                      # per-team, idempotent
```
Repeat per season. Games are fetched once and both sides processed. A team-game that fails
validation is excluded for that team and listed in its data audit; the opponent's side is
judged separately, so defence for such a game is reported as unavailable, not as zero.

## What this is

**Court Vision** reads how teams create baskets: **who creates for whom** (assisted made
baskets) and **where on the floor the basket happens**, at three grains — player, lineup, team
— for any team and season, plus what opponents do against them.

Every figure is a count or ratio of real field-goal attempts. Free throws, turnovers,
possessions, defenders and shot clock are not in this data; views never imply them.

**Expected points** compare a shot with what a typical attempt from that spot and value
returned that season. It is location + shot value only — not shot quality in a tracking sense
— and its sample (shots, teams) is shown wherever it is used.

## Hard-won data facts (from the spike — do not re-derive)

The spike already validated the data. Build on these facts; don't re-litigate them.

### Shots (`shotchartdetail`) — spatial, works perfectly
- 6,933 Nets shots for the season.
- Each row carries `LOC_X`, `LOC_Y`, `SHOT_MADE_FLAG`, `SHOT_TYPE`, `SHOT_ZONE_BASIC`,
  `SHOT_DISTANCE`, **`PLAYER_ID`**, and **`GAME_ID`**.
- Because every shot has `PLAYER_ID`, shots filter cleanly to any player or to the set
  of players in a lineup.
- `LOC_X`/`LOC_Y` are in tenths of feet, origin at the basket. Standard NBA shot-chart
  coordinate space (x roughly -250..250, y roughly -50..470).

### Assists (`playbyplayv3`) — per-event, and the core source

Spike 2 replaced the season-aggregate passing endpoint (`playerdashptpass`) with
per-game play-by-play. This changed what the tool can honestly claim.

- **`shotchartdetail.GAME_EVENT_ID` joins to V3 `actionNumber` at 100%** (41/41 made
  shots in the validated game). Every made shot ties to its real court location AND its
  assister.
- V3 also carries `xLegacy`/`yLegacy` (same coordinate space as `LOC_X`/`LOC_Y`),
  `shotResult`, `shotValue`, `isFieldGoal`, `personId`, `period`, and `clock`
  (`"PT11M41.00S"`) — so play-by-play is close to a complete source on its own.
- Because the data is **per-event, not season-aggregate**, assists can be honestly
  filtered by game, by date range, and by lineup-on-court. A lineup's assist network
  reflects the possessions that unit was actually on court for.
- Lineup-on-court filtering comes from `LineupInterval`s derived from substitution
  events (`actionType: "Substitution"`, `description: "SUB: Williams FOR Porter Jr."`).
  That derivation is the highest-risk transform in the project — Phase 3+.

> **CRITICAL DATA-HONESTY CAVEAT — assister resolution.** The assister exists in the
> source **only as free text**: a bare surname inside the event description, e.g.
> `"Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)"`. The spike confirmed the structured
> assist fields are **empty** — there is no assister `personId` anywhere in the data.
>
> So every assist edge depends on parsing a surname and mapping it to a `personId`
> against the roster on court, which can be ambiguous (two players sharing a surname).
> **An ambiguous parse resolves to `null` and logs a warning. It is never guessed.** A
> wrong edge is a fabricated claim about a specific player — worse than a missing one.
>
> `assisterId` is therefore nullable throughout, and null carries three
> indistinguishable meanings: the shot was missed, the make was unassisted, or the
> assister could not be resolved. State this openly in the README; knowing the limit is
> itself the positive signal.

Scope note: an assist edge means **assisted made baskets**, not "ball movement"
generally. A pass leading to a miss, a swung ball, a hockey assist, and a dribble
handoff are all real ball movement and none appear here. Label it as the
assisted-basket subset — do not call it a passing network.

### The assisted-vs-unassisted split — in scope, free from the parse

Because the `(Name N AST)` tag is either present or absent on a made basket, we can
honestly state **what fraction of a player's or unit's made baskets were assisted versus
self-created**. This costs nothing — it falls out of the assister parse already required
— and it is a real scouting-relevant characterization: a player scoring 80% assisted is
a different offensive piece than one scoring 30% assisted.

Note the null-handling interaction: an unresolved assister (the ambiguous-surname case)
is a made basket we know was assisted but cannot attribute. Those baskets count as
**assisted** in this split even though they produce no edge in the network — the tag was
present. Do not let them silently fall into "self-created," which would misstate the
split.

> **What this split does NOT claim.** It characterizes *made baskets only*, and says
> nothing about shot difficulty, contest level, or defensive pressure. An unassisted
> basket is not necessarily a "tougher" shot, and an assisted one is not necessarily
> "easier." Those are tracking-data claims and we do not have that data. State it as
> assisted vs. self-created and stop there.

### Lineups (`teamdashlineups`, group_quantity=5) — forced a real scope decision
- 250 distinct five-man lineups, but the distribution is thin (rebuilding team):
  - ≥100 min: **2** lineups
  - ≥50 min: **5** lineups
  - ≥25 min: 29 lineups
- **Decision: surface only lineups above a minutes threshold (~50 min → 5 core units).**
  The other ~245 are noise. This threshold is *forced by the data, not arbitrary* —
  say so in the README. It's the "I understood my dataset" signal.
- Top unit: Porter Jr. / Mann / Claxton / Clowney / Dëmin (~307 min) — a real subject.

### Access constraint (also a write-up point)
- `stats.nba.com` returns **403 from cloud IPs** (confirmed). ETL runs locally / from an
  allowed environment, not from the deployed app. The deployed app reads from Postgres,
  never live from the NBA. This separation is correct architecture AND a good write-up
  note about knowing your data source's constraints.

### The honesty narrative (core of the README)
The original vision — all ten players as moving dots, possession-by-possession, offense
vs defense — depends on **Second Spectrum optical tracking**, which is not public (locked
behind league/team partnerships + CBA tracking-data privacy). Rather than fabricate
positions, the tool uses only honest public data (real shots, real passing) rendered as a
stylized offensive signature. **This boundary is the signal** — show where the data line
is and that we respected it.

---

## Architecture (see STACK.md for full justifications)

```
[ Python ETL /etl ]  --pull+transform-->  [ Neon Postgres ]  --Drizzle-->  [ Next API routes ]  --typed contract-->  [ Next/React + D3 frontend ]
   (offline, local)                         (relational,                     (server boundary)                        (the differentiator)
                                             migrated)
```

- **ETL (Python, `/etl`):** pulls the three endpoints, transforms to normalized shape,
  loads Postgres. Run manually to seed; not deployed. Mirrors real Python-alongside-JS
  work. In prod this is where nightly per-game ingestion would attach.
- **DB (Neon Postgres):** relational, migrated. Justified by the *job's* living data
  layer (ingests nightly, grows across a season, evolves), not by this snapshot's size.
  Name this reasoning in the README.
- **Migrations (Drizzle):** ordered, versioned, TypeScript schema. Let migrations be
  **real** — an initial schema plus genuine additive changes you actually needed while
  building. Do NOT manufacture fake migrations for show; a reviewer sees through padding.
- **API (Next route handlers):** real server→client boundary, right-sized (no separate
  service — that'd be over-engineering the brief says to avoid).
- **Type contract (shared TS + Zod):** one source of truth, DB→API→frontend. Zod
  validates at the API boundary. Reads as senior; prevents drift.
- **Frontend (Next/React + D3/SVG):** the offensive-signature visualization. This is
  where surplus effort goes. See Design section.
- **Deploy (Vercel):** live URL required by brief; native Next + Neon.

---

## Design direction (the differentiator)

"Opinionated design" is explicitly rewarded, and most candidates render basketball data
as tables. The edge is making spatial/relational data *legible and beautiful*. Leverage
the candidate's generative-art background here.

**Avoid the AI-default looks** (per frontend-design skill): cream + serif + terracotta
(#D97757-adjacent is an Anthropic tell); near-black + single acid accent; broadsheet
hairline-rule newspaper. These appear regardless of subject — don't spend design freedom
on them.

**Ground the aesthetic in the subject.** The subject's world is a basketball court:
geometry, coordinate space, the arc of the three-point line, the paint, movement and
flow. The court itself is the material. The signature element should embody **assisted
scoring** — the connection between creator and scorer, landing at a real place on the
floor — not a chart bolted onto a page. Encode only the three dimensions named in the
guardrails; a beautiful encoding of data we don't have is still fabrication.

**Two-pass process before building UI:** (1) compact token system — 4–6 named hex colors,
2+ deliberate typefaces (characterful display used with restraint, clean body, a mono/
utility face for data), a layout concept, and ONE signature element the tool is
remembered by. (2) critique it against the brief; if any part reads as the generic
default, revise and note why. Only then write code.

**Motion:** deliberate, not scattered. The assist network can animate on load or reveal
on interaction, but resist ambient effects that read as AI-generated. Spend boldness in
one place; keep everything else quiet. Respect `prefers-reduced-motion`.

**Copy:** plain, active, from the user's side of the screen. Name things by what a scout/
coach recognizes, not by how the system is built. Empty and error states give direction,
not mood.

**Quality floor (non-negotiable, unannounced):** responsive to mobile, visible keyboard
focus, reduced-motion respected.

---

## TDD — scoped honestly

TDD applies where it earns its keep. Write tests first for these; do NOT write hollow
tests to hit a coverage number.

**Test (high value):**
- **Data transforms** — given a raw play-by-play / shot blob, does the transform produce
  the correct normalized structure? (Use saved spike JSON as fixtures.)
- **Assister parsing** — the highest-value surface. Given an event description, is the
  `(Name N AST)` tag extracted correctly? Cover unassisted makes (no tag), missed shots,
  and — critically — the **ambiguous surname case, which must resolve to `null`, never a
  guess**.
- **Lineup-interval derivation** — the highest-risk transform. Given substitution events,
  are the on-court fives and their interval boundaries correct across period resets?
- **Shot/play-by-play join** — does `GAME_EVENT_ID` ↔ `actionNumber` join cleanly, and
  what happens to an unmatched event?
- **Assist-edge aggregation** — given `ShotEvent`s, is the directed network (nodes,
  weighted edges, directions) assembled correctly, with `count`/`points`/`made2`/`made3`
  consistent?
- **API contract** — does each endpoint return data matching the Zod schema / TS types?

**Do NOT unit-test:**
- SVG/D3 pixel output — visual review, not assertions. Testing rendered pixels is theater.
- The NBA endpoints themselves — they're external; mock with saved fixtures.

State this scoping in the test README so the suite reflects real confidence, not vanity
coverage.

---

## Working rhythm

- Build in **small, reviewable slices**. The candidate does a **code review before every
  manual commit and push** — Claude does not commit. Produce a slice, explain what changed
  and why, wait for review.
- Conventional-ish commits, clear messages.
- Each slice should leave the app in a runnable state where possible.
- When a slice touches the data contract, update the shared types FIRST, then DB, then API,
  then frontend — contract-first.

## Guardrails

These are about honesty, not scope — the product is free to grow.

- **No fabricated data.** No invented player positions, defensive spacing or contest levels.
  If a view needs data we don't have, we don't build that view.
- **Never guess an assister.** Ambiguous surname→`personId` resolution yields `null` plus a
  logged warning. Label assist data as **assisted made baskets**, not "all ball movement."
- **Unavailable is not zero.** Missing defensive data (opponent side failed validation or is
  not loaded) is `null` in payloads and a dash in the UI.
- **Name the model.** Anything built on expected points states what it knows (location and
  shot value) and what it was built from (shots, teams).
- **Tracking-only dimensions stay out** (contested shots, defender distance, speed). Not public.
- **Play-type context (Synergy), turnovers and full possession modelling** remain future work.
- **Judgements are the reader's.** Views show counts and differences from a stated baseline;
  they do not issue grades, rankings or recommendations unless that is deliberately added.

## Repo hygiene

- `.gitignore`: `.venv/`, `spike_out/`, `.env*`, `node_modules/`, Next build output.
- Keep secrets (Neon connection string) in `.env`, never committed.
- The spike script + `spike_out/` fixtures may live in a gitignored `/scratch` for
  reference while modeling; not part of the deliverable.

## History: original build order (Nets take-home)

1. **Repo + tooling skeleton** — Next + TS, Drizzle, test runner, gitignore, env scaffold.
2. **Data contract** — shared TS types + Zod for player, shot event, assist edge,
   lineup, lineup interval.
3. **ETL** — Python pulls → transforms (TDD the transforms against spike fixtures) → JSON.
4. **DB + migrations** — Drizzle schema from real data shape; initial migration; load ETL
   output.
5. **API** — route handlers per grain (player / lineup / team); Zod-validated; contract-
   tested.
6. **Design pass** — token system + signature element + critique BEFORE frontend code.
7. **Frontend** — shot map, then assist network, then the three-grain switch; wire to API.
8. **Polish** — quality floor, empty/error states, responsive, reduced-motion.
9. **Write-up + disclosure + deploy.**

Confirm scope and this order, then we start Phase 1.
