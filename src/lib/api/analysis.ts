import { and, eq, or, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { gameTeamValidation, games, players, shotEvents, teamSeasons } from '@/db/schema';
import type {
  DefenseResponse,
  GameLine,
  MatchupResponse,
  ModelInfo,
  SideLine,
  TimelineResponse,
  TrendResponse,
  ValueResponse,
} from '@/lib/contracts/analysis';
import {
  CELL,
  ShotValueModel,
  type CellTally,
} from '@/lib/model/expected-points';

import type { TeamScope } from './queries';

/**
 * Analysis queries: timeline, defence, matchups, trend, and the shot-value model.
 *
 * A game counts for a team only if THAT team's side of it passed validation (the same
 * "drop the whole game" rule the team plates use). The opponent's side is a separate
 * validation result: when it failed, defence for that game is reported as unavailable
 * rather than as zero.
 */

interface ModelBundle {
  model: ShotValueModel;
  info: ModelInfo;
}

const MODEL_TTL_MS = 10 * 60 * 1000;
const modelCache = new Map<string, { at: number; bundle: ModelBundle }>();

/** The season's league-wide model, built from SQL-aggregated cell tallies (a few thousand rows). */
export async function getShotValueModel(season: string): Promise<ModelBundle> {
  const hit = modelCache.get(season);
  if (hit && Date.now() - hit.at < MODEL_TTL_MS) return hit.bundle;

  const db = getDb();
  const rows = await db.execute<{
    cx: number;
    cy: number;
    shot_value: number;
    attempts: number;
    makes: number;
  }>(sql`
    SELECT floor(loc_x / ${sql.raw(String(CELL))}.0)::int AS cx,
           floor(loc_y / ${sql.raw(String(CELL))}.0)::int AS cy,
           shot_value,
           count(*)::int AS attempts,
           sum(CASE WHEN made THEN 1 ELSE 0 END)::int AS makes
    FROM shot_events
    WHERE season = ${season}
    GROUP BY 1, 2, 3
  `);
  const tallies: CellTally[] = rows.rows.map((r) => ({
    cx: Number(r.cx),
    cy: Number(r.cy),
    shotValue: Number(r.shot_value) === 3 ? 3 : 2,
    attempts: Number(r.attempts),
    makes: Number(r.makes),
  }));
  const teamCount = await db.execute<{ n: number }>(
    sql`SELECT count(DISTINCT team_id)::int AS n FROM shot_events WHERE season = ${season}`,
  );
  const model = new ShotValueModel(tallies);
  const bundle = {
    model,
    info: { season, attempts: model.attempts, teams: Number(teamCount.rows[0]?.n ?? 0) },
  };
  modelCache.set(season, { at: Date.now(), bundle });
  return bundle;
}

interface GameShot {
  gameId: string;
  teamId: number;
  locX: number;
  locY: number;
  shotValue: 2 | 3;
  made: boolean;
  assisted: boolean;
  assisterId: number | null;
  shooterId: number;
}

interface TeamGames {
  /** gameId -> meta, only games where this team's own side validated. */
  games: Map<string, { playedOn: string | null; opponentId: number; home: boolean; opponentValidated: boolean }>;
  shots: GameShot[];
}

/** Every validated game of a team-season, plus all shots in those games (both sides). */
async function loadTeamGames(scope: TeamScope): Promise<TeamGames> {
  const db = getDb();
  const gameRows = await db
    .select({
      gameId: games.gameId,
      playedOn: games.playedOn,
      home: games.homeTeamId,
      away: games.awayTeamId,
    })
    .from(games)
    .innerJoin(
      gameTeamValidation,
      and(
        eq(gameTeamValidation.gameId, games.gameId),
        eq(gameTeamValidation.teamId, scope.teamId),
        eq(gameTeamValidation.passed, true),
      ),
    )
    .where(
      and(
        eq(games.season, scope.season),
        or(eq(games.homeTeamId, scope.teamId), eq(games.awayTeamId, scope.teamId)),
      ),
    );

  const opponentPassed = await db
    .select({ gameId: gameTeamValidation.gameId, teamId: gameTeamValidation.teamId })
    .from(gameTeamValidation)
    .where(and(eq(gameTeamValidation.season, scope.season), eq(gameTeamValidation.passed, true)));
  const passedKey = new Set(opponentPassed.map((r) => `${r.gameId}:${r.teamId}`));

  const meta: TeamGames['games'] = new Map();
  for (const g of gameRows) {
    const home = g.home === scope.teamId;
    const opponentId = home ? g.away : g.home;
    meta.set(g.gameId, {
      playedOn: g.playedOn,
      opponentId,
      home,
      opponentValidated: passedKey.has(`${g.gameId}:${opponentId}`),
    });
  }

  const shotRows = await db
    .select({
      gameId: shotEvents.gameId,
      teamId: shotEvents.teamId,
      locX: shotEvents.locX,
      locY: shotEvents.locY,
      shotValue: shotEvents.shotValue,
      made: shotEvents.made,
      assisted: shotEvents.assisted,
      assisterId: shotEvents.assisterId,
      shooterId: shotEvents.shooterId,
    })
    .from(shotEvents)
    .innerJoin(games, eq(games.gameId, shotEvents.gameId))
    .innerJoin(
      gameTeamValidation,
      and(
        eq(gameTeamValidation.gameId, games.gameId),
        eq(gameTeamValidation.teamId, scope.teamId),
        eq(gameTeamValidation.passed, true),
      ),
    )
    .where(
      and(
        eq(shotEvents.season, scope.season),
        or(eq(games.homeTeamId, scope.teamId), eq(games.awayTeamId, scope.teamId)),
      ),
    );

  return {
    games: meta,
    shots: shotRows.map((r) => ({ ...r, shotValue: r.shotValue === 3 ? 3 : 2 })),
  };
}

const emptyLine = (): SideLine => ({
  shots: 0, made: 0, points: 0, threes: 0, madeAssisted: 0, expectedPoints: 0,
});

function addShot(line: SideLine, shot: GameShot, model: ShotValueModel): void {
  line.shots += 1;
  if (shot.shotValue === 3) line.threes += 1;
  if (shot.made) {
    line.made += 1;
    line.points += shot.shotValue;
    if (shot.assisted) line.madeAssisted += 1;
  }
  line.expectedPoints += model.expectedPoints(shot);
}

function addLine(into: SideLine, from: SideLine): void {
  into.shots += from.shots;
  into.made += from.made;
  into.points += from.points;
  into.threes += from.threes;
  into.madeAssisted += from.madeAssisted;
  into.expectedPoints += from.expectedPoints;
}

function buildGameLines(data: TeamGames, scope: TeamScope, model: ShotValueModel): GameLine[] {
  const lines = new Map<string, GameLine>();
  for (const [gameId, m] of data.games) {
    lines.set(gameId, {
      gameId,
      playedOn: m.playedOn,
      opponentId: m.opponentId,
      home: m.home,
      offense: emptyLine(),
      defense: m.opponentValidated ? emptyLine() : null,
    });
  }
  for (const shot of data.shots) {
    const line = lines.get(shot.gameId);
    if (!line) continue;
    if (shot.teamId === scope.teamId) addShot(line.offense, shot, model);
    else if (line.defense) addShot(line.defense, shot, model);
  }
  return [...lines.values()].sort(
    (a, b) => (a.playedOn ?? '').localeCompare(b.playedOn ?? '') || a.gameId.localeCompare(b.gameId),
  );
}

export async function getTimeline(scope: TeamScope): Promise<TimelineResponse> {
  const [data, bundle] = await Promise.all([loadTeamGames(scope), getShotValueModel(scope.season)]);
  return {
    season: scope.season,
    teamId: scope.teamId,
    games: buildGameLines(data, scope, bundle.model),
    model: bundle.info,
  };
}

const toMapShot = (s: GameShot) => ({
  locX: s.locX, locY: s.locY, shotValue: s.shotValue, made: s.made, assisted: s.assisted,
});

export async function getDefense(scope: TeamScope): Promise<DefenseResponse> {
  const [data, bundle] = await Promise.all([loadTeamGames(scope), getShotValueModel(scope.season)]);
  const lines = buildGameLines(data, scope, bundle.model);
  const withDefense = lines.filter((l) => l.defense !== null);
  const usable = new Set(withDefense.map((l) => l.gameId));

  const allowed = emptyLine();
  const byOpponent = new Map<number, { games: number; offense: SideLine; defense: SideLine }>();
  for (const line of withDefense) {
    addLine(allowed, line.defense as SideLine);
    const entry = byOpponent.get(line.opponentId)
      ?? { games: 0, offense: emptyLine(), defense: emptyLine() };
    entry.games += 1;
    addLine(entry.offense, line.offense);
    addLine(entry.defense, line.defense as SideLine);
    byOpponent.set(line.opponentId, entry);
  }

  return {
    season: scope.season,
    teamId: scope.teamId,
    gamesWithDefense: withDefense.length,
    games: lines.length,
    allowed,
    shots: data.shots
      .filter((s) => s.teamId !== scope.teamId && usable.has(s.gameId))
      .map(toMapShot),
    byOpponent: [...byOpponent.entries()]
      .map(([opponentId, e]) => ({ opponentId, ...e }))
      .sort((a, b) => a.opponentId - b.opponentId),
    model: bundle.info,
  };
}

export async function getMatchup(scope: TeamScope, opponentId: number): Promise<MatchupResponse> {
  const [data, bundle] = await Promise.all([loadTeamGames(scope), getShotValueModel(scope.season)]);
  const all = buildGameLines(data, scope, bundle.model).filter((l) => l.opponentId === opponentId);
  const ids = new Set(all.map((l) => l.gameId));
  // Opponent shots count only where the opponent's side validated — the same rule as
  // getDefense, so the map never shows shots the per-game table reports as unavailable.
  const withDefense = new Set(all.filter((l) => l.defense !== null).map((l) => l.gameId));
  return {
    season: scope.season,
    teamId: scope.teamId,
    opponentId,
    games: all,
    teamShots: data.shots
      .filter((s) => ids.has(s.gameId) && s.teamId === scope.teamId)
      .map(toMapShot),
    opponentShots: data.shots
      .filter((s) => withDefense.has(s.gameId) && s.teamId !== scope.teamId)
      .map(toMapShot),
    model: bundle.info,
  };
}

/** Seasons in which this team has loaded data, newest last. */
export async function getTeamSeasonLabels(teamId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ season: teamSeasons.season })
    .from(teamSeasons)
    .where(eq(teamSeasons.teamId, teamId))
    .orderBy(teamSeasons.season);
  return rows.map((r) => r.season);
}

