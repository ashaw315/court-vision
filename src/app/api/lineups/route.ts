import { LineupsResponse } from '@/lib/contracts';
import { parseMinMinutes } from '@/lib/api/params';
import { getLineups } from '@/lib/api/queries';
import { badRequest, serverError, validated } from '@/lib/api/respond';

/**
 * The ETL emits every unit down to this floor; nothing below it exists at any threshold.
 * Echoed in the response so the UI can explain why a thin unit is missing entirely.
 */
const EMIT_FLOOR_MINUTES = 25;

/**
 * The default DISPLAY cutoff. Deliberately higher than the emit floor: 50 minutes is where
 * a unit has enough possessions to read as a subject rather than noise. The frontend can
 * lower it to the floor via ?minMinutes= without any server change — which is the whole
 * point of separating the two numbers.
 */
const DEFAULT_MIN_MINUTES = 50;

/**
 * GET /api/lineups?minMinutes=NN
 *
 * The lineup picker: which units exist above a threshold, and how much each is worth.
 * Every row carries its minutes so the UI can show sample size honestly. Read-only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Absent OR empty means "apply the default". `Number('')` is 0, which previously made
  // `?minMinutes=` silently return every unit above the emit floor while the caller
  // believed the documented default was in force.
  const parsed = parseMinMinutes(
    url.searchParams.get('minMinutes'),
    DEFAULT_MIN_MINUTES,
  );
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const minMinutes = parsed.value;

  try {
    const lineups = await getLineups(minMinutes);
    return validated(LineupsResponse, {
      lineups,
      minMinutes,
      emitFloorMinutes: EMIT_FLOOR_MINUTES,
    });
  } catch (error) {
    return serverError(error, 'GET /api/lineups');
  }
}
