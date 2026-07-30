import { GrainResponse } from '@/lib/contracts';
import { getTeamGrain } from '@/lib/api/queries';
import { serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/team
 *
 * The full roster's assist network + shot map + season split. Read-only.
 *
 * This is the largest response (6,089 shots ≈ 1.5 MB of JSON). Left whole deliberately:
 * the team shot map renders every shot, so paginating would just make the client
 * reassemble it. If it becomes a problem the answer is a projected/binned variant, not
 * pagination of the same payload.
 */
export async function GET() {
  try {
    const payload = await getTeamGrain();
    return validated(GrainResponse, payload);
  } catch (error) {
    return serverError(error, 'GET /api/team');
  }
}
