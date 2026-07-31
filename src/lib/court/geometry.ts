import type { ShotEvent } from '@/lib/contracts';

/**
 * Half-court geometry and the NBA → SVG coordinate transform.
 *
 * Every constant is derived from the FIG. 12c plate in `design/creation-network.html`, and
 * that plate turns out to be dimensionally exact: its sidelines span 950 units for a 50 ft
 * court (19 units per foot), its key is 16 ft wide and 19 ft deep, its rim sits 5.25 ft
 * from the baseline with a 0.75 ft radius, and its arc is 23.75 ft from the hoop. So these
 * are real court dimensions rendered at the design's scale, not approximations of a
 * drawing.
 */

/** The design's viewBox. */
export const COURT_VIEW = { width: 1010, height: 830 } as const;

/** SVG units per foot, from the design's own sidelines (980 − 30 = 950 over 50 ft). */
export const UNITS_PER_FOOT = 19;

/**
 * `locX`/`locY` are TENTHS of a foot, so one unit of raw data is 1.9 SVG units.
 *
 * Getting this wrong is silent and plausible-looking — treating tenths as feet puts a
 * 25-foot three about two feet from the rim, which still renders a pretty picture of
 * entirely wrong data. Hence the explicit name and the tests.
 */
export const UNITS_PER_TENTH_FOOT = UNITS_PER_FOOT / 10;

/**
 * The hoop in SVG space — the origin of the NBA coordinate system.
 * From the design: `<circle cx="505" cy="129.8" r="14">`, i.e. 5.25 ft off the baseline.
 */
export const HOOP = { x: 505, y: 129.8 } as const;

/** Court furniture, all taken from the design's drawn paths. */
export const COURT = {
  baselineY: 30,
  sidelineLeftX: 30,
  sidelineRightX: 980,
  /** Dashed crop edge — the design shows the half court cropped at 40 ft. */
  cropY: 790,
  key: { x: 353, y: 30, width: 304, height: 361 },
  freeThrowCircle: { cx: 505, cy: 391, r: 114 },
  backboard: { x1: 448, x2: 562, y: 106 },
  rimRadius: 14,
  /** Corner-three lines: 3 ft in from each sideline, running out to the arc. */
  cornerLineLeftX: 87,
  cornerLineRightX: 923,
  cornerLineEndY: 296,
  /** Three-point arc radius, 23.75 ft from the hoop. */
  arcRadiusFeet: 23.75,
  cornerDistanceFeet: 22,
} as const;

export type CourtPoint = { x: number; y: number };

/**
 * Transform a shot's raw NBA coordinates into court SVG space.
 *
 * NBA space: origin at the basket, x roughly −250..250 (left/right), y roughly −50..470
 * (away from the hoop), both in tenths of a foot. SVG y grows downward and the hoop sits
 * near the top of this plate, so y ADDS — a shot further from the basket is further down
 * the plate.
 */
export function shotToCourt(locX: number, locY: number): CourtPoint {
  return {
    x: HOOP.x + locX * UNITS_PER_TENTH_FOOT,
    y: HOOP.y + locY * UNITS_PER_TENTH_FOOT,
  };
}

/** True when a shot falls inside the drawn (cropped) half court. */
export function isInsideCrop(point: CourtPoint): boolean {
  return (
    point.x >= COURT.sidelineLeftX
    && point.x <= COURT.sidelineRightX
    && point.y >= COURT.baselineY
    && point.y <= COURT.cropY
  );
}

/**
 * The three-point arc path, generated rather than copied.
 *
 * The real arc is a 23.75 ft circle around the hoop, truncated where it meets the corner
 * lines 22 ft to each side. Sweeping it explicitly keeps the geometry honest and matches
 * the design's own polyline.
 */
export function threePointArcPath(): string {
  const radius = COURT.arcRadiusFeet * UNITS_PER_FOOT;
  const halfWidth = (COURT.sidelineRightX - COURT.sidelineLeftX) / 2;
  const cornerOffset = halfWidth - (COURT.cornerLineLeftX - COURT.sidelineLeftX);

  // Angle at which the arc reaches the corner line, measured from the hoop.
  const cutoff = Math.asin(cornerOffset / radius);
  const steps = 96;
  const points: string[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const angle = -cutoff + (2 * cutoff * i) / steps;
    // angle 0 points straight out from the hoop, down the plate.
    const x = HOOP.x + radius * Math.sin(angle);
    const y = HOOP.y + radius * Math.cos(angle);
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/** Where the arc meets each corner line — so the straight segments join it exactly. */
export function cornerLineEnd(): number {
  const radius = COURT.arcRadiusFeet * UNITS_PER_FOOT;
  const halfWidth = (COURT.sidelineRightX - COURT.sidelineLeftX) / 2;
  const cornerOffset = halfWidth - (COURT.cornerLineLeftX - COURT.sidelineLeftX);
  const cutoff = Math.asin(cornerOffset / radius);
  return HOOP.y + radius * Math.cos(cutoff);
}

export type ShotZone = 'rim' | 'mid' | 'three';

/**
 * Classify a made basket into the tally's three buckets.
 *
 * `shotValue` decides two versus three — it comes from the source and is authoritative.
 * Re-deriving it from distance would be a guess that disagrees with the data at the
 * corners, where a 22 ft shot is a three but a 22 ft shot elsewhere is not.
 *
 * Only the twos are split further, by distance from the hoop: "at rim" is the standard
 * 4 ft restricted-area radius.
 */
export const RIM_RADIUS_FEET = 4;

export function classifyShot(shot: Pick<ShotEvent, 'shotValue' | 'locX' | 'locY'>): ShotZone {
  if (shot.shotValue === 3) return 'three';
  const feet = Math.hypot(shot.locX, shot.locY) / 10;
  return feet <= RIM_RADIUS_FEET ? 'rim' : 'mid';
}

export type ShotTally = {
  rim: number;
  mid: number;
  three: number;
  points: number;
  total: number;
};

/** The §-footer tally — computed from real shots, never hardcoded. */
export function tallyShots(shots: ShotEvent[]): ShotTally {
  const tally: ShotTally = { rim: 0, mid: 0, three: 0, points: 0, total: shots.length };
  for (const shot of shots) {
    tally[classifyShot(shot)] += 1;
    tally.points += shot.shotValue;
  }
  return tally;
}

/** Horizontal thirds, for describing where a connection lives. */
export type CourtSide = 'left' | 'middle' | 'right';

/**
 * Which side of the floor a shot came from.
 *
 * From the SHOOTER's perspective looking at the basket: NBA `locX` is negative to the
 * shooter's left, so the sign maps directly. The middle band is the width of the key,
 * so "left" and "right" mean genuinely off to a side rather than marginally off-centre.
 */
export function shotSide(locX: number): CourtSide {
  const feet = locX / 10;
  if (feet < -8) return 'left';
  if (feet > 8) return 'right';
  return 'middle';
}
