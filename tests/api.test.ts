import { beforeAll, describe, expect, it } from 'vitest';

import { GrainResponse, LineupsResponse, PlayersResponse } from '@/lib/contracts';
import {
  computeSplit,
  deriveEdges,
  getLineup,
  getLineupGrain,
  getLineups,
  getPlayerGrain,
  getPlayers,
  getTeamGrain,
  playerExists,
} from '@/lib/api/queries';
import type { ShotEvent } from '@/lib/contracts';

/**
 * API query + shaping tests, against the SEEDED Neon database.
 *
 * These tests need the database and they do NOT skip without it — the Phase 3 lesson was
 * that a test which can silently skip is a test that isn't really committed. `beforeAll`
 * fails the suite with an actionable message if DATABASE_URL is missing or the data is not
 * seeded, so "green" always means "these assertions actually ran".
 *
 * Connection uses the same env loader as the rest of the tooling (`vitest.setup.ts`
 * imports `src/db/env`), so `npm test` works with no extra ceremony.
 *
 * Known seeded values used as anchors — all verified in Phase 4's 24/24 check:
 *   6,089 shots · 286 edges · 22 players · 21 lineups · 66.9% assisted · 4,272 null assisters
 */

const PORTER = 1629008; // Porter Jr., 858 shots — the busiest shooter
const TOP_LINEUP = '-1629008-1629611-1629651-1641730-1642856-'; // 287.2 min
const TOP_FIVE = new Set([1629008, 1629611, 1629651, 1641730, 1642856]);

/**
 * Preflight result, captured rather than thrown.
 *
 * A `beforeAll` that THROWS makes Vitest report every test in the file as SKIPPED, not
 * failed — verified: 27 skipped, 0 failed, exit non-zero but a CI summary reading "0
 * failed". That is precisely the silent-skip trap this project already learned once. So
 * the preflight records the problem and the first real test asserts on it, which produces
 * an actual FAILED test that no summary can misread.
 */
let preflightError: string | null = null;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    preflightError =
      'DATABASE_URL is not set — the API tests need the seeded Neon database. '
      + 'Copy .env.example to .env and fill it in.';
    return;
  }
  try {
    const team = await getTeamGrain();
    if (team.shots.length === 0) {
      preflightError = 'Database is reachable but empty. Run `npm run db:seed`.';
    }
  } catch (error) {
    preflightError =
      `Could not read the seeded database (${error instanceof Error ? error.message : error}). `
      + 'Run `npm run db:migrate && npm run db:seed` first.';
  }
});

describe('database preflight', () => {
  it('can reach the seeded database (these tests fail rather than skip without it)', () => {
    expect(preflightError, preflightError ?? undefined).toBeNull();
  });
});

/** Pure shaping — no database, so the null rules are pinned independently of the data. */
describe('computeSplit', () => {
  const shot = (over: Partial<ShotEvent>): ShotEvent => ({
    gameId: 'g', eventId: 1, period: 1, clock: 'PT11M00.00S', shooterId: 1,
    locX: 0, locY: 0, shotValue: 2, made: true, assisted: false, assisterId: null,
    shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot', teamId: 1,
    intervalId: null, ...over,
  });

  it('counts an unresolved assist as assisted, not self-created', () => {
    // The rule the whole honesty story rests on: the tag was present, so the basket was
    // assisted even though no edge can be drawn from it.
    const split = computeSplit([
      shot({ assisted: true, assisterId: 2 }),
      shot({ assisted: true, assisterId: null }), // tagged, unresolvable
      shot({ assisted: false }),
    ]);
    expect(split.madeBaskets).toBe(3);
    expect(split.assisted).toBe(2);
    expect(split.selfCreated).toBe(1);
    expect(split.unresolvedAssisted).toBe(1);
  });

  it('excludes misses from the split entirely', () => {
    const split = computeSplit([
      shot({ made: false }),
      shot({ made: true, assisted: true, assisterId: 2 }),
    ]);
    expect(split.madeBaskets).toBe(1);
    expect(split.assistedPct).toBe(1);
  });

  it('returns a null percentage when nothing was made, not zero', () => {
    // "No data" and "0% assisted" are different claims.
    expect(computeSplit([shot({ made: false })]).assistedPct).toBeNull();
    expect(computeSplit([]).assistedPct).toBeNull();
  });
});