export async function getTrend(teamId: number): Promise<TrendResponse> {
  const seasons = await getTeamSeasonLabels(teamId);
  const out: TrendResponse['seasons'] = [];
  for (const season of seasons) {
    const timeline = await getTimeline({ season, teamId });
    const offense = emptyLine();
    const defense = emptyLine();
    let defenseGames = 0;
    for (const g of timeline.games) {
      addLine(offense, g.offense);
      if (g.defense) {
        addLine(defense, g.defense);
        defenseGames += 1;
      }
    }
    out.push({
      season,
      games: timeline.games.length,
      offense,
      defense: defenseGames > 0 ? defense : null,
      model: timeline.model,
    });
  }
  return { teamId, seasons: out };
}

export async function getValue(scope: TeamScope): Promise<ValueResponse> {
  const [data, bundle] = await Promise.all([loadTeamGames(scope), getShotValueModel(scope.season)]);
  const own = data.shots.filter((s) => s.teamId === scope.teamId);

  const shooters = new Map<number, { attempts: number; actual: number; expected: number }>();
  const creators = new Map<number, { assists: number; points: number; expected: number }>();
  for (const s of own) {
    const x = bundle.model.expectedPoints(s);
    const sh = shooters.get(s.shooterId) ?? { attempts: 0, actual: 0, expected: 0 };
    sh.attempts += 1;
    sh.expected += x;
    if (s.made) sh.actual += s.shotValue;
    shooters.set(s.shooterId, sh);

    // Only resolved assisters: an unresolved assist is never credited to anyone.
    if (s.made && s.assisted && s.assisterId !== null && s.assisterId !== s.shooterId) {
      const c = creators.get(s.assisterId) ?? { assists: 0, points: 0, expected: 0 };
      c.assists += 1;
      c.points += s.shotValue;
      c.expected += x;
      creators.set(s.assisterId, c);
    }
  }

  const db = getDb();
  const ids = new Set([...shooters.keys(), ...creators.keys()]);
  const names = new Map<number, string>();
  if (ids.size > 0) {
    const rows = await db
      .select({ personId: players.personId, displayName: players.displayName })
      .from(players)
      .where(sql`${players.personId} IN (${sql.join([...ids].map((i) => sql`${i}`), sql`, `)})`);
    for (const r of rows) names.set(r.personId, r.displayName);
  }
  const nameOf = (id: number) => names.get(id) ?? String(id);

  return {
    season: scope.season,
    teamId: scope.teamId,
    shooters: [...shooters.entries()]
      .map(([personId, v]) => ({
        personId, displayName: nameOf(personId), attempts: v.attempts,
        actualPoints: v.actual, expectedPoints: v.expected,
      }))
      .sort((a, b) => b.attempts - a.attempts),
    creators: [...creators.entries()]
      .map(([personId, v]) => ({
        personId, displayName: nameOf(personId), assists: v.assists,
        points: v.points, expectedPointsOnAssistedShots: v.expected,
      }))
      .sort((a, b) => b.assists - a.assists),
    model: bundle.info,
  };
}
