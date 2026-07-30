import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AssistEdge,
  Lineup,
  LineupInterval,
  Player,
  ShotEvent,
} from '@/lib/contracts';

/**
 * Validates the COMMITTED seed dataset against the Phase 2 contract.
 *
 * The seed script performs this same validation at runtime, but only when someone runs it
 * against a live database. This test runs in CI on every change, so a dataset that would
 * fail the seed is caught before anyone tries to load it — and unlike the seed, it needs
 * no DATABASE_URL.
 *
 * Deliberately NOT tested here: the live database connection, the insert order, or
 * anything requiring Neon. Per CLAUDE.md the test surface is data shape and derived math;
 * a test that needs a network round-trip to a hosted database is not a unit test, and
 * `npm run db:verify` covers the loaded state properly.
 */

const DATASET = path.join(process.cwd(), 'data', 'season.json');
const dataset = JSON.parse(readFileSync(DATASET, 'utf8'));

describe('committed seed dataset', () => {
  const groups: Array<[string, { safeParse: (r: unknown) => { success: boolean } }]> = [
    ['players', Player],
    ['lineups', Lineup],
    ['lineupIntervals', LineupInterval],
    ['shotEvents', ShotEvent],
    ['assistEdges', AssistEdge],
  ];

  for (const [key, schema] of groups) {
    it(`every ${key} record satisfies the contract`, () => {
      const records = dataset[key];
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const result = schema.safeParse(record);
        expect(result.success, JSON.stringify(record).slice(0, 300)).toBe(true);
      }
    });
  }

  it('carries game metadata for every game the shots reference', () => {
    // games is dataset-local rather than a Phase 2 entity, so the FK it will become is
    // checked here instead of by a contract schema.
    const gameIds = new Set(dataset.games.map((g: { gameId: string }) => g.gameId));
    const referenced = new Set(
      dataset.shotEvents.map((s: { gameId: string }) => s.gameId),
    );
    for (const gameId of referenced) {
      expect(gameIds.has(gameId), `game ${gameId} missing from games`).toBe(true);
    }
  });

  it('references only players present in the roster', () => {
    // Mirrors the seed's pre-insert check, including the array columns Postgres cannot
    // constrain with a foreign key.
    const known = new Set(dataset.players.map((p: { personId: number }) => p.personId));
    for (const shot of dataset.shotEvents) {
      expect(known.has(shot.shooterId)).toBe(true);
      if (shot.assisterId !== null) expect(known.has(shot.assisterId)).toBe(true);
    }
    for (const lineup of dataset.lineups) {
      for (const id of lineup.personIds) expect(known.has(id)).toBe(true);
    }
    for (const interval of dataset.lineupIntervals) {
      for (const id of interval.onCourt) expect(known.has(id)).toBe(true);
    }
  });

  it('has a unique (gameId, eventId) for every shot — the composite primary key', () => {
    const keys = dataset.shotEvents.map(
      (s: { gameId: string; eventId: number }) => `${s.gameId}:${s.eventId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has one row per ordered pair in assistEdges — the composite primary key', () => {
    const keys = dataset.assistEdges.map(
      (e: { assisterId: number; shooterId: number }) => `${e.assisterId}:${e.shooterId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the honesty nulls as real nulls, never sentinels', () => {
    // A -1/0 assisterId would mean "person -1 assisted", a fabricated claim. The contract
    // rejects it (personId must be positive), and this asserts the committed data relies
    // on that rather than smuggling a placeholder through.
    const nullAssisters = dataset.shotEvents.filter(
      (s: { assisterId: number | null }) => s.assisterId === null,
    );
    expect(nullAssisters.length).toBeGreaterThan(0);
    for (const shot of dataset.shotEvents) {
      if (shot.assisterId !== null) expect(shot.assisterId).toBeGreaterThan(0);
      if (shot.intervalId !== null) expect(typeof shot.intervalId).toBe('string');
    }
  });

  it('points every non-null intervalId at an interval that exists', () => {
    const intervalIds = new Set(
      dataset.lineupIntervals.map((i: { intervalId: string }) => i.intervalId),
    );
    for (const shot of dataset.shotEvents) {
      if (shot.intervalId !== null) {
        expect(intervalIds.has(shot.intervalId)).toBe(true);
      }
    }
  });
});
