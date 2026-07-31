import { describe, expect, it } from 'vitest';

import type { GrainResponse, ShotEvent } from '@/lib/contracts';
import {
  biggestConnection,
  buildSpatialReading,
  selectConnection,
} from '@/lib/court/connection';
import {
  COURT,
  HOOP,
  RIM_RADIUS_FEET,
  UNITS_PER_FOOT,
  UNITS_PER_TENTH_FOOT,
  classifyShot,
  cornerLineEnd,
  isInsideCrop,
  shotSide,
  shotToCourt,
  tallyShots,
  threePointArcPath,
} from '@/lib/court/geometry';

/**
 * Tests for the court plate's real logic: the coordinate transform, shot classification,
 * the tally, and the spatial reading.
 *
 * The transform is the highest-value test here. Getting it wrong is SILENT — treating
 * tenths of a foot as feet still draws a plausible-looking picture, just of the wrong
 * places. So the known landmarks are pinned explicitly.
 *
 * No SVG-pixel assertions (visual review), no database, no network — nothing to skip.
 */

const shot = (over: Partial<ShotEvent>): ShotEvent => ({
  gameId: 'g', eventId: 1, period: 1, clock: 'PT11M00.00S', shooterId: 1,
  locX: 0, locY: 0, shotValue: 2, made: true, assisted: true, assisterId: 2,
  shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot', teamId: 1,
  intervalId: null, ...over,
});

describe('the NBA → SVG coordinate transform', () => {
  it('scales tenths of a foot, not feet — the silent-failure case', () => {
    // 19 SVG units per foot means 1.9 per tenth. Using 0.19 would put a 25-foot three
    // about two feet from the rim and still render something that looks like a shot
    // chart, which is exactly why this is asserted directly.
    expect(UNITS_PER_FOOT).toBe(19);
    expect(UNITS_PER_TENTH_FOOT).toBeCloseTo(1.9, 10);
  });

  it('puts a shot at the origin exactly on the hoop', () => {
    expect(shotToCourt(0, 0)).toEqual({ x: HOOP.x, y: HOOP.y });
  });

  it('lands a left-corner three behind the corner line', () => {
    // The spike's real left-corner three. "Behind the arc" in the corner means further
    // out than the corner line at x = 87.
    const point = shotToCourt(-229, 1);
    expect(point.x).toBeLessThan(COURT.cornerLineLeftX);
    // And still on the floor, not off the side.
    expect(point.x).toBeGreaterThan(COURT.sidelineLeftX);
    // Corners sit close to the baseline.
    expect(point.y).toBeLessThan(COURT.backboard.y + 60);
  });

  it('mirrors a right-corner three to the other side', () => {
    const left = shotToCourt(-229, 1);
    const right = shotToCourt(229, 1);
    expect(right.x).toBeGreaterThan(COURT.cornerLineRightX);
    expect(right.x - HOOP.x).toBeCloseTo(HOOP.x - left.x, 6);
  });

  it('keeps a rim shot inside the restricted area', () => {
    const point = shotToCourt(8, 12); // ~1.4 ft from the hoop
    expect(Math.hypot(point.x - HOOP.x, point.y - HOOP.y))
      .toBeLessThan(RIM_RADIUS_FEET * UNITS_PER_FOOT);
  });

  it('sends shots further from the basket further DOWN the plate', () => {
    // SVG y grows downward and the hoop sits near the top of this crop.
    expect(shotToCourt(0, 250).y).toBeGreaterThan(shotToCourt(0, 50).y);
  });

  it('places a top-of-the-key three beyond the arc but inside the crop', () => {
    const point = shotToCourt(0, 250); // 25 ft straight on
    const distance = Math.hypot(point.x - HOOP.x, point.y - HOOP.y) / UNITS_PER_FOOT;
    expect(distance).toBeGreaterThan(COURT.arcRadiusFeet);
    expect(isInsideCrop(point)).toBe(true);
  });

  it('reports a shot beyond the 40 ft crop as outside', () => {
    expect(isInsideCrop(shotToCourt(0, 420))).toBe(false);
  });

  it('agrees with the source shotDistance to within rounding', () => {
    // Cross-check the scale against a field the source computes independently.
    for (const [locX, locY, reported] of [[-116, 225, 25], [138, 157, 21], [39, 269, 27]]) {
      expect(Math.hypot(locX, locY) / 10).toBeCloseTo(reported, 0);
    }
  });
});

