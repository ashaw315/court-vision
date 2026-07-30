import { PlayersResponse } from '@/lib/contracts';
import { getPlayers } from '@/lib/api/queries';
import { serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/players
 *
 * The player picker. Ordered by shot count so the UI can lead with the players who
 * actually carry the offence. Read-only.
 */
export async function GET() {
  try {
    const players = await getPlayers();
    return validated(PlayersResponse, { players });
  } catch (error) {
    return serverError(error, 'GET /api/players');
  }
}
