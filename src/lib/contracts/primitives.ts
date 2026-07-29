import { z } from 'zod';

/**
 * Shared primitives and scope shapes.
 *
 * Everything downstream (ETL output validation, DB row mapping, API responses,
 * frontend props) imports from `@/lib/contracts`. Zod schemas are the source of
 * truth; TypeScript types are inferred with `z.infer` so the two can never drift.
 */

/**
 * NBA person identifier — the ONLY reliable join key in this dataset.
 *
 * Name hazard, confirmed against the spike output: the same player appears under at
 * least three different name forms across the sources.
 *   - play-by-play V3 `playerName`      → "Porter Jr."      (bare surname)
 *   - play-by-play V3 `playerNameI`     → "M. Porter Jr."   (initial + surname)
 *   - `shotchartdetail.PLAYER_NAME`     → "Michael Porter Jr." (FIRST LAST)
 *   - `playerdashptpass.PASS_TO`        → "Minott, Josh"    (LAST, FIRST)
 * Never join, group, or dedupe on any of these. Always use `personId`.
 */
export const PersonId = z.number().int().positive();

/** NBA game identifier. A zero-padded string (e.g. "0022500123") — not a number. */
export const GameId = z.string().min(1);

/**
 * Game clock in the ISO-8601 duration form play-by-play V3 emits: "PT11M41.00S".
 *
 * Deliberately kept as the raw string rather than parsed to seconds. Parsing is an
 * edge concern (Phase 3 derivation / frontend display); storing the source form means
 * a bad parser can never silently corrupt the stored value.
 */
export const Clock = z.string().regex(/^PT(\d+M)?[\d.]+S$/, 'expected ISO-8601 duration like "PT11M41.00S"');

/** Regulation period 1–4; overtimes continue 5, 6, ... */
export const Period = z.number().int().min(1);

/** Field goals are worth 2 or 3. Free throws are not shot events and never appear here. */
export const ShotValue = z.union([z.literal(2), z.literal(3)]);

/**
 * The three grains the tool operates at. These are views onto the same underlying
 * ShotEvents — not three different datasets.
 */
export const Grain = z.enum(['player', 'lineup', 'team']);
export type Grain = z.infer<typeof Grain>;

/**
 * Shared filter for scoping a query.
 *
 * Per-game and date-range filtering are honest capabilities now that the data source
 * is per-event play-by-play rather than season aggregates. All fields optional; an
 * empty filter means the full loaded season.
 */
export const ScopeFilter = z.object({
  gameId: GameId.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
export type ScopeFilter = z.infer<typeof ScopeFilter>;
