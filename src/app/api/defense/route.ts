import { getDefense } from '@/lib/api/analysis';
import { serverError, validated } from '@/lib/api/respond';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { DefenseResponse } from '@/lib/contracts/analysis';

/**
 * GET /api/defense?season=2025-26&team=BKN
 *
 * What opponents did against this team: shots allowed, by opponent. Read-only; a finished season does not change, so it is cacheable.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const payload = await getDefense(resolved.scope);
    return validated(DefenseResponse, payload, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (error) {
    return serverError(error, 'GET /api/defense');
  }
}
