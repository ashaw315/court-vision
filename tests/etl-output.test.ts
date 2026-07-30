import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssistEdge, LineupInterval, Player, ShotEvent } from '@/lib/contracts';

/**
 * Validates the Python ETL's output against the REAL Phase 2 Zod contract.
 *
 * This is the enforced interface between the Python ETL and the rest of the stack. The
 * alternative — mirroring the schemas in Python — would let the two definitions drift
 * and quietly defeat the purpose of having one contract. Instead the ETL emits JSON and
 * these tests parse it with the actual schemas. A record the contract rejects is a bug
 * in the ETL, not something to coerce.
 *
 * Input resolution, in order:
 *   1. `etl/out/fixture_stage1.json` — live output, if the pipeline has been run locally.
 *   2. `etl/tests/fixtures/etl_output_0022500610.json` — a TRACKED frozen copy.
 *
 * The tracked fallback exists so this file actually runs on a fresh clone. It previously
 * read only the gitignored `etl/out/` path behind a `describe.skipIf`, which meant all
 * eight assertions SILENTLY SKIPPED for anyone who had not run the ETL — reporting green
 * while verifying nothing. Preferring live output keeps the test meaningful during
 * development; the frozen copy keeps it meaningful everywhere else.
 *
 * Regenerate the live input with:  .venv/bin/python etl/run_game.py
 */

// Anchored to this file, not the working directory.
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIVE_OUTPUT = path.join(HERE, '..', 'etl', 'out', 'fixture_stage1.json');
const TRACKED_OUTPUT = path.join(
  HERE, '..', 'etl', 'tests', 'fixtures', 'etl_output_0022500610.json',
);
// The staleness guard compares against the full-game artifact specifically, NOT
// fixture_stage1.json: run_fixture.py overwrites that path with truncated-sample output
// (13 shots), so comparing the frozen full-game copy to it would fail for the wrong
// reason. run_game.py writes both.
const LIVE_GAME_OUTPUT = path.join(
  HERE, '..', 'etl', 'out', 'game_0022500610.json',
);

const source = existsSync(LIVE_OUTPUT) ? LIVE_OUTPUT : TRACKED_OUTPUT;
const payload = JSON.parse(readFileSync(source, 'utf8'));

describe('ETL output conforms to the Phase 2 contract', () => {
  it('emits shot events that satisfy ShotEvent', () => {
    expect(payload.shotEvents.length).toBeGreaterThan(0);
    for (const record of payload.shotEvents) {
      const result = ShotEvent.safeParse(record);
      expect(result.success, JSON.stringify({ record, error: result.error?.issues }))
        .toBe(true);
    }
  });

  it('emits assist edges that satisfy AssistEdge', () => {
    expect(payload.assistEdges.length).toBeGreaterThan(0);
    for (const record of payload.assistEdges) {
      const result = AssistEdge.safeParse(record);
      expect(result.success, JSON.stringify({ record, error: result.error?.issues }))
        .toBe(true);
    }
  });

  it('emits lineup intervals that satisfy LineupInterval', () => {
    expect(payload.lineupIntervals.length).toBeGreaterThan(0);
    for (const record of payload.lineupIntervals) {
      const result = LineupInterval.safeParse(record);
      expect(result.success, JSON.stringify({ record, error: result.error?.issues }))
        .toBe(true);
    }
  });

  it('emits players that satisfy Player', () => {
    expect(payload.players.length).toBeGreaterThan(0);
    for (const record of payload.players) {
      expect(Player.safeParse(record).success).toBe(true);
    }
  });

  it('preserves intervalId through the contract, not silently stripping it', () => {
    // Zod strips unknown keys by default, so an emitted field the schema does not
    // declare vanishes without error. That is exactly how the lineup-filtered assist
    // capability could be lost crossing from Python into TypeScript — the ETL would
    // emit intervalId and the app would never see it.
    for (const record of payload.shotEvents) {
      const parsed = ShotEvent.parse(record);
      expect('intervalId' in parsed).toBe(true);
      expect(parsed.intervalId).toBe(record.intervalId);
    }
  });

  it('attributes shots to lineups that actually exist', () => {
    const intervalIds = new Set(
      payload.lineupIntervals.map((iv: { intervalId: string }) => iv.intervalId),
    );
    for (const record of payload.shotEvents) {
      if (record.intervalId !== null) {
        expect(intervalIds.has(record.intervalId)).toBe(true);
      }
    }
  });

  it('never emits a name where a personId belongs', () => {
    for (const record of payload.shotEvents) {
      expect(typeof record.shooterId).toBe('number');
      expect(record.assisterId === null || typeof record.assisterId === 'number')
        .toBe(true);
    }
  });

  it('keeps the assisted split consistent with the emitted events', () => {
    const made = payload.shotEvents.filter((e: { made: boolean }) => e.made);
    const assisted = made.filter((e: { assisted: boolean }) => e.assisted);
    expect(payload.assistedSplit.madeBaskets).toBe(made.length);
    expect(payload.assistedSplit.assisted).toBe(assisted.length);
    expect(payload.assistedSplit.selfCreated).toBe(made.length - assisted.length);
  });
});

