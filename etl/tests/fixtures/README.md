# Test fixtures — frozen real NBA data

These files are **tracked in git on purpose**. The ETL test suite must run on a fresh
clone with no network access and no prior pipeline run.

Every file is a real response from the public NBA stats endpoints, saved verbatim. All of
them come from **one game — `0022500610`, Brooklyn Nets vs Phoenix Suns, 19 Jan 2026** —
which keeps the set minimal while still exercising a complete four-period game.

Public game data only: no credentials, no personal data, nothing secret.

| File | Endpoint | What it is |
|---|---|---|
| `pbp_full_0022500610.json` | `playbyplayv3` | The **complete** action stream — 427 events across all 4 periods. Saved as the bare `game.actions` array. |
| `s2b_pbp_v3_sample.json` | `playbyplayv3` | A **truncated** 60-event sample: period 1 only, ending at 4:19, containing just 2 substitutions. Kept deliberately — see below. |
| `s3_boxscore_0022500610.json` | `boxscoretraditionalv3` | Game-scope boxscore. Supplies the authoritative 12-man roster, the starting five (non-empty `position`), and per-player minutes. |
| `s3_boxscore_periods_0022500610.json` | `boxscoretraditionalv3` ×4 | Per-period boxscores (`start_period=N, end_period=N, range_type=1`), keyed by period. Supplies who played each period and for how long. |
| `etl_output_0022500610.json` | *ETL output* | A frozen copy of the pipeline's own output for this game, read by `tests/etl-output.test.ts` to validate emitted records against the Phase 2 Zod contract on a clone. Kept in sync by a staleness guard — see below. |

## The two play-by-play fixtures disagree on 3 events — by design

If you diff `s2b_pbp_v3_sample.json` against `pbp_full_0022500610.json`, the sample's 60
`actionNumber`s are all present in the full stream, but **three of them carry different
content**:

| `actionNumber` | in the sample | in the full stream |
|---|---|---|
| 24 | `MISS Porter Jr. 24' 3PT Jump Shot` | `Gillespie BLOCK (1 BLK)` |
| 61 | `Claxton Lost Ball Turnover (P1.T1)` | `Williams STEAL (1 STL)` |
| 75 | `MISS Clowney 5' Turnaround Jump Shot` | `Williams BLOCK (1 BLK)` |

**Neither file is stale or wrong.** `actionNumber` is **not unique** in the source: a
block or steal shares an `actionNumber` with the shot or turnover it pairs with, differing
only by `actionId`. In this game 16 of 411 distinct `actionNumber`s are duplicated that
way. The two saves were written by different spike scripts that de-duplicated in opposite
directions — one kept the shot, the other kept the block/steal.

Why this is safe: **no duplicated `actionNumber` pairs two field goals**, so
`ShotEvent.eventId` remains unique among the events a ShotEvent can hold (all 81 Nets
field goals in this game have distinct ids). It is only unsafe as a key over *raw stream*
events; `actionId` is the stream-wide unique key. Pinned by
`test_shot_events.py::TestEventIdUniqueness`, and documented on the contract itself in
`src/lib/contracts/entities.ts`.

Do not "fix" one file to match the other. The sample is the historical spike artifact and
the tests using it assert only what it can support.

## Why both a full stream and a truncated sample

They test different things, and the difference is the point.

The **truncated sample** is what the original data spike saved. It is genuinely
impoverished — one period, two substitutions, no period boundary — and the transform tests
that use it are honest about what it can and cannot prove. It also stands in for the
degraded case: a stream where little is observable.

The **full stream** is required by the tests that assert behaviour across all four
periods, most importantly that every period derives a valid opening five. Those tests
previously read a gitignored cache directory behind a `pytest.skip`, which meant they
**silently skipped on a fresh clone** — quietly not verifying the property they exist to
verify. Tracking the full stream removes that failure mode.

## Why frozen data rather than live calls

Three reasons, all deliberate:

1. **Offline.** `stats.nba.com` returns 403 from cloud IPs, so a test that called it
   would fail in CI regardless of correctness.
2. **Deterministic.** A test whose input can change is a test whose failures cannot be
   trusted. Frozen input means a red suite is always a real regression.
3. **Fast.** The whole Python suite runs in well under a second.

Per CLAUDE.md, the NBA endpoints themselves are explicitly *not* under test — they are
external. These fixtures stand in for them.

## The frozen ETL output is guarded against staleness

`etl_output_0022500610.json` is a copy of the pipeline's output, so
`tests/etl-output.test.ts` can validate real emitted records against the Zod contract
without requiring a pipeline run. That creates a divergence risk: a transform change would
alter live output while this copy kept asserting the old shape and passing — and CI, which
only ever sees the frozen copy, would be the branch that's wrong.

So that test also asserts, **whenever `etl/out/game_0022500610.json` exists**, that the
frozen copy matches it exactly (excluding `verification`/`warnings`, which are run
diagnostics rather than contract data). If they diverge the suite fails with instructions
to regenerate:

```
.venv/bin/python etl/run_game.py 0022500610
cp etl/out/game_0022500610.json etl/tests/fixtures/etl_output_0022500610.json
```

On a clone the comparison has nothing to compare against and no-ops — but the contract
assertions still run against the frozen copy, and the guard is written as a normal test
rather than a conditional skip so the suite keeps its zero-skip property.

## Refreshing or adding a fixture

Fixtures are only refreshed deliberately, never automatically. The ETL caches raw
responses under `etl/cache/` (gitignored) when the pipeline runs:

```
.venv/bin/python etl/run_game.py 0022500610
```

To promote a cached response into a tracked fixture, copy it here and note it in the table
above. Keep the set minimal — one game's worth is sufficient, and a large fixture corpus
is a maintenance burden rather than added confidence.
