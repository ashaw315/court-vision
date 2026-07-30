/**
 * The data contract — the spine every later phase conforms to.
 *
 * Zod schemas are the single source of truth. TypeScript types are inferred from them
 * (`z.infer`), never hand-written in parallel, so the runtime validation and the
 * compile-time types cannot drift apart. ETL output validation, DB row mapping, API
 * responses, and frontend props all import from this module.
 *
 * Two properties of this contract are deliberate and worth preserving:
 *
 * 1. It is OBSERVATIONAL. There are no fields for grades, ratings, rankings,
 *    projections, or recommendations — anywhere. The tool shows a coach or scout their
 *    own data in a form they haven't seen; the judgment stays with the human. A schema
 *    with no slot for a rating cannot grow one by accident.
 *
 * 2. It never fabricates. Where the source data is uncertain — chiefly assister
 *    resolution, which the source provides only as a bare surname in free text — the
 *    contract types the value as nullable and the derivation resolves ambiguity to
 *    null. A missing edge is honest; a guessed one is a fabricated claim about a
 *    specific player.
 */

export {
  Clock,
  GameId,
  Grain,
  PersonId,
  Period,
  ScopeFilter,
  ShotValue,
} from './primitives';

export {
  AssistEdge,
  Lineup,
  LineupInterval,
  Player,
  ShotEvent,
} from './entities';

export {
  ApiError,
  AssistedSplit,
  GrainResponse,
  LineupsResponse,
  LineupSummary,
  PlayerRef,
  PlayersResponse,
  ResponseScope,
} from './responses';
