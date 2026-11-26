import { getValue } from '@/lib/api/analysis';
import { serverError, validated } from '@/lib/api/respond';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { ValueResponse } from '@/lib/contracts/analysis';

/**
 * GET /api/value?season=2025-26&team=BKN
 *
 * Shot-making against the location model, and points created per assist. Read-only; a finished season does not change, so it is cacheable.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveTeamScope(new URL(request.url));
    if (!resolved.ok) return resolved.response;
    const payload = await getValue(resolved.scope);
    return validated(ValueResponse, payload, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (error) {
    return serverError(error, 'GET /api/value');
  }
}
