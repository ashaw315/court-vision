import { describe, expect, it } from 'vitest';

import { rolling } from '@/components/analysis/Charts';

/**
 * The game-by-game chart plots a team line and an opponent line on the same game axis.
 * A game without defensive data must stay a gap at its own position — not be dropped, which
 * would slide every later opponent point onto the wrong game.
 */
describe('rolling', () => {
  it('averages over the trailing window', () => {
    expect(rolling([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it('keeps a missing game as a gap at its own index', () => {
    const out = rolling([2, null, 4, 6], 2);
    expect(out).toHaveLength(4);
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(4); // window [null, 4]: only the known value counts
    expect(out[3]).toBe(5);
  });

  it('is all gaps when nothing is known', () => {
    expect(rolling([null, null], 3)).toEqual([null, null]);
  });
});
