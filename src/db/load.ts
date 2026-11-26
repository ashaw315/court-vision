import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { neon } from '@neondatabase/serverless';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { z } from 'zod';

import {
  AssistEdge,
  Lineup,
  LineupInterval,
  Player,
  ShotEvent,
} from '@/lib/contracts';
import { teamById } from '@/lib/teams';

import { databaseUrl } from './env';
import {
  assistEdges,
  gameTeamValidation,
  games,
  lineupIntervals,
  lineups,
  playerTeamSeasons,
  players,
  shotEvents,
  teamSeasons,
} from './schema';

/**
 * Loads ETL output into Neon, one team-season at a time.
 *
 *     npm run db:load -- --season 2025-26 [--teams BKN,BOS] [--dir etl/out] [--dry-run]
 *
 * Reads `<dir>/<season>/teams/<ABBR>.json` as written by `etl/run_season.py`.
 *
 * Idempotent per team-season: everything owned by (season, team) is deleted and re-inserted,
 * so re-running a team replaces it and never touches any other team or season. Shared rows
 * (games, players) are inserted once and left alone afterwards — a game is the same game
 * whichever side loads it first.
 *
 * Like the seed, every record is parsed with the contract schemas BEFORE the database is
 * touched, so a bad file fails loudly instead of half-loading a team. (The Neon HTTP driver
 * has no multi-statement transactions; a crash mid-load leaves that one team-season
 * partial, and the same command repairs it.)
 */

const BATCH_SIZE = 500;

const GameRow = z.object({
  gameId: z.string().min(1),
  season: z.string().min(1),
  gameDate: z.string().min(1),
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  matchup: z.string().min(1),
  homeTeamId: z.number().int(),
  awayTeamId: z.number().int(),
});

const ValidationRow = z.object({
  gameId: z.string().min(1),
  teamId: z.number().int(),
  passed: z.boolean(),
  reasons: z.array(z.string()),
});

const TeamSeasonFile = z.object({
  season: z.string().min(1),
  teamId: z.number().int(),
  abbreviation: z.string().min(2),
  scheduled: z.number().int(),
  games: z.array(GameRow),
  validation: z.array(ValidationRow),
  aggregate: z.object({
    shotEvents: z.array(z.unknown()),
    assistEdges: z.array(z.unknown()),
    lineupIntervals: z.array(z.unknown()),
    lineups: z.array(z.unknown()),
    players: z.array(z.unknown()),
  }),
});

/** `'PT05M18.00S'` -> seconds remaining on the clock. */
function clockSeconds(clock: string | null): number {
  if (clock === null) throw new Error('interval with a null clock cannot be timed');
  const match = /^PT(\d+)M(\d+(?:\.\d+)?)S$/.exec(clock);
  if (!match) throw new Error(`unparseable clock: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseAll<T>(label: string, schema: z.ZodType<T>, records: unknown[]): T[] {
  return records.map((record, index) => {
    const result = schema.safeParse(record);
    if (!result.success) {
      throw new Error(
        `${label}[${index}] violates the contract: ${result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    return result.data;
  });
}

