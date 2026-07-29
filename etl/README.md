# ETL

Turns raw NBA play-by-play into the Phase 2 contract shapes. Emits JSON; it does **not**
write to Postgres — Phase 4 loads the JSON. Keeping those concerns separate means the
transforms can be tested without a database.

## This runs locally, never in the deploy

`stats.nba.com` returns **403 from cloud IPs**. The ETL is a manual, offline seeding step
run from a machine on an allowed network. The deployed app never calls the NBA endpoints —
it only reads from Postgres. That separation is deliberate architecture, not a workaround.

## Stage status

Built incrementally, per `phases/phase3.md`:

- **Stage 1 — transforms, TDD'd against saved fixtures, no network.** ✅ Done.
- **Stage 2 — one-game live pull end-to-end.** ✅ Done (`etl/run_game.py`).
- **Stage 3 — all 82 games, rate-limited + checkpointed.** Not started.

```
.venv/bin/python etl/run_game.py [GAME_ID]   # default 0022500610 (BKN vs PHX)
```

Raw responses cache under `etl/cache/`; delete it to force a re-fetch. Requests are
throttled to one per 2s with bounded retry/backoff.

`etl/run_fixture.py` and `etl/run_game.py` both write `etl/out/fixture_stage1.json`,
which `tests/etl-output.test.ts` reads. Run `run_game.py` last if you want the contract
test exercised against the full game rather than the truncated fixture.

### How each period's opening five is established

Play-by-play never states who is on court, only substitutions — and the five does **not**
carry across a period boundary (coaches re-choose at the break and emit no substitution
events for it). So each period's opening five is derived independently:

| Period | Source |
|---|---|
| 1 | Boxscore starters (`position` non-empty) — authoritative |
| 2+ | Boxscore per-period participation **minus** players who entered as a substitute before ever being substituted out |

Both are boxscore-anchored, so a player who was on court but recorded no action is still
counted. That makes the old "fewer than five players acted → whole period lost" failure
structurally impossible rather than merely handled.

**Deviation from the instruction, with evidence.** The instruction was to seed every
period's opening five *from the boxscore*, using observation only as a cross-check. Two
verified facts about the endpoint shaped how that was met:

1. `BoxScoreTraditionalV3` at game scope has **no per-period lineup data** — only game
   starters and game totals. It cannot seed periods 2+ on its own.
2. A per-period call (`start_period=N, end_period=N, range_type=1`) says who played and
   for how long, but per-period **minutes cannot identify the openers**: in the validated
   game's period 2 the openers' minutes ranged 4:56–10:41 while two non-openers had 7:04.
   A player can open, sit and return (high total, opener) or open and be pulled early (low
   total, opener). Ranking by minutes yields the wrong five.

So the boxscore supplies the candidate set (who played) and the stream supplies only
substitution direction (who entered). Verified on the live game: exactly five openers for
every period, agreeing with independent stream observation in periods 2, 3 and 4.
Observation is retained purely as a **cross-check** — any disagreement between the two is
reported as a warning, never silently resolved.

Per-period boxscores cost one extra call per period (~330 across 82 games). If they are
unavailable the derivation degrades to observation alone and says so in a warning.

### Stage 2 result (game 0022500610, BKN vs PHX)

All **16** structural checks pass. 81/81 shots attributed to a lineup, 17 intervals across
all 4 periods, 0 warnings. Cross-validated against the boxscore — an independent
endpoint — and every figure matches exactly: 81 FGA, 41 FGM, 28 assists, per-player assist
counts for all 9 Nets assisters, and **per-player minutes to the second for all 10
players** (14,400 derived player-seconds = 5 × 48 min exactly). Assisted share 68.3% (28
assisted, 13 self-created, 0 unresolved assisters).

Two checks were added after adversarial re-review, both guarding failure modes that were
previously invisible:

- **shot attribution coverage** — fails below 99.5%. Stage 2's first run attributed 30 of
  81 shots and still passed 11 of 14 checks; the non-zero exit came from unrelated
  failures. Coverage collapse is now a direct failure.
- **derived minutes match the boxscore** — the strongest available validation. Membership
  checks prove *who*; this proves *when*. A boundary shifted by 30s keeps the correct five
  in every interval and corrupts every duration downstream, and nothing else detects it.
  Verified by injection: a 30s shift and a single swapped player are both caught. If
  boxscore minutes are not supplied the check is skipped and recorded as a problem — an
  absent validation never reads as a pass.

## Environment

Python 3.13 via the repo-root venv (gitignored).

All commands run from the **repo root** (`pytest.ini` there sets the import path):

```
.venv/bin/pip install -r etl/requirements.txt
.venv/bin/python -m pytest -q          # transform tests, no network
npm run lint:py                        # ruff (Python linting)
.venv/bin/python etl/run_fixture.py    # stage-1 driver → etl/out/
npm run test:etl                       # ruff + transforms + contract validation
```

## The contract is the boundary

