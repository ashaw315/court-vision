import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { assistEdges, lineups, players, shotEvents } from '@/db/schema';
import type {
  AssistedSplit,
  GrainResponse,
  LineupSummary,
  ShotEvent,
} from '@/lib/contracts';

/**
 * Query + shaping for the three grains.
 *
 * The server does the assembling. Every function here returns a bundle the frontend can
 * render directly — assist network, shot map, split — rather than raw tables the browser
 * would have to join. Kept out of the route handlers so the shaping is testable without
 * spinning up HTTP.
 *
 * Query budget: each grain assembles in 3 round trips (shots, edges, players). Nothing
 * loops per-row. The lineup grain adds one lookup for the unit itself.
 */

type ShotRow = typeof shotEvents.$inferSelect;

/** Map a database row to the contract's ShotEvent. Nulls pass through untouched. */
function toShotEvent(row: ShotRow): ShotEvent {
  return {
    gameId: row.gameId,
    eventId: row.eventId,
    period: row.period,
    clock: row.clock,
    shooterId: row.shooterId,
    locX: row.locX,
    locY: row.locY,
    shotValue: row.shotValue as 2 | 3,
    made: row.made,
    assisted: row.assisted,
    // Honest nulls: unassisted / unresolvable stays null, never a sentinel.
    assisterId: row.assisterId,
    shotDistance: row.shotDistance,
    actionType: row.actionType,
    subType: row.subType,
    teamId: row.teamId,
    intervalId: row.intervalId,
  };
}

/**
 * The assisted-vs-unassisted split for a set of shots.
 *
 * Computed server-side so the null-handling rule lives in one place: a made basket tagged
 * assisted whose assister could not be resolved counts as ASSISTED (it just yields no
 * edge). Letting it fall into "self-created" would misstate the split.
 */
export function computeSplit(shots: ShotEvent[]): AssistedSplit {
  const made = shots.filter((s) => s.made);
  const assisted = made.filter((s) => s.assisted);
  const unresolved = assisted.filter((s) => s.assisterId === null);
  return {
    madeBaskets: made.length,
    assisted: assisted.length,
    selfCreated: made.length - assisted.length,
    unresolvedAssisted: unresolved.length,
    // null rather than 0 when nothing was made — "no data" ≠ "0% assisted".
    //
    // Serialization note for the frontend (Phase 7 owns formatting, so the VALUE stays a
    // plain number here): JSON has one number type, so a whole ratio emits as `1`, not
    // `1.0`. Consumers must not assume a decimal point — format with an explicit
    // toFixed/Intl call rather than string-matching the raw value.
    assistedPct: made.length ? assisted.length / made.length : null,
  };
}

/** Distinct games a shot set spans — sample-size context for the UI. */
function countGames(shots: ShotEvent[]): number {
  return new Set(shots.map((s) => s.gameId)).size;
}

/** Every player referenced by these shots or edges, fetched in ONE query (no N+1). */
async function fetchPlayers(personIds: Set<number>) {
  if (personIds.size === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ personId: players.personId, displayName: players.displayName })
    .from(players)
    .where(inArray(players.personId, [...personIds]));
  return rows.sort((a, b) => a.personId - b.personId);
}

function referencedPlayers(
  shots: ShotEvent[],
  edges: Array<{ assisterId: number; shooterId: number }>,
): Set<number> {
  const ids = new Set<number>();
  for (const shot of shots) {
    ids.add(shot.shooterId);
    if (shot.assisterId !== null) ids.add(shot.assisterId);
  }
  for (const edge of edges) {
    ids.add(edge.assisterId);
    ids.add(edge.shooterId);
  }
  return ids;
}

/** Does this player exist? Used to 404 rather than return an empty bundle. */
export async function playerExists(personId: number): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ displayName: players.displayName })
    .from(players)
    .where(eq(players.personId, personId))
    .limit(1);
  return rows.length ? rows[0].displayName : null;
}

