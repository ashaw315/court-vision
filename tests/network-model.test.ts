import { describe, expect, it } from 'vitest';

import type { AssistEdge, GrainResponse, ShotEvent } from '@/lib/contracts';
import {
  ACID_THRESHOLD_PPB,
  buildConnections,
  buildOrigination,
  buildReading,
  buildRoleNodes,
  buildStrands,
  formatPct,
  formatShare,
  playerSplits,
} from '@/lib/network/model';
import { color, encoding, network } from '@/lib/design/tokens';

/**
 * Tests for the Creation Network encoding — the claims the plate makes about the data.
 *
 * Deliberately NOT tested: SVG pixel output. Per CLAUDE.md that is visual review, not
 * assertions. What is tested is every place a number becomes a visual claim: role
 * position, share, the acid threshold, node fill, and the reading annotation.
 *
 * No database and no network here — these are pure functions over a `GrainResponse`, so
 * there is nothing to skip and nothing to mock.
 */

const shot = (over: Partial<ShotEvent>): ShotEvent => ({
  gameId: 'g', eventId: 1, period: 1, clock: 'PT11M00.00S', shooterId: 1,
  locX: 0, locY: 0, shotValue: 2, made: true, assisted: false, assisterId: null,
  shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot', teamId: 1,
  intervalId: null, ...over,
});

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

const response = (over: Partial<GrainResponse> = {}): GrainResponse => ({
  scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Test unit' },
  edges: [],
  shots: [],
  players: [1, 2, 3, 4, 5].map((personId) => ({ personId, displayName: `P${personId}` })),
  split: { madeBaskets: 0, assisted: 0, selfCreated: 0, unresolvedAssisted: 0, assistedPct: null },
  meta: { shotCount: 0, edgeCount: 0, minutes: 100, games: 1 },
  ...over,
});

describe('formatting', () => {
  it('formats a whole ratio explicitly — assistedPct serialises as 1, not 1.0', () => {
    // The recurring trap: string-matching the raw value would print "1" where the plate
    // must read "100%".
    expect(formatPct(1)).toBe('100%');
    expect(formatPct(0.7510204081632653)).toBe('75%');
    expect(formatPct(0.751, 1)).toBe('75.1%');
  });

  it('renders a null split as an em dash, never as 0%', () => {
    // A player with no made baskets has no split. Printing "0%" would claim they are a
    // pure self-creator, which is a fabricated reading of missing data.
    expect(formatPct(null)).toBe('—');
  });

  it('matches the design fmt: whole numbers bare, otherwise one decimal', () => {
    expect(formatShare(31)).toBe('31%');
    expect(formatShare(2.5)).toBe('2.5%');
  });
});

