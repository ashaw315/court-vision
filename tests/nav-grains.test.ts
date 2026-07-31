import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { GrainResponse } from '@/lib/contracts';
import {
  getLineup,
  getLineupGrain,
  getLineups,
  getPlayerGrain,
  getPlayers,
  getTeamGrain,
  playerExists,
} from '@/lib/api/queries';
import { DENSITY, densityNoteText, scopeForPlate } from '@/lib/network/density';
import { buildConnections, buildRoleNodes } from '@/lib/network/model';

/**
 * Navigation against the SEEDED database: does each scope actually return itself, and does
 * every scope survive the one shared plate?
 *
 * The routing unit tests prove the container asks the right endpoint. These prove the
 * endpoint answers with the right thing, and that the real payloads — not synthetic ones —
 * render through the same instrument at every grain.
 *
 * Following the Phase 3 lesson, a missing database FAILS these tests rather than skipping
 * them: the preflight records the problem and the first test asserts on it.
 */

const TOP_LINEUP = '-1629008-1629611-1629651-1641730-1642856-';
const PORTER = 1629008;
const PORTER_NAME = 'Porter Jr.';

let preflightError: string | null = null;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    preflightError =
      'DATABASE_URL is not set — the navigation tests need the seeded Neon database. '
      + 'Copy .env.example to .env and fill it in.';
    return;
  }
  try {
    const team = await getTeamGrain();
    if (team.shots.length === 0) {
      preflightError = 'Database is reachable but empty. Run `npm run db:seed`.';
    }
  } catch (error) {
    preflightError = `Could not reach the database: ${(error as Error).message}`;
  }
});

describe('preflight', () => {
  it('has a seeded database to test against', () => {
    expect(preflightError).toBeNull();
  });
});

describe('each grain returns its own scope', () => {
  it('labels the team scope as team, with no unit id', () => {
    // The scope block is what the plate prints in its header. If it lied, the plate would
    // caption the wrong subject while looking entirely correct.
    return getTeamGrain().then((team) => {
      expect(team.scope.grain).toBe('team');
      expect(team.scope.id).toBeNull();
    });
  });

  it('labels the lineup scope as lineup, carrying the group id back', async () => {
    const lineup = await getLineup(TOP_LINEUP);
    expect(lineup).not.toBeNull();
    const payload = await getLineupGrain(lineup!);
    expect(payload.scope.grain).toBe('lineup');
    expect(payload.scope.id).toBe(TOP_LINEUP);
  });

  it('labels the player scope as player, carrying the person id back', async () => {
    const payload = await getPlayerGrain(PORTER, PORTER_NAME);
    expect(payload.scope.grain).toBe('player');
    expect(payload.scope.id).toBe(PORTER);
  });

  it('narrows: player ⊂ lineup ⊂ team', async () => {
    // A grain switch has to actually change the data. Equal shot counts would mean the
    // container was re-rendering the same scope under three different labels.
    const [team, lineupRow] = await Promise.all([getTeamGrain(), getLineup(TOP_LINEUP)]);
    const [lineup, player] = await Promise.all([
      getLineupGrain(lineupRow!),
      getPlayerGrain(PORTER, PORTER_NAME),
    ]);
    expect(player.shots.length).toBeLessThan(team.shots.length);
    expect(lineup.shots.length).toBeLessThan(team.shots.length);
    expect(team.players.length).toBeGreaterThan(lineup.players.length);
  });
});

describe('every grain satisfies the shared contract', () => {
  it('validates all three payloads against GrainResponse', async () => {
    const lineupRow = await getLineup(TOP_LINEUP);
    const payloads = await Promise.all([
      getTeamGrain(),
      getLineupGrain(lineupRow!),
      getPlayerGrain(PORTER, PORTER_NAME),
    ]);
    // One schema for three scopes is the claim that makes "one instrument" true.
    for (const payload of payloads) {
      expect(GrainResponse.safeParse(payload).success).toBe(true);
    }
  });
});

