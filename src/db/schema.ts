import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Relational model of the Phase 2 contract (`src/lib/contracts`).
 *
 * The contract stays the source of truth for SHAPE — the seed validates every record
 * against the Zod schemas before insert, so these tables cannot silently drift into a
 * different vocabulary. What this file adds is what a contract cannot express: real
 * foreign keys, so the database itself refuses to hold a shot by a player who does not
 * exist or a lineup interval belonging to no game.
 *
 * Two modelling decisions worth stating plainly, both load-bearing:
 *
 * 1. **The honesty nulls are TRUE NULL columns.** `shot_events.assister_id` and
 *    `shot_events.interval_id` are nullable, never a -1/0 sentinel. Phase 3 works hard to
 *    emit null where the source genuinely does not tell us who assisted or which five was
 *    on court; a sentinel would turn "we don't know" into a claim about person -1, which
 *    is exactly the fabrication the project refuses. In this dataset 4,272 of 6,089 shots
 *    have a null assister (unassisted or unresolvable) — that is real data, not a gap.
 *
 * 2. **The five person ids are an ARRAY column, not a join table.** Justified in the
 *    comment on `lineups.person_ids` below.
 */

/**
 * The 30 NBA franchises. Reference data seeded by the migration itself, keyed by the NBA's
 * own team id so every `team_id` column in the schema joins straight to it.
 */
export const teams = pgTable('teams', {
  teamId: integer('team_id').primaryKey(),
  abbreviation: text('abbreviation').notNull().unique(),
  city: text('city').notNull(),
  name: text('name').notNull(),
  conference: text('conference').notNull(),
  division: text('division').notNull(),
});

/**
 * One team's one season: what was scheduled, what passed validation, when it was last
 * loaded. Replaces the single-season `SEASON_LABEL` constant and the manifest that used to
 * live inside `data/season.json`, so the scope line and the exclusions note work per
 * team-season.
 */
export const teamSeasons = pgTable(
  'team_seasons',
  {
    season: text('season').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),
    seasonType: text('season_type').notNull().default('Regular Season'),
    gamesScheduled: integer('games_scheduled').notNull(),
    gamesValidated: integer('games_validated').notNull(),
    gamesExcluded: integer('games_excluded').notNull(),
    /** When the ETL output for this team-season was last loaded. */
    lastLoadedAt: timestamp('last_loaded_at', { withTimezone: true }),
    /** The ETL's failure list for this team-season, kept as reported. */
    failures: jsonb('failures').$type<unknown[]>().notNull().default([]),
  },
  (table) => [primaryKey({ columns: [table.season, table.teamId] })],
);

/** A player. `personId` is the only join key anywhere — never a name. */
export const players = pgTable('players', {
  personId: integer('person_id').primaryKey(),
  displayName: text('display_name').notNull(),
});

/**
 * One game. A game exists once however many of its two sides were loaded; which sides
 * passed validation is recorded per side in `game_team_validation`.
 */
export const games = pgTable(
  'games',
  {
    gameId: text('game_id').primaryKey(),
    season: text('season').notNull(),
    /** As the source reports it, e.g. "NOV 07, 2025". Kept verbatim. */
    gameDate: text('game_date'),
    /** The same date as a real date, for ordering and the season timeline. */
    playedOn: date('played_on'),
    /** e.g. "BKN vs. DET" / "BKN @ CHA". */
    matchup: text('matchup'),
    homeTeamId: integer('home_team_id')
      .notNull()
      .references(() => teams.teamId),
    awayTeamId: integer('away_team_id')
      .notNull()
      .references(() => teams.teamId),
  },
  (table) => [
    index('games_season_idx').on(table.season),
    index('games_home_idx').on(table.season, table.homeTeamId),
    index('games_away_idx').on(table.season, table.awayTeamId),
  ],
);

/**
 * Validation is per SIDE of a game: one team's substitution clocks can be contradictory
 * while the other's are clean, so a game can pass for one team and fail for the other.
 */
export const gameTeamValidation = pgTable(
  'game_team_validation',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.gameId, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),
    season: text('season').notNull(),
    passed: boolean('passed').notNull(),
    /** Why a side failed; empty when it passed. */
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.teamId] }),
    index('game_team_validation_team_idx').on(table.season, table.teamId),
  ],
);

/**
 * Who was on which team in which season. A traded player has two rows in one season, which
 * is what keeps his networks with each team separate.
 */
