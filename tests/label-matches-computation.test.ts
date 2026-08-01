import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { AssistEdge, GrainResponse, ShotEvent } from '@/lib/contracts';
import { buildOrigination, buildReading, buildRoleNodes } from '@/lib/network/model';
import { selectConnection } from '@/lib/court/connection';

/**
 * Label-vs-computation guards.
 *
 * This is the bug class that keeps recurring: a word that is true in one grain reused where
 * the maths means something else ("FIVE-MAN UNIT" on team, "SELF-CREATOR" on player,
 * "100% of assisted creation" on a capped plate). These tests pin the WORDING to the
 * FORMULA, so changing one without the other fails.
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

/**
 * A scope where outgoing and inbound creation are DELIBERATELY very different, so a test
 * cannot pass by coincidence: player 1 creates a lot and receives little; player 2 the
 * reverse.
 */
function lopsided(grain: 'team' | 'lineup' | 'player'): GrainResponse {
  const players = [
    { personId: 1, displayName: 'Creator' },
    { personId: 2, displayName: 'Scorer' },
    { personId: 3, displayName: 'Middle' },
  ];
  const edges = [edge(1, 2, 60), edge(1, 3, 20), edge(3, 2, 15), edge(2, 1, 5)];
  return {
    scope: {
      grain,
      id: grain === 'team' ? null : grain === 'lineup' ? '-1-2-3-4-5-' : 1,
      label: grain === 'player' ? 'Creator' : 'Unit',
    },
    players,
    edges,
    shots: [shot(1), shot(1, { assisted: false }), shot(2), shot(3)],
    split: { madeBaskets: 4, assisted: 3, selfCreated: 1, unresolvedAssisted: 0, assistedPct: 0.75 },
    meta: { shotCount: 4, edgeCount: edges.length, minutes: null, games: 72 },
  };
}

describe('§D ORIGINATION means outgoing creation in EVERY grain', () => {
  for (const grain of ['team', 'lineup', 'player'] as const) {
    it(`computes assister-side share, not inbound, at ${grain} grain`, () => {
      const data = lopsided(grain);
      const rows = buildOrigination(buildRoleNodes(data), data);
      const total = data.edges.reduce((sum, e) => sum + e.count, 0);

      for (const row of rows) {
        const outgoing = data.edges
          .filter((e) => e.assisterId === row.personId)
          .reduce((sum, e) => sum + e.count, 0);
        const inbound = data.edges
          .filter((e) => e.shooterId === row.personId)
          .reduce((sum, e) => sum + e.count, 0);

        expect(row.share).toBeCloseTo((outgoing / total) * 100, 6);
        // The fixture guarantees these differ, so this cannot pass by coincidence.
        if (outgoing !== inbound) {
          expect(row.share).not.toBeCloseTo((inbound / total) * 100, 6);
        }
      }
    });
  }

  it('ranks the biggest CREATOR first, not the biggest scorer', () => {
    // Player 2 receives the most (65) and creates the least (5). If §D ever flipped to
    // inbound, they would top the list — a silent meaning inversion under one label.
    const rows = buildOrigination(buildRoleNodes(lopsided('player')), lopsided('player'));
    expect(rows[0]!.name).toBe('Creator');
    expect(rows[rows.length - 1]!.name).toBe('Scorer');
  });
});

describe('§C never uses one word for two different measures', () => {
  it('does not describe the node-fill split with the same phrase as connection volume', () => {
    // "assisted" meant two unrelated things on one plate: a node fill of "84% ASSISTED"
    // (share of THAT PLAYER'S own made baskets) and "% of assisted creation" (share of the
    // unit's assist VOLUME). A reader cannot tell which "assisted" a sentence means.
    const data = lopsided('lineup');
    const text = buildReading(
      data.edges.map((e) => ({
        assisterId: e.assisterId, shooterId: e.shooterId, count: e.count,
        share: (e.count / 100) * 100, pointsPerBasket: 2, isHighValue: false,
      })),
      buildRoleNodes(data),
    );
    // The split must be phrased as scoring off teammates, not as a bare "% assisted".
    expect(text).not.toMatch(/on \d+% assisted/);
    expect(text).toMatch(/off teammates/);
  });

  it('states the origination share against the same denominator §D uses', () => {
    // §C said "Claxton originates 27%" (drawn subgraph) directly above a §D bar reading
    // 13% (full scope) for the same player — a 2.1x contradiction introduced when §D was
    // corrected and §C was left behind.
    const data = lopsided('team');
    const nodes = buildRoleNodes(data);
    const rows = buildOrigination(nodes, data);
    const text = buildReading(
      data.edges.map((e) => ({
        assisterId: e.assisterId, shooterId: e.shooterId, count: e.count,
        share: 25, pointsPerBasket: 2, isHighValue: false,
      })),
      nodes,
      data,
    );
    const lead = rows[0]!;
    expect(text).toContain(`${lead.name} originates ${Math.round(lead.share)}%`);
  });
});

describe('§C does not call a player scope a "unit"', () => {
  it('avoids "this unit" when the subject is one player', () => {
    const data = lopsided('player');
    const text = buildReading(
      data.edges.map((e) => ({
        assisterId: e.assisterId, shooterId: e.shooterId, count: e.count,
        share: 25, pointsPerBasket: 2, isHighValue: false,
      })),
      buildRoleNodes(data),
      data,
    );
    expect(text).not.toMatch(/this unit/i);
  });

  it('still says "unit" for a five-man lineup, where it is accurate', () => {
    const data = lopsided('lineup');
    const text = buildReading(
      data.edges.map((e) => ({
        assisterId: e.assisterId, shooterId: e.shooterId, count: e.count,
        share: 25, pointsPerBasket: 2, isHighValue: false,
      })),
      buildRoleNodes(data),
      data,
    );
    expect(text).toMatch(/this unit/i);
  });
});

