# Court Vision

A tool for reading how the Brooklyn Nets create baskets — who sets up whom, and where those baskets land — across the 2025-26 regular season, at team, lineup, and player scope.

**Live:** [court-vision-seven.vercel.app](https://court-vision-seven.vercel.app)

---

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Data source](#data-source)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Data integrity](#data-integrity)
- [AI-tool disclosure](#ai-tool-disclosure)

---

## Overview

Court Vision visualizes *assisted scoring* — the creation connections that produce made baskets — as a paired set of plates: a creation network (who creates for whom) and a spatial signature (where a given connection's baskets land). The same instrument renders three scopes: the full roster, a five-man lineup, or a single player.

It is observational, not predictive: it surfaces what the record shows and leaves the judgment to the reader.

For the concept, the design reasoning, and the data-integrity narrative, see **[WRITEUP.md](WRITEUP.md)**.

## Architecture

```
NBA play-by-play → Python ETL → Zod contract → Neon Postgres (Drizzle) → typed API → React/SVG frontend → Vercel
```

The ETL runs locally and writes a validated dataset; the deployed app reads only from Postgres and never contacts the NBA at runtime. Rationale for each choice is in **[WRITEUP.md](WRITEUP.md)**.

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16.2.12 (App Router), React 19.2.4 |
| Language | TypeScript 5 |
| Contract | Zod 4 — validated at the pipeline, API, and frontend boundaries |
| Database | Neon Postgres (`@neondatabase/serverless` 1.1) |
| ORM / migrations | Drizzle ORM 0.45, drizzle-kit 0.31 |
| Visualization | Hand-rolled SVG in React; `d3-scale` for scale math only (no D3 rendering) |
| ETL | Python 3.13, `nba_api` 1.11.4 |
| Tests | Vitest 4 (TypeScript), pytest 8.3 (Python), ruff 0.9 (Python lint) |
| Deploy | Vercel |

## Data source

`stats.nba.com`, via [`nba_api`](https://github.com/swar/nba_api). Three endpoints:

| Endpoint | Used for |
|---|---|
| `playbyplayv3` | Every event: shots, locations, made/missed, and the assist tag |
| `boxscoretraditionalv3` | Rosters, period starting fives, and the reconciliation check |
| `teamgamelog` | The season's game list |

Shot locations and assists both come from `playbyplayv3` — there is no separate shot-chart call.

> `stats.nba.com` returns 403 from cloud IPs. The ETL is designed to run locally; responses are cached under `etl/cache/`.

## Getting started

### Prerequisites

- **Node.js 20+** (developed on 24.3.0)
- **Python 3.13** (for the ETL and its tests)
- A **Postgres database** — [Neon](https://neon.tech) free tier is what this uses

### 1. Install

```bash
git clone <repo-url>
cd court-vision
npm install

# Python ETL dependencies, into a repo-root .venv
python3 -m venv .venv
.venv/bin/pip install -r etl/requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
```

Then set the one required variable in `.env`:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

`.env` is gitignored. Never commit a real connection string.

### 3. Set up the database

```bash
npm run db:migrate   # apply migrations
npm run db:seed      # load data/season.json into Postgres
npm run db:verify    # 24 checks: does the DB match the source dataset?
```

The repo ships with `data/season.json` already built, so you can seed and run without touching the NBA API.

### 4. Run the app

```bash
npm run dev          # http://localhost:3000
```

### 5. Re-run the ETL (optional)

Only needed to regenerate the dataset from source. Requires a non-cloud IP.

```bash
.venv/bin/python etl/run_season.py              # full season
.venv/bin/python etl/run_season.py --limit 3    # smoke-test the loop
.venv/bin/python etl/run_game.py <GAME_ID>      # a single game
```

Writes `etl/out/season.json`, `etl/out/season_manifest.json`, and per-game files in `etl/out/games/`.

> **Note:** `data/season.json` (what the seed reads) is the ETL's season output plus a `games` array and the run `manifest`. No committed script performs that assembly, so regenerating the seed file from a fresh ETL run is a manual step.

## Project structure

```
src/app/          Next.js App Router — pages and the read-only API routes
src/components/   React/SVG plates (network, court), navigation, info panel
src/lib/          Contract (Zod), query layer, geometry, design tokens
src/db/           Drizzle schema, seed and verify scripts
etl/              Python pipeline — client, transforms, verification, tests
etl/transforms/   The real work: assister parsing, lineup intervals, shot events
data/             season.json — the committed dataset the seed loads
drizzle/          Generated SQL migrations
tests/            Vitest suites (contract, API, geometry, labels, layout)
design/           Resolved design reference (source of truth for the plates)
phases/           Staged build plans and prompts (see AI-tool disclosure)
```

## Testing

```bash
npm test           # Vitest — 354 tests across 21 files
npm run test:etl   # ruff + pytest (138 tests) + the ETL-output contract test
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Coverage is scoped deliberately (see `CLAUDE.md`): data transforms, assister parsing, lineup-interval derivation, the shot/play-by-play join, assist-edge aggregation, API contracts, and label-vs-computation guards. Rendered SVG output is reviewed visually rather than asserted.

Some suites read the seeded database and **fail** — rather than skip — when `DATABASE_URL` is absent, so a green run always means the assertions actually executed.

## Data integrity

Every derived figure is checked against the official box scores: across all 72 games, field goals and assists reconcile exactly, and minutes to within two seconds per player. Ten of the season's 82 games are excluded because their substitution timestamps contradict themselves in the source — rather than guess a lineup, those games were dropped.

The full account is in **[WRITEUP.md](WRITEUP.md)**.

## AI-tool disclosure

The concept, design, and direction are the author's; implementation was AI-assisted and reviewed at every step. Full disclosure is in **[WRITEUP.md](WRITEUP.md)**, and the staged build plans and prompts are preserved in [`phases/`](phases/).
