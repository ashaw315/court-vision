import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { AssistEdge, GrainResponse, ShotEvent } from '@/lib/contracts';
import { network } from '@/lib/design/tokens';
import { buildReading, buildRoleNodes, focalPersonId } from '@/lib/network/model';

/**
 * Player-grain layout: the subject is the hub.
 *
 * Measured on the real data before changing anything: in a player scope EVERY edge touches
 * the focal player and every other node has a two-way relationship with them. The role-band
 * layout ignored that shape — teammate role balances cluster inside a ~0.1 span while the
 * focal player sits far outside it, so nine nodes collapsed into one horizontal lane with
 * labels overprinting while most of the plate's vertical space went unused.
 *
 * Synthetic scopes here so the geometry is pinned without a database; the real-data sweep
 * lives in the nav-grains suite.
 */

const edge = (assisterId: number, shooterId: number, count: number): AssistEdge => ({
  assisterId, shooterId, count, made2: count, made3: 0, points: 2 * count,
});

const shot = (shooterId: number, over: Partial<ShotEvent> = {}): ShotEvent => ({
  gameId: 'g', eventId: Math.random(), period: 1, clock: 'PT11M00.00S', shooterId,
  locX: 0, locY: 0, shotValue: 2, made: true, assisted: true, assisterId: 1,
  shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot', teamId: 1,
  intervalId: null, ...over,
});

/**
 * A player scope shaped like the real thing: a focal subject, `n` teammates each with a
 * two-way relationship, and shots ONLY for the subject — which is why every teammate's
 * split is null.
 */
function playerScope(n: number, focalId = 1): GrainResponse {
  const players = [
    { personId: focalId, displayName: 'Focal' },
    ...Array.from({ length: n }, (_, i) => ({ personId: i + 2, displayName: `Mate${i + 2}` })),
  ];
  const edges: AssistEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    const mate = i + 2;
    // Deliberately near-identical balances — the exact clustering that broke the band layout.
    edges.push(edge(mate, focalId, 20 + i), edge(focalId, mate, 18 + i));
  }
  return {
    scope: { grain: 'player', id: focalId, label: 'Focal' },
    players,
    edges,
    shots: [shot(focalId), shot(focalId, { assisted: false })],
    split: { madeBaskets: 2, assisted: 1, selfCreated: 1, unresolvedAssisted: 0, assistedPct: 0.5 },
    meta: { shotCount: 2, edgeCount: edges.length, minutes: null, games: 72 },
  };
}

/** Same players, but as a team scope — the layout must NOT go radial. */
function teamScope(n: number): GrainResponse {
  const base = playerScope(n);
  return { ...base, scope: { grain: 'team', id: null, label: 'Team' } };
}

const MIN_GAP_Y = 34;
const X_OVERLAP = 96;

function overlappingPairs(nodes: ReturnType<typeof buildRoleNodes>) {
  const hits: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.abs(a.x - b.x) >= X_OVERLAP) continue;
      if (Math.abs(a.y - b.y) < MIN_GAP_Y - 1e-6) hits.push(`${a.name}/${b.name}`);
    }
  }
  return hits;
}

describe('labels never overprint in the player grain', () => {
  it('separates a tightly clustered roster at every realistic width', () => {
    // 9 teammates with near-identical role balances is the real Porter Jr. shape.
    for (const n of [3, 5, 7, 9]) {
      expect(overlappingPairs(buildRoleNodes(playerScope(n)))).toEqual([]);
    }
  });

  it('uses the plate\'s vertical room instead of one band', () => {
    const nodes = buildRoleNodes(playerScope(9));
    const ys = nodes.map((node) => node.y);
    const usable = network.receivesY - network.originatesY;
    // The band layout crushed these into a sliver; the ring should occupy most of the height.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(usable * 0.5);
  });

  it('keeps every node inside the plate', () => {
    for (const node of buildRoleNodes(playerScope(9))) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(network.viewBox.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(network.viewBox.height);
    }
  });
});

