# Phase 5 — API Layer (Claude Code prompt)

> Paste into Claude Code. Read CLAUDE.md, STACK.md, and phases/phase2.md first.
> Phase 4 is done: Neon holds the validated season (verified 24/24). This phase exposes it
> through read-only Next.js route handlers, one per grain, returning contract-shaped JSON.
> Calm phase. No UI yet — this is the data-to-frontend boundary the brief requires.

## Purpose

Court Vision is a UI-serving tool. The API exists to feed the visualization, not to be a
general data API. So endpoints return data in the shape the FRONTEND consumes (assist
network + shot map + split, per scope) — the server queries and shapes; the browser
renders. Do NOT build a thin passthrough that dumps raw tables and makes the client
assemble everything.

## The three grains (the whole tool)

Each grain returns the same conceptual bundle for its scope: the assist network (edges),
the shot map (located shots), and the assisted-vs-unassisted split.

1. **Player** — `GET /api/player/[personId]`
   - That player's assist edges (as assister AND as shooter), their located shots, their
     assisted/unassisted split.
2. **Lineup** — `GET /api/lineup/[groupId]`
   - The unit's assist network and shot map, filtered to the LineupIntervals that unit was
     actually on court for (the lineup-filtered capability the whole project is built on).
   - Also: `GET /api/lineups?minMinutes=NN` — list available lineups above a threshold, so
     the frontend picks the display cutoff (emit floor is 25; default display can be 50).
     Return each lineup's minutes so the UI can show sample size honestly.
3. **Team** — `GET /api/team`
   - The full Nets roster's assist network + shot map + season split.

Plus whatever small support endpoints the UI genuinely needs — e.g. `GET /api/players` to
populate a player picker. Don't add speculative endpoints.

## Design rules

- **Next.js App Router route handlers** (`src/app/api/.../route.ts`), reading Neon via the
  Drizzle client from Phase 4.
- **Validate responses against the Phase 2 Zod contract** before returning — the contract
  is enforced at the API boundary too, so the frontend gets a guaranteed shape. Reuse the
  existing schemas; don't invent response-only types except thin wrappers (e.g. a
  `GrainResponse` combining edges + shots + split, itself a Zod schema).
- **Read-only.** GET only. No mutations, no auth (right-sized per the brief — this is
  internal-tool-shaped, not a public multi-tenant API).
- **Shape for the UI.** Each grain response is one bundle the frontend can render directly:
  `{ scope, edges, shots, split, ...minimal metadata }`. Compute the split server-side.
- **Honest nulls pass through.** Unassisted shots (null assister) and unattributable shots
  (null interval) stay null in responses — never coerced.
- **Errors are clean.** Unknown personId/groupId → 404 with a clear JSON error, not a 500.
  Invalid params → 400. No stack traces leaked.
- **Efficient queries.** Use the indexes from Phase 4. Don't N+1 (e.g. don't fetch shots
  then loop per-shot to fetch players). Assemble each response in a small number of
  queries.

## Testing

- Test the query/shaping logic and the response contract: given seeded data, does
  `/api/player/[id]` return the right edges/shots/split in the contract shape? Does an
  unknown id 404? Does the lineup grain correctly filter to on-court intervals?
- These tests need the DB. Prefer testing the shaping functions against known seeded
  values, and/or a lightweight route test. Do NOT hit live NBA endpoints (there are none
  here — it's all Neon now).
- Keep the DB-dependent tests runnable: document how they connect (the same env loader),
  and don't let them silently skip if the DB is absent — either run them or fail clearly.
  (Remember the silent-skip lesson from Phase 3.)

## Constraints

- No UI/components — Phase 6/7.
- No new data, no schema changes (unless a real missing index surfaces — then it's a real
  migration, flagged).
- Reuse the Drizzle client and contract; don't duplicate DB or type logic.
- Do NOT commit. Stop for review with the endpoint list, a sample response from each grain
  (real seeded data), and the test results.

## Definition of done

- Route handlers for player, lineup (single + list), and team grains, reading Neon,
  returning contract-validated UI-shaped JSON.
- Clean 404/400 handling; honest nulls preserved.
- Tests covering shaping + contract + not-found, green, not silently skipping.
- A real sample response from each grain endpoint (curl or equivalent against the seeded
  DB) included in the report so we can see the actual shape the frontend will consume.

Report the endpoints, sample responses, and tests. Stop for review.