describe('the games figure describes the scope it sits on', () => {
  it('reports the scope\'s own game span, not the season constant', async () => {
    const { formatScope, seasonScope } = await import('@/lib/data/scope');
    const season = seasonScope(72, 82);
    // A lineup that played 18 games must not be captioned "72 GAMES" — a reader would take
    // its 26 baskets as a 72-game rate.
    expect(formatScope(season, 18)).toContain('18 games');
    expect(formatScope(season, 18)).not.toContain('72 games');
  });

  it('still reports the full season when the scope spans it', () => {
    // Team grain covers every validated game, so nothing should change there.
    return import('@/lib/data/scope').then(({ formatScope, seasonScope }) => {
      expect(formatScope(seasonScope(72, 82), 72)).toContain('72 games');
    });
  });

  it('falls back to the season count when no scope span is given', () => {
    return import('@/lib/data/scope').then(({ formatScope, seasonScope }) => {
      expect(formatScope(seasonScope(72, 82))).toContain('72 games');
    });
  });
});

describe('axis and legend name what they actually encode', () => {
  const source = () =>
    readFile(new URL('../src/components/network/CreationNetwork.tsx', import.meta.url), 'utf8');

  it('does not claim the vertical axis encodes origination', async () => {
    // The band's y-scale is roleBalance (originated MINUS received); the hub uses no
    // vertical measure at all. Verified against real data: the player-grain subject is the
    // #1 originator yet sits 9th from the top.
    const text = await source();
    expect(text).not.toContain("VERTICAL AXIS · CREATION ORIGINATED");
    expect(text).toContain('VERTICAL AXIS · CREATOR-TO-SCORER BALANCE');
    expect(text).toContain('ARCS RADIATE FROM THE SUBJECT');
  });

  it('names the denominator in the density legend when the plate is thinned', async () => {
    // "SHARE OF UNIT CREATION" on a capped plate overstates: the top team connection reads
    // 16.7% of the drawn arcs but is 5.2% of the season.
    expect(await source()).toContain("SHARE OF {densityNote ? 'CREATION SHOWN' : 'UNIT CREATION'}");
  });
});

describe('the court caption counts THIS connection\'s games', () => {
  it('counts only games where this pair actually produced a basket', () => {
    // The risk is an overcount: reporting games the SCOPE spans (the lineup was on court)
    // rather than games this connection appears in. A connection that scored in 12 of a
    // lineup's 18 games must read 12, not 18.
    const players = [
      { personId: 1, displayName: 'Creator' },
      { personId: 2, displayName: 'Scorer' },
      { personId: 3, displayName: 'Other' },
    ];
    const shots: ShotEvent[] = [
      // The connection under test: two baskets, but both in ONE game.
      shot(2, { gameId: 'g1', assisterId: 1 }),
      shot(2, { gameId: 'g1', assisterId: 1 }),
      // Same scope, different games — must NOT inflate the connection's span.
      shot(3, { gameId: 'g2', assisterId: 1 }),
      shot(3, { gameId: 'g3', assisterId: 1 }),
    ];
    const data: GrainResponse = {
      scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
      players,
      edges: [edge(1, 2, 2), edge(1, 3, 2)],
      shots,
      split: { madeBaskets: 4, assisted: 4, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
      meta: { shotCount: 4, edgeCount: 2, minutes: 100, games: 3 },
    };

    const connection = selectConnection(data, 1, 2)!;
    const connectionGames = new Set(connection.shots.map((s) => s.gameId)).size;

    // The scope spans 3 games; this connection appears in 1.
    expect(new Set(data.shots.map((s) => s.gameId)).size).toBe(3);
    expect(connectionGames).toBe(1);
  });

  it('derives the rendered figure from the connection, not the scope', async () => {
    // The two tests above exercise `selectConnection`, NOT the line that renders. Verified
    // by sabotage: repointing the component at `scope.games` left the whole suite green.
    // This pins the component's own expression, which is the thing that can actually drift.
    const source = await readFile(
      new URL('../src/components/court/SpatialSignature.tsx', import.meta.url), 'utf8',
    );
    expect(source).toContain(
      'const connectionGames = new Set(connection.shots.map((shot) => shot.gameId)).size;',
    );
    // The scope's season-wide count must not be what the caption receives.
    expect(source).not.toMatch(/connectionGames\s*=\s*scope/);
    expect(source).toContain('formatScope(scope, connectionGames)');
  });

  it('never reports more games than the connection has baskets', () => {
    // A cheap invariant that catches any drift toward a scope-wide count: one basket can
    // only ever appear in one game.
    const players = [
      { personId: 1, displayName: 'Creator' },
      { personId: 2, displayName: 'Scorer' },
    ];
    const data: GrainResponse = {
      scope: { grain: 'lineup', id: '-1-2-3-4-5-', label: 'Unit' },
      players,
      edges: [edge(1, 2, 2)],
      shots: [shot(2, { gameId: 'g1', assisterId: 1 }), shot(2, { gameId: 'g2', assisterId: 1 })],
      split: { madeBaskets: 2, assisted: 2, selfCreated: 0, unresolvedAssisted: 0, assistedPct: 1 },
      meta: { shotCount: 2, edgeCount: 1, minutes: 100, games: 9 },
    };
    const connection = selectConnection(data, 1, 2)!;
    const games = new Set(connection.shots.map((s) => s.gameId)).size;
    expect(games).toBeLessThanOrEqual(connection.shots.length);
    // And explicitly not the scope's inflated meta.games.
    expect(games).not.toBe(data.meta.games);
  });
});
