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
 * Regenerate the input with:  .venv/bin/python etl/run_fixture.py
 */

const OUTPUT = path.join(process.cwd(), 'etl', 'out', 'fixture_stage1.json');

const payload = existsSync(OUTPUT)
  ? JSON.parse(readFileSync(OUTPUT, 'utf8'))
  : null;

describe.skipIf(payload === null)('ETL output conforms to the Phase 2 contract', () => {
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
