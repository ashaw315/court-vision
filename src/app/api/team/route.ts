import { GrainResponse } from '@/lib/contracts';
import { getTeamGrain } from '@/lib/api/queries';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/team?season=2025-26&team=BKN
 *
 * The full roster's assist network + shot map + season split. Read-only.
 *
 * This is the largest response (about 6,000 shots ≈ 1.5 MB of JSON for one team-season). Left whole deliberately:
 * the team shot map renders every shot, so paginating would just make the client
 * reassemble it. If it becomes a problem the answer is a projected/binned variant, not
 * pagination of the same payload.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const payload = await getTeamGrain(resolved.scope);
    return validated(GrainResponse, payload);
  } catch (error) {
    return serverError(error, 'GET /api/team');
  }
}
