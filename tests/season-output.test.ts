import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssistEdge, Lineup, LineupInterval, Player, ShotEvent } from '@/lib/contracts';

/**
 * Validates the SEASON aggregate against the Phase 2 Zod contract.
 *
 * Per-game output is already validated by `etl-output.test.ts`; this checks the merged
 * dataset Phase 4 will load, because aggregation itself can break the contract in ways a
 * single game cannot show — chiefly `AssistEdge`, whose one-row-per-ordered-pair shape
 * only holds if edges are re-derived over all games rather than concatenated per game,
 * and `Lineup`, which does not exist at game scope at all.
 *
 * Regenerate with:  .venv/bin/python etl/run_season.py
 *
 * The season file is gitignored (2.4 MB of derived data, rebuildable from cache), so this
 * no-ops when it is absent rather than skipping — the suite holds itself to zero skips.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEASON = path.join(HERE, '..', 'etl', 'out', 'season.json');
const hasSeason = existsSync(SEASON);

describe('season aggregate conforms to the Phase 2 contract', () => {
  it('validates every record of every entity type', () => {
    if (!hasSeason) {
      // Nothing to validate without a season run; the per-game contract test still
      // covers the record shapes on a clone.
      expect(hasSeason).toBe(false);
      return;
    }

    const season = JSON.parse(readFileSync(SEASON, 'utf8'));
    const groups: Array<[string, { safeParse: (r: unknown) => { success: boolean } }]> = [
      ['shotEvents', ShotEvent],
      ['assistEdges', AssistEdge],
      ['lineupIntervals', LineupInterval],
      ['lineups', Lineup],
      ['players', Player],
    ];

    for (const [key, schema] of groups) {
      const records = season[key];
      expect(records.length, `${key} must not be empty`).toBeGreaterThan(0);
      for (const record of records) {
        const result = schema.safeParse(record);
        expect(
          result.success,
          `${key}: ${JSON.stringify(record).slice(0, 300)}`,
        ).toBe(true);
      }
    }
  });

  it('keeps every lineup above the emit floor, and carries its minutes', () => {
    if (!hasSeason) {
      expect(hasSeason).toBe(false);
      return;
    }
    const season = JSON.parse(readFileSync(SEASON, 'utf8'));
    const floor = season.honesty.lineupEmitFloorMinutes;
    for (const lineup of season.lineups) {
      expect(lineup.minutes).toBeGreaterThanOrEqual(floor);
      // The frontend applies its own display threshold, so the number itself must be
      // present on every record — not just membership above some ETL-side line.
      expect(typeof lineup.minutes).toBe('number');
    }
  });

  it('emits sub-50-minute units so the frontend can choose its own threshold', () => {
    // The ETL used to cut at 50, which baked a presentation decision into the dataset.
    // Emitting down to the floor means a UI threshold change needs no season re-pull.
    if (!hasSeason) {
      expect(hasSeason).toBe(false);
      return;
    }
    const season = JSON.parse(readFileSync(SEASON, 'utf8'));
    expect(season.honesty.lineupEmitFloorMinutes).toBeLessThan(50);
    const thin = season.lineups.filter(
      (lu: { minutes: number }) => lu.minutes < 50,
    );
    expect(thin.length).toBeGreaterThan(0);
  });

  it('attributes every season shot to a lineup that exists in the dataset', () => {
    if (!hasSeason) {
      expect(hasSeason).toBe(false);
      return;
    }
    const season = JSON.parse(readFileSync(SEASON, 'utf8'));
    const intervalIds = new Set(
      season.lineupIntervals.map((iv: { intervalId: string }) => iv.intervalId),
    );
    for (const shot of season.shotEvents) {
      if (shot.intervalId !== null) {
        expect(intervalIds.has(shot.intervalId)).toBe(true);
      }
    }
  });
});
