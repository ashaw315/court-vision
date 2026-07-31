import { describe, expect, it } from 'vitest';

import type { GrainResponse, ShotEvent } from '@/lib/contracts';
import { buildSpatialReading, selectConnection } from '@/lib/court/connection';
import { isInsideCrop, shotToCourt, tallyShots } from '@/lib/court/geometry';

/**
 * One shot set for the court plate.
 *
 * The plate had three different answers to "which shots?": the marks plotted only shots
 * inside the 40 ft crop, while the caption's basket count, the rim/mid/three tally and the
 * §F reading all counted EVERY shot including the cropped ones. Nothing disagreed in
 * production only because no assisted make in the season falls beyond 40 ft — a latent
 * "shows 7, says 8" bug waiting for one long make.
 *
 * These tests use a synthetic beyond-crop make to force the condition the real data has
 * not yet produced.
 */

const shot = (over: Partial<ShotEvent> = {}): ShotEvent => ({
  gameId: 'g', eventId: Math.random(), period: 1, clock: 'PT11M00.00S', shooterId: 2,
  locX: 0, locY: 40, shotValue: 2, made: true, assisted: true, assisterId: 1,
  shotDistance: 4, actionType: 'Made Shot', subType: 'Layup', teamId: 1,
  intervalId: null, ...over,
});

/** Two normal makes plus one make from well beyond the 40 ft crop. */
function scopeWithFarMake(): GrainResponse {
  const shots = [
    shot(),
    shot({ locX: 220, locY: 240, shotValue: 3, shotDistance: 25 }),
    // ~60 ft out: real, made, and impossible to plot honestly.
    shot({ locX: 40, locY: 600, shotValue: 3, shotDistance: 60 }),
  ];
  return {
    scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
    players: [
      { personId: 1, displayName: 'Creator' },
      { personId: 2, displayName: 'Scorer' },
    ],
    edges: [{ assisterId: 1, shooterId: 2, count: 3, made2: 1, made3: 2, points: 8 }],
    shots,
    split: { madeBaskets: 3, assisted: 3, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
    meta: { shotCount: 3, edgeCount: 1, minutes: 100, games: 72 },
  };
}

const plottable = (shots: ShotEvent[]) =>
  shots.filter((s) => isInsideCrop(shotToCourt(s.locX, s.locY)));

describe('the fixture really does exercise the crop', () => {
  it('contains a made basket outside the plottable area', () => {
    // Without this the whole file would pass vacuously.
    const data = scopeWithFarMake();
    expect(plottable(data.shots).length).toBe(data.shots.length - 1);
  });
});

describe('counted, plotted and described are the same shots', () => {
  it('tallies only the shots that can be drawn', () => {
    const data = scopeWithFarMake();
    const connection = selectConnection(data, 1, 2)!;
    // The tally is what §E/the caption report; it must describe the marks on the court.
    expect(connection.tally.total).toBe(plottable(connection.shots).length);
    expect(connection.tally.rim + connection.tally.mid + connection.tally.three)
      .toBe(connection.tally.total);
  });

  it('does not count a cropped basket in the points total', () => {
    const data = scopeWithFarMake();
    const connection = selectConnection(data, 1, 2)!;
    // 2 + 3 = 5; the cropped three must not silently add 3 more.
    expect(connection.tally.points).toBe(5);
  });

  it('reports the same basket count in the reading as in the tally', () => {
    const data = scopeWithFarMake();
    const connection = selectConnection(data, 1, 2)!;
    const reading = buildSpatialReading(connection);
    expect(reading).toContain(`${connection.tally.total} made baskets`);
  });

  it('still exposes the cropped shots so the plate can disclose them', () => {
    // Dropping them silently would be the opposite error — the count must remain nameable.
    const data = scopeWithFarMake();
    const connection = selectConnection(data, 1, 2)!;
    expect(connection.clipped).toBe(1);
    expect(connection.shots.length).toBe(connection.tally.total);
  });

  it('leaves an all-plottable connection completely unchanged', () => {
    const data = scopeWithFarMake();
    data.shots = data.shots.slice(0, 2);
    const connection = selectConnection(data, 1, 2)!;
    expect(connection.clipped).toBe(0);
    expect(connection.tally.total).toBe(2);
    expect(connection.tally).toEqual(tallyShots(data.shots));
  });
});
