import { z } from 'zod';

import { AssistEdge, Lineup, Player, ShotEvent } from './entities';
import { Grain, PersonId } from './primitives';

/**
 * API response shapes — thin wrappers over the Phase 2 entities.
 *
 * Deliberately thin. The entities are the contract; these only describe how a grain
 * BUNDLES them for one scope, so the frontend receives something it can render directly
 * rather than five lists it has to join in the browser. No response-only field duplicates
 * an entity field, and every response is validated against these schemas before it leaves
 * the server — the contract is enforced at the API boundary just as it is at the ETL and
 * seed boundaries.
 */

/**
 * The assisted-vs-unassisted split, computed SERVER-SIDE for the scope in question.
 *
 * Sent as a computed bundle rather than left to the client because the null-handling rule
 * is subtle and belongs in one place: a made basket tagged as assisted whose assister
 * could not be resolved is ASSISTED (it just produces no edge). A client recomputing this
 * from `shots` would have to re-derive that rule, and would eventually get it wrong.
 */
export const AssistedSplit = z.object({
  madeBaskets: z.number().int().nonnegative(),
  assisted: z.number().int().nonnegative(),
  selfCreated: z.number().int().nonnegative(),
  /**
   * Assisted baskets whose assister could not be resolved from the play-by-play text.
   * Counted in `assisted`, contributing no edge. Surfaced so the UI can state the cost of
   * never guessing rather than hiding it.
   */
  unresolvedAssisted: z.number().int().nonnegative(),
  /** null when there are no made baskets — "no data" and "0% assisted" are different. */
  assistedPct: z.number().min(0).max(1).nullable(),
});
export type AssistedSplit = z.infer<typeof AssistedSplit>;

/** Minimal player reference, so the client can label a node without a second request. */
export const PlayerRef = Player;
export type PlayerRef = z.infer<typeof PlayerRef>;

/** What scope produced this bundle. `grain` tells the UI how to read `id`. */
export const ResponseScope = z.object({
  grain: Grain,
  /** personId for player, groupId for lineup, null for team (the whole roster). */
  id: z.union([z.number().int(), z.string()]).nullable(),
  label: z.string().min(1),
});
export type ResponseScope = z.infer<typeof ResponseScope>;

/**
 * The bundle every grain returns: who, the assist network, the shot map, the split.
 *
 * One shape for all three grains on purpose — the frontend renders the same two lenses
 * (assist connections + shot geography) at every grain, so a shared response shape means
 * one renderer rather than three.
 */
export const GrainResponse = z.object({
  scope: ResponseScope,
  /** Directed assister→shooter edges within this scope. */
  edges: z.array(AssistEdge),
  /** Located field-goal attempts within this scope. Nulls preserved. */
  shots: z.array(ShotEvent),
  split: AssistedSplit,
  /** Every player appearing in `edges` or `shots`, so the UI can label without a join. */
  players: z.array(PlayerRef),
  /** Sample-size context the UI needs to caveat thin scopes honestly. */
  meta: z.object({
    shotCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    /** Minutes the scope represents — only meaningful for a lineup. */
    minutes: z.number().nonnegative().nullable(),
    /** Games the scope's shots span. */
    games: z.number().int().nonnegative(),
  }),
});
export type GrainResponse = z.infer<typeof GrainResponse>;

/**
 * The lineup picker's payload: which units exist, and how much each one is worth.
 *
 * `minutes` rides on every row because the DISPLAY threshold is the frontend's decision
 * (the ETL emits down to a 25-minute floor). The UI filters and caveats; the API just
 * reports what exists.
 */
export const LineupSummary = Lineup.extend({
  /** Shots taken by this unit while it was on court. Cheap sample-size signal. */
  shotCount: z.number().int().nonnegative(),
});
export type LineupSummary = z.infer<typeof LineupSummary>;

export const LineupsResponse = z.object({
  lineups: z.array(LineupSummary),
  /** The floor actually applied to this response, echoed so the UI can show it. */
  minMinutes: z.number().nonnegative(),
  /** The ETL's emit floor — nothing below this exists at any threshold. */
  emitFloorMinutes: z.number().nonnegative(),
});
export type LineupsResponse = z.infer<typeof LineupsResponse>;

/** The player picker's payload. */
export const PlayersResponse = z.object({
  players: z.array(
    Player.extend({
      personId: PersonId,
      shotCount: z.number().int().nonnegative(),
    }),
  ),
});
export type PlayersResponse = z.infer<typeof PlayersResponse>;

/** Every error response has this shape — no stack traces, ever. */
export const ApiError = z.object({
  error: z.string().min(1),
  detail: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