The ETL emits JSON that must satisfy the Phase 2 Zod schemas. Validation runs on the
**TypeScript** side, against the real schemas in `src/lib/contracts`:

```
npx vitest run tests/etl-output.test.ts
```

This is deliberate. Mirroring the schemas in Python would let the two definitions drift
and defeat the purpose of a single contract. A record the contract rejects is a bug in the
ETL, not something to coerce.

## What's tested, and what isn't

Per CLAUDE.md, tests go where they earn their keep. The two high-risk transforms were
TDD'd — tests written before implementation:

- **`transforms/assister.py`** — the `(Surname N AST)` parse and surname→personId
  resolution. Covers the apostrophe (`O'Neale`), the suffix (`Porter Jr.`), sibling tags
  that must NOT match (`(3 PTS)`, `(Williams 1 BLK)`), and the load-bearing case: an
  **ambiguous surname resolves to `None` and is never guessed.**
- **`transforms/lineup_intervals.py`** — substitution application, period boundaries,
  simultaneous subs, a starter who is subbed out and returns, and the refusal path: an
  unresolvable substitution makes the five UNKNOWN and drops the affected intervals
  rather than emitting a stale one.
- **`transforms/roster.py`** — authoritative roster + starting five from the boxscore.

`tests/test_review_regressions.py` holds a permanent regression test per defect found in
adversarial review (see below), each named for its finding.

Not tested here: the NBA endpoints themselves (external; fixtures stand in for them) and
anything requiring a network call.

### Fixture limitation, stated plainly

`scratch/fixtures/s2b_pbp_v3_sample.json` is a **truncated 60-event sample** — period 1
only, ending at 4:19, with just **two substitutions** and no period boundary. It proves
starting-five derivation and a single substitution against real data. Period resets,
re-entry, and simultaneous subs cannot be proven from it, so those tests use synthetic
event streams in the real V3 shape. **Stage 2, against a full game, is where the
substitution logic first meets a complete stream** — treat its output as unverified until
then.

## Adversarial review: 9 defects found and fixed

Stage 1 passed 45 tests and still contained 9 real defects. They were found by attacking
the transforms rather than confirming them; each now has a regression test.

| # | Defect | Consequence |
|---|---|---|
| 1 | Unresolved substitution left the five unchanged | Emitted an interval asserting the OUTGOING player was on court — fabrication |
| 2 | Starting five derived from the stream | A starter who was quiet before being subbed out made the five short and **dropped the whole period** |
| 3 | The two transforms never met | `interval_for_event` was dead code; no ShotEvent carried a lineup, so lineup-filtered assists did not exist |
| 4 | Roster derived from the stream | Only players who ACTED were present (5 of 12); resolution was order-dependent |
| 5 | Period opened at the first recorded action | A shot before that action mapped to no lineup |
| 6 | Substitution at the exact period-start instant | Dropped the starting five / emitted a zero-length interval |
| 7 | Self-assist counted as assisted | Impossible source data inflated the assisted numerator |
| 8 | Surnames matched with periods intact | `"Porter Jr"` vs `"Porter Jr."` silently became "unresolved" |
| 9 | Half-open interval containment | A shot at exactly `endClock` — including every **buzzer-beater** — mapped to no lineup |

Stage 2 then found an **11th**, against the first complete 4-period stream: the on-court
five does **not** carry across a period boundary. Coaches re-choose at the break and no
substitution events describe it — Porter Jr. was subbed out at P1 6:04, never subbed back
in during P1, and opened P2 on court. Carry-forward produced a five the next events
contradicted, which tripped the "outgoing player was not on court" refusal and **cascaded**:
periods 3 and 4 emitted nothing and 51 of 81 shots lost attribution. Each period's opening
five is now derived independently — observed from its own events, with period 1 taking the
boxscore starters and any disagreement reported. Periods are independent, so one broken
period can no longer poison later ones.

Findings #2 and #4 were fixed at the root by adding `BoxScoreTraditionalV3` (one call per
game) instead of inferring from play-by-play. On the validated game this took the roster
from 5 to 12 players, resolved the substitution that previously could not be resolved, and
took shots-with-a-lineup from 0 to 13/13.

## Two source decisions

**V3 alone; no `shotchartdetail`.** V3 carries everything `ShotEvent` needs. Validated
against the fixtures: across the 13 overlapping events, coordinates, made-flag and
`PLAYER_ID` agree exactly. The one difference is `shotDistance` — V3 **rounds** the
Euclidean distance where shotchart **truncates** it (25.52 ft → V3 26, shotchart 25).
Neither is wrong; they differ by convention. We keep V3's value so the stored distance
stays consistent with the stored coordinates, and we save an endpoint call per game.

**Substitution direction.** V3 writes `"SUB: <incoming> FOR <outgoing>"` with `personId`
set to the **outgoing** player — verified against fixture event #67 (`personId` 1629008
Porter Jr., description `"SUB: Williams FOR Porter Jr."`). The outgoing player is taken
from `personId` structurally; only the incoming player needs surname resolution, and it
follows the same never-guess rule as the assister.
