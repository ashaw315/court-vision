import { beforeAll, describe, expect, it } from 'vitest';

import { getDefense, getMatchup, getTimeline, getTrend, getValue } from '@/lib/api/analysis';
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

  it('reports no defensive data rather than zeros when opponents are not loaded', async () => {
    const timeline = await getTimeline(NETS);
    // Only the Nets are loaded in the sample, so no opponent side has validated.
    expect(timeline.games.every((g) => g.defense === null)).toBe(true);
    const defense = await getDefense(NETS);
    expect(defense.gamesWithDefense).toBe(0);
    expect(defense.shots).toHaveLength(0);
    expect(defense.games).toBe(72);
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
  });

  it('trend lists the loaded seasons for the team', async () => {
    const trend = await getTrend(NETS.teamId);
    expect(TrendResponse.safeParse(trend).success).toBe(true);
    expect(trend.seasons.map((s) => s.season)).toContain('2025-26');
    expect(trend.seasons[0].defense).toBeNull();
  });
});
