/**
 * A shot-value model: how many points a shot from a given spot is worth on average.
 *
 * Built from every shot in a season (league-wide when the league is loaded), and nothing
 * but location and shot value: where the shot was taken and whether it counted for 2 or 3.
 * It does NOT know about defenders, shot clock, or who took it — those are tracking-data
 * dimensions we do not have — so "expected points" here means "what a typical attempt from
 * this spot returned", not "what this shot should have been worth given the defence".
 *
 * Method: the court is cut into square cells; each cell's make rate is smoothed toward the
 * make rate of its distance band (itself pulled toward the overall rate) so a rarely-used cell cannot swing to 0% or 100% on a
 * handful of attempts. Expected points = shot value × smoothed make rate.
 */

/** Cell edge in court units (tenths of a foot): 30 = three feet. */
export const CELL = 30;
/** Distance band width used as the smoothing prior, in court units. */
export const BAND = 40;
/** Pseudo-attempts of prior weight: how hard a thin cell is pulled toward its band. */
export const PRIOR_WEIGHT = 20;

export interface CellTally {
  cx: number;
  cy: number;
  shotValue: 2 | 3;
  attempts: number;
  makes: number;
}

export interface ModelShot {
  locX: number;
  locY: number;
  shotValue: number;
  made: boolean;
}

export function cellOf(locX: number, locY: number): { cx: number; cy: number } {
  return { cx: Math.floor(locX / CELL), cy: Math.floor(locY / CELL) };
}

function bandOf(locX: number, locY: number): number {
  return Math.floor(Math.hypot(locX, locY) / BAND);
}

function key(cx: number, cy: number, value: number): string {
  return `${cx}:${cy}:${value}`;
}

export class ShotValueModel {
  private readonly cells = new Map<string, CellTally>();
  private readonly bands = new Map<string, { attempts: number; makes: number }>();
  private readonly values = new Map<number, { attempts: number; makes: number }>();

  constructor(tallies: Iterable<CellTally>) {
    for (const t of tallies) {
      this.cells.set(key(t.cx, t.cy, t.shotValue), t);
      // Cell centre decides the band, so tallies aggregated in SQL need no raw shots.
      const band = bandOf((t.cx + 0.5) * CELL, (t.cy + 0.5) * CELL);
      const bandKey = `${band}:${t.shotValue}`;
      const b = this.bands.get(bandKey) ?? { attempts: 0, makes: 0 };
      b.attempts += t.attempts;
      b.makes += t.makes;
      this.bands.set(bandKey, b);
      const v = this.values.get(t.shotValue) ?? { attempts: 0, makes: 0 };
      v.attempts += t.attempts;
      v.makes += t.makes;
      this.values.set(t.shotValue, v);
    }
  }

  /** Build from raw shots (tests, small scopes). */
  static fromShots(shots: Iterable<ModelShot>): ShotValueModel {
    const tallies = new Map<string, CellTally>();
    for (const s of shots) {
      const value = s.shotValue === 3 ? 3 : 2;
      const { cx, cy } = cellOf(s.locX, s.locY);
      const k = key(cx, cy, value);
      const t = tallies.get(k) ?? { cx, cy, shotValue: value, attempts: 0, makes: 0 };
      t.attempts += 1;
      if (s.made) t.makes += 1;
      tallies.set(k, t);
    }
    return new ShotValueModel(tallies.values());
  }

  get attempts(): number {
    let n = 0;
    for (const v of this.values.values()) n += v.attempts;
    return n;
  }

  /** Smoothed make probability for a shot at this spot. */
  makeRate(locX: number, locY: number, shotValue: number): number {
    const value = shotValue === 3 ? 3 : 2;
    const { cx, cy } = cellOf(locX, locY);
    const cell = this.cells.get(key(cx, cy, value));
    const band = this.bands.get(`${bandOf(locX, locY)}:${value}`);
    const overall = this.values.get(value);
    // Hierarchical prior: shot-value-wide rate -> distance band -> cell. Each level is
    // pulled toward the one above it, so a thin band cannot hand a thin cell a wild prior.
    const overallRate = overall && overall.attempts > 0
      ? overall.makes / overall.attempts
      : value === 3 ? 0.36 : 0.5;
    const prior = band
      ? (band.makes + PRIOR_WEIGHT * overallRate) / (band.attempts + PRIOR_WEIGHT)
      : overallRate;
    if (!cell) return prior;
    return (cell.makes + PRIOR_WEIGHT * prior) / (cell.attempts + PRIOR_WEIGHT);
  }

  expectedPoints(shot: Pick<ModelShot, 'locX' | 'locY' | 'shotValue'>): number {
    const value = shot.shotValue === 3 ? 3 : 2;
    return value * this.makeRate(shot.locX, shot.locY, value);
  }
}

export interface ValueSummary {
  attempts: number;
  actualPoints: number;
  expectedPoints: number;
  /** Actual minus expected: positive means the shots beat the typical return. */
  pointsAboveExpected: number;
}

/** Score a set of shots against the model. */
export function summarize(shots: ModelShot[], model: ShotValueModel): ValueSummary {
  let actual = 0;
  let expected = 0;
  for (const s of shots) {
    if (s.made) actual += s.shotValue === 3 ? 3 : 2;
    expected += model.expectedPoints(s);
  }
  return {
    attempts: shots.length,
    actualPoints: actual,
    expectedPoints: expected,
    pointsAboveExpected: actual - expected,
  };
}