describe('deriveEdges', () => {
  const made = (assisterId: number | null, shooterId: number, shotValue: 2 | 3): ShotEvent => ({
    gameId: 'g', eventId: 1, period: 1, clock: 'PT11M00.00S', shooterId,
    locX: 0, locY: 0, shotValue, made: true, assisted: assisterId !== null,
    assisterId, shotDistance: 1, actionType: 'Made Shot', subType: 'Jump Shot',
    teamId: 1, intervalId: null,
  });

  it('aggregates a pair and keeps the arithmetic consistent', () => {
    const edges = deriveEdges([made(1, 2, 3), made(1, 2, 3), made(1, 2, 2)]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ count: 3, points: 8, made2: 1, made3: 2 });
  });

  it('treats direction as meaningful', () => {
    expect(deriveEdges([made(1, 2, 2), made(2, 1, 2)])).toHaveLength(2);
  });

  it('drops unresolved assists — no edge without a named assister', () => {
    expect(deriveEdges([made(null, 2, 2)])).toEqual([]);
  });
});

describe('GET /api/player shaping', () => {
  it('returns a contract-valid bundle for a real player', async () => {
    const name = await playerExists(PORTER);
    expect(name).toBe('Porter Jr.');
    const payload = await getPlayerGrain(PORTER, name!);
    expect(GrainResponse.safeParse(payload).success).toBe(true);
  });

  it('scopes shots to that player and reports matching meta', async () => {
    const payload = await getPlayerGrain(PORTER, 'Porter Jr.');
    expect(payload.shots.length).toBe(858);
    expect(payload.meta.shotCount).toBe(payload.shots.length);
    for (const shot of payload.shots) expect(shot.shooterId).toBe(PORTER);
  });

  it('includes edges in BOTH directions', async () => {
    // A player's role is what they create AND what is created for them; one direction
    // alone would misrepresent it.
    const payload = await getPlayerGrain(PORTER, 'Porter Jr.');
    expect(payload.edges.some((e) => e.assisterId === PORTER)).toBe(true);
    expect(payload.edges.some((e) => e.shooterId === PORTER)).toBe(true);
  });

  it('labels every player referenced by edges or shots', async () => {
    // The UI must never need a second request to name a node.
    const payload = await getPlayerGrain(PORTER, 'Porter Jr.');
    const known = new Set(payload.players.map((p) => p.personId));
    for (const edge of payload.edges) {
      expect(known.has(edge.assisterId)).toBe(true);
      expect(known.has(edge.shooterId)).toBe(true);
    }
    for (const shot of payload.shots) {
      expect(known.has(shot.shooterId)).toBe(true);
      if (shot.assisterId !== null) expect(known.has(shot.assisterId)).toBe(true);
    }
  });

  it('preserves null assisters rather than coercing them', async () => {
    const payload = await getPlayerGrain(PORTER, 'Porter Jr.');
    const nulls = payload.shots.filter((s) => s.assisterId === null);
    expect(nulls.length).toBeGreaterThan(0);
    for (const shot of payload.shots) {
      if (shot.assisterId !== null) expect(shot.assisterId).toBeGreaterThan(0);
    }
  });

  it('reports no player for an unknown id, so the route can 404', async () => {
    expect(await playerExists(9_999_999)).toBeNull();
  });
});