describe('court furniture matches real NBA dimensions', () => {
  it('draws a 50 ft court and a 16 ft key', () => {
    expect((COURT.sidelineRightX - COURT.sidelineLeftX) / UNITS_PER_FOOT).toBeCloseTo(50, 6);
    expect(COURT.key.width / UNITS_PER_FOOT).toBeCloseTo(16, 6);
    expect(COURT.key.height / UNITS_PER_FOOT).toBeCloseTo(19, 6);
  });

  it('puts the hoop 5.25 ft from the baseline', () => {
    expect((HOOP.y - COURT.baselineY) / UNITS_PER_FOOT).toBeCloseTo(5.25, 2);
  });

  it('crops the half court at 40 ft', () => {
    expect((COURT.cropY - COURT.baselineY) / UNITS_PER_FOOT).toBeCloseTo(40, 6);
  });

  it('generates an arc at 23.75 ft from the hoop', () => {
    const path = threePointArcPath();
    const points = path
      .split(/[ML]/)
      .filter(Boolean)
      .map((pair) => pair.trim().split(',').map(Number));
    expect(points.length).toBeGreaterThan(50);
    for (const [x, y] of points) {
      const feet = Math.hypot(x - HOOP.x, y - HOOP.y) / UNITS_PER_FOOT;
      expect(feet).toBeCloseTo(COURT.arcRadiusFeet, 1);
    }
  });

  it('meets the corner lines where the arc ends', () => {
    // The straight corner segments must join the arc, not float short of it.
    const endY = cornerLineEnd();
    const distance = Math.hypot(COURT.cornerLineLeftX - HOOP.x, endY - HOOP.y) / UNITS_PER_FOOT;
    expect(distance).toBeCloseTo(COURT.arcRadiusFeet, 1);
  });
});

describe('shot classification uses shotValue, not distance', () => {
  it('trusts the data for two versus three', () => {
    // A 22 ft corner shot IS a three, and a 22 ft shot elsewhere is not. Re-deriving from
    // distance would disagree with the source on exactly these shots.
    expect(classifyShot({ shotValue: 3, locX: -220, locY: 10 })).toBe('three');
    expect(classifyShot({ shotValue: 2, locX: -220, locY: 10 })).toBe('mid');
  });

  it('splits twos into rim and mid at the restricted-area radius', () => {
    expect(classifyShot({ shotValue: 2, locX: 0, locY: 20 })).toBe('rim'); // 2 ft
    expect(classifyShot({ shotValue: 2, locX: 0, locY: 150 })).toBe('mid'); // 15 ft
  });
});

describe('the tally is computed from real shots', () => {
  it('counts each bucket and sums points from shotValue', () => {
    const tally = tallyShots([
      shot({ shotValue: 2, locX: 0, locY: 10 }),
      shot({ shotValue: 2, locX: 0, locY: 20 }),
      shot({ shotValue: 2, locX: 0, locY: 160 }),
      shot({ shotValue: 3, locX: -229, locY: 1 }),
    ]);
    expect(tally).toEqual({ rim: 2, mid: 1, three: 1, points: 9, total: 4 });
  });

  it('returns zeroes rather than throwing on an empty connection', () => {
    expect(tallyShots([])).toEqual({ rim: 0, mid: 0, three: 0, points: 0, total: 0 });
  });
});

describe('shot side', () => {
  it('maps locX sign to the shooter\'s left and right', () => {
    expect(shotSide(-220)).toBe('left');
    expect(shotSide(220)).toBe('right');
    expect(shotSide(0)).toBe('middle');
  });
});

