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
});
export type SeasonScope = z.infer<typeof SeasonScope>;

/**
 * The season this dataset covers.
 *
 * Mirrors `etl/nba_client.py`'s `SEASON`. The label lives in config because the database
 * stores no season column — the dataset is single-season by design (CLAUDE.md: Nets-only,
 * 2025-26), so a column would be a constant in every row. The GAME COUNT, which is the
 * part that can drift, is read from the data rather than written here.
 */
export const SEASON_LABEL = '2025-26';
export const SEASON_TYPE = 'Regular Season';

/**
 * Format the scope for display: "2025-26 REGULAR SEASON · 72 GAMES".
 *
 * Uppercased at the call site by the mono label styling, so the string itself stays
 * readable in tests and screen-reader output.
 */
export function formatScope(scope: SeasonScope): string {
  const games = `${scope.games} ${scope.games === 1 ? 'game' : 'games'}`;
  return `${scope.season} ${scope.seasonType} · ${games}`;
}

/**
 * Build the scope from a real validated game count.
 *
 * Callers pass the count from the database (see `getSeasonScope` in the query layer) so
 * this stays true if the dataset is ever regenerated with more or fewer valid games.
 */
export function seasonScope(games: number): SeasonScope {
  return { season: SEASON_LABEL, seasonType: SEASON_TYPE, games };
}