describe('GET /api/lineup shaping — the lineup-filtered capability', () => {
  it('returns a contract-valid bundle for a real unit', async () => {
    const lineup = await getLineup(TOP_LINEUP);
    expect(lineup).not.toBeNull();
    const payload = await getLineupGrain(lineup!);
    expect(GrainResponse.safeParse(payload).success).toBe(true);
    expect(payload.meta.minutes).toBeCloseTo(287.2, 1);
  });

  it('includes ONLY shots taken while that exact five was on court', async () => {
    // The assertion the whole project rests on. If this fails, a "lineup network" is
    // really a season network wearing a lineup's name.
    const lineup = await getLineup(TOP_LINEUP);
    const payload = await getLineupGrain(lineup!);
    expect(payload.shots.length).toBeGreaterThan(0);
    for (const shot of payload.shots) {
      expect(TOP_FIVE.has(shot.shooterId)).toBe(true);
      expect(shot.intervalId).not.toBeNull();
    }
  });

  it('derives edges within the unit only, not season-wide', async () => {
    const lineup = await getLineup(TOP_LINEUP);
    const payload = await getLineupGrain(lineup!);
    for (const edge of payload.edges) {
      expect(TOP_FIVE.has(edge.assisterId)).toBe(true);
      expect(TOP_FIVE.has(edge.shooterId)).toBe(true);
    }
  });

  it('produces SMALLER edge counts than the season table for the same pair', async () => {
    // Guards the specific mistake of reading `assist_edges` (season-scoped, whole team)
    // for a lineup: Claxton -> Porter Jr. is 94 across the season but far fewer within
    // any single unit. Equal counts would mean the filter is not being applied.
    const lineup = await getLineup(TOP_LINEUP);
    const lineupPayload = await getLineupGrain(lineup!);
    const team = await getTeamGrain();

    const pair = (edges: typeof team.edges) =>
      edges.find((e) => e.assisterId === 1629651 && e.shooterId === PORTER)?.count ?? 0;

    const seasonCount = pair(team.edges);
    const unitCount = pair(lineupPayload.edges);
    expect(seasonCount).toBeGreaterThan(0);
    expect(unitCount).toBeGreaterThan(0);
    expect(unitCount).toBeLessThan(seasonCount);
  });

  it('agrees with the shot count the lineups list reports', async () => {
    // Two independent queries; if they disagree, one of them is filtering wrongly.
    const [lineup, list] = await Promise.all([getLineup(TOP_LINEUP), getLineups(0)]);
    const payload = await getLineupGrain(lineup!);
    const summary = list.find((l) => l.groupId === TOP_LINEUP);
    expect(summary).toBeDefined();
    expect(payload.shots.length).toBe(summary!.shotCount);
  });

  it('returns null for an unknown groupId, so the route can 404', async () => {
    expect(await getLineup('-1-2-3-4-5-')).toBeNull();
  });
});

describe('GET /api/team shaping', () => {
  it('returns a contract-valid bundle covering the whole season', async () => {
    const payload = await getTeamGrain();
    expect(GrainResponse.safeParse(payload).success).toBe(true);
    expect(payload.shots.length).toBe(6089);
    expect(payload.edges.length).toBe(286);
    expect(payload.meta.games).toBe(72);
  });

  it('matches the season assisted split verified in Phase 4', async () => {
    const payload = await getTeamGrain();
    expect(payload.split.madeBaskets).toBe(2714);
    expect(payload.split.assisted).toBe(1817);
    expect(payload.split.assistedPct).toBeCloseTo(0.669, 3);
  });

  it('preserves all 4,272 null assisters', async () => {
    const payload = await getTeamGrain();
    expect(payload.shots.filter((s) => s.assisterId === null).length).toBe(4272);
  });
});

describe('GET /api/lineups shaping', () => {
  it('returns a contract-valid list', async () => {
    const lineups = await getLineups(50);
    expect(LineupsResponse.safeParse({
      lineups, minMinutes: 50, emitFloorMinutes: 25,
    }).success).toBe(true);
  });

  it('honours the threshold, and the emit floor exposes more units', async () => {
    // The separation that lets the frontend move the display cutoff with no server change.
    const [atFifty, atFloor] = await Promise.all([getLineups(50), getLineups(25)]);
    expect(atFifty.length).toBe(5);
    expect(atFloor.length).toBe(21);
    for (const lineup of atFifty) expect(lineup.minutes).toBeGreaterThanOrEqual(50);
  });

  it('carries minutes and a shot count on every row for sample-size honesty', async () => {
    for (const lineup of await getLineups(25)) {
      expect(lineup.minutes).toBeGreaterThanOrEqual(25);
      expect(lineup.shotCount).toBeGreaterThanOrEqual(0);
      expect(lineup.personIds).toHaveLength(5);
    }
  });

  it('orders by minutes descending', async () => {
    const minutes = (await getLineups(25)).map((l) => l.minutes);
    expect([...minutes].sort((a, b) => b - a)).toEqual(minutes);
  });
});

