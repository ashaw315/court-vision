# Phase 1 — Repo & Tooling Skeleton (Claude Code prompt)

> Paste this into Claude Code. It assumes CLAUDE.md is already in the repo root — read it
> first. This phase builds ONLY the foundation: no features, no data, no design.

## Objective

Stand up a clean, runnable Next.js + TypeScript skeleton with Drizzle, a test runner, and
correct repo hygiene. End state: `npm run dev` serves a near-empty app, `npm test` passes
one trivial test, and nothing secret or throwaway is tracked by git.

## Read first

- `CLAUDE.md` (repo root) — scope, guardrails, architecture, build order. Do not violate
  the guardrails. This phase corresponds to build-order step 1.

## Tasks

1. **Initialize Next.js + TypeScript** (App Router). Keep the default app minimal — strip
   boilerplate marketing content down to a bare landing placeholder that just renders the
   project name "Court Vision". No design work yet.

2. **Install and configure Drizzle** for Postgres (Neon):
   - `drizzle-orm`, `drizzle-kit`, and a Postgres driver appropriate for Neon serverless
     (`@neondatabase/serverless` or `postgres` — pick one and note why in a comment).
   - A `drizzle.config.ts` pointing at a `DATABASE_URL` env var.
   - An empty `src/db/schema.ts` with a comment placeholder — NO tables yet (schema comes
     in Phase 4, after the data contract and real data shape are locked).
   - A `src/db/client.ts` that lazily creates the Drizzle client from `DATABASE_URL`.

3. **Wire up a test runner** — use Vitest (fast, TS-native, integrates with the Next/TS
   setup). Add a `test` script. Include ONE trivial passing test (e.g. a `sanity.test.ts`
   asserting `true`) purely to confirm the runner works. Do not write feature tests yet.

4. **Folder structure** — create the skeleton directories with `.gitkeep` where empty:
   - `/etl` — Python ETL (Phase 3); add a placeholder `README.md` noting it runs locally,
     not in deploy, and requires the `nba_api` venv.
   - `/src/db` — Drizzle schema + client.
   - `/src/lib/contracts` — shared TS types + Zod (Phase 2). Empty placeholder for now.
   - `/src/app/api` — route handlers (Phase 5). Empty for now.
   - `/scratch` — for spike JSON fixtures; MUST be gitignored.

5. **Repo hygiene:**
   - `.gitignore` must include: `node_modules/`, `.next/`, `.env`, `.env.*` (but allow
     `.env.example`), `.venv/`, `spike_out/`, `/scratch/`, `dist/`, coverage output.
   - `.env.example` with `DATABASE_URL=` (empty) and a comment. The real `.env` stays
     untracked.
   - Confirm `git status` shows no secrets, no `node_modules`, no `.venv`, no `/scratch`.

6. **Verify and report:**
   - `npm run dev` boots without error and serves the placeholder.
   - `npm test` runs green on the trivial test.
   - `npm run build` succeeds (catches config issues early).
   - Print the resulting file tree (excluding gitignored dirs) and the contents of
     `package.json` scripts, `drizzle.config.ts`, `.gitignore`, and `.env.example` so it
     can be reviewed before commit.

## Constraints

- **Do NOT commit.** Leave everything staged/unstaged for human review. The human commits
  and pushes manually after review.
- **No tables, no contract types, no API routes, no ETL logic, no design** — those are
  later phases. Resist scaffolding ahead.
- Prefer stable, current versions; note any version pinned and why if non-obvious.
- Keep dependencies lean — no UI kit, no state library, no D3 yet. Just what the skeleton
  needs.

## Definition of done

A runnable skeleton, green trivial test, clean `git status`, and a printed summary of the
key config files for review. Nothing more.