describe('selecting one connection', () => {
  const data: GrainResponse = {
    scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
    players: [
      { personId: 1, displayName: 'Creator' },
      { personId: 2, displayName: 'Scorer' },
      { personId: 3, displayName: 'Other' },
    ],
    edges: [
      { assisterId: 1, shooterId: 2, count: 3, points: 7, made2: 2, made3: 1 },
      { assisterId: 3, shooterId: 2, count: 1, points: 2, made2: 1, made3: 0 },
    ],
    shots: [
      shot({ shooterId: 2, assisterId: 1, shotValue: 2, locX: 0, locY: 15 }),
      shot({ shooterId: 2, assisterId: 1, shotValue: 2, locX: 0, locY: 150 }),
      shot({ shooterId: 2, assisterId: 1, shotValue: 3, locX: -229, locY: 1 }),
      // Same shooter, different creator — must not leak in.
      shot({ shooterId: 2, assisterId: 3, shotValue: 2, locX: 0, locY: 20 }),
      // Unassisted make by the same shooter — must not leak in.
      shot({ shooterId: 2, assisted: false, assisterId: null, shotValue: 2 }),
      // A miss — the plate shows made baskets only.
      shot({ shooterId: 2, made: false, assisted: false, assisterId: null }),
    ],
    split: { madeBaskets: 5, assisted: 4, selfCreated: 1, unresolvedAssisted: 0, assistedPct: 0.8 },
    meta: { shotCount: 6, edgeCount: 2, minutes: 100, games: 1 },
  };

  it('returns only that pair\'s made, assisted baskets', () => {
    const connection = selectConnection(data, 1, 2)!;
    expect(connection.shots).toHaveLength(3);
    for (const s of connection.shots) {
      expect(s.made).toBe(true);
      expect(s.assisterId).toBe(1);
      expect(s.shooterId).toBe(2);
    }
  });

  it('matches the count the network edge reports for the same pair', () => {
    // The two plates must agree — if they disagree, one of them is filtering wrongly.
    const connection = selectConnection(data, 1, 2)!;
    const edge = data.edges.find((e) => e.assisterId === 1 && e.shooterId === 2)!;
    expect(connection.shots.length).toBe(edge.count);
    expect(connection.tally.points).toBe(edge.points);
  });

  it('computes the share of the unit\'s assisted creation', () => {
    expect(selectConnection(data, 1, 2)!.share).toBeCloseTo((3 / 4) * 100, 6);
  });

  it('picks the biggest connection by count', () => {
    const connection = biggestConnection(data)!;
    expect(connection.assisterId).toBe(1);
    expect(connection.shooterId).toBe(2);
  });

  it('returns null for a player who is not in the unit', () => {
    expect(selectConnection(data, 1, 99)).toBeNull();
  });
});

describe('the §F / READING is computed, not hardcoded', () => {
  const base = {
    assisterId: 1, shooterId: 2, assisterName: 'Creator', shooterName: 'Scorer', share: 14.1,
  };

  const reading = (shots: ShotEvent[]) =>
    buildSpatialReading({ ...base, shots, tally: tallyShots(shots) });

  it('calls a rim-heavy connection a rim connection', () => {
    const text = reading([
      shot({ shotValue: 2, locX: 0, locY: 10 }),
      shot({ shotValue: 2, locX: 0, locY: 20 }),
      shot({ shotValue: 2, locX: 5, locY: 15 }),
    ]);
    expect(text).toMatch(/rim connection/i);
  });

  it('calls a three-heavy connection a perimeter connection', () => {
    const text = reading([
      shot({ shotValue: 3, locX: -229, locY: 1 }),
      shot({ shotValue: 3, locX: -200, locY: 100 }),
      shot({ shotValue: 3, locX: 0, locY: 250 }),
    ]);
    expect(text).toMatch(/perimeter connection/i);
    expect(text).not.toMatch(/rim connection/i);
  });

  it('names the side the threes come from', () => {
    const text = reading([
      shot({ shotValue: 3, locX: -229, locY: 1 }),
      shot({ shotValue: 3, locX: -210, locY: 60 }),
      shot({ shotValue: 2, locX: 0, locY: 10 }),
    ]);
    expect(text).toMatch(/left side/i);
  });

  it('says plainly when a connection produces no threes', () => {
    const text = reading([shot({ shotValue: 2, locX: 0, locY: 10 })]);
    expect(text).toMatch(/no threes/i);
  });

  it('reports the real point total and share', () => {
    const text = reading([
      shot({ shotValue: 3, locX: -229, locY: 1 }),
      shot({ shotValue: 2, locX: 0, locY: 10 }),
    ]);
    expect(text).toContain('5 points');
    expect(text).toContain('14.1%');
  });

  it('describes an empty connection without inventing one', () => {
    expect(reading([])).toMatch(/no made baskets/i);
  });

  it('produces different prose for different connections', () => {
    const rim = reading([shot({ shotValue: 2, locX: 0, locY: 10 })]);
    const perimeter = reading([shot({ shotValue: 3, locX: 0, locY: 250 })]);
    expect(rim).not.toBe(perimeter);
  });
});
