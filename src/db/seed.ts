import { readFileSync } from 'node:fs';
import path from 'node:path';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { z } from 'zod';

import {
  AssistEdge,
  Lineup,
  LineupInterval,
  Player,
  ShotEvent,
} from '@/lib/contracts';

import { databaseUrl } from './env';
import {
  assistEdges,
  games,
  lineupIntervals,
  lineups,
  players,
  shotEvents,
} from './schema';

/**
 * Seeds Neon from the committed season dataset.
 *
 *     npm run db:seed
 *
 * Runs LOCALLY and manually. The season is over and the data is static, so this is a
 * one-shot load, not a pipeline. The deployed app only ever reads from Neon — never this
 * file, never the NBA endpoints.
 *
 * Two properties:
 *
 *   * **Contract-validated at the boundary.** Every record is parsed with the Phase 2 Zod
 *     schemas before it reaches SQL. A record that fails is a HARD ERROR — never coerced,
 *     never skipped. The contract has already been enforced in the ETL and in the
 *     TypeScript tests; enforcing it once more here means the database cannot be the place
 *     a bad shape first appears.
 *
 *   * **Idempotent by truncate-and-reload.** Re-running produces exactly the same database,
 *     which is the property that makes "fresh clone + migrate + seed" reproducible. Upsert
 *     was the alternative and was rejected: with static data it adds per-row conflict
 *     handling to solve a problem that does not exist, and it would silently leave behind
 *     rows deleted from the source. TRUNCATE ... CASCADE is honest about replacing
 *     everything.
 */

const DATASET = path.join(process.cwd(), 'data', 'season.json');

// Batch size for multi-row inserts. Postgres caps a statement at 65,535 bound parameters;
// shot_events binds 16 columns, so 500 rows = 8,000 parameters — comfortably clear while
// still cutting 6,089 shots down to 13 round trips rather than 6,089.
const BATCH_SIZE = 500;

/** Game metadata is dataset-local (not a Phase 2 entity), so it gets a schema here. */
const GameRecord = z.object({
  gameId: z.string().min(1),
  gameDate: z.string().nullable(),
  matchup: z.string().nullable(),
});
type GameRecord = z.infer<typeof GameRecord>;

/**
 * Parse every record or fail loudly, naming the entity and index.
 *
 * The failure message has to be actionable: "record 4,821 of shotEvents" plus the Zod
 * issue, not "validation failed".
 */
function validateAll<T>(
  label: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: z.ZodError } },
  records: unknown[],
): T[] {
  const parsed: T[] = [];
  for (const [index, record] of records.entries()) {
    const result = schema.safeParse(record);
    if (!result.success) {
      const issues = result.error!.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `${label}[${index}] failed contract validation — ${issues}\n`
          + `  record: ${JSON.stringify(record)}`,
      );
    }
    parsed.push(result.data!);
  }
  return parsed;
}

async function insertBatched<T>(
  label: string,
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insert(rows.slice(start, start + BATCH_SIZE));
  }
  console.log(`  ${label.padEnd(17)} ${String(rows.length).padStart(5)} rows`);
}

async function main(): Promise<void> {
  console.log('=== Phase 4 seed ===\n');

  const raw = JSON.parse(readFileSync(DATASET, 'utf8'));
  console.log(`dataset: ${path.relative(process.cwd(), DATASET)}\n`);

  // ---------------- validate BEFORE touching the database ----------------
  // Nothing is written until every record has passed, so a bad dataset cannot leave the
  // database half-loaded.
  console.log('validating against the Phase 2 contract:');
  const gameRows = validateAll<GameRecord>('games', GameRecord, raw.games);
  const playerRows = validateAll<Player>('players', Player, raw.players);
  const lineupRows = validateAll<Lineup>('lineups', Lineup, raw.lineups);
  const intervalRows = validateAll<LineupInterval>(
    'lineupIntervals',
    LineupInterval,
    raw.lineupIntervals,
  );
  const shotRows = validateAll<ShotEvent>('shotEvents', ShotEvent, raw.shotEvents);
  const edgeRows = validateAll<AssistEdge>('assistEdges', AssistEdge, raw.assistEdges);
  console.log(
    `  all ${(
      gameRows.length + playerRows.length + lineupRows.length
      + intervalRows.length + shotRows.length + edgeRows.length
    ).toLocaleString()} records valid\n`,
  );

  // The array columns cannot carry a foreign key, so the ids they hold are checked here
  // — the honest cost of the array choice, paid explicitly rather than assumed away.
  const knownPlayers = new Set(playerRows.map((p) => p.personId));
  for (const lineup of lineupRows) {
    for (const personId of lineup.personIds) {
      if (!knownPlayers.has(personId)) {
        throw new Error(`lineup ${lineup.groupId} references unknown player ${personId}`);
      }
    }
  }
  for (const interval of intervalRows) {
    for (const personId of interval.onCourt) {
      if (!knownPlayers.has(personId)) {
        throw new Error(
          `interval ${interval.intervalId} references unknown player ${personId}`,
        );
      }
    }
  }
  console.log('  array-column player references check out (no DB-enforceable FK there)\n');

  const db = drizzle(neon(databaseUrl()));

  // ---------------- reload ----------------
  // CASCADE handles the dependency order for us; RESTART IDENTITY is a no-op here (no
  // serial columns) but keeps the statement correct if one is ever added.
  console.log('truncating (idempotent reload):');
  await db.execute(
    'TRUNCATE TABLE shot_events, assist_edges, lineup_intervals, lineups, games, players '
      + 'RESTART IDENTITY CASCADE',
  );
  console.log('  all tables cleared\n');

  // ---------------- insert, FK-safe order ----------------
  console.log('inserting (parents first):');

  await insertBatched('players', playerRows, (batch) =>
    db.insert(players).values(batch));

  await insertBatched('games', gameRows, (batch) =>
    db.insert(games).values(batch));

  await insertBatched('lineups', lineupRows, (batch) =>
    db.insert(lineups).values(
      batch.map((lineup) => ({
        groupId: lineup.groupId,
        personIds: [...lineup.personIds],
        minutes: lineup.minutes,
        displayNames: [...lineup.displayNames],
      })),
    ));

  await insertBatched('lineup_intervals', intervalRows, (batch) =>
    db.insert(lineupIntervals).values(
      batch.map((interval) => ({
        intervalId: interval.intervalId,
        gameId: interval.gameId,
        period: interval.period,
        startClock: interval.startClock,
        endClock: interval.endClock,
        onCourt: [...interval.onCourt],
      })),
    ));

  // Shots reference games, players AND intervals, so they come after all three.
  await insertBatched('shot_events', shotRows, (batch) =>
    db.insert(shotEvents).values(
      batch.map((shot) => ({
        gameId: shot.gameId,
        eventId: shot.eventId,
        period: shot.period,
        clock: shot.clock,
        shooterId: shot.shooterId,
        locX: shot.locX,
        locY: shot.locY,
        shotValue: shot.shotValue,
        shotDistance: shot.shotDistance,
        made: shot.made,
        assisted: shot.assisted,
        // Passed through as-is: null stays null. No sentinel, ever.
        assisterId: shot.assisterId,
        actionType: shot.actionType,
        subType: shot.subType,
        teamId: shot.teamId,
        intervalId: shot.intervalId,
      })),
    ));

  await insertBatched('assist_edges', edgeRows, (batch) =>
    db.insert(assistEdges).values(batch));

  console.log('\nseed complete — run `npm run db:verify` to check it against the JSON');
}

main().catch((error) => {
  console.error('\nSEED FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
