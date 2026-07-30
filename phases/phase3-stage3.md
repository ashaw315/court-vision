# Phase 3 — Stage 3: Full 82-Game Run (Claude Code prompt)

> Paste into Claude Code. Read CLAUDE.md and phases/phase3.md first. Stages 1-2 and the
> hardening pass are committed: the transforms are validated on one game (box-score exact,
> minutes reconciled to the second) and the verifier has coverage + minutes-reconciliation
> checks. This stage runs the WHOLE Nets 2025-26 regular season through that validated
> pipeline. It is about surviving volume and surfacing the long tail — NOT new transform
> logic.

## What this stage is really about

The transforms work on one game. Stage 3 proves they hold across all ~82, and surfaces the
cases one game couldn't contain: overtime, a same-surname pair on ONE roster (the
never-guess path, so far only synthetic-tested), mid-period ejections/injuries, unusual
event sequences. The deliverable is a complete, validated dataset plus an honest report of
anything that didn't fit.

## Three things that carry the weight

### 1. Per-game validation on EVERY game
Run the full `verify_game` suite (all structural checks, attribution-coverage threshold,
and minutes-reconciliation) on each game individually. A game that fails any check is
logged with its game_id and the specific failure — never silently absorbed into an
aggregate. The run must make a bad game 47 identifiable, not blend it into a total.

### 2. Checkpointing / resumability
~82 games × several endpoint calls each (playbyplayv3, game boxscore, per-period boxscore)
at a polite rate limit = a 15-30 minute run. It MUST resume, not restart, if it dies:
- Cache raw endpoint responses per game (reuse the existing cache dir; already gitignored).
- Persist per-game processed output so a re-run skips completed games.
- A crash, network blip, or Ctrl-C at game 70 resumes from game 70, not game 1.

### 3. Failure policy — loud, isolated, non-fatal
When a single game fails (endpoint error, a verify check fails, an unparseable event):
- Log it loudly against the game_id with the specific reason.
- CONTINUE to the next game — one bad game does not abort the run.
- At the end, print a manifest: games succeeded, games failed (with reasons), and
  aggregate honesty stats. A partial dataset with a clear failure list is the correct
  outcome; a silent 79/82 that looks like 82/82 is not.

## Tasks

1. **Game list.** Use `teamgamelog` to get all Nets 2025-26 regular-season game_ids (the
   loop driver). Confirm the count (~82).

2. **Per-game pipeline.** For each game_id: fetch (cached) → transform → verify_game →
   persist output. Reuse everything from stages 1-2; do not rewrite transforms.

3. **Rate limiting & politeness.** Keep the existing ~1 req / 2s + bounded backoff. Cache
   so re-runs don't re-hit the endpoint. Be a good citizen.

4. **Aggregate the season output** into the shape Phase 4 will load: all ShotEvents,
   AssistEdges, LineupIntervals, Lineups (above-threshold), Players — validated against the
   Phase 2 Zod contract in aggregate, not just per game.

5. **Season honesty report** (print + save): games processed / failed, total shots,
   attributed %, assisted-vs-unassisted split (season), unresolved-assister count, count of
   games that triggered each edge case (OT, same-surname ambiguity, sub-anomalies). These
   numbers are write-up material AND a sanity check — e.g. a season assisted % wildly off
   ~55-65% would signal a systemic bug.

## Watch for (the long tail one game didn't test)

- **Same-surname on one roster** → the never-guess null path. If it fires on real data,
  confirm it produces null + warning, not a wrong edge. Report how many times it happened.
- **Overtime games** → periods beyond 4. The per-period opener seeding must handle them.
- **Traded/10-day/two-way players** appearing mid-season → roster resolution across games.
- **A game where minutes DON'T reconcile** → must fail that game's check loudly and appear
  in the manifest, not silently pass.
- **Endpoint flakiness** → 403s/timeouts from the NBA endpoints are expected intermittently;
  retry/backoff and, if a game still fails, log-and-continue.

## Constraints

- Do NOT change the validated transforms unless a real bug surfaces — and if one does, flag
  it, add a regression test, don't silently patch.
- Do NOT write to Postgres (Phase 4) or build API/UI. Emit validated JSON only.
- Output goes to the gitignored output dir; do NOT commit the full dataset yet (decide
  committing vs. regenerating in Phase 4).
- Do NOT commit. Stop for review with the season honesty report.
- Run the actual 82-game pull (it's the point of the stage) — but if it's long, it's fine
  to report progress and let it run; checkpointing makes that safe.

## Definition of done

- All ~82 games pulled, transformed, verified per-game, output persisted.
- A season manifest: successes, failures (with game_ids + reasons), and the honesty stats.
- Aggregate output validates against the Phase 2 contract.
- Any long-tail case that fired is reported honestly, with the never-guess/coverage/minutes
  guards shown working (or a real bug flagged with a regression test).

Report the season honesty report and the failure manifest, and stop for review.
