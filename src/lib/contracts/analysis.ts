import { z } from 'zod';

/**
 * Payloads for the analysis views: game-by-game timeline, defence, head-to-head matchups,
 * year-over-year trend, and the shot-value model.
 *
 * Everything here is a count or a ratio of real shots. "Expected points" is the
 * location-and-value model in `lib/model/expected-points.ts` — not a prediction and not a
 * grade of anyone. The model's own sample is carried on every response (`model`) so a view
 * built on a thin model can say so.
 */

export const ModelInfo = z.object({
  season: z.string(),
  /** Shots the model was built from. */
  attempts: z.number().int().nonnegative(),
  /** Distinct teams contributing shots — the model is only as league-wide as this says. */
  teams: z.number().int().nonnegative(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** One side's shooting in one game. */
export const SideLine = z.object({
  shots: z.number().int().nonnegative(),
  made: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  threes: z.number().int().nonnegative(),
  madeAssisted: z.number().int().nonnegative(),
  expectedPoints: z.number(),
});
export type SideLine = z.infer<typeof SideLine>;

export const GameLine = z.object({
  gameId: z.string(),
  /** ISO date, or null for a game loaded before dates were tracked. */
  playedOn: z.string().nullable(),
  opponentId: z.number().int(),
  home: z.boolean(),
  offense: SideLine,
  /**
   * What the opponent did against this team. Null when the opponent's side of the game did
   * not pass validation — "no defensive data" is not "held them to zero".
   */
  defense: SideLine.nullable(),
});
export type GameLine = z.infer<typeof GameLine>;

export const TimelineResponse = z.object({
  season: z.string(),
  teamId: z.number().int(),
  games: z.array(GameLine),
  model: ModelInfo,
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;

/** A located attempt, trimmed to what a shot map needs. */
export const MapShot = z.object({
  locX: z.number(),
  locY: z.number(),
  shotValue: z.union([z.literal(2), z.literal(3)]),
  made: z.boolean(),
  assisted: z.boolean(),
});
export type MapShot = z.infer<typeof MapShot>;

export const OpponentLine = z.object({
  opponentId: z.number().int(),
  games: z.number().int().nonnegative(),
  offense: SideLine,
  defense: SideLine,
});
export type OpponentLine = z.infer<typeof OpponentLine>;

export const DefenseResponse = z.object({
  season: z.string(),
  teamId: z.number().int(),
  /** Games with defensive data / games played. */
  gamesWithDefense: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  allowed: SideLine,
  /** Opponents' attempts against this team, for the shot map. */
  shots: z.array(MapShot),
  byOpponent: z.array(OpponentLine),
  model: ModelInfo,
});
export type DefenseResponse = z.infer<typeof DefenseResponse>;

export const MatchupResponse = z.object({
  season: z.string(),
  teamId: z.number().int(),
  opponentId: z.number().int(),
  games: z.array(GameLine),
  /** The team's attempts in these games. */
  teamShots: z.array(MapShot),
  /** The opponent's attempts in these games. */
  opponentShots: z.array(MapShot),
  model: ModelInfo,
});
export type MatchupResponse = z.infer<typeof MatchupResponse>;

export const SeasonTrend = z.object({
  season: z.string(),
  games: z.number().int().nonnegative(),
  offense: SideLine,
  /** Null if no game had defensive data. */
  defense: SideLine.nullable(),
  model: ModelInfo,
});
export type SeasonTrend = z.infer<typeof SeasonTrend>;

export const TrendResponse = z.object({
  teamId: z.number().int(),
  seasons: z.array(SeasonTrend),
});
export type TrendResponse = z.infer<typeof TrendResponse>;

export const ShooterValue = z.object({
  personId: z.number().int(),
  displayName: z.string(),
  attempts: z.number().int().nonnegative(),
  actualPoints: z.number().int().nonnegative(),
  expectedPoints: z.number(),
});

export const CreatorValue = z.object({
  personId: z.number().int(),
  displayName: z.string(),
  /** Assisted baskets with a resolved assister — unresolved ones are never attributed. */
  assists: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  /** What the shots they set up would be worth at the typical make rate from those spots. */
  expectedPointsOnAssistedShots: z.number(),
});

export const ValueResponse = z.object({
  season: z.string(),
  teamId: z.number().int(),
  shooters: z.array(ShooterValue),
  creators: z.array(CreatorValue),
  model: ModelInfo,
});
export type ValueResponse = z.infer<typeof ValueResponse>;
