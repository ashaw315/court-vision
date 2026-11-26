import { describe, expect, it } from 'vitest';

import { ShotValueModel, summarize } from '@/lib/model/expected-points';

const rim = (made: boolean) => ({ locX: 0, locY: 10, shotValue: 2, made });
const corner = (made: boolean) => ({ locX: 230, locY: 20, shotValue: 3, made });

function repeat<T>(n: number, f: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => f(i));
}

describe('ShotValueModel', () => {
  // 100 rim shots at 60%, 100 corner threes at 40%.
  const shots = [
    ...repeat(100, (i) => rim(i < 60)),
    ...repeat(100, (i) => corner(i < 40)),
  ];
  const model = ShotValueModel.fromShots(shots);

  it('values a spot by shot value × make rate', () => {
    expect(model.expectedPoints(rim(true))).toBeCloseTo(1.2, 1);
    expect(model.expectedPoints(corner(true))).toBeCloseTo(1.2, 1);
  });

  it('pulls a thin cell toward its band instead of trusting a tiny sample', () => {
    // One lone make in a fresh cell must not read as a 100% shot.
    const thin = ShotValueModel.fromShots([...shots, { locX: 60, locY: 10, shotValue: 2, made: true }]);
    expect(thin.makeRate(60, 10, 2)).toBeLessThan(0.7);
  });

  it('never returns NaN for an empty model', () => {
    const empty = ShotValueModel.fromShots([]);
    expect(Number.isFinite(empty.expectedPoints(rim(true)))).toBe(true);
  });

  it('summarizes points above expected', () => {
    const lucky = repeat(10, () => rim(true));
    const result = summarize(lucky, model);
    expect(result.actualPoints).toBe(20);
    expect(result.expectedPoints).toBeCloseTo(12, 0);
    expect(result.pointsAboveExpected).toBeGreaterThan(7);
  });

  it('is zero-sum over the data the model was built from', () => {
    const result = summarize(shots, model);
    expect(Math.abs(result.pointsAboveExpected)).toBeLessThan(2);
  });
});
