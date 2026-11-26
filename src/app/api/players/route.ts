import { PlayersResponse } from '@/lib/contracts';
import { getPlayers } from '@/lib/api/queries';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/players?season=2025-26&team=BKN
 *
 * The player picker. Ordered by shot count so the UI can lead with the players who
 * actually carry the offence. Read-only.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const players = await getPlayers(resolved.scope);
    return validated(PlayersResponse, { players });
  } catch (error) {
    return serverError(error, 'GET /api/players');
  }
}
