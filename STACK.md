# Stack & Architecture Decisions

> Working document. Each choice below is paired with the *reason* it was made, so
> the README write-up can be compressed from this without re-deriving the logic.
> Data-layer specifics (table shapes) are provisional until the data spike confirms
> the real shape of the public NBA passing + shot data.

---

## Guiding principle

The dataset for *this take-home* is small, static, and historical — it could ship as
flat JSON files and the app would behave identically. Every choice to add
infrastructure beyond that is therefore deliberate, and justified not by what this
snapshot of data needs, but by what the **actual job** needs: a data layer that
ingests continuously across a season, evolves as new metrics and models are connected,
and stays maintainable as priorities shift through the basketball calendar.

The architecture is built to demonstrate that understanding — while staying small in
scope, per the brief. We design for growth; we do not *build* the growth.

---

## The stack, layer by layer

### 1. Data acquisition — Python ETL scripts (`/etl`)

**What it does:** Pulls public NBA data (shot coordinates, passing networks, lineup
data) from the unofficial NBA stats endpoints, transforms it into a normalized shape,
and loads it into Postgres.

**Why Python, not TS:** The mature community tooling for these undocumented endpoints
(e.g. `nba_api`) is Python. This mirrors the real job, where a JS/TS application layer
sits alongside Python/R for data work — the JD lists Python/R as a preferred qual and
names collaboration with data scientists explicitly.

**Why it's a separate, offline step (not a deployed service):** This is an ETL job run
manually to seed the database, not a live pipeline. Keeping it in-repo (`/etl`) shows
the *whole* pipeline for review; making it offline-only keeps production simple and
honest about what's actually deployed.

**Growth story (README):** In production this is where nightly per-game ingestion would
attach. The transform layer is structured so a scheduled run could append new games
without touching the schema.

### 2. Database — Neon Postgres

**What it does:** Stores the normalized basketball data; serves it to the API layer via
SQL.

**Why a real relational DB when flat files would work:** This is the core judgment call.
A production basketball-ops data layer is a *living* system — games land nightly, tables
grow across a season, and schemas evolve as new models and metrics get connected. A pile
of flat files cannot survive that. Modeling this relationally, with real foreign keys and
migrations, demonstrates the competency the role actually requires, not just the one this
snapshot demands.

**Why Neon specifically:** Serverless Postgres, generous free tier, database branching,
and clean integration with Vercel/Next.js. Branching in particular mirrors a real
workflow where schema changes are tested in isolation before merging.

**Growth story (README):** Modeled relationally *because* a production data layer ingests
continuously and evolves across a season; the schema anticipates new metrics and models
being connected over time rather than being a frozen denormalized snapshot.

### 3. Schema & migrations — Drizzle ORM

**What it does:** Defines the schema in TypeScript, generates and manages ordered,
versioned migrations, and gives the app typed access to the data.

**Why Drizzle over Prisma:** Lighter-weight, TypeScript-native schema (flows directly
into the shared type contract — see §5), and a transparent migration story. The schema
being TS means one source of truth feeds both the DB and the frontend types.

**Why migrations matter here specifically:** The `migrations/` directory is itself the
artifact that proves the "designed to grow" thinking. Even 2–3 ordered migrations
demonstrate that schema evolution is handled deliberately — the exact competency a
season-long, evolving data layer demands.

**Growth story (README):** Migrations are versioned and ordered so schema changes across
a season are auditable and reversible — the way a real ops data layer must handle new
columns, new related models, and connective tables mid-season.

### 4. Backend / API — Next.js API routes (or route handlers)

**What it does:** Queries Postgres via Drizzle, shapes responses to the typed contract,
serves them to the frontend.

**Why this satisfies the brief:** The guidelines require "transfer of data between a
backend / API to the frontend." A real API layer querying a real database is the
strongest reading of that — not fetching a static file.

**Why co-located in Next, not a separate service:** For a project this size, a separate
backend service would be over-engineering (the brief says "keep it small" twice). Next
route handlers give a genuine server/API boundary without standing up a second deploy.
This is itself a judgment call worth naming: right-sized, not maximal.

### 5. Type contract — shared TypeScript types + Zod

**What it does:** One set of types describes the data from DB → API → frontend. Zod
validates at the API boundary that what comes out of the DB matches the contract at
runtime.

**Why it matters:** The JD names TypeScript twice and "clean, maintainable" repeatedly.
A single shared contract across all layers is a small thing that reads as senior — it
prevents drift and documents the data shape in one place. Drizzle's TS schema feeds this
naturally.

### 6. Frontend — Next.js (React) + SVG / D3 visualization

**What it does:** Renders the two-lineup offensive-signature comparison — passing network
(relational) fused with shot map (spatial) — with an opinionated, designed interface.

**Why SVG/D3 over canvas:** The visuals are spatial but not heavily animated (the live
moving-dots idea was cut deliberately — see the honesty note below). SVG/D3 gives precise
aesthetic control, crisp vector rendering, and clean React integration. Canvas would only
be warranted for heavy real-time animation, which this isn't.

**Why this is the differentiator:** "Opinionated design" is explicitly rewarded by the
brief, and most candidates render basketball data as tables. The design layer is where
the surplus effort goes — not into more systems.

### 7. Deployment — Vercel

**What it does:** Hosts the live deployed version required by the brief; pairs natively
with Next.js and Neon.

**Why:** Zero-friction deploy, native Next support, connects cleanly to Neon. The brief
requires a live deployed version; this is the lowest-friction path to it.

---

## Testing approach (TDD, honestly scoped)

TDD applies where it earns its keep. The honest test surface is:

- **Data transforms** — given a raw pass-event / shot blob, does the transform produce
  the correct normalized structure? (This is the highest-value test surface.)
- **API layer** — does each endpoint return data matching the typed contract?
- **Derived math** — any computed metrics (network weights, aggregates) are unit-tested.

The SVG/D3 rendering gets **visual review, not unit tests** — testing pixel output is
theater. This is stated explicitly so the test suite reflects real confidence, not a
coverage number.

---

## The honesty note (core of the write-up narrative)

The original concept involved animated dots — all ten players moving on the court,
possession by possession. That was cut for a real reason worth telling: true player
tracking (continuous x,y positions of all players) comes from Second Spectrum's optical
system and is **not public** — it's locked behind league/team partnerships and CBA
tracking-data privacy clauses. Rather than fabricate positions and animate guesses
(which any basketball-ops reviewer would spot instantly), the project uses only honest
public data — real shot coordinates and real passing networks — rendered as a stylized
offensive signature.

**This boundary is the signal.** "Here's what I wanted, here's why the data to do it
literally is closed, here's the honest reconstruction I built instead" demonstrates the
engineering judgment that separates a deliberate build from a candidate who wired up a
stats table without knowing where the data came from.

---

## One-line summary per layer (for quick README compression)

| Layer | Tech | One-line justification |
|---|---|---|
| ETL | Python (`/etl`) | Mature tooling for NBA endpoints; mirrors real Python-alongside-JS job |
| Database | Neon Postgres | Living ops data layer must survive a season; not a frozen snapshot |
| Schema/migrations | Drizzle | Versioned migrations *are* the proof of "designed to grow" |
| API | Next route handlers | Real backend→frontend transfer, right-sized not maximal |
| Contract | Shared TS + Zod | One source of truth, prevents drift, reads as senior |
| Frontend | Next + SVG/D3 | Opinionated design is the differentiator; precise vector control |
| Deploy | Vercel | Native Next + Neon, lowest-friction live deploy |