async function insertBatched<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insert(rows.slice(start, start + BATCH_SIZE));
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const season = argValue('season');
  if (!season) throw new Error('usage: npm run db:load -- --season 2025-26 [--teams BKN,BOS]');
  const dir = path.join(process.cwd(), argValue('dir') ?? 'etl/out', season, 'teams');
  const wanted = argValue('teams')?.split(',').map((t) => t.trim().toUpperCase());

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !wanted || wanted.includes(f.replace('.json', '')))
    .sort();
  if (files.length === 0) throw new Error(`no team files found in ${dir}`);

  const dryRun = process.argv.includes('--dry-run');
  const db = drizzle(neon(dryRun ? 'postgres://dry-run@localhost/none' : databaseUrl()));
  console.log(`=== db:load ${season} — ${files.length} team(s) ===\n`);

  for (const file of files) {
    const parsed = TeamSeasonFile.parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    if (parsed.season !== season) throw new Error(`${file}: season mismatch (${parsed.season})`);
    if (!teamById(parsed.teamId)) throw new Error(`${file}: unknown team id ${parsed.teamId}`);

    const { teamId } = parsed;
    const agg = parsed.aggregate;
    // Validate everything first; nothing is written until every record has passed.
    const playerRows = parseAll('players', Player, agg.players);
    const lineupRows = parseAll('lineups', Lineup, agg.lineups);
    const intervalRows = parseAll('lineupIntervals', LineupInterval, agg.lineupIntervals);
    const shotRows = parseAll('shotEvents', ShotEvent, agg.shotEvents);
    const edgeRows = parseAll('assistEdges', AssistEdge, agg.assistEdges);
    const wrongTeam = shotRows.find((s) => s.teamId !== teamId);
    if (wrongTeam) throw new Error(`${file}: shot ${wrongTeam.gameId}/${wrongTeam.eventId} belongs to another team`);

    if (dryRun) {
      console.log(`  ${parsed.abbreviation.padEnd(4)} valid · ${shotRows.length} shots · ${intervalRows.length} intervals · ${edgeRows.length} edges (dry run, nothing written)`);
      continue;
    }

    // ---- clear this team-season (children first) ----
    await db.delete(shotEvents).where(and(eq(shotEvents.season, season), eq(shotEvents.teamId, teamId)));
    await db.delete(assistEdges).where(and(eq(assistEdges.season, season), eq(assistEdges.teamId, teamId)));
    await db.delete(lineupIntervals).where(and(eq(lineupIntervals.season, season), eq(lineupIntervals.teamId, teamId)));
    await db.delete(lineups).where(and(eq(lineups.season, season), eq(lineups.teamId, teamId)));
    await db.delete(playerTeamSeasons).where(and(eq(playerTeamSeasons.season, season), eq(playerTeamSeasons.teamId, teamId)));
    await db.delete(gameTeamValidation).where(and(eq(gameTeamValidation.season, season), eq(gameTeamValidation.teamId, teamId)));

    // ---- shared rows: first writer wins ----
    await insertBatched(playerRows, (batch) =>
      db.insert(players).values(batch).onConflictDoNothing());
    await insertBatched(parsed.games, (batch) =>
      db.insert(games).values(batch).onConflictDoNothing());

    // ---- team-owned rows ----
    await insertBatched(parsed.validation, (batch) =>
      db.insert(gameTeamValidation).values(batch.map((v) => ({ ...v, season }))));
    await insertBatched(playerRows, (batch) =>
      db.insert(playerTeamSeasons).values(batch.map((p) => ({ personId: p.personId, teamId, season }))));
    await insertBatched(lineupRows, (batch) =>
      db.insert(lineups).values(batch.map((l) => ({
        season, teamId, groupId: l.groupId, personIds: [...l.personIds], minutes: l.minutes,
        displayNames: [...l.displayNames],
      }))));
    await insertBatched(intervalRows, (batch) =>
      db.insert(lineupIntervals).values(batch.map((i) => ({
        season, teamId, intervalId: i.intervalId, gameId: i.gameId, period: i.period,
        startClock: i.startClock, endClock: i.endClock, onCourt: [...i.onCourt],
        durationSeconds: clockSeconds(i.startClock) - clockSeconds(i.endClock),
      }))));
    await insertBatched(shotRows, (batch) =>
      db.insert(shotEvents).values(batch.map((s) => ({ ...s, season }))));
    await insertBatched(edgeRows, (batch) =>
      db.insert(assistEdges).values(batch.map((e) => ({ ...e, season, teamId }))));

    const validated = parsed.validation.filter((v) => v.passed).length;
    const summary = {
      gamesScheduled: parsed.scheduled,
      gamesValidated: validated,
      gamesExcluded: parsed.validation.length - validated,
      lastLoadedAt: new Date(),
      failures: parsed.validation.filter((v) => !v.passed),
    };
    await db.insert(teamSeasons)
      .values({ season, teamId, ...summary })
      .onConflictDoUpdate({ target: [teamSeasons.season, teamSeasons.teamId], set: summary });

    console.log(
      `  ${parsed.abbreviation.padEnd(4)} ${validated}/${parsed.scheduled} games · `
      + `${shotRows.length} shots · ${intervalRows.length} intervals · ${edgeRows.length} edges`,
    );
  }
  console.log('\nload complete');
}

main().catch((error) => {
  console.error('\nLOAD FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
