import type { Grain } from '@/lib/contracts';

/**
 * Which endpoint serves a scope.
 *
 * Extracted from the container so it can be tested directly: sending a grain to the wrong
 * endpoint would return a valid `GrainResponse` of the WRONG scope, which renders as a
 * perfectly plausible plate showing the wrong thing. That is exactly the failure a test
 * should catch rather than a screenshot.
 *
 * Returns null when a scope needs a selection it does not have yet — the caller must not
 * fetch. Null is deliberate: a "" id would hit `/api/player/` and 404 for a reason that
 * looks like a server fault rather than an incomplete selection.
 */
export function grainUrl(grain: Grain, unitId: string | number | null): string | null {
  if (grain === 'team') return '/api/team';
  if (unitId === null || unitId === '') return null;
  return grain === 'lineup'
    ? `/api/lineup/${encodeURIComponent(String(unitId))}`
    : `/api/player/${encodeURIComponent(String(unitId))}`;
}

/**
 * The unit a grain should land on when it is selected.
 *
 * Keeps a previous choice if there is one, otherwise falls back to the first available
 * unit so switching to lineup or player always lands on something rather than an empty
 * plate the user has to fix themselves.
 */
export function unitForGrain<T>(remembered: T | null, available: T | undefined): T | null {
  return remembered ?? available ?? null;
}
