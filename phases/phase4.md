# Phase 4 — Database: Schema, Migrations, Seed (Claude Code prompt)

> Paste into Claude Code. Read CLAUDE.md, STACK.md, and phases/phase2.md first.
> Phase 3 is done: a validated 72-game dataset (6,089 shots, 100% attributed, box-score
> reconciled) is emitted as JSON. This phase models it in Neon Postgres via Drizzle,
> writes ordered migrations, and seeds the data. This is a CALM, mechanical phase — the
> hard correctness work is behind us. No transforms, no parsing.

## The data flow this phase builds

```
committed JSON  ->  seed script (validates vs Zod contract)  ->  Neon Postgres  ->  [Phase 5 API reads]
```

The season is over; the data is static and will never change. Seed runs ONCE manually.
The deployed app only ever READS from Neon — never the JSON, never the NBA.

## Decisions already made (don't relitigate)

- **Commit the dataset.** The ~2.4MB validated season JSON gets committed (it's small and
  makes the DB reproducible from a clean clone). Move it from the gitignored ETL output
  dir to a tracked location (e.g. `data/season.json` or `db/seed-data/`). A fresh clone +
  Neon + migrate + seed must reproduce an identical database.
- **Neon is provisioned.** `DATABASE_URL` is in the developer's local env. Do NOT commit
  it; `.env.example` documents the variable.
- **Emit floor 25 min; display threshold is the frontend's job.** The DB stores all
  emitted lineups (21 units) with their minutes; the API/UI filters later.

## Env gotcha to handle first

Standalone scripts (drizzle-kit, the seed script) do NOT automatically read `.env.local`
the way the Next app does — they typically look for `.env`. Make DATABASE_URL reliably
available to drizzle-kit and the seed script (e.g. load `.env.local` explicitly via a
dotenv call in the drizzle config / seed script, or document a `.env` for tooling).
Verify the migration and seed commands actually find the connection string before
building on them. Confirm `.env.local` (and any `.env`) is gitignored.

## Tasks

### 1. Drizzle schema (`src/db/schema.ts`)
Translate the Phase 2 Zod contract into relational tables. One table per entity:
- `players` (personId PK, displayName)
- `games` (gameId PK, plus any game metadata available — date, opponent if in the data)
- `lineups` (groupId PK, minutes; the 5 personIds as a relation or array — choose and
  justify)
- `lineup_intervals` (intervalId PK, gameId FK, period, start/end clock, onCourt five)
- `shot_events` (eventId within game — note eventId is unique among FIELD-GOAL events per
  the Phase 3 finding; use a surrogate PK or composite (gameId, eventId)); FKs to players
  (shooter, assister-nullable), games, and lineup_intervals (intervalId, nullable if a
  shot is unattributable)
- `assist_edges` (assister FK, shooter FK, count/points/made2/made3; scope — team/season)

Model real **foreign keys** — shots→players, intervals→games, edges→players. This is the
"designed to grow across a season" architecture STACK.md justifies. Use Drizzle relations
so Phase 5 can query naturally.

Design notes to decide and comment:
- The five personIds on a lineup/interval: Postgres array column vs. a join table. For a
  fixed-5 read-mostly static set, an array is simpler and honest; a join table is more
  "normalized." Pick one, justify in a comment (either is defensible; don't over-engineer).
- `assisterId` and `intervalId` are nullable (the honesty nulls from Phase 3) — model them
  nullable, not with a sentinel.

### 2. Migrations
Generate ordered Drizzle migrations (`drizzle-kit generate`). This is the growth story —
real versioned migration files in `/drizzle`, committed. Start with the initial schema
migration. If a genuine schema refinement happens while building (e.g. an index you
actually need), that's a real second migration — good. Do NOT manufacture fake migrations
for show.
- Add indexes that the API will actually use (e.g. shot_events by intervalId, by shooterId;
  assist_edges by assisterId) — but only ones a real query needs.

### 3. Seed script (`src/db/seed.ts` or `scripts/seed.ts`)
- Reads the committed season JSON.
- Validates every record against the Phase 2 Zod schemas at the boundary (import the
  contract; a record that fails is a hard error, not coerced). The contract is enforced
  one more time here.
- Inserts in FK-safe order: players and games first, then lineups and lineup_intervals,
  then shot_events, then assist_edges. Handle ordering explicitly.
- Idempotent: safe to re-run (truncate-and-reload, or upsert). Document which.
- Batches inserts sensibly (don't insert 6,089 shots one round-trip at a time).

### 4. Verification
After seeding, assert the DB matches the source: row counts per table equal the JSON
counts (6,089 shots, 286 edges, 1,380 intervals, 21 lineups, 22 players), no orphaned FKs,
and a couple of spot-checks (a known assisted shot has the right assister; the top lineup's
minutes match). Print a seed report.

## Constraints

- No API routes, no UI — Phase 5+. Just schema, migrations, seed, verification.
- Migrations and seed run LOCALLY against Neon; not in the deployed app.
- Do NOT commit `.env.local` / `.env`. Do commit the schema, migrations, seed script, and
  the season JSON.
- Contract is the boundary — seed validates against the same Zod schemas; no divergent
  DB-only shape.
- Keep it right-sized: real FKs and indexes the API needs, but no auth, no multi-tenant, no
  speculative tables.
- Do NOT commit at the end — stop for review with the seed report and row-count
  verification.

## Definition of done

- Drizzle schema modeling all entities with real FKs, committed.
- Ordered migrations in `/drizzle`, committed; `drizzle-kit migrate` creates the tables in
  Neon cleanly.
- Season JSON committed to a tracked location.
- Seed script loads Neon, validating against the contract, in FK-safe order, idempotently.
- Verification: row counts match JSON, no orphaned FKs, spot-checks pass; seed report
  printed.
- Suite still green (add tests for the seed's transform/validation logic where it has any;
  don't unit-test the live DB connection).

Report the schema, the migration, and the seed/verification output. Stop for review.