export const playerTeamSeasons = pgTable(
  'player_team_seasons',
  {
    personId: integer('person_id')
      .notNull()
      .references(() => players.personId),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),
    season: text('season').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.personId, table.teamId, table.season] }),
    index('player_team_seasons_team_idx').on(table.season, table.teamId),
  ],
);

/**
 * A five-man unit that cleared the ETL emit floor (25 minutes).
 *
 * ARRAY vs JOIN TABLE — chosen: array.
 * The set is fixed at exactly five, immutable (the season is over and this data will never
 * change), and always read as a whole: no query wants "one member of a lineup" in
 * isolation. A `lineup_players` join table would add 105 rows and a join to every read to
 * model a cardinality that is constant and already enforced upstream by the contract's
 * five-element tuple. Postgres integer arrays are first-class and indexable if that is ever
 * needed. The relational purism would buy nothing here, and CLAUDE.md warns against
 * over-engineering.
 *
 * The honest cost, stated: an array cannot carry a foreign key, so the database will not
 * enforce that each id exists in `players`. The seed checks it explicitly instead, and the
 * verification step asserts zero orphans. If lineups ever gained per-player attributes,
 * the join table would become the right answer.
 */
export const lineups = pgTable(
  'lineups',
  {
  season: text('season').notNull(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.teamId),
  /** Dash-delimited sorted person ids, e.g. "-1629008-1629611-...-". */
  groupId: text('group_id').notNull(),
  /** Exactly 5, sorted ascending. Enforced by the contract at the seed boundary. */
  personIds: integer('person_ids').array().notNull(),
  /**
   * Minutes played together across the season, summed from derived interval durations
   * (which reconcile to box-score minutes to the second). Stored so the FRONTEND can apply
   * its own display threshold and show sample size honestly — a 25-minute unit and a
   * 287-minute unit must not look equally authoritative.
   */
  minutes: doublePrecision('minutes').notNull(),
  displayNames: text('display_names').array().notNull(),
  },
  (table) => [primaryKey({ columns: [table.season, table.teamId, table.groupId] })],
);

/**
 * A contiguous stretch of one game with a fixed five on court.
 *
 * This is what makes lineup-filtered assists real rather than approximate — the capability
 * the whole play-by-play rewrite was for.
 */
export const lineupIntervals = pgTable(
  'lineup_intervals',
  {
    /** "gameId:teamId:period:startClock". */
    intervalId: text('interval_id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.gameId, { onDelete: 'cascade' }),
    season: text('season').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),
    period: smallint('period').notNull(),
    /** ISO-8601 durations, kept raw ("PT11M41.00S"); parsing is an edge concern. */
    startClock: text('start_clock').notNull(),
    endClock: text('end_clock').notNull(),
    /** The five on court, sorted. Same array rationale as `lineups.person_ids`. */
    onCourt: integer('on_court').array().notNull(),
    /** Stored so lineup minutes can be summed in SQL across games and seasons. */
    durationSeconds: doublePrecision('duration_seconds').notNull(),
  },
  (table) => [
    // Phase 5 reads a game's intervals in order to render its timeline.
    index('lineup_intervals_game_idx').on(table.gameId),
    index('lineup_intervals_team_idx').on(table.season, table.teamId),
  ],
);

/**
 * One field-goal attempt — the atomic unit of the dataset.
 *
 * PK is composite `(game_id, event_id)`. `event_id` (V3 `actionNumber`) is unique among
 * FIELD-GOAL events within a game, which is all this table holds, but NOT across the raw
 * action stream — blocks and steals share an `actionNumber` with the shot they pair with.
 * Verified: all 6,089 rows have a distinct (game_id, event_id).
 */
