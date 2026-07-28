# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Court Vision — operating instructions for building this project with Claude as execution
partner. Read this before writing code in any session.

---

## Current repo state (pre-build)

**Nothing from the build order exists yet.** The working tree is a validated data spike
plus planning docs. Do not assume any app scaffolding is present — verify before
referencing it.

```
CLAUDE.md      this file — scope, guardrails, build order
STACK.md       per-layer technology justifications (source for the README write-up)
spike.py       throwaway spike; already run, do not re-run to re-derive facts
spike_out/     saved raw NBA JSON — the test fixtures for ETL transforms
phases/        empty
.venv/         python 3.13; nba_api 1.11.4, pandas, numpy, requests
```

- **Not a git repository yet.** `git init` is part of Phase 1, along with the `.gitignore`
  described under Repo hygiene.
- **No `package.json`, no `/etl`, no test runner, no migrations.** Build/lint/test commands
  do not exist yet; they arrive in Phase 1 (Next + TS + Drizzle + test runner). Once they
  exist, record the real invocations here — do not guess them in the meantime.
- Python work runs against the local venv: `.venv/bin/python spike.py`. The venv is
  gitignored; `nba_api` is the only non-transitive dependency the spike needs.

### The spike fixtures are the test surface

`spike_out/*.json` are real endpoint responses saved in NBA-stats' `{headers, rows}`
column-array shape (not objects — every transform must zip headers to rows). These are the
fixtures TDD'd ETL transforms should run against, so the NBA endpoints are never hit from
a test.

| File | Endpoint | Shape |
|---|---|---|
| `q1_shots_sample.json` | `shotchartdetail` | 24 headers, 25 sample rows (6,933 total for the season) |
| `q2_PassesMade.json` | `playerdashptpass` | 21 headers; `PASS_TO` + `PASS_TEAMMATE_PLAYER_ID` |
| `q2_PassesReceived.json` | `playerdashptpass` | 21 headers; `PASS_FROM` + `PASS_TEAMMATE_PLAYER_ID` |
| `q3_lineups.json` | `teamdashlineups` | 56 headers, top 40 lineups by minutes |

Two shapes worth knowing before modeling, confirmed against the fixtures:

- **Lineup identity** is `GROUP_ID`, a dash-delimited sorted player-id string:
  `'-1629008-1629611-1629651-1641730-1642856-'` (leading and trailing dashes included).
  That is the natural join key to five `PLAYER_ID`s; `GROUP_NAME` is display-only
  (`"M. Porter Jr. - T. Mann - N. Claxton - N. Clowney - E. Dëmin"`).
- **Player names in passing data** are `LAST, FIRST` (`"Minott, Josh"`), unlike
  `shotchartdetail`'s `PLAYER_NAME` (`FIRST LAST`). Normalize on `PLAYER_ID`, never on name.

---

## What this is

**Court Vision** is an observational tool for reading the Brooklyn Nets' offensive
identity through two fused lenses: **ball movement** (who feeds whom — a passing
network) and **shot geography** (where those possessions score). It operates at three
grains from the same underlying data:

- **Player** — one player's passing network + shot signature
- **Lineup** — a five-man unit's players shown together (see data-honesty note)
- **Team** — the full Nets roster's ball-movement network + shot map

It is **observational, not advisory**. It shows a coach/scout/exec their own data in a
form they haven't seen; it never scores lineups, recommends moves, or predicts. The
human brings the judgment. This is a deliberate design line — do not add "grades,"
"ratings," or "you should add X" features.

**Nets-only, 2025-26 regular season.** Not league-wide. The focus is the point: a tool
built for *this organization* to read *its own* rebuild is a stronger deliverable than a
generic league viewer. Say why in the README.

---

## The central concept is the candidate's own

Per the take-home brief, the concept must be the candidate's, not AI-suggested. It is:
the candidate's instinct (lineups, ball movement, make/miss per possession) pressure-
tested against real public-data limits and honestly narrowed to what public data
supports. Claude's role here is **execution** — code, schema, debugging, review, the
write-up — not concept generation. Do not invent new core features; help build the
locked scope well. If a genuinely new *concept* idea arises, flag it as the candidate's
to decide, don't silently bake it in.

---

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

