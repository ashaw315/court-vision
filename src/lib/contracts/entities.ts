import { z } from 'zod';

import { Clock, GameId, PersonId, Period, ShotValue } from './primitives';

/**
 * A player.
 *
 * `personId` is identity. `displayName` is for rendering only and must never be used
 * to join, group, or dedupe — see the name-variant hazard documented on `PersonId`.
 * We standardise on the `playerNameI` form ("M. Porter Jr."), which is what
 * play-by-play carries and what reads naturally on a court diagram.
 */
export const Player = z.object({
  personId: PersonId,
  displayName: z.string().min(1),
});
export type Player = z.infer<typeof Player>;

/**
 * ShotEvent — the atomic unit of this dataset. One per field-goal attempt.
 *
 * Built by joining play-by-play V3 to `shotchartdetail` on
 * `actionNumber` === `GAME_EVENT_ID` (a 100% join in the validated spike game).
 *
 * What this claims: a real field-goal attempt, at a real court location, by a real
 * player, in a real game.
 * What it does NOT claim: anything about defenders, spacing, or player positions
 * other than the shooter's. That data is optical-tracking-only and not public, so it
 * is absent here rather than estimated.
 */
export const ShotEvent = z.object({
  gameId: GameId,

  /** V3 `actionNumber` / shotchart `GAME_EVENT_ID` — unique within a game. */
  eventId: z.number().int().nonnegative(),

  period: Period,
  clock: Clock,

  shooterId: PersonId,

  /**
   * Court location in tenths of a foot, origin at the basket (V3 `xLegacy`/`yLegacy`,
   * identical to shotchart `LOC_X`/`LOC_Y`). Roughly x ∈ [-250, 250], y ∈ [-50, 470].
   *
   * Stored raw. Conversion into SVG coordinate space belongs to the frontend, where
   * the viewBox is known — baking it in here would hard-code one rendering.
   */
  locX: z.number(),
  locY: z.number(),

  shotValue: ShotValue,
  made: z.boolean(),

  /**
   * Whether this basket was assisted.
   *
   * Derived from the presence of an `(Name N AST)` tag in the V3 event description —
   * e.g. "Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)". Unassisted baskets carry no
   * such tag. Always false when `made` is false: a missed shot cannot be assisted.
   */
  assisted: z.boolean(),

  /**
   * The assisting player, or null.
   *
   * Null in three distinct cases, which the contract deliberately does not
   * distinguish — all three mean "we do not have an assister for this shot":
   *   1. the shot was missed,
   *   2. the make was unassisted,
   *   3. the description named an assister we could not resolve to a personId.
   *
   * Case 3 matters for honesty. The assister appears in the description ONLY as a bare
   * surname ("Mann"), and the spike confirmed the structured `assist_fields` are empty
   * — there is no assister personId anywhere in the source. Resolution therefore means
   * mapping a surname against the roster on court, which can be ambiguous (two players
   * sharing a surname). An ambiguous parse resolves to null and logs a warning; it is
   * NEVER guessed. A wrong edge on a passing network is a fabricated claim about a
   * player, which is worse than a missing one.
   *
   * The parser and its tests live in Phase 3. This contract types only the result.
   */
  assisterId: PersonId.nullable(),

  /** Distance in feet, as reported by the source. */
  shotDistance: z.number().nonnegative(),

  /** Shot descriptors, e.g. actionType "Made Shot" / subType "Driving Layup Shot". */
  actionType: z.string(),
  subType: z.string(),
})
  .refine((s) => !(s.assisted && !s.made), {
    message: 'a missed shot cannot be assisted',
    path: ['assisted'],
  })
  .refine((s) => !(s.assisterId !== null && !s.assisted), {
    message: 'assisterId requires assisted === true',
    path: ['assisterId'],
  })
  .refine((s) => s.assisterId !== s.shooterId, {
    message: 'a player cannot assist their own shot',
    path: ['assisterId'],
  });
export type ShotEvent = z.infer<typeof ShotEvent>;