describe('every grain survives the one plate', () => {
  it('draws a positioned, bounded plate at all three scopes', async () => {
    const lineupRow = await getLineup(TOP_LINEUP);
    const scopes = await Promise.all([
      getTeamGrain(),
      getLineupGrain(lineupRow!),
      getPlayerGrain(PORTER, PORTER_NAME),
    ]);

    for (const raw of scopes) {
      const { data } = scopeForPlate(raw, DENSITY[raw.scope.grain]);
      const nodes = buildRoleNodes(data);

      expect(nodes.length).toBeGreaterThan(0);
      // Every node positioned: the pre-Stage-5 `roleColumns` returned undefined past five.
      for (const node of nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
      }
      // No two nodes stacked on one lane — that would read as a single player.
      expect(new Set(nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(nodes.length);

      // Every connection resolves to a drawn node, at every grain.
      const drawn = new Set(nodes.map((node) => node.personId));
      for (const connection of buildConnections(data.edges)) {
        expect(drawn.has(connection.assisterId)).toBe(true);
        expect(drawn.has(connection.shooterId)).toBe(true);
      }
    }
  });

  it('thins the real team scope and says so', async () => {
    const team = await getTeamGrain();
    const { data, note } = scopeForPlate(team, DENSITY.team);

    expect(team.players.length).toBeGreaterThan(DENSITY.team.maxNodes!);
    expect(data.players).toHaveLength(DENSITY.team.maxNodes!);
    expect(data.edges.length).toBeLessThanOrEqual(DENSITY.team.maxConnections!);

    // The thinned team plate must carry its own caveat — silence would read as "all 22".
    const text = densityNoteText(note);
    expect(text).not.toBeNull();
    expect(text).toContain(`of ${team.players.length} players`);
  });

  it('leaves the real lineup scope untouched', async () => {
    // Five players by definition — capping it would restyle the resolved design.
    const lineupRow = await getLineup(TOP_LINEUP);
    const lineup = await getLineupGrain(lineupRow!);
    expect(scopeForPlate(lineup, DENSITY.lineup).note.thinned).toBe(false);
  });

  it('thins a real player scope, which is wider than it looks', async () => {
    // A player's scope is every teammate they have ever created with or for — 13-21 people
    // across a season, most with no made baskets in that scope. Uncapped it renders as one
    // band of overprinting labels.
    const player = await getPlayerGrain(PORTER, PORTER_NAME);
    expect(player.players.length).toBeGreaterThan(DENSITY.player.maxNodes!);

    const { data, note } = scopeForPlate(player, DENSITY.player);
    expect(data.players).toHaveLength(DENSITY.player.maxNodes!);
    expect(densityNoteText(note)).not.toBeNull();
  });
});

describe('the pickers can populate', () => {
  it('offers lineups at the display threshold, each with its minutes', async () => {
    const lineups = await getLineups(50);
    expect(lineups.length).toBeGreaterThan(0);
    // Minutes ride on every row so a thin unit is never mistaken for a substantial one.
    for (const lineup of lineups) {
      expect(lineup.minutes).toBeGreaterThanOrEqual(50);
      expect(lineup.displayNames).toHaveLength(5);
    }
  });

  it('surfaces more units at the emit floor than at the display threshold', async () => {
    // This is the emit-floor decision paying off — the UI owns the display cutoff.
    const [atFloor, atDefault] = await Promise.all([getLineups(25), getLineups(50)]);
    expect(atFloor.length).toBeGreaterThan(atDefault.length);
  });

  it('offers every picked lineup as a loadable scope', async () => {
    // A picker row that cannot be fetched is a dead option in the UI.
    const lineups = await getLineups(50);
    const row = await getLineup(lineups[0]!.groupId);
    expect(row).not.toBeNull();
  });

  it('offers players ordered by shot count, all loadable', async () => {
    const players = await getPlayers();
    expect(players.length).toBeGreaterThan(0);
    const counts = players.map((player) => player.shotCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);

    const first = players[0]!;
    const name = await playerExists(first.personId);
    expect(name).not.toBeNull();
    const payload = await getPlayerGrain(first.personId, name!);
    expect(payload.scope.grain).toBe('player');
  });
});

describe('the plate captions the scope it is actually showing', () => {
  it('names a different subject for each grain', async () => {
    // "FIVE-MAN UNIT" was hardcoded while the tool only drew lineups. At team and player
    // grain it captioned the wrong subject on an otherwise correct plate — the kind of
    // error that is invisible precisely because everything around it is right.
    const source = await readFile(
      new URL('../src/components/network/CreationNetwork.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('const SUBJECT: Record<Grain, string>');
    // The caption must be derived, not asserted.
    expect(source).not.toContain('CREATION NETWORK · FIVE-MAN UNIT');
  });

  it('does not claim completeness on a thinned plate', async () => {
    // "ALL CONNECTIONS SHOWN" beside "top 18 of 286" is a direct self-contradiction.
    const source = await readFile(
      new URL('../src/components/network/CreationNetwork.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("densityNote ? '' : ' · ALL CONNECTIONS SHOWN'");
  });

  it('scopes the arcs-sum denominator to what is drawn', async () => {
    // Arc shares are computed over the DRAWN edges. On a thinned plate they sum to 100% of
    // those arcs, not of the season — claiming the latter would contradict the density
    // note directly beneath it.
    const source = await readFile(
      new URL('../src/components/network/CreationNetwork.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("densityNote ? 'CREATION SHOWN' : 'ASSISTED CREATION'");
  });

  it('reports the density note against the whole team, not the subgraph', async () => {
    // The conservative denominator is the honest one: these 18 arcs carry ~31% of the
    // Nets' season, even though they are ~64% of the 8-player subgraph drawn.
    const team = await getTeamGrain();
    const { data, note } = scopeForPlate(team, DENSITY.team);
    const drawn = data.edges.reduce((sum, edge) => sum + edge.count, 0);
    const whole = team.edges.reduce((sum, edge) => sum + edge.count, 0);
    expect(note.coverageOfScope).toBeCloseTo((drawn / whole) * 100, 6);

    const keptIds = new Set(data.players.map((player) => player.personId));
    const subgraph = team.edges
      .filter((edge) => keptIds.has(edge.assisterId) && keptIds.has(edge.shooterId))
      .reduce((sum, edge) => sum + edge.count, 0);
    // Guard the direction of the understatement: the note must never flatter the plate.
    expect(note.coverageOfScope).toBeLessThan((drawn / subgraph) * 100);
  });
});

describe('no plate overprints its own labels', () => {
  it('draws every real scope with clear labels', async () => {
    // The claim that matters: not that the separation is a perfect solver, but that on the
    // data this tool actually renders, no two labels land on top of each other. Observed
    // failing before the fix — the Porter Jr. plate overprinted WOLF/TRAORE and
    // SHARPE/CLOWNEY/WILLIAMS into an illegible band.
    const MIN_GAP_Y = 34;
    const X_OVERLAP = 96;

    const players = await getPlayers();
    const lineupRow = await getLineup(TOP_LINEUP);
    const scopes = [
      await getTeamGrain(),
      await getLineupGrain(lineupRow!),
      ...(await Promise.all(
        players.map((player) => getPlayerGrain(player.personId, player.displayName)),
      )),
    ];

    for (const raw of scopes) {
      const { data } = scopeForPlate(raw, DENSITY[raw.scope.grain]);
      const nodes = buildRoleNodes(data);
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          if (Math.abs(a.x - b.x) >= X_OVERLAP) continue;
          expect(
            Math.abs(a.y - b.y),
            `${raw.scope.label}: ${a.name} overprints ${b.name}`,
          ).toBeGreaterThanOrEqual(MIN_GAP_Y - 1e-6);
        }
      }
    }
  }, 300000);
});
