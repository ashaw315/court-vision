import { getMatchup } from '@/lib/api/analysis';
import { badRequest, serverError, validated } from '@/lib/api/respond';
import { resolveTeamScope } from '@/lib/api/scope-request';
import { MatchupResponse } from '@/lib/contracts/analysis';
import { teamByAbbreviation } from '@/lib/teams';

/**
 * GET /api/matchup?season=2025-26&team=BKN&opponent=BOS
 *
 * Every validated game between two teams in a season, with both sides' shots.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const opponent = teamByAbbreviation(url.searchParams.get('opponent') ?? '');
  if (!opponent) return badRequest('opponent must be an NBA abbreviation like "BOS"');
  try {
    const resolved = await resolveTeamScope(url);
    if (!resolved.ok) return resolved.response;
    if (opponent.teamId === resolved.scope.teamId) return badRequest('opponent must differ from team');
    const payload = await getMatchup(resolved.scope, opponent.teamId);
    return validated(MatchupResponse, payload, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    return serverError(error, 'GET /api/matchup');
  }
}