describe('GET /api/players shaping', () => {
  it('returns a contract-valid picker payload for the full roster', async () => {
    const players = await getPlayers();
    expect(PlayersResponse.safeParse({ players }).success).toBe(true);
    expect(players.length).toBe(22);
  });

  it('orders by shot count so the UI can lead with the primary options', async () => {
    const counts = (await getPlayers()).map((p) => p.shotCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

/**
 * Live route behaviour for the three findings from the targeted API review.
 *
 * These hit the running dev server rather than calling the shaping functions, because the
 * findings were about STATUS CODES and MESSAGES — things only the route produces. They are
 * skipped-proof in the same way as the rest of this file: if the server is not up, the
 * preflight test below fails loudly rather than quietly passing.
 *
 * Start the server first:  npm run dev
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

async function api(path: string) {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.json() };
}

let serverUp = false;

describe('live route behaviour', () => {
  beforeAll(async () => {
    try {
      const response = await fetch(`${BASE}/api/players`);
      serverUp = response.ok;
    } catch {
      serverUp = false;
    }
  });

  it('the dev server is reachable (these tests fail rather than skip without it)', () => {
    expect(
      serverUp,
      `No server at ${BASE}. Run \`npm run dev\` — these route tests assert on status `
        + 'codes, which only the running route produces.',
    ).toBe(true);
  });

  describe('finding 1: out-of-range personId', () => {
    it('returns 400, not 500, for int4 max + 1', async () => {
      const { status, body } = await api('/api/player/2147483648');
      expect(status).toBe(400);
      expect(body.error).toBe('Bad request');
    });

    it('returns 400, not 500, for an absurdly large id', async () => {
      expect((await api('/api/player/999999999999999999999')).status).toBe(400);
    });

    it('still 404s int4 max — a storable id that simply is not present', async () => {
      const { status, body } = await api('/api/player/2147483647');
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
    });

    it('leaks nothing on any rejected id', async () => {
      // "Postgres integer range" is deliberately NOT treated as a leak: naming the
      // constraint tells a caller how to fix their request. A leak is internals a caller
      // cannot act on — SQL text, file paths, connection strings, stack frames.
      for (const path of ['/api/player/2147483648', '/api/player/abc']) {
        const { body } = await api(path);
        const serialized = JSON.stringify(body);
        expect(serialized).not.toMatch(/select |insert |node_modules|\.ts:|\bat \w+ \(/i);
        expect(serialized).not.toMatch(/postgresql:\/\/|neon\.tech|password/i);
      }
    });
  });

  describe('finding 2: minMinutes default', () => {
    it('applies the default when the parameter is absent', async () => {
      const { body } = await api('/api/lineups');
      expect(body.minMinutes).toBe(50);
      expect(body.lineups.length).toBe(5);
    });

    it('applies the default when the parameter is empty', async () => {
      // Previously Number('') === 0 silently returned all 21 units.
      const { body } = await api('/api/lineups?minMinutes=');
      expect(body.minMinutes).toBe(50);
      expect(body.lineups.length).toBe(5);
    });

    it('lets an explicit 25 reach the emit floor', async () => {
      const { body } = await api('/api/lineups?minMinutes=25');
      expect(body.minMinutes).toBe(25);
      expect(body.lineups.length).toBe(21);
    });

    it('honours an explicit 0 as a deliberate request for everything', async () => {
      const { body } = await api('/api/lineups?minMinutes=0');
      expect(body.minMinutes).toBe(0);
      expect(body.lineups.length).toBe(21);
    });
  });

  describe('finding 3: honest 404 detail for an unknown lineup', () => {
    it('does not blame the emit floor for a well-formed unknown groupId', async () => {
      // These five ARE the real 287-minute unit, just unsorted — "below the emit floor"
      // would send someone debugging in entirely the wrong direction.
      const { status, body } = await api(
        '/api/lineup/-1642856-1629008-1641730-1629611-1629651-',
      );
      expect(status).toBe(404);
      // The emit floor may be MENTIONED as one possible cause — what it must not do is
      // lead, as though it were the established reason. Canonical ordering, the actual
      // explanation for this input, must come first.
      const detail: string = body.detail;
      expect(detail).toMatch(/canonical|sorted/i);
      const sortedAt = detail.search(/canonical|sorted/i);
      const floorAt = detail.search(/emit floor/i);
      expect(sortedAt).toBeGreaterThan(-1);
      if (floorAt > -1) expect(sortedAt).toBeLessThan(floorAt);
    });

    it('mentions both real reasons a lookup can miss', async () => {
      const { body } = await api('/api/lineup/-1-2-3-4-5-');
      expect(body.detail).toMatch(/sorted|canonical/i);
      expect(body.detail).toMatch(/25|floor|threshold/i);
    });
  });
});
