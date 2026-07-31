import { describe, expect, it } from 'vitest';

import type { GrainResponse, ShotEvent } from '@/lib/contracts';
import { selectConnection } from '@/lib/court/connection';
import { buildConnections, buildRoleNodes, buildStrands } from '@/lib/network/model';
import { color } from '@/lib/design/tokens';
import {
  DIM_OPACITY,
  connectionLabel,
  isDimmed,
  isEndpoint,
  isNodeDimmed,
  isSameConnection,
  isSelected,
  toggleSelection,
  type ConnectionSelection,
} from '@/lib/network/selection';

/**
 * Selection logic — the wiring that turns two plates into one instrument.
 *
 * Pure state rules plus the model-level plumbing they drive. Nothing here needs a browser,
 * a database or a network, so there is nothing to skip. Rendering itself is visual review;
 * what is asserted is that the RIGHT connection is selected, dimmed, and fed to the court.
 */

const shot = (over: Partial<ShotEvent>): ShotEvent => ({
  gameId: 'g', eventId: 1, period: 1, clock: 'PT11M00.00S', shooterId: 1,
  locX: 0, locY: 0, shotValue: 2, made: true, assisted: true, assisterId: 2,
  shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot', teamId: 1,
  intervalId: null, ...over,
});

const A = 1; // creator
const B = 2; // scorer
const C = 3; // another player

