import { beforeAll, describe, expect, it } from 'vitest';

import { getDefense, getMatchup, getTimeline, getTrend, getValue } from '@/lib/api/analysis';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { gameTeamValidation } from '@/db/schema';
import { teamByAbbreviation } from '@/lib/teams';
import { TimelineResponse, TrendResponse, ValueResponse } from '@/lib/contracts/analysis';

import { NETS } from './helpers/scope';

/**
 * Analysis queries against the seeded sample (Nets 2025-26 only). Needs the database, like
 * api.test.ts; the first test fails loudly rather than letting the file skip.
 */
let preflightError: string | null = null;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    preflightError = 'DATABASE_URL is not set — these tests need the seeded Neon database.';
    return;
  }
  try {
    const t = await getTimeline(NETS);
    if (t.games.length === 0) preflightError = 'No games found. Run `npm run db:seed`.';
  } catch (error) {
    preflightError = `Could not reach the database: ${(error as Error).message}`;
  }
});

describe('analysis queries', () => {
  it('has a seeded database', () => {
    expect(preflightError).toBeNull();
  });

  it('timeline covers the 72 validated games and matches the contract', async () => {
    const timeline = await getTimeline(NETS);
    expect(TimelineResponse.safeParse(timeline).success).toBe(true);
    expect(timeline.games).toHaveLength(72);
    const shots = timeline.games.reduce((n, g) => n + g.offense.shots, 0);
    expect(shots).toBe(6089);
  });

  /** `${gameId}:${teamId}` for every team-game side that passed validation this season. */
  async function validatedSides(): Promise<Set<string>> {
    const rows = await getDb()
      .select({ gameId: gameTeamValidation.gameId, teamId: gameTeamValidation.teamId })
      .from(gameTeamValidation)
      .where(and(eq(gameTeamValidation.season, NETS.season), eq(gameTeamValidation.passed, true)));
    return new Set(rows.map((r) => `${r.gameId}:${r.teamId}`));
  }

  it('reports defensive data exactly where the opponent side validated, never zeros', async () => {
    // Holds for the Nets-only sample (no opponent loaded: every game null) and for a branch
    // with real opponents loaded (a game has data iff that opponent's side passed).
    const passed = await validatedSides();
    const timeline = await getTimeline(NETS);
    for (const g of timeline.games) {
      const opponentPassed = passed.has(`${g.gameId}:${g.opponentId}`);
      expect(g.defense !== null, `game ${g.gameId}`).toBe(opponentPassed);
      if (g.defense) expect(g.defense.shots).toBeGreaterThan(0);
    }
    const withData = timeline.games.filter((g) => g.defense !== null).length;
    const defense = await getDefense(NETS);
    expect(defense.gamesWithDefense).toBe(withData);
    expect(defense.games).toBe(72);
    if (withData === 0) expect(defense.shots).toHaveLength(0);
  });

  it('matchup shows opponent shots only from games with defensive data', async () => {
    const matchup = await getMatchup(NETS, teamByAbbreviation('BOS')!.teamId);
    expect(matchup.games.length).toBeGreaterThan(0);
    const defensiveShots = matchup.games.reduce((n, g) => n + (g.defense ? g.defense.shots : 0), 0);
    expect(matchup.opponentShots).toHaveLength(defensiveShots);
    const teamShots = matchup.games.reduce((n, g) => n + g.offense.shots, 0);
    expect(matchup.teamShots).toHaveLength(teamShots);
  });

  it('shot-making sums to the team total', async () => {
    const value = await getValue(NETS);
    expect(ValueResponse.safeParse(value).success).toBe(true);
    const attempts = value.shooters.reduce((n, s) => n + s.attempts, 0);
    expect(attempts).toBe(6089);
    // Only resolved assisters are credited: fewer credited assists than assisted makes.
    const credited = value.creators.reduce((n, c) => n + c.assists, 0);
    expect(credited).toBeGreaterThan(0);
    expect(credited).toBeLessThan(6089);
    // Each credited basket is a two or a three, so points = 2 x assists + threes.
    for (const c of value.creators) {
      expect(c.threes).toBeLessThanOrEqual(c.assists);
      expect(c.points).toBe(2 * c.assists + c.threes);
    }
  });

  it('trend lists the loaded seasons for the team', async () => {
    const trend = await getTrend(NETS.teamId);
    expect(TrendResponse.safeParse(trend).success).toBe(true);
    expect(trend.seasons.map((s) => s.season)).toContain('2025-26');
    // Unavailable, not zero: a season with no validated opponent side has null defence.
    const timeline = await getTimeline(NETS);
    const anyDefense = timeline.games.some((g) => g.defense !== null);
    const season = trend.seasons.find((s) => s.season === NETS.season)!;
    expect(season.defense === null).toBe(!anyDefense);
  });
});