/**
 * The player grain: one player's shots, their assist edges in BOTH directions, their split.
 *
 * Both directions matter — "who creates for this player" and "who this player creates for"
 * are the two halves of their role, and a network drawn from only one would misrepresent
 * it.
 */
export async function getPlayerGrain(
  personId: number,
  displayName: string,
): Promise<GrainResponse> {
  const db = getDb();

  const [shotRows, edgeRows] = await Promise.all([
    // Uses shot_events_shooter_idx.
    db.select().from(shotEvents).where(eq(shotEvents.shooterId, personId)),
    // Uses assist_edges_assister_idx / _shooter_idx.
    db
      .select()
      .from(assistEdges)
      .where(
        or(
          eq(assistEdges.assisterId, personId),
          eq(assistEdges.shooterId, personId),
        ),
      ),
  ]);

  const shots = shotRows.map(toShotEvent);
  const edges = edgeRows.map((e) => ({ ...e }));
  const playerRefs = await fetchPlayers(referencedPlayers(shots, edges));

  return {
    scope: { grain: 'player', id: personId, label: displayName },
    edges: edges.sort((a, b) => b.count - a.count),
    shots,
    split: computeSplit(shots),
    players: playerRefs,
    meta: {
      shotCount: shots.length,
      edgeCount: edges.length,
      minutes: null,
      games: countGames(shots),
    },
  };
}

/** The lineup row, or null if the groupId is unknown. */
export async function getLineup(groupId: string): Promise<typeof lineups.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lineups)
    .where(eq(lineups.groupId, groupId))
    .limit(1);
  return rows.length ? rows[0] : null;
}

/**
 * The lineup grain — the capability the whole project is built on.
 *
 * Shots are filtered to the LineupIntervals this exact five was ACTUALLY on court for, via
 * `shot_events.interval_id -> lineup_intervals.on_court`. This is what makes a lineup's
 * assist network real rather than the season-level approximation the original passing-
 * endpoint approach would have forced.
 *
 * Edges are RE-DERIVED from those shots rather than read from `assist_edges`, because that
 * table is season-scoped for the whole team; using it here would silently attribute a
 * player's entire season to whichever unit you were looking at.
 */
export async function getLineupGrain(
  lineup: typeof lineups.$inferSelect,
): Promise<GrainResponse> {
  const db = getDb();

  // One query: shots whose interval's on-court five is exactly this unit.
  // `on_court = $five` compares the sorted int arrays for equality — both sides are stored
  // canonically sorted, which is what makes array equality a valid identity test.
  //
  // The five ids are bound as a parameter, not interpolated. They come from a database row
  // here so they are already trustworthy, but the groupId that selected that row came off
  // the URL, and a query that is only safe because of where its input happened to come
  // from is one refactor away from not being safe.
  // Drizzle expands a JS array inside sql`` as a row constructor ($1,$2,...), not an array
  // literal, so the five ids are joined into an explicit ARRAY[...] with each element
  // still bound as its own parameter.
  const fiveArray = sql`ARRAY[${sql.join(
    lineup.personIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::integer[]`;

  const shotRows = await db
    .select()
    .from(shotEvents)
    .where(
      and(
        isNotNull(shotEvents.intervalId),
        sql`${shotEvents.intervalId} IN (
          SELECT interval_id FROM lineup_intervals
          WHERE on_court = ${fiveArray}
        )`,
      ),
    );

  const shots = shotRows.map(toShotEvent);
  const edges = deriveEdges(shots);
  const playerRefs = await fetchPlayers(referencedPlayers(shots, edges));

  return {
    scope: {
      grain: 'lineup',
      id: lineup.groupId,
      label: lineup.displayNames.join(' · '),
    },
    edges,
    shots,
    split: computeSplit(shots),
    players: playerRefs,
    meta: {
      shotCount: shots.length,
      edgeCount: edges.length,
      minutes: lineup.minutes,
      games: countGames(shots),
    },
  };
}