describe('the focal player is the hub', () => {
  it('places the subject at the centre of the plate', () => {
    const nodes = buildRoleNodes(playerScope(9));
    const focal = nodes.find((node) => node.personId === 1)!;
    expect(focal.x).toBeCloseTo(network.viewBox.width / 2, 6);
    expect(focal.y).toBeCloseTo((network.originatesY + network.receivesY) / 2, 6);
  });

  it('puts every teammate off-centre, around them', () => {
    const nodes = buildRoleNodes(playerScope(9));
    const cx = network.viewBox.width / 2;
    const cy = (network.originatesY + network.receivesY) / 2;
    for (const node of nodes.filter((n) => n.personId !== 1)) {
      expect(Math.hypot(node.x - cx, node.y - cy)).toBeGreaterThan(60);
    }
  });

  it('separates creators from receivers when the scope has both', () => {
    // Angle carries the role encoding the band layout carried in raw height: with a genuine
    // mix, every net creator sits above every net receiver.
    const data = playerScope(8);
    // Flip half the teammates into net receivers by reversing their edge weights.
    data.edges = data.edges.map((edge) =>
      edge.assisterId >= 6 || edge.shooterId >= 6
        ? { ...edge, count: edge.assisterId === 1 ? 60 : 5, points: 2 * (edge.assisterId === 1 ? 60 : 5) }
        : edge,
    );
    const nodes = buildRoleNodes(data);
    const mates = nodes.filter((node) => node.personId !== 1);
    const creators = mates.filter((node) => node.roleBalance > 0);
    const receivers = mates.filter((node) => node.roleBalance < 0);
    expect(creators.length).toBeGreaterThan(0);
    expect(receivers.length).toBeGreaterThan(0);

    const lowestCreator = Math.max(...creators.map((n) => n.y));
    const highestReceiver = Math.min(...receivers.map((n) => n.y));
    expect(lowestCreator).toBeLessThan(highestReceiver);
  });

  it('orders the ring by role even when every teammate is the same kind', () => {
    // Real and common: Traore's scope is 0 creators / 9 receivers, Williams' is 9 / 0. A
    // strict hemisphere rule would crush those plates into half the plate, so a one-sided
    // scope is allowed the whole ring — but it must still be ORDERED by role, most
    // creator-ish first, so the reading is unchanged.
    const nodes = buildRoleNodes(playerScope(9));
    const mates = nodes.filter((node) => node.personId !== 1);
    expect(mates.every((node) => node.roleBalance > 0)).toBe(true);

    const byRole = [...mates].sort((a, b) => b.roleBalance - a.roleBalance);
    const byRing = [...mates].sort((a, b) => a.y - b.y);
    expect(byRing.map((n) => n.name)).toEqual(byRole.map((n) => n.name));
  });
});

describe('team and lineup grains are untouched', () => {
  it('does not centre any node for a team scope', () => {
    // Same players, same edges — only the grain differs. The radial branch must not fire.
    const nodes = buildRoleNodes(teamScope(9));
    const cx = network.viewBox.width / 2;
    const cy = (network.originatesY + network.receivesY) / 2;
    const centred = nodes.filter(
      (node) => Math.abs(node.x - cx) < 1 && Math.abs(node.y - cy) < 1,
    );
    expect(centred).toHaveLength(0);
  });

  it('still positions and separates every team node', () => {
    expect(overlappingPairs(buildRoleNodes(teamScope(7)))).toEqual([]);
  });

  it('leaves the five-man lineup on its resolved spacing', async () => {
    const { scaleLinear } = await import('d3-scale');
    const lineup: GrainResponse = {
      ...playerScope(4),
      scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
    };
    const nodes = buildRoleNodes(lineup);
    const balances = nodes.map((node) => node.roleBalance);
    const spread = Math.max(
      Math.abs(Math.min(...balances)), Math.abs(Math.max(...balances)), 0.01,
    );
    const yScale = scaleLinear()
      .domain([spread, -spread])
      .range([network.originatesY + 32, network.receivesY - 34])
      .clamp(true);
    // The lineup grain IS the resolved design — the band scale, untouched.
    for (const node of nodes) expect(node.y).toBeCloseTo(yScale(node.roleBalance), 6);
  });
});

