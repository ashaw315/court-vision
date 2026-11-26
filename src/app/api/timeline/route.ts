import { getTimeline } from '@/lib/api/analysis';
import { serverError, validated } from '@/lib/api/respond';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { TimelineResponse } from '@/lib/contracts/analysis';

/**
 * GET /api/timeline?season=2025-26&team=BKN
 *
 * Game-by-game offence and defence for one team-season. Read-only; a finished season does not change, so it is cacheable.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const payload = await getTimeline(resolved.scope);
    return validated(TimelineResponse, payload, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (error) {
    return serverError(error, 'GET /api/timeline');
  }
}
