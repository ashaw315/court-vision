import { describe, expect, it } from 'vitest';

import type { AssistEdge } from '@/lib/contracts';
import {
  SEASON_LABEL,
  SEASON_TYPE,
  formatScope,
  methodologyFootnote,
  seasonScope,
} from '@/lib/data/scope';
import {
  COURT_SLIDE_MS,
  NETWORK_DRAW_MS,
  NETWORK_STAGGER_MS,
  SHOT_STAGGER_CAP_MS,
  arcSequence,
  networkPlayDurationMs,
  nodeSettleMs,
  playKey,
  shotBloomDelay,
} from '@/lib/motion/play';
import { buildConnections } from '@/lib/network/model';

/**
 * Motion timing and scope-line logic.
 *
 * Pure functions — no browser, no database, no timers — so what is asserted is the
 * SEQUENCE and the RULES, not pixels or frame counts. Nothing here can skip.
 */

const edge = (
  assisterId: number, shooterId: number, count: number, made3 = 0,
): AssistEdge => ({
  assisterId,
  shooterId,
  count,
  made2: count - made3,
  made3,
  points: 2 * (count - made3) + 3 * made3,
});

describe('volume-order: the structure announces itself first', () => {
  const connections = buildConnections([
    edge(1, 2, 5), edge(3, 4, 26), edge(2, 3, 15), edge(4, 1, 9),
  ]);

  it('draws the heaviest connection first and lighter ones after', () => {
    const sequence = arcSequence(connections, 0);
    const shares = sequence.map(
      (timing) =>
        connections.find(
          (c) => c.assisterId === timing.assisterId && c.shooterId === timing.shooterId,
        )!.share,
    );
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  });

  it('gives the heaviest arc the earliest delay', () => {
    const sequence = arcSequence(connections, 0);
    expect(sequence[0].assisterId).toBe(3); // the 26-count connection
    expect(sequence[0].delay).toBe(0);
    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i].delay).toBeGreaterThan(sequence[i - 1].delay);
    }
  });

  it('staggers by a fixed step so the cascade reads as one gesture', () => {
    const sequence = arcSequence(connections, 100);
    expect(sequence[0].delay).toBe(100);
    expect(sequence[1].delay - sequence[0].delay).toBe(NETWORK_STAGGER_MS);
  });

  it('is deterministic — equal shares never reorder between renders', () => {
    // A sequence that shuffles itself on re-render would read as jitter.
    const tied = buildConnections([edge(2, 1, 10), edge(1, 2, 10), edge(3, 4, 10)]);
    const first = arcSequence(tied, 0).map((t) => `${t.assisterId}-${t.shooterId}`);
    const second = arcSequence(tied, 0).map((t) => `${t.assisterId}-${t.shooterId}`);
    expect(first).toEqual(second);
  });

  it('starts arcs only after the nodes have landed', () => {
    const settle = nodeSettleMs(5);
    const sequence = arcSequence(connections, settle);
    expect(settle).toBeGreaterThan(0);
    for (const timing of sequence) expect(timing.delay).toBeGreaterThanOrEqual(settle);
  });

  it('handles a unit with no connections without producing timings', () => {
    expect(arcSequence([], 0)).toEqual([]);
  });
});