/**
 * AssistEdge — a directed assister→shooter relationship, ALWAYS derived.
 *
 * Computed by aggregating `ShotEvent`s where `assisted === true` over some scope
 * (team / lineup / game / season). It is never a stored primary source and never comes
 * from an endpoint. Keeping it derived is what makes the honesty structural: an edge
 * can only exist if real assisted baskets are behind it.
 *
 * What this claims: assisted made baskets between two players, in the given scope.
 * What it does NOT claim: total passes, or "ball movement" generally. A pass that
 * leads to a miss, a swung ball, a hockey assist, and a dribble handoff are all real
 * ball movement and none of them appear here. This is the assisted-basket subset.
 */
export const AssistEdge = z.object({
  assisterId: PersonId,
  shooterId: PersonId,

  /** Assisted made baskets on this ordered pair. */
  count: z.number().int().nonnegative(),

  /** Points created — 2 * made2 + 3 * made3. */
  points: z.number().int().nonnegative(),

  made2: z.number().int().nonnegative(),
  made3: z.number().int().nonnegative(),
})
  .refine((e) => e.assisterId !== e.shooterId, {
    message: 'an assist edge cannot be self-directed',
    path: ['shooterId'],
  })
  .refine((e) => e.made2 + e.made3 === e.count, {
    message: 'count must equal made2 + made3',
    path: ['count'],
  })
  .refine((e) => e.points === 2 * e.made2 + 3 * e.made3, {
    message: 'points must equal 2*made2 + 3*made3',
    path: ['points'],
  });
export type AssistEdge = z.infer<typeof AssistEdge>;

/** Exactly five person ids, sorted ascending. Used for both on-court sets and lineups. */
const FivePersonIds = z
  .tuple([PersonId, PersonId, PersonId, PersonId, PersonId])
  .refine((ids) => new Set(ids).size === 5, { message: 'the five personIds must be distinct' })
  .refine((ids) => ids.every((id, i) => i === 0 || ids[i - 1] < id), {
    message: 'personIds must be sorted ascending (canonical order)',
  });

/**
 * LineupInterval — a contiguous stretch of one game with a fixed five on court.
 *
 * Derived from substitution events, which V3 carries as
 * `actionType: "Substitution"`, `description: "SUB: Williams FOR Porter Jr."`.
 * This is the highest-risk transform in the project: the description names the players
 * by bare surname, the incoming/outgoing pair must be read in the right direction, and
 * period boundaries reset the on-court five. Phase 3+ owns that derivation and its
 * tests; the contract types only its result.
 *
 * Why it matters: every `ShotEvent` falls within exactly one `LineupInterval` for its
 * team, which is what lets assists attribute to a lineup honestly. Because the source
 * is per-event play-by-play rather than season aggregates, a lineup's assist network
 * can be filtered to the possessions that lineup was actually on court for — the
 * season-level approximation the earlier passing-endpoint approach forced is gone.
 */
export const LineupInterval = z.object({
  gameId: GameId,

  /** Stable id, e.g. "0022500123:1:PT06M04.00S" (gameId:period:startClock). */
  intervalId: z.string().min(1),

  period: Period,

  /** Clocks count DOWN within a period, so startClock is the larger value. */
  startClock: Clock,
  endClock: Clock,

  onCourt: FivePersonIds,
});
export type LineupInterval = z.infer<typeof LineupInterval>;

/**
 * Lineup — a five-man unit that cleared the minutes threshold.
 *
 * Only units above the threshold (~50 minutes, which on this roster yields ~5 units)
 * ever enter the data. The Nets ran 250 distinct five-man lineups but only 2 cleared
 * 100 minutes and only 5 cleared 50 — the distribution of a rebuilding team. The
 * threshold is therefore forced by the data rather than chosen arbitrarily; below it,
 * a "unit" is a handful of scattered possessions and any network drawn from it is
 * noise. This reasoning belongs in the README.
 */
export const Lineup = z.object({
  /**
   * Identity: the dash-delimited sorted person-id string from `teamdashlineups`,
   * including leading and trailing dashes —
   * "-1629008-1629611-1629651-1641730-1642856-".
   */
  groupId: z.string().regex(/^-(\d+-){5}$/, 'expected "-id-id-id-id-id-" with five ids'),

  personIds: FivePersonIds,

  /** Minutes played together, as reported by the source (fractional). */
  minutes: z.number().nonnegative(),

  /** Display only, derived from Players. Never a join key. */
  displayNames: z.array(z.string().min(1)).length(5),
});
export type Lineup = z.infer<typeof Lineup>;