/**
 * Staleness guard.
 *
 * The contract assertions above run against live output when it exists and the frozen
 * copy otherwise. That is what makes them work on a clone — but it also means the two
 * inputs could silently diverge: a transform change would alter live output while the
 * frozen copy kept asserting the old shape and passing. CI (frozen) would then be
 * green about something that is no longer true.
 *
 * So whenever live full-game output is present, it must MATCH the frozen fixture. If it
 * doesn't, the fixture needs regenerating — which is a deliberate act, not something to
 * discover later:
 *
 *     .venv/bin/python etl/run_game.py 0022500610
 *     cp etl/out/game_0022500610.json \
 *        etl/tests/fixtures/etl_output_0022500610.json
 *
 * This is a SEPARATE describe from the contract assertions on purpose. When live output
 * is absent (a clone, or CI) only the COMPARISON no-ops; every contract assertion above
 * still runs against the frozen copy. Note "no-ops", not "skips" — the test still
 * executes and reports, because a conditional skip is precisely the pattern this file
 * was fixed to remove.
 */
const hasLiveGameOutput = existsSync(LIVE_GAME_OUTPUT);

describe('the frozen ETL fixture is not stale', () => {
  // Deliberately NOT `it.runIf`: that registers a SKIPPED test on a clone, and this
  // suite holds itself to zero skips — a test that can skip is a test that isn't really
  // committed. Instead this always runs and no-ops explicitly when there is nothing to
  // compare against.
  it('matches freshly generated live output when live output exists', () => {
    if (!hasLiveGameOutput) {
      // Nothing to compare on a clone. The contract assertions above already ran
      // against the frozen copy, which is the coverage that matters here.
      expect(existsSync(TRACKED_OUTPUT), 'the frozen fixture must be tracked').toBe(true);
      return;
    }

    const live = JSON.parse(readFileSync(LIVE_GAME_OUTPUT, 'utf8'));
    const frozen = JSON.parse(readFileSync(TRACKED_OUTPUT, 'utf8'));

    // Compare the payload the contract tests actually read. `verification` and
    // `warnings` are run diagnostics rather than contract data, so they are excluded —
    // they can legitimately differ (e.g. added checks) without the DATA being stale.
    const shape = (p: Record<string, unknown>) => ({
      gameId: p.gameId,
      teamId: p.teamId,
      shotEvents: p.shotEvents,
      assistEdges: p.assistEdges,
      lineupIntervals: p.lineupIntervals,
      players: p.players,
      assistedSplit: p.assistedSplit,
      starters: p.starters,
    });

    expect(
      shape(frozen),
      'frozen fixture differs from live ETL output — regenerate it (see the comment '
        + 'above this test) so the clone/CI branch asserts current behaviour',
    ).toEqual(shape(live));
  });

  it('records whether the comparison ran, so a skip is never invisible', () => {
    // Always runs. Documents in the suite output which mode this file is in, so
    // "the guard did not compare anything" can never look like "the guard passed".
    expect(typeof hasLiveGameOutput).toBe('boolean');
    if (!hasLiveGameOutput) {
      console.info(
        'staleness comparison skipped: no etl/out/game_0022500610.json (expected on a '
          + 'fresh clone). Contract assertions still ran against the frozen fixture.',
      );
    }
  });
});