/**
 * Aggregate shots into directed assister→shooter edges.
 *
 * Mirrors the ETL's `build_assist_edges`, and must stay consistent with it: only made,
 * assisted shots with a RESOLVED assister contribute. An unresolved assist counts in the
 * split but produces no edge — the honest cost of refusing to guess.
 */
export function deriveEdges(shots: ShotEvent[]): GrainResponse['edges'] {
  const pairs = new Map<string, { assisterId: number; shooterId: number; made2: number; made3: number }>();

  for (const shot of shots) {
    if (!shot.made || !shot.assisted || shot.assisterId === null) continue;
    if (shot.assisterId === shot.shooterId) continue;
    const key = `${shot.assisterId}:${shot.shooterId}`;
    const entry = pairs.get(key)
      ?? { assisterId: shot.assisterId, shooterId: shot.shooterId, made2: 0, made3: 0 };
    if (shot.shotValue === 3) entry.made3 += 1;
    else entry.made2 += 1;
    pairs.set(key, entry);
  }

  return [...pairs.values()]
    .map((e) => ({
      assisterId: e.assisterId,
      shooterId: e.shooterId,
      count: e.made2 + e.made3,
      points: 2 * e.made2 + 3 * e.made3,
      made2: e.made2,
      made3: e.made3,
    }))
    .sort((a, b) => b.count - a.count || a.assisterId - b.assisterId);
}

/** The team grain: the whole loaded season. */
export async function getTeamGrain(): Promise<GrainResponse> {
  const db = getDb();

  const [shotRows, edgeRows, playerRows] = await Promise.all([
    db.select().from(shotEvents),
    db.select().from(assistEdges),
    db
      .select({ personId: players.personId, displayName: players.displayName })
      .from(players),
  ]);

  const shots = shotRows.map(toShotEvent);
  const edges = edgeRows.map((e) => ({ ...e })).sort((a, b) => b.count - a.count);

  return {
    scope: { grain: 'team', id: null, label: 'Brooklyn Nets' },
    edges,
    shots,
    split: computeSplit(shots),
    players: playerRows.sort((a, b) => a.personId - b.personId),
    meta: {
      shotCount: shots.length,
      edgeCount: edges.length,
      minutes: null,
      games: countGames(shots),
    },
  };
}

/**
 * Lineups at or above a minutes threshold, with sample-size context.
 *
 * The threshold is the FRONTEND's call — the ETL emits down to a 25-minute floor and this
 * endpoint reports whatever exists above the requested cutoff, so the UI can move the line
 * without a re-run.
 */
export async function getLineups(minMinutes: number): Promise<LineupSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      groupId: lineups.groupId,
      personIds: lineups.personIds,
      minutes: lineups.minutes,
      displayNames: lineups.displayNames,
      shotCount: sql<number>`(
        SELECT count(*)::int FROM shot_events s
        WHERE s.interval_id IN (
          SELECT interval_id FROM lineup_intervals i WHERE i.on_court = ${lineups.personIds}
        )
      )`,
    })
    .from(lineups)
    .where(sql`${lineups.minutes} >= ${minMinutes}`)
    .orderBy(sql`${lineups.minutes} DESC`);

  return rows.map((row) => ({
    groupId: row.groupId,
    personIds: row.personIds as [number, number, number, number, number],
    minutes: row.minutes,
    displayNames: row.displayNames,
    shotCount: Number(row.shotCount),
  }));
}

/** The player picker: every player, with a shot count for ordering/sizing. */
export async function getPlayers() {
  const db = getDb();
  const rows = await db
    .select({
      personId: players.personId,
      displayName: players.displayName,
      shotCount: sql<number>`(
        SELECT count(*)::int FROM shot_events s WHERE s.shooter_id = ${players.personId}
      )`,
    })
    .from(players)
    .orderBy(sql`3 DESC`);

  return rows.map((row) => ({
    personId: row.personId,
    displayName: row.displayName,
    shotCount: Number(row.shotCount),
  }));
}