describe('connection shares', () => {
  it('sums to 100% — the claim the plate header makes', () => {
    const connections = buildConnections([
      edge(1, 2, 26), edge(2, 3, 15), edge(3, 1, 9), edge(4, 5, 3),
    ]);
    const total = connections.reduce((sum, c) => sum + c.share, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('orders by share, largest first', () => {
    const shares = buildConnections([edge(1, 2, 3), edge(2, 3, 26), edge(3, 4, 9)])
      .map((c) => c.share);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  });

  it('returns an empty list rather than dividing by zero', () => {
    expect(buildConnections([])).toEqual([]);
  });
});

describe('the acid accent stays rare', () => {
  it('marks only connections at or above the threshold', () => {
    const allTwos = buildConnections([edge(1, 2, 10, 0)])[0]; // 2.00 pts/basket
    const allThrees = buildConnections([edge(1, 2, 10, 10)])[0]; // 3.00
    expect(allTwos.isHighValue).toBe(false);
    expect(allThrees.isHighValue).toBe(true);
  });

  it('uses a threshold inside the achievable range of points per MADE basket', () => {
    // The measure spans 2.00 (all twos) to 3.00 (all threes). The design's literal
    // "1.42 pts/attempt" sits below that floor, so applying it would paint EVERY
    // connection acid and destroy the encoding. Guarding the bound keeps a future edit
    // from silently reintroducing that.
    expect(ACID_THRESHOLD_PPB).toBeGreaterThan(2);
    expect(ACID_THRESHOLD_PPB).toBeLessThan(3);
  });

  it('leaves the majority of a realistic unit un-accented', () => {
    // Mirrors the real top lineup's mix: mostly 2.0–2.6, a few high.
    const edges = [
      edge(1, 2, 26, 8), edge(2, 1, 15, 9), edge(3, 1, 15, 8), edge(2, 4, 14, 10),
      edge(3, 4, 14, 11), edge(1, 3, 13, 0), edge(1, 5, 13, 9), edge(2, 5, 11, 10),
      edge(2, 3, 10, 0), edge(5, 2, 9, 8),
    ];
    const connections = buildConnections(edges);
    const green = connections.filter((c) => c.isHighValue).length;
    expect(green).toBeGreaterThan(0);
    expect(green).toBeLessThan(connections.length / 2);
  });
});

describe('role-space positioning', () => {
  /** A pure creator, a pure scorer, and three in between. */
  const roleEdges = [
    edge(1, 2, 30), edge(1, 3, 20), edge(1, 4, 10), // player 1 only originates
    edge(3, 2, 10), edge(4, 2, 10), // player 2 only receives
  ];

  it('places creators above scorers', () => {
    const nodes = buildRoleNodes(response({ edges: roleEdges }));
    const creator = nodes.find((n) => n.personId === 1)!;
    const scorer = nodes.find((n) => n.personId === 2)!;
    // SVG y grows downward, so "above" means a smaller y.
    expect(creator.y).toBeLessThan(scorer.y);
  });

  it('orders every node by role balance on the vertical axis', () => {
    const nodes = buildRoleNodes(response({ edges: roleEdges }));
    const byBalance = [...nodes].sort((a, b) => b.roleBalance - a.roleBalance);
    const ys = byBalance.map((n) => n.y);
    // Descending role balance must give ascending y, with no inversions.
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
    }
  });

  it('keeps nodes inside the ORIGINATES / RECEIVES band', () => {
    const nodes = buildRoleNodes(response({ edges: roleEdges }));
    for (const node of nodes) {
      expect(node.y).toBeGreaterThan(network.originatesY);
      expect(node.y).toBeLessThan(network.receivesY);
    }
  });

  it('gives distinct horizontal positions so bundles do not stack', () => {
    const xs = buildRoleNodes(response({ edges: roleEdges })).map((n) => n.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('does not crash on a unit with no edges at all', () => {
    const nodes = buildRoleNodes(response());
    expect(nodes).toHaveLength(5);
    for (const node of nodes) expect(node.roleBalance).toBe(0);
  });
});

describe('node fill — the assisted split', () => {
  it('computes each player\'s split from real made baskets', () => {
    const shots = [
      shot({ shooterId: 1, made: true, assisted: true, assisterId: 2 }),
      shot({ shooterId: 1, made: true, assisted: true, assisterId: 2 }),
      shot({ shooterId: 1, made: true, assisted: false }),
      shot({ shooterId: 1, made: false }), // misses excluded
    ];
    const splits = playerSplits(response({ shots }));
    expect(splits.get(1)!.assistedPct).toBeCloseTo(2 / 3, 6);
    expect(splits.get(1)!.madeBaskets).toBe(3);
  });

  it('counts a tagged-but-unresolved assist as assisted, not self-created', () => {
    // The honesty rule the whole project rests on, carried into the fill: an unresolvable
    // assister still means the basket was created, so the node must not read emptier.
    const shots = [
      shot({ shooterId: 1, made: true, assisted: true, assisterId: null }),
      shot({ shooterId: 1, made: true, assisted: false }),
    ];
    expect(playerSplits(response({ shots })).get(1)!.assistedPct).toBeCloseTo(0.5, 6);
  });

  it('gives null, not zero, for a player with no made baskets', () => {
    const splits = playerSplits(response({ shots: [shot({ shooterId: 1, made: false })] }));
    expect(splits.get(1)!.assistedPct).toBeNull();
    expect(splits.get(2)!.assistedPct).toBeNull();
  });
});

describe('strand bundles', () => {
  const nodes = buildRoleNodes(response({
    edges: [edge(1, 2, 30), edge(1, 3, 20), edge(3, 2, 10)],
  }));

  it('draws more strands for a larger share — density IS the encoding', () => {
    // Passed TOGETHER: the magnitude scale is relative to the scope's largest connection,
    // so a bundle only means something alongside the others it is being compared with.
    const connections = buildConnections([edge(1, 2, 30), edge(1, 3, 2)]);
    const { bundles } = buildStrands(connections, nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    const big = bundles.find((b) => b.shooterId === 2)!;
    const small = bundles.find((b) => b.shooterId === 3)!;
    expect(big.strands.length).toBeGreaterThan(small.strands.length);
  });

  it('labels only connections at or above the 7% threshold', () => {
    const connections = buildConnections([
      edge(1, 2, 50), // 62.5% — labelled
      edge(1, 3, 26), // 32.5% — labelled
      edge(3, 2, 4), //   5.0% — not labelled
    ]);
    const { labels } = buildStrands(connections, nodes, { warm: color.rust, acid: color.acid });
    expect(labels).toHaveLength(2);
    for (const connection of connections) {
      const labelled = labels.some((l) => l.text === formatShare(Math.round(connection.share * 10) / 10));
      expect(labelled).toBe(connection.share >= encoding.labelMinShare);
    }
  });

  it('gives exactly one arrowhead per bundle — the centre strand', () => {
    const connections = buildConnections([edge(1, 2, 30)]);
    const { strands } = buildStrands(connections, nodes, { warm: color.rust, acid: color.acid });
    expect(strands.filter((s) => s.marker !== null)).toHaveLength(1);
  });

  it('colours high-value bundles acid and ordinary ones rust', () => {
    const connections = buildConnections([edge(1, 2, 10, 10), edge(1, 3, 10, 0)]);
    const { strands } = buildStrands(connections, nodes, { warm: color.rust, acid: color.acid });
    expect(strands.some((s) => s.color === color.acid)).toBe(true);
    expect(strands.some((s) => s.color === color.rust)).toBe(true);
  });

  it('skips a connection whose endpoints are missing rather than throwing', () => {
    const connections = buildConnections([edge(98, 99, 10)]);
    expect(buildStrands(connections, nodes, { warm: color.rust, acid: color.acid }).strands)
      .toEqual([]);
  });
});

describe('origination bars', () => {
  it('orders by share originated and sums to 100%', () => {
    const nodes = buildRoleNodes(response({
      edges: [edge(1, 2, 30), edge(3, 2, 10), edge(4, 5, 10)],
    }));
    const bars = buildOrigination(nodes);
    expect(bars[0].name).toBe('P1');
    const total = bars.reduce((sum, bar) => sum + bar.share, 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

describe('the §C / READING annotation is computed, not hardcoded', () => {
  const concentrated = response({
    edges: [edge(1, 2, 60), edge(1, 3, 20), edge(3, 2, 10), edge(4, 5, 10)],
    shots: [
      shot({ shooterId: 2, made: true, assisted: true, assisterId: 1 }),
      shot({ shooterId: 2, made: true, assisted: true, assisterId: 1 }),
    ],
  });

  const distributed = response({
    edges: [
      edge(1, 2, 11), edge(2, 3, 10), edge(3, 4, 10), edge(4, 5, 10),
      edge(5, 1, 10), edge(2, 1, 10), edge(3, 1, 10), edge(4, 2, 10),
      edge(5, 3, 10), edge(1, 4, 9),
    ],
  });

  it('names the real top connection and its real share', () => {
    const nodes = buildRoleNodes(concentrated);
    const text = buildReading(buildConnections(concentrated.edges), nodes);
    expect(text).toContain('P1');
    expect(text).toContain('P2');
    expect(text).toMatch(/60%/);
  });

  it('describes a concentrated unit differently from a distributed one', () => {
    const a = buildReading(buildConnections(concentrated.edges), buildRoleNodes(concentrated));
    const b = buildReading(buildConnections(distributed.edges), buildRoleNodes(distributed));
    expect(a).toContain('concentrated');
    expect(b).not.toContain('concentrated');
    expect(a).not.toBe(b);
  });

  it('handles a unit with no assisted creation without inventing one', () => {
    const text = buildReading([], buildRoleNodes(response()));
    expect(text).toMatch(/no assisted creation/i);
  });

  it('formats every percentage explicitly — no bare ratios leak into prose', () => {
    const text = buildReading(buildConnections(concentrated.edges), buildRoleNodes(concentrated));
    // A raw 0.75 or a bare "1" would mean formatting was skipped somewhere.
    expect(text).not.toMatch(/\b0\.\d+/);
  });
});

describe('the two visual registers — dotted faint vs solid dominant', () => {
  const nodes = buildRoleNodes(response({
    edges: [edge(1, 2, 40), edge(1, 3, 30), edge(3, 2, 20), edge(2, 4, 4)],
  }));
  const paint = (edges: AssistEdge[]) =>
    buildStrands(buildConnections(edges), nodes, { warm: color.rust, acid: color.acid });

  it('draws faint connections DOTTED and dominant ones SOLID', () => {
    // The Stage 3/4 regression flattened these into one register and the plate became a
    // knot. The dash pattern is what makes a small connection read as delicate rather
    // than merely thin.
    const { bundles } = paint([edge(1, 2, 90), edge(2, 4, 4)]);
    const dominant = bundles.find((b) => b.shooterId === 2)!;
    const faint = bundles.find((b) => b.shooterId === 4)!;
    expect(dominant.strands.every((s) => s.dash === 'none')).toBe(true);
    expect(faint.strands.every((s) => s.dash !== 'none')).toBe(true);
  });

  it('switches register exactly at the documented share threshold', () => {
    // 100 total: one connection at 6% (dominant) and one at 5% (faint).
    const { bundles } = paint([edge(1, 2, 89), edge(1, 3, 6), edge(3, 2, 5)]);
    const atThreshold = bundles.find((b) => b.shooterId === 3)!;
    const below = bundles.find((b) => b.assisterId === 3)!;
    expect(atThreshold.share).toBeGreaterThanOrEqual(encoding.denseMinShare);
    expect(atThreshold.strands.every((s) => s.dash === 'none')).toBe(true);
    expect(below.share).toBeLessThan(encoding.denseMinShare);
    expect(below.strands.every((s) => s.dash !== 'none')).toBe(true);
  });

  it('keeps faint connections to one or two hairlines so they recede', () => {
    const { bundles } = paint([edge(1, 2, 90), edge(2, 4, 4), edge(3, 2, 1)]);
    for (const bundle of bundles.filter((b) => b.share < encoding.denseMinShare)) {
      expect(bundle.strands.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('magnitude is rankable at a glance', () => {
  const nodes = buildRoleNodes(response({
    edges: [edge(1, 2, 26), edge(1, 3, 15), edge(3, 2, 13), edge(2, 4, 2)],
  }));

  /** Mirrors the real top lineup: a 14.1% leader against 8.2% and 7.1% followers. */
  const realistic = [
    edge(1, 2, 26), edge(1, 3, 15), edge(3, 1, 15), edge(1, 4, 14),
    edge(4, 1, 14), edge(2, 3, 13), edge(3, 4, 13), edge(2, 4, 11),
    edge(4, 2, 10), edge(2, 1, 9), edge(3, 2, 7), edge(4, 3, 6),
    edge(1, 5, 6), edge(5, 1, 5), edge(5, 2, 5), edge(5, 3, 4),
    edge(2, 5, 3), edge(3, 5, 3), edge(4, 5, 3), edge(5, 4, 2),
  ];

  it('makes the top connection visibly dominate the next tier', () => {
    // Before: 7 strands vs 4 — indistinguishable. The leader must read as clearly
    // heaviest without the viewer reading a single label.
    const { bundles } = buildStrands(buildConnections(realistic), nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    const ranked = [...bundles].sort((a, b) => b.share - a.share);
    const top = ranked[0].strands.length;
    const second = ranked[1].strands.length;
    expect(top).toBeGreaterThanOrEqual(second * 1.6);
  });

  it('never draws a heavier connection with fewer strands than a lighter one', () => {
    const { bundles } = buildStrands(buildConnections(realistic), nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    const ranked = [...bundles].sort((a, b) => b.share - a.share);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i].strands.length).toBeLessThanOrEqual(ranked[i - 1].strands.length);
    }
  });

  it('scales relative to the scope, so the leader always maxes out', () => {
    // A unit whose biggest connection is only 20% should still show a full-weight leader;
    // magnitude is read WITHIN a plate, not against an absolute scale.
    const flat = [edge(1, 2, 20), edge(1, 3, 20), edge(3, 2, 20), edge(2, 4, 20), edge(4, 1, 20)];
    const { bundles } = buildStrands(buildConnections(flat), nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    expect(bundles[0].strands.length).toBe(encoding.denseMaxStrands + 1); // odd-adjusted
  });

  it('gives every dominant bundle an odd strand count for a single arrowhead', () => {
    // An even count has no true centre, so two strands would carry arrowheads.
    const { bundles } = buildStrands(buildConnections(realistic), nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    for (const bundle of bundles.filter((b) => b.share >= encoding.denseMinShare)) {
      expect(bundle.strands.length % 2).toBe(1);
      expect(bundle.strands.filter((s) => s.marker !== null)).toHaveLength(1);
    }
  });
});
