import { z } from 'zod';

/**
 * The time scope every figure on these plates is measured over.
 *
 * The plates report season totals — "26 baskets · 57 points" is a whole-season count, not
 * one game's. Without a stated scope a reader cannot tell which, so the scope line is an
 * honesty requirement rather than a caption: it makes every other number on the plate
 * unambiguous.
 *
 * Two counts exist and they are NOT interchangeable:
 *
 *   * `games` here — the validated games in the DATASET (72). This is what the totals are
 *     summed over, so it is what the scope line must state.
 *   * `GrainResponse.meta.games` — the games the current SCOPE appears in (18 for the top
 *     lineup). Useful context, but stating it as the season scope would claim the totals
 *     cover 18 games when they cover 72.
 *
 * Both are surfaced so a plate can say each without confusing them.
 */
export const SeasonScope = z.object({
  /** e.g. "2025-26". */
  season: z.string().min(1),
  /** e.g. "Regular Season". */
  seasonType: z.string().min(1),
  /** Validated games in the dataset — what the totals are summed over. */
  games: z.number().int().nonnegative(),
  /** Games in the full schedule (82). */
  scheduledGames: z.number().int().nonnegative(),
  /** Games excluded by validation (82 − 72 = 10). */
  excludedGames: z.number().int().nonnegative(),
  /** When this team-season was last loaded (ISO), or null if unknown. */
  lastLoadedAt: z.string().nullable().default(null),
});
export type SeasonScope = z.infer<typeof SeasonScope>;

/**
 * The season this dataset covers.
 *
 * The DEFAULT season, used when a request names none. Every table now carries its own
 * season column, so this is only the landing choice — never an assumption about the data.
 */
export const SEASON_LABEL = '2025-26';
export const DEFAULT_SEASON = SEASON_LABEL;
export const SEASON_TYPE = 'Regular Season';

/**
 * Format the scope for display: "2025-26 REGULAR SEASON · 72 GAMES".
 *
 * Uppercased at the call site by the mono label styling, so the string itself stays
 * readable in tests and screen-reader output.
 */
export function formatScope(scope: SeasonScope, scopeGames?: number): string {
  // `scopeGames` is how many games THIS plate's data actually spans. Without it every plate
  // printed the season constant, so a lineup that played 18 games was captioned "72 GAMES"
  // and its 26 baskets read as a 72-game rate.
  const count = scopeGames ?? scope.games;
  const games = `${count} ${count === 1 ? 'game' : 'games'}`;
  return `${scope.season} ${scope.seasonType} · ${games}`;
}

/**
 * Build the scope from a real validated game count.
 *
 * Callers pass the count from the database (see `getSeasonScope` in the query layer) so
 * this stays true if the dataset is ever regenerated with more or fewer valid games.
 */
export function seasonScope(
  games: number,
  scheduledGames = games,
  excludedGames = Math.max(0, scheduledGames - games),
  options: { season?: string; seasonType?: string; lastLoadedAt?: string | null } = {},
): SeasonScope {
  return {
    season: options.season ?? SEASON_LABEL,
    seasonType: options.seasonType ?? SEASON_TYPE,
    games,
    scheduledGames,
    excludedGames,
    lastLoadedAt: options.lastLoadedAt ?? null,
  };
}

/**
 * The methodology footnote.
 *
 * "72 games" is a surprising number next to an 82-game season, and an unexplained gap
 * reads as a mistake. Naming the exclusion and its cause turns it into what it actually
 * is — a validation result — and every figure comes from the data rather than a literal,
 * so the sentence cannot go stale if the dataset is regenerated.
 *
 * Returns null when nothing was excluded: a footnote explaining a gap that does not exist
 * would be noise.
 */
export function methodologyFootnote(scope: SeasonScope): string | null {
  if (scope.excludedGames <= 0) return null;
  const games = scope.excludedGames === 1 ? 'game' : 'games';
  return (
    `* ${scope.games} of ${scope.scheduledGames} games. ${scope.excludedGames} ${games} `
    + 'excluded for contradictory source substitution timestamps — see methodology.'
  );
}