describe('an unmeasurable split stays honest (6a must not regress)', () => {
  it('never names a null-split teammate as a finisher', () => {
    const data = playerScope(9);
    const nodes = buildRoleNodes(data);
    // Every teammate is null here, exactly as in the real payload.
    expect(nodes.filter((n) => n.personId !== 1).every((n) => n.assistedPct === null)).toBe(true);

    const text = buildReading(
      data.edges.map((e) => ({
        assisterId: e.assisterId, shooterId: e.shooterId, count: e.count,
        share: 100 / data.edges.length, pointsPerBasket: 2, isHighValue: false,
      })),
      nodes,
    );
    expect(text).not.toMatch(/on\s+—\s+assisted/);
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe('copy states what each grain actually shows', () => {
  const source = () =>
    readFile(new URL('../src/components/network/CreationNetwork.tsx', import.meta.url), 'utf8');

  it('does not claim "position as role" on a hub layout', async () => {
    // The band layout's own description. On a player plate the subject is centred and the
    // others ring them, so the caption has to say so.
    expect(await source()).toContain("focalId === null ? 'POSITION AS ROLE' : 'SUBJECT AT CENTRE'");
  });

  it('renames the axis captions for the hub', async () => {
    // "ORIGINATES / RECEIVES CREATION" label the top and bottom of a role BAND. Around a
    // hub the meaningful statement is the direction of the arcs relative to the subject.
    const text = await source();
    expect(text).toContain("'ORIGINATES CREATION' : 'CREATES FOR THE SUBJECT'");
    expect(text).toContain("'RECEIVES CREATION' : 'SCORES OFF THE SUBJECT'");
  });

  it('does not tell a player plate that an empty node means self-creator', async () => {
    // True on team/lineup; false on player, where the payload holds only the subject's
    // shots so a teammate's split is simply not measurable in this view.
    expect(await source()).toContain("? 'SELF-CREATOR'");
    expect(await source()).toContain("'NOT MEASURABLE HERE'");
  });

  it('drops the per-node null readout only where it would repeat', async () => {
    // Nine repetitions of the same caveat is noise; the legend carries it once. The
    // team/lineup case still prints "NO MADE BASKETS", which is accurate there.
    expect(await source()).toContain("focalId === null ? 'NO MADE BASKETS' : ''");
  });
});

describe('only the player grain gets a hub', () => {
  it('resolves a subject for a player scope', () => {
    expect(focalPersonId(playerScope(4))).toBe(1);
  });

  it('resolves none for team or lineup', () => {
    expect(focalPersonId(teamScope(4))).toBeNull();
    expect(focalPersonId({
      ...playerScope(4),
      scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
    })).toBeNull();
  });

  it('refuses a NUMERIC lineup id rather than relying on the format', () => {
    // A lineup's groupId is "-1-2-3-4-5-", so Number() is NaN and the radial branch is
    // unreachable for lineups by accident. This pins the grain check itself: even a scope
    // whose id parses cleanly must not become a hub unless the grain says player.
    expect(focalPersonId({
      ...playerScope(4),
      scope: { grain: 'lineup', id: 1, label: 'Unit' },
    })).toBeNull();
  });

  it('refuses an unparseable player id instead of returning NaN', () => {
    // NaN would compare false against every personId and silently fall back to the band
    // layout — a confusing failure rather than a clear one.
    expect(focalPersonId({
      ...playerScope(4),
      scope: { grain: 'player', id: 'not-a-number', label: '?' },
    })).toBeNull();
  });
});
