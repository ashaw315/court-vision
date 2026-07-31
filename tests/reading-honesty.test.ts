import { describe, expect, it } from 'vitest';

import type { AssistEdge, GrainResponse, ShotEvent } from '@/lib/contracts';
import { buildConnections, buildReading, buildRoleNodes } from '@/lib/network/model';

/**
 * §C reading-text honesty.
 *
 * Two defects found by the Stage 6a adversarial pass:
 *   1. A player with no made baskets was named as a "finisher", printing an em-dash into
 *      the middle of a sentence ("Williams on — assisted") on 20 of 22 player grains.
 *   2. The prose could in principle cite a connection the density cap had removed from the
 *      plate, describing an arc the reader cannot see.
 *
 * Pure functions over synthetic scopes — no DB, no browser, nothing can skip.
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

/** A scope where the top receiver has NO made baskets of their own. */
function scopeWithScorelessFinisher(): GrainResponse {
  const players = [
    { personId: 1, displayName: 'Creator' },
    { personId: 2, displayName: 'Scoreless' },
    { personId: 3, displayName: 'RealScorer' },
  ];
  const edges = [edge(1, 2, 40), edge(1, 3, 10)];
  return {
    scope: { grain: 'player', id: 1, label: 'Creator' },
    players,
    edges,
    // Only player 3 has shots in this payload — player 2 receives 40 but has no shots here.
    shots: [shot(3), shot(3, { assisted: false })],
    split: { madeBaskets: 2, assisted: 1, selfCreated: 1, unresolvedAssisted: 0, assistedPct: 0.5 },
    meta: { shotCount: 2, edgeCount: edges.length, minutes: null, games: 72 },
  };
}

describe('null assisted-split never reaches the prose', () => {
  it('does not print a blank or em-dash mid-sentence', () => {
    const data = scopeWithScorelessFinisher();
    const text = buildReading(buildConnections(data.edges), buildRoleNodes(data));
    // The exact rendered defect: "Scoreless on — assisted".
    expect(text).not.toMatch(/on\s+—\s+assisted/);
    expect(text).not.toMatch(/undefined|NaN|null/);
  });

  it('never names a player with no made baskets as a finisher', () => {
    const data = scopeWithScorelessFinisher();
    const nodes = buildRoleNodes(data);
    const text = buildReading(buildConnections(data.edges), nodes);

    const scoreless = nodes.find((node) => node.name === 'Scoreless')!;
    expect(scoreless.assistedPct).toBeNull();
    // Naming them "finishes through" asserts a split we do not have for them.
    expect(text).not.toContain('Scoreless on');
  });

  it('still describes a real finisher when one exists', () => {
    // The fix must not silently delete the sentence whenever any null is present.
    const data = scopeWithScorelessFinisher();
    const text = buildReading(buildConnections(data.edges), buildRoleNodes(data));
    expect(text).toContain('RealScorer');
  });

  it('omits the finisher clause entirely when nobody has made baskets', () => {
    const data = scopeWithScorelessFinisher();
    data.shots = [];
    const text = buildReading(buildConnections(data.edges), buildRoleNodes(data));
    expect(text).not.toMatch(/finish/i);
    expect(text).not.toMatch(/—/);
  });
});

describe('the prose only cites connections the plate draws', () => {
  it('never names an arc missing from the connections it was given', () => {
    // Guards the contract directly: whatever `buildReading` cites must be in its own input,
    // so a future caller passing uncapped connections cannot describe a hidden arc.
    const players = Array.from({ length: 6 }, (_, i) => ({ personId: i + 1, displayName: `P${i + 1}` }));
    const edges = [edge(5, 6, 99), edge(1, 2, 40), edge(1, 3, 10)];
    const full: GrainResponse = {
      scope: { grain: 'team', id: null, label: 'Team' },
      players, edges,
      shots: players.map((p) => shot(p.personId)),
      split: { madeBaskets: 6, assisted: 6, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
      meta: { shotCount: 6, edgeCount: edges.length, minutes: null, games: 72 },
    };

    const nodes = buildRoleNodes(full);
    const all = buildConnections(full.edges);
    // Simulate a cap that drops the biggest connection (P5 -> P6).
    const drawn = all.filter((c) => !(c.assisterId === 5 && c.shooterId === 6));
    const text = buildReading(drawn, nodes);

    expect(text).not.toContain('P5 to P6');
    const cited = drawn[0]!;
    const citedNames = `${nodes.find((n) => n.personId === cited.assisterId)!.name} to `
      + `${nodes.find((n) => n.personId === cited.shooterId)!.name}`;
    expect(text).toContain(citedNames);
  });

  it('reports the share of what is drawn, not of the hidden total', () => {
    // If the cited share were computed against the pre-cap total it would not match the
    // arc the reader can actually see.
    const players = Array.from({ length: 4 }, (_, i) => ({ personId: i + 1, displayName: `P${i + 1}` }));
    const edges = [edge(1, 2, 30), edge(3, 4, 10)];
    const data: GrainResponse = {
      scope: { grain: 'team', id: null, label: 'Team' },
      players, edges,
      shots: players.map((p) => shot(p.personId)),
      split: { madeBaskets: 4, assisted: 4, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
      meta: { shotCount: 4, edgeCount: edges.length, minutes: null, games: 72 },
    };
    const drawn = buildConnections(data.edges);
    const text = buildReading(drawn, buildRoleNodes(data));
    // 30/40 = 75% of the drawn set.
    expect(text).toContain('75%');
  });
});