export const shotEvents = pgTable(
  'shot_events',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.gameId, { onDelete: 'cascade' }),
    season: text('season').notNull(),
    eventId: integer('event_id').notNull(),
    period: smallint('period').notNull(),
    clock: text('clock').notNull(),

    shooterId: integer('shooter_id')
      .notNull()
      .references(() => players.personId),

    /** Tenths of a foot, origin at the basket. Raw; the frontend maps to SVG space. */
    locX: integer('loc_x').notNull(),
    locY: integer('loc_y').notNull(),
    shotValue: smallint('shot_value').notNull(),
    shotDistance: real('shot_distance').notNull(),

    made: boolean('made').notNull(),
    /**
     * Whether the source tagged this basket as assisted. Distinct from
     * `assister_id IS NOT NULL`: a tagged basket whose surname could not be resolved is
     * still assisted, it just yields no edge. Keeping both columns is what lets the
     * assisted-vs-unassisted split stay correct without inventing an assister.
     */
    assisted: boolean('assisted').notNull(),
    /** NULLABLE by design — see the header note on honesty nulls. */
    assisterId: integer('assister_id').references(() => players.personId),

    actionType: text('action_type').notNull(),
    subType: text('sub_type').notNull(),
    /** The SHOOTER's team. A team's shots allowed are the shots in its games by the other side. */
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),

    /**
     * The lineup on court for this shot. NULLABLE by design: null means the five could
     * not be established for that moment, which is honest incompleteness. All 6,089 rows
     * are currently attributed, but the column stays nullable because the ETL can
     * legitimately produce null and a future game may.
     */
    intervalId: text('interval_id').references(() => lineupIntervals.intervalId, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.eventId] }),
    // Every Phase 5 grain maps to one of these:
    index('shot_events_shooter_idx').on(table.shooterId), // player grain
    index('shot_events_interval_idx').on(table.intervalId), // lineup grain
    index('shot_events_game_idx').on(table.gameId), // per-game / date filtering
    index('shot_events_team_season_idx').on(table.season, table.teamId), // team grain
    index('shot_events_team_season_shooter_idx').on(table.season, table.teamId, table.shooterId),
  ],
);

/**
 * A directed assister→shooter relationship, aggregated over the season.
 *
 * Always DERIVED from shot events, never a primary source — an edge exists only if real
 * assisted baskets are behind it. Stored because re-deriving 286 rows from 6,089 shots on
 * every request would be wasteful, not because it is independent data.
 *
 * Scope is the whole loaded season for one team. Lineup- or game-scoped networks are
 * computed on demand from `shot_events.interval_id`, which is why that column exists.
 */
export const assistEdges = pgTable(
  'assist_edges',
  {
    season: text('season').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.teamId),
    assisterId: integer('assister_id')
      .notNull()
      .references(() => players.personId),
    shooterId: integer('shooter_id')
      .notNull()
      .references(() => players.personId),
    /** Assisted made baskets on this ordered pair. */
    count: integer('count').notNull(),
    /** 2*made2 + 3*made3. */
    points: integer('points').notNull(),
    made2: integer('made_2').notNull(),
    made3: integer('made_3').notNull(),
  },
  (table) => [
    // One row per ordered pair; the direction is the data, so the PK is the pair.
    primaryKey({ columns: [table.season, table.teamId, table.assisterId, table.shooterId] }),
    index('assist_edges_assister_idx').on(table.assisterId),
    index('assist_edges_shooter_idx').on(table.shooterId),
  ],
);

// ---------------------------------------------------------------------------
// Relations — so Phase 5 can query naturally (db.query.games.findMany({ with: ... })).
// ---------------------------------------------------------------------------

export const playersRelations = relations(players, ({ many }) => ({
  shotsTaken: many(shotEvents, { relationName: 'shooter' }),
  shotsAssisted: many(shotEvents, { relationName: 'assister' }),
  assistsGiven: many(assistEdges, { relationName: 'edgeAssister' }),
  assistsReceived: many(assistEdges, { relationName: 'edgeShooter' }),
}));

export const gamesRelations = relations(games, ({ many }) => ({
  shotEvents: many(shotEvents),
  lineupIntervals: many(lineupIntervals),
}));

export const lineupIntervalsRelations = relations(lineupIntervals, ({ one, many }) => ({
  game: one(games, {
    fields: [lineupIntervals.gameId],
    references: [games.gameId],
  }),
  shotEvents: many(shotEvents),
}));

export const shotEventsRelations = relations(shotEvents, ({ one }) => ({
  game: one(games, {
    fields: [shotEvents.gameId],
    references: [games.gameId],
  }),
  shooter: one(players, {
    fields: [shotEvents.shooterId],
    references: [players.personId],
    relationName: 'shooter',
  }),
  assister: one(players, {
    fields: [shotEvents.assisterId],
    references: [players.personId],
    relationName: 'assister',
  }),
  interval: one(lineupIntervals, {
    fields: [shotEvents.intervalId],
    references: [lineupIntervals.intervalId],
  }),
}));

export const assistEdgesRelations = relations(assistEdges, ({ one }) => ({
  assister: one(players, {
    fields: [assistEdges.assisterId],
    references: [players.personId],
    relationName: 'edgeAssister',
  }),
  shooter: one(players, {
    fields: [assistEdges.shooterId],
    references: [players.personId],
    relationName: 'edgeShooter',
  }),
}));
