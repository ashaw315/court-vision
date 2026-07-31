import type { Connection } from '@/lib/network/model';

/**
 * The "play" — motion timing for the two animated moments.
 *
 * Pure scheduling maths, no React and no DOM, so the ordering and the reduced-motion
 * branch are testable directly.
 *
 * Two rules govern everything here, both from CLAUDE.md:
 *
 *   1. Motion is deliberate and tied to an action — load, lineup change, connection
 *      select. Nothing ambient, nothing looping, nothing that re-runs on an unrelated
 *      re-render.
 *   2. `prefers-reduced-motion` means NO animation at all: the final static state renders
 *      immediately. Not "a shorter animation" — none.
 */

/**
 * How long a single arc takes to draw.
 *
 * Slowed from the original 900ms: the point of the volume-order build is that a viewer
 * SEES the heaviest connection arrive first and the lighter ones cascade after it. At the
 * previous pace the whole sequence blurred into a single flicker and the ordering — the
 * one thing the animation exists to communicate — was imperceptible.
 */
export const NETWORK_DRAW_MS = 1500;
/** Gap between successive arcs starting. Total ≈ NETWORK_DRAW_MS + stagger × (n − 1). */
export const NETWORK_STAGGER_MS = 62;
/** Nodes land before the arcs that connect them. */
export const NODE_FADE_MS = 340;
export const NODE_STAGGER_MS = 45;

/** How long the court panel takes to slide in beside the network. */
export const COURT_SLIDE_MS = 320;

/** Court bloom: quicker still — the court is a detail view, not a reveal. */
export const SHOT_BLOOM_MS = 260;
export const SHOT_STAGGER_MS = 14;
/** Cap the court's total stagger so a 26-shot connection does not crawl. */
export const SHOT_STAGGER_CAP_MS = 520;

export type ArcTiming = {
  assisterId: number;
  shooterId: number;
  /** ms after the sequence starts that this arc begins drawing. */
  delay: number;
  duration: number;
};

/**
 * Order the arcs by VOLUME — heaviest connection first, lighter ones cascading in.
 *
 * The structure announces itself before the detail fills in: a reader sees the unit's
 * dominant connection before the texture around it, which is the same reading order the
 * static plate rewards.
 *
 * Ties break on the id pair so the sequence is deterministic — an animation that reorders
 * itself between renders would read as jitter.
 */
export function arcSequence(
  connections: Connection[],
  nodeSettleMs: number,
): ArcTiming[] {
  const ordered = [...connections].sort(
    (a, b) =>
      b.share - a.share
      || a.assisterId - b.assisterId
      || a.shooterId - b.shooterId,
  );

  return ordered.map((connection, index) => ({
    assisterId: connection.assisterId,
    shooterId: connection.shooterId,
    delay: nodeSettleMs + index * NETWORK_STAGGER_MS,
    duration: NETWORK_DRAW_MS,
  }));
}

/** When the nodes have finished landing, so arcs can start after them. */
export function nodeSettleMs(nodeCount: number): number {
  if (nodeCount === 0) return 0;
  return NODE_FADE_MS + (nodeCount - 1) * NODE_STAGGER_MS;
}

/** Total wall-clock for the network play, for assertions and for sequencing. */
export function networkPlayDurationMs(nodeCount: number, arcCount: number): number {
  if (arcCount === 0) return nodeSettleMs(nodeCount);
  const settle = nodeSettleMs(nodeCount);
  return settle + (arcCount - 1) * NETWORK_STAGGER_MS + NETWORK_DRAW_MS;
}

/**
 * Court bloom timing for one shot.
 *
 * Staggered by index so baskets arrive in a quick scatter rather than a single pop, with
 * the stagger compressed when a connection has many shots so the total stays snappy.
 */
export function shotBloomDelay(index: number, total: number): number {
  if (total <= 1) return 0;
  const step = Math.min(SHOT_STAGGER_MS, SHOT_STAGGER_CAP_MS / (total - 1));
  return index * step;
}

/**
 * A stable key identifying "which play should be running".
 *
 * The play restarts when — and only when — this key changes: a different lineup, or a
 * different selected connection. An unrelated re-render (hover, focus, a parent state
 * change) produces the same key and therefore no replay, which is the difference between
 * deliberate motion and something that twitches whenever React re-renders.
 */
export function playKey(
  scopeId: string | number | null,
  selection: { assisterId: number; shooterId: number } | null,
): string {
  const scope = scopeId === null ? 'team' : String(scopeId);
  const connection = selection
    ? `${selection.assisterId}-${selection.shooterId}`
    : 'none';
  return `${scope}::${connection}`;
}