describe('the play is deliberate, not hypnotic', () => {
  it('runs long enough to read the build, short enough to settle', () => {
    // Superseded the original "within 2.5s": at that pace the volume-order build was a
    // blur, and the ordering is the one thing the animation exists to communicate. The
    // upper bound still holds it to a single deliberate gesture.
    const total = networkPlayDurationMs(5, 20);
    expect(total).toBeGreaterThan(NETWORK_DRAW_MS);
    expect(total).toBeLessThanOrEqual(3500);
  });

  it('caps the court stagger so a busy connection still blooms quickly', () => {
    const last = shotBloomDelay(25, 26);
    expect(last).toBeLessThanOrEqual(SHOT_STAGGER_CAP_MS);
  });

  it('gives a single shot no delay at all', () => {
    expect(shotBloomDelay(0, 1)).toBe(0);
  });

  it('staggers shots in order', () => {
    const delays = Array.from({ length: 8 }, (_, i) => shotBloomDelay(i, 8));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});

describe('the play triggers on actions, not on incidental re-renders', () => {
  const selection = { assisterId: 1, shooterId: 2 };

  it('keeps the same key across unrelated re-renders', () => {
    // Hover, focus, a parent state change — none of these change the key, so the play
    // does not restart. This is the difference between deliberate motion and a twitch.
    expect(playKey('-1-2-3-4-5-', selection)).toBe(playKey('-1-2-3-4-5-', selection));
    expect(playKey('-1-2-3-4-5-', { ...selection })).toBe(
      playKey('-1-2-3-4-5-', selection),
    );
  });

  it('changes the key when a different connection is selected', () => {
    expect(playKey('-1-2-3-4-5-', { assisterId: 3, shooterId: 4 })).not.toBe(
      playKey('-1-2-3-4-5-', selection),
    );
  });

  it('changes the key when the lineup changes', () => {
    // Stage 5 will switch grains; the play must re-run then.
    expect(playKey('-9-8-7-6-5-', selection)).not.toBe(playKey('-1-2-3-4-5-', selection));
  });

  it('distinguishes a selection from no selection', () => {
    expect(playKey('-1-2-3-4-5-', null)).not.toBe(playKey('-1-2-3-4-5-', selection));
  });

  it('treats the reverse connection as a different play', () => {
    expect(playKey('x', { assisterId: 2, shooterId: 1 })).not.toBe(
      playKey('x', { assisterId: 1, shooterId: 2 }),
    );
  });
});

describe('scope line — every figure is a season total, and says so', () => {
  it('reads the game count from data rather than hardcoding it', () => {
    // The count is what can drift if the dataset is regenerated; it must come from the
    // data. A literal here would silently go stale.
    expect(seasonScope(72).games).toBe(72);
    expect(seasonScope(64).games).toBe(64);
  });

  it('formats the scope so the numbers are unambiguous', () => {
    expect(formatScope(seasonScope(72))).toBe('2025-26 Regular Season · 72 games');
  });

  it('uses the season this dataset actually covers', () => {
    expect(SEASON_LABEL).toBe('2025-26');
    expect(SEASON_TYPE).toBe('Regular Season');
  });

  it('handles a single game and an empty dataset grammatically', () => {
    expect(formatScope(seasonScope(1))).toContain('1 game');
    expect(formatScope(seasonScope(1))).not.toContain('1 games');
    expect(formatScope(seasonScope(0))).toContain('0 games');
  });

  it('does NOT use a scope\'s own game count as the season scope', () => {
    // The top lineup appears in 18 games; its totals cover the 72-game validated season.
    // Conflating the two would understate what the numbers are summed over — a new
    // honesty bug in the fix meant to remove one.
    const seasonGames = 72;
    const lineupAppearances = 18;
    expect(seasonScope(seasonGames).games).toBe(seasonGames);
    expect(seasonScope(seasonGames).games).not.toBe(lineupAppearances);
  });
});

describe('the draw-in is slow enough to perceive the volume order', () => {
  it('takes 2.5–3.5s for a realistic network', () => {
    // The whole point of the ordered build is that a viewer SEES heaviest-first. At the
    // original 900ms pace the sequence blurred and the ordering was imperceptible.
    const total = networkPlayDurationMs(5, 20);
    expect(total).toBeGreaterThanOrEqual(2500);
    expect(total).toBeLessThanOrEqual(3500);
  });

  it('gives each individual arc a visible draw, not a flicker', () => {
    expect(NETWORK_DRAW_MS).toBeGreaterThanOrEqual(1200);
  });

  it('keeps the stagger, so arcs still arrive one after another', () => {
    const sequence = arcSequence(
      buildConnections([edge(1, 2, 30), edge(2, 3, 20), edge(3, 4, 10)]),
      0,
    );
    expect(sequence[1].delay - sequence[0].delay).toBe(NETWORK_STAGGER_MS);
    expect(NETWORK_STAGGER_MS).toBeGreaterThan(0);
  });

  it('slides the court quickly — it is a panel, not a reveal', () => {
    expect(COURT_SLIDE_MS).toBeGreaterThan(0);
    expect(COURT_SLIDE_MS).toBeLessThanOrEqual(500);
  });
});

describe('the methodology footnote', () => {
  it('states the real validated / scheduled / excluded counts', () => {
    const note = methodologyFootnote(seasonScope(72, 82, 10))!;
    expect(note).toContain('72 of 82');
    expect(note).toContain('10 games');
    expect(note).toMatch(/substitution timestamps/i);
    expect(note).toMatch(/methodology/i);
  });

  it('derives the counts rather than hardcoding them', () => {
    // Regenerating the dataset must change the sentence, not leave a stale literal.
    const note = methodologyFootnote(seasonScope(60, 82, 22))!;
    expect(note).toContain('60 of 82');
    expect(note).toContain('22 games');
    expect(note).not.toContain('72');
  });

  it('says nothing when no games were excluded', () => {
    // A footnote explaining a gap that does not exist is noise.
    expect(methodologyFootnote(seasonScope(82, 82, 0))).toBeNull();
  });

  it('reads grammatically for a single excluded game', () => {
    const note = methodologyFootnote(seasonScope(81, 82, 1))!;
    expect(note).toContain('1 game ');
    expect(note).not.toContain('1 games');
  });

  it('defaults to no exclusion when only a validated count is known', () => {
    expect(seasonScope(72).excludedGames).toBe(0);
    expect(methodologyFootnote(seasonScope(72))).toBeNull();
  });
});
