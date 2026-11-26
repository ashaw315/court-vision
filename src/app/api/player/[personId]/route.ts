import { GrainResponse } from '@/lib/contracts';
import { parsePersonId } from '@/lib/api/params';
import { getPlayerGrain, playerExists } from '@/lib/api/queries';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { badRequest, notFound, serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/player/[personId]?season=2025-26&team=BKN
 *
 * One player's assist network (both directions), shot map, and assisted/unassisted split.
 * Read-only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ personId: string }> },
) {
  const { personId: raw } = await params;

  // Range-checked here, not just type-checked: a value beyond Postgres int4 is one the
  // column cannot hold, and letting it through made the driver throw — a 500 for what is
  // plainly bad input.
  const parsed = parsePersonId(raw);
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const personId = parsed.value;

  try {
    // Existence is checked first so an unknown id 404s instead of returning an empty
    // bundle — "this player has no shots" and "this player does not exist" are different
    // answers and the client should not have to guess which it got.
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const { scope } = resolved;
    const displayName = await playerExists(personId, scope);
    if (displayName === null) {
      return notFound(`No player with personId ${personId} on this team in ${scope.season}`);
    }

    const payload = await getPlayerGrain(personId, displayName, scope);
    return validated(GrainResponse, payload);
  } catch (error) {
    return serverError(error, `GET /api/player/${personId}`);
  }
}