const data: GrainResponse = {
  scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
  players: [A, B, C, 4, 5].map((personId) => ({ personId, displayName: `P${personId}` })),
  edges: [
    { assisterId: A, shooterId: B, count: 10, points: 22, made2: 8, made3: 2 },
    { assisterId: C, shooterId: B, count: 6, points: 12, made2: 6, made3: 0 },
    { assisterId: B, shooterId: A, count: 4, points: 8, made2: 4, made3: 0 },
  ],
  shots: [
    ...Array.from({ length: 8 }, (_, i) =>
      shot({ eventId: i + 1, shooterId: B, assisterId: A, shotValue: 2, locX: 0, locY: 15 })),
    ...Array.from({ length: 2 }, (_, i) =>
      shot({ eventId: 20 + i, shooterId: B, assisterId: A, shotValue: 3, locX: -229, locY: 1 })),
    ...Array.from({ length: 6 }, (_, i) =>
      shot({ eventId: 40 + i, shooterId: B, assisterId: C, shotValue: 2, locX: 0, locY: 20 })),
    ...Array.from({ length: 4 }, (_, i) =>
      shot({ eventId: 60 + i, shooterId: A, assisterId: B, shotValue: 2, locX: 0, locY: 30 })),
  ],
  split: { madeBaskets: 20, assisted: 20, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
  meta: { shotCount: 20, edgeCount: 3, minutes: 100, games: 1 },
};

const AB: ConnectionSelection = { assisterId: A, shooterId: B };
const CB: ConnectionSelection = { assisterId: C, shooterId: B };
const BA: ConnectionSelection = { assisterId: B, shooterId: A };

describe('selection identity', () => {
  it('treats direction as meaningful — A→B is not B→A', () => {
    // The two are genuinely different connections with different shots, so conflating
    // them would show the wrong court.
    expect(isSameConnection(AB, BA)).toBe(false);
    expect(isSameConnection(AB, { ...AB })).toBe(true);
  });

  it('never matches when nothing is selected', () => {
    expect(isSameConnection(null, AB)).toBe(false);
    expect(isSameConnection(null, null)).toBe(false);
  });
});

describe('clicking a connection', () => {
  it('selects it from the resting state', () => {
    expect(toggleSelection(null, AB)).toEqual(AB);
  });

  it('re-resolves to a different connection', () => {
    expect(toggleSelection(AB, CB)).toEqual(CB);
  });

  it('clicking the selected connection again deselects', () => {
    // The "click the selected arc again" affordance — the way back to resting state.
    expect(toggleSelection(AB, AB)).toBeNull();
  });

  it('distinguishes the reverse connection from a deselect', () => {
    // B→A is a different arc, so clicking it while A→B is selected must SELECT it,
    // not clear the selection.
    expect(toggleSelection(AB, BA)).toEqual(BA);
  });
});

describe('emphasis and dimming', () => {
  it('dims nothing at rest — the resting plate is unchanged', () => {
    for (const edge of data.edges) {
      expect(isDimmed(null, edge)).toBe(false);
    }
    for (const player of data.players) {
      expect(isNodeDimmed(null, player.personId)).toBe(false);
    }
  });

  it('keeps the selected arc full-strength and dims every other', () => {
    const selectedEdges = data.edges.filter((edge) => isSelected(AB, edge));
    const dimmedEdges = data.edges.filter((edge) => isDimmed(AB, edge));
    expect(selectedEdges).toHaveLength(1);
    expect(dimmedEdges).toHaveLength(data.edges.length - 1);
    expect(selectedEdges[0].assisterId).toBe(A);
    expect(selectedEdges[0].shooterId).toBe(B);
  });

  it('keeps BOTH endpoint nodes full-strength', () => {
    // They are what the connection is; dimming them would break the link to the court.
    expect(isEndpoint(AB, A)).toBe(true);
    expect(isEndpoint(AB, B)).toBe(true);
    expect(isNodeDimmed(AB, A)).toBe(false);
    expect(isNodeDimmed(AB, B)).toBe(false);
  });

  it('dims players who are not part of the selected connection', () => {
    expect(isNodeDimmed(AB, C)).toBe(true);
    expect(isEndpoint(AB, C)).toBe(false);
  });

  it('recedes without disappearing', () => {
    // Dimmed arcs must stay legible as context — the field is still the unit's shape.
    expect(DIM_OPACITY).toBeGreaterThan(0);
    expect(DIM_OPACITY).toBeLessThan(0.4);
  });

  it('moves emphasis when the selection changes', () => {
    const before = data.edges.filter((edge) => isSelected(AB, edge));
    const after = data.edges.filter((edge) => isSelected(CB, edge));
    expect(before[0]).not.toEqual(after[0]);
    // The previously selected arc returns to the dimmed field.
    expect(isDimmed(CB, before[0])).toBe(true);
  });
});

describe('the court receives the selected connection', () => {
  it('feeds selectConnection the clicked ids', () => {
    const selection = toggleSelection(null, AB)!;
    const connection = selectConnection(data, selection.assisterId, selection.shooterId)!;
    expect(connection.assisterId).toBe(A);
    expect(connection.shooterId).toBe(B);
  });

  it('renders a basket count matching the SELECTED edge, not another', () => {
    // The consistency guarantee: the court's count must be the clicked arc's count.
    for (const edge of data.edges) {
      const connection = selectConnection(data, edge.assisterId, edge.shooterId)!;
      expect(connection.shots.length).toBe(edge.count);
      expect(connection.tally.points).toBe(edge.points);
    }
  });

  it('re-resolves to a different shot set when the selection changes', () => {
    const first = selectConnection(data, AB.assisterId, AB.shooterId)!;
    const second = selectConnection(data, CB.assisterId, CB.shooterId)!;
    expect(first.shots.length).not.toBe(second.shots.length);
    expect(first.shots).not.toEqual(second.shots);
  });

  it('does not leak the reverse connection\'s shots', () => {
    const forward = selectConnection(data, A, B)!;
    const reverse = selectConnection(data, B, A)!;
    expect(forward.shots.length).toBe(10);
    expect(reverse.shots.length).toBe(4);
    for (const s of reverse.shots) expect(s.shooterId).toBe(A);
  });
});

describe('arcs are addressable targets', () => {
  const nodes = buildRoleNodes(data);
  const connections = buildConnections(data.edges);
  const { bundles, strands } = buildStrands(connections, nodes, {
    warm: color.rust,
    acid: color.acid,
  });

  it('groups strands into one bundle per connection', () => {
    // A bundle is many hairlines but ONE connection — the user clicks the connection.
    expect(bundles).toHaveLength(data.edges.length);
    const ids = bundles.map((b) => `${b.assisterId}:${b.shooterId}`);
    expect(new Set(ids).size).toBe(bundles.length);
  });

  it('keeps every strand accounted for in exactly one bundle', () => {
    const bundled = bundles.reduce((sum, bundle) => sum + bundle.strands.length, 0);
    expect(bundled).toBe(strands.length);
  });

  it('gives each bundle a single hit path for a comfortable target', () => {
    // Thin hairlines are near-impossible to click; one fat invisible path fixes that.
    for (const bundle of bundles) {
      expect(bundle.hitPath).toMatch(/^M[\d.-]+,[\d.-]+ Q/);
    }
  });

  it('lets a bundle be matched back to its selection', () => {
    const bundle = bundles.find((b) => b.assisterId === A && b.shooterId === B)!;
    expect(isSelected(AB, bundle)).toBe(true);
    expect(isDimmed(AB, bundle)).toBe(false);
    expect(isDimmed(CB, bundle)).toBe(true);
  });

  it('ties each % label to its connection so it dims with its own arc', () => {
    // A bright label over a ghosted arc would keep competing with the selection.
    const { labels } = buildStrands(connections, nodes, {
      warm: color.rust,
      acid: color.acid,
    });
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(typeof label.assisterId).toBe('number');
      expect(typeof label.shooterId).toBe('number');
    }
    const selectedLabels = labels.filter((label) => !isDimmed(AB, label));
    // Only the selected connection's label stays full-strength.
    for (const label of selectedLabels) {
      expect(label.assisterId).toBe(A);
      expect(label.shooterId).toBe(B);
    }
  });
});

describe('accessible labelling', () => {
  it('names both players, the share, and what activating does', () => {
    const label = connectionLabel('Claxton', 'Porter Jr.', 14.1, false);
    expect(label).toContain('Claxton');
    expect(label).toContain('Porter Jr.');
    expect(label).toContain('14.1%');
    expect(label).toMatch(/activate/i);
  });

  it('announces the selected state and how to clear it', () => {
    const label = connectionLabel('Claxton', 'Porter Jr.', 14.1, true);
    expect(label).toMatch(/selected/i);
    expect(label).toMatch(/clear/i);
  });
});
