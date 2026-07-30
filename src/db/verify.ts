import { readFileSync } from 'node:fs';
import path from 'node:path';

import { neon } from '@neondatabase/serverless';

import { databaseUrl } from './env';

/**
 * Verifies the seeded database against the source JSON.
 *
 *     npm run db:verify
 *
 * Every expectation is computed FROM THE DATASET, not hard-coded, so this stays honest if
 * the data is ever regenerated — a check that asserts a magic number would silently pass
 * on stale figures. Counts, orphan checks and spot-checks all fail loudly and set a
 * non-zero exit code.
 */

const DATASET = path.join(process.cwd(), 'data', 'season.json');

type Check = { name: string; passed: boolean; detail: string };

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(DATASET, 'utf8'));
  const sql = neon(databaseUrl());
  const checks: Check[] = [];

  const check = (name: string, passed: boolean, detail = '') =>
    checks.push({ name, passed, detail });

  console.log('=== Phase 4 seed verification ===\n');

  // ---------------- row counts ----------------
  console.log('row counts (database vs JSON):');
  const tables: Array<[string, string, number]> = [
    ['players', 'players', raw.players.length],
    ['games', 'games', raw.games.length],
    ['lineups', 'lineups', raw.lineups.length],
    ['lineup_intervals', 'lineupIntervals', raw.lineupIntervals.length],
    ['shot_events', 'shotEvents', raw.shotEvents.length],
    ['assist_edges', 'assistEdges', raw.assistEdges.length],
  ];

  for (const [table, , expected] of tables) {
    const rows = await sql.query(`select count(*)::int as n from ${table}`);
    const actual = rows[0].n as number;
    const ok = actual === expected;
    console.log(
      `  ${table.padEnd(17)} db=${String(actual).padStart(5)}  `
        + `json=${String(expected).padStart(5)}  ${ok ? 'match' : 'MISMATCH'}`,
    );
    check(`${table} row count`, ok, `db=${actual} json=${expected}`);
  }

  // ---------------- orphaned foreign keys ----------------
  // The FK constraints make most of these impossible by construction; running them anyway
  // proves the constraints are actually present rather than assumed.
  console.log('\norphan checks:');
  const orphanQueries: Array<[string, string]> = [
    [
      'shot_events.shooter_id -> players',
      'select count(*)::int n from shot_events s left join players p on s.shooter_id = p.person_id where p.person_id is null',
    ],
    [
      'shot_events.assister_id -> players (non-null only)',
      'select count(*)::int n from shot_events s left join players p on s.assister_id = p.person_id where s.assister_id is not null and p.person_id is null',
    ],
    [
      'shot_events.game_id -> games',
      'select count(*)::int n from shot_events s left join games g on s.game_id = g.game_id where g.game_id is null',
    ],
    [
      'shot_events.interval_id -> lineup_intervals (non-null only)',
      'select count(*)::int n from shot_events s left join lineup_intervals i on s.interval_id = i.interval_id where s.interval_id is not null and i.interval_id is null',
    ],
    [
      'lineup_intervals.game_id -> games',
      'select count(*)::int n from lineup_intervals i left join games g on i.game_id = g.game_id where g.game_id is null',
    ],
    [
      'assist_edges.assister_id -> players',
      'select count(*)::int n from assist_edges e left join players p on e.assister_id = p.person_id where p.person_id is null',
    ],
    [
      'assist_edges.shooter_id -> players',
      'select count(*)::int n from assist_edges e left join players p on e.shooter_id = p.person_id where p.person_id is null',
    ],
    // The array columns carry no FK, so these are the checks the database cannot do.
    [
      'lineups.person_ids -> players (array, no FK)',
      'select count(*)::int n from (select unnest(person_ids) pid from lineups) x left join players p on x.pid = p.person_id where p.person_id is null',
    ],
    [
      'lineup_intervals.on_court -> players (array, no FK)',
      'select count(*)::int n from (select unnest(on_court) pid from lineup_intervals) x left join players p on x.pid = p.person_id where p.person_id is null',
    ],
  ];

  for (const [label, query] of orphanQueries) {
    const rows = await sql.query(query);
    const orphans = rows[0].n as number;
    console.log(`  ${label.padEnd(48)} ${orphans === 0 ? 'clean' : `${orphans} ORPHANS`}`);
    check(`no orphans: ${label}`, orphans === 0, `${orphans} orphaned rows`);
  }

  // ---------------- honesty nulls survived the load ----------------
  console.log('\nhonesty nulls (must be NULL, never a sentinel):');
  const jsonNullAssisters = raw.shotEvents.filter(
    (s: { assisterId: number | null }) => s.assisterId === null,
  ).length;
  const jsonNullIntervals = raw.shotEvents.filter(
    (s: { intervalId: string | null }) => s.intervalId === null,
  ).length;

  const dbNullAssisters = (
    await sql.query('select count(*)::int n from shot_events where assister_id is null')
  )[0].n as number;
  const dbNullIntervals = (
    await sql.query('select count(*)::int n from shot_events where interval_id is null')
  )[0].n as number;

  console.log(
    `  null assister_id   db=${dbNullAssisters}  json=${jsonNullAssisters}  `
      + `${dbNullAssisters === jsonNullAssisters ? 'match' : 'MISMATCH'}`,
  );
  check('null assisters preserved', dbNullAssisters === jsonNullAssisters,
    `db=${dbNullAssisters} json=${jsonNullAssisters}`);
  console.log(
    `  null interval_id   db=${dbNullIntervals}  json=${jsonNullIntervals}  `
      + `${dbNullIntervals === jsonNullIntervals ? 'match' : 'MISMATCH'}`,
  );
  check('null intervals preserved', dbNullIntervals === jsonNullIntervals,
    `db=${dbNullIntervals} json=${jsonNullIntervals}`);

  // No negative ids anywhere a sentinel would have been written.
  const sentinels = (
    await sql.query(
      'select count(*)::int n from shot_events where shooter_id <= 0 or assister_id <= 0',
    )
  )[0].n as number;
  console.log(`  sentinel ids (<= 0)  ${sentinels === 0 ? 'none' : `${sentinels} FOUND`}`);
  check('no sentinel ids', sentinels === 0, `${sentinels} rows`);

  // ---------------- spot checks ----------------
  console.log('\nspot checks:');

  // 1. The top lineup's minutes must survive the round trip exactly.
  const topLineup = [...raw.lineups].sort(
    (a: { minutes: number }, b: { minutes: number }) => b.minutes - a.minutes,
  )[0];
  const dbTop = await sql.query(
    'select group_id, minutes, person_ids, display_names from lineups order by minutes desc limit 1',
  );
  const minutesMatch = Math.abs((dbTop[0].minutes as number) - topLineup.minutes) < 1e-6;
  const groupMatch = dbTop[0].group_id === topLineup.groupId;
  console.log(
    `  top lineup ${dbTop[0].minutes} min — ${(dbTop[0].display_names as string[]).join(', ')}`,
  );
  check('top lineup matches JSON', minutesMatch && groupMatch,
    `db=${dbTop[0].group_id}@${dbTop[0].minutes} json=${topLineup.groupId}@${topLineup.minutes}`);

  // 2. A known assisted shot keeps its assister through the load.
  const assistedShot = raw.shotEvents.find(
    (s: { assisted: boolean; assisterId: number | null }) =>
      s.assisted && s.assisterId !== null,
  );
  const dbShot = await sql.query(
    `select s.assister_id, s.made, s.assisted, p.display_name shooter, a.display_name assister
     from shot_events s
     join players p on p.person_id = s.shooter_id
     left join players a on a.person_id = s.assister_id
     where s.game_id = '${assistedShot.gameId}' and s.event_id = ${assistedShot.eventId}`,
  );
  const assisterMatch = dbShot.length === 1
    && dbShot[0].assister_id === assistedShot.assisterId;
  console.log(
    `  assisted shot ${assistedShot.gameId}#${assistedShot.eventId}: `
      + `${dbShot[0]?.assister} -> ${dbShot[0]?.shooter} (assister_id ${dbShot[0]?.assister_id})`,
  );
  check('assisted shot keeps its assister', assisterMatch,
    `db=${dbShot[0]?.assister_id} json=${assistedShot.assisterId}`);

  // 3. The largest assist edge round-trips, arithmetic intact.
  const topEdge = [...raw.assistEdges].sort(
    (a: { count: number }, b: { count: number }) => b.count - a.count,
  )[0];
  const dbEdge = await sql.query(
    `select e.count, e.points, e.made_2, e.made_3, a.display_name assister, s.display_name shooter
     from assist_edges e
     join players a on a.person_id = e.assister_id
     join players s on s.person_id = e.shooter_id
     order by e.count desc limit 1`,
  );
  const edgeMatch = dbEdge[0].count === topEdge.count && dbEdge[0].points === topEdge.points;
  console.log(
    `  top edge ${dbEdge[0].assister} -> ${dbEdge[0].shooter}: `
      + `${dbEdge[0].count} baskets, ${dbEdge[0].points} pts`,
  );
  check('top assist edge matches JSON', edgeMatch,
    `db=${dbEdge[0].count}/${dbEdge[0].points} json=${topEdge.count}/${topEdge.points}`);

  // 4. Every lineup carries exactly five players (array cardinality the contract requires).
  const badCardinality = (
    await sql.query(
      'select count(*)::int n from lineups where array_length(person_ids, 1) <> 5 '
        + 'or array_length(display_names, 1) <> 5',
    )
  )[0].n as number;
  console.log(`  lineups with exactly 5 players  ${badCardinality === 0 ? 'all' : `${badCardinality} BAD`}`);
  check('lineup arrays hold five', badCardinality === 0, `${badCardinality} rows`);

  const badInterval = (
    await sql.query('select count(*)::int n from lineup_intervals where array_length(on_court, 1) <> 5')
  )[0].n as number;
  console.log(`  intervals with exactly 5 on court  ${badInterval === 0 ? 'all' : `${badInterval} BAD`}`);
  check('interval arrays hold five', badInterval === 0, `${badInterval} rows`);

  // 5. Aggregate sanity: the assisted split recomputed IN SQL must match the ETL's report.
  const dbSplit = await sql.query(
    'select count(*) filter (where made)::int made, '
      + 'count(*) filter (where made and assisted)::int assisted from shot_events',
  );
  const splitMatch = dbSplit[0].made === raw.assistedSplit.madeBaskets
    && dbSplit[0].assisted === raw.assistedSplit.assisted;
  console.log(
    `  assisted split in SQL: ${dbSplit[0].assisted}/${dbSplit[0].made} made baskets `
      + `(${((dbSplit[0].assisted / dbSplit[0].made) * 100).toFixed(1)}%)`,
  );
  check('assisted split matches the ETL report', splitMatch,
    `db=${dbSplit[0].assisted}/${dbSplit[0].made} `
      + `json=${raw.assistedSplit.assisted}/${raw.assistedSplit.madeBaskets}`);

  // ---------------- report ----------------
  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const c of failed) console.log(`  ${c.name} — ${c.detail}`);
    process.exit(1);
  }
  console.log('database matches the source dataset');
}

main().catch((error) => {
  console.error('\nVERIFY FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