### Passing (`playerdashptpass`) — relational, works WITH ONE CAVEAT
- Returns two sets per player: **PassesMade** and **PassesReceived**.
- Key fields: `PASS_TEAMMATE_PLAYER_ID` (the join), `PASS` (count), `FREQUENCY`, `AST`,
  and shooting results off those passes (`FGM/FGA/FG_PCT`, 2s and 3s).
- Assembling all five players' pairwise records builds a **directed passing network**
  for a lineup. The fusion is mechanically real.

> **CRITICAL DATA-HONESTY CAVEAT.** This passing data is **season-level per player**, NOT
> filtered to shared lineup minutes. A player's pass counts span all their minutes
> against all lineups. So an assembled "lineup network" is really *"the season-long ball-
> movement tendencies of this unit's five players, shown together,"* NOT *"how these five
> passed during their shared possessions."*
>
> **This must be labeled accurately everywhere** — UI copy and README. Honest phrasing:
> "ball-movement tendencies of this unit's players." Overclaim to avoid: "how this lineup
> passed." The distinction, stated openly, is itself a positive signal (knowing your
> data's limits). Never paper over it.

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
flow. The court itself is the material. The signature element should embody ball movement
+ shot geography — not a chart bolted onto a page.

**Two-pass process before building UI:** (1) compact token system — 4–6 named hex colors,
2+ deliberate typefaces (characterful display used with restraint, clean body, a mono/
utility face for data), a layout concept, and ONE signature element the tool is
remembered by. (2) critique it against the brief; if any part reads as the generic
default, revise and note why. Only then write code.

**Motion:** deliberate, not scattered. The passing network can animate on load or reveal
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
- **Data transforms** — given a raw pass blob / shot blob, does the transform produce the
  correct normalized structure? (Highest-value surface. Use saved spike JSON as fixtures.)
- **Network assembly** — given five players' pairwise pass records, is the directed
  network (nodes, weighted edges, directions) assembled correctly?
- **API contract** — does each endpoint return data matching the Zod schema / TS types?
- **Derived math** — any aggregates (edge weights, frequencies, shot-zone rollups) are
  unit-tested against hand-checked values.

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

## Guardrails / do-nots

- **No advisory features.** Observational only. No grades, rankings, recommendations,
  projections, or "who to add."
- **No fabricated data.** Especially no invented player positions or defensive spacing.
  If a view would require data we don't have, we don't build that view.
- **No opponent/matchup views.** Passing data isn't opponent-splittable; "Nets vs X" would
  require faking the opponent dimension. Out of scope.
- **No scope creep dressed as ambition.** The brief says "small" twice. Player + lineup +
  team grain, Nets-only, is the whole scope. Everything else goes in README "Future
  directions," not the build.
- **No over-engineering.** No separate backend service, no auth system, no multi-team
  infra. Right-sized.
- **Label passing data honestly** (season-level, not lineup-filtered) everywhere it appears.

## Repo hygiene

- `.gitignore`: `.venv/`, `spike_out/`, `.env*`, `node_modules/`, Next build output.
- Keep secrets (Neon connection string) in `.env`, never committed.
- The spike script + `spike_out/` fixtures may live in a gitignored `/scratch` for
  reference while modeling; not part of the deliverable.

## Deliverables (from the brief)

1. GitHub repo, clean history, readable code.
2. Deployed live version (Vercel).
3. Write-up: project summary, architecture + technology choices, AI-tool disclosure
   (tools used + prompt summaries), and the data-honesty narrative.

---

## Build order (proposed — confirm before starting each phase)

1. **Repo + tooling skeleton** — Next + TS, Drizzle, test runner, gitignore, env scaffold.
2. **Data contract** — shared TS types + Zod for player, lineup, team, shot, pass-edge.
3. **ETL** — Python pulls → transforms (TDD the transforms against spike fixtures) → JSON.
4. **DB + migrations** — Drizzle schema from real data shape; initial migration; load ETL
   output.
5. **API** — route handlers per grain (player / lineup / team); Zod-validated; contract-
   tested.
6. **Design pass** — token system + signature element + critique BEFORE frontend code.
7. **Frontend** — shot map, then passing network, then the three-grain switch; wire to API.
8. **Polish** — quality floor, empty/error states, responsive, reduced-motion.
9. **Write-up + disclosure + deploy.**

Confirm scope and this order, then we start Phase 1.
