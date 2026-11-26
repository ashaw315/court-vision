import { getTrend } from '@/lib/api/analysis';
import { badRequest, notFound, serverError, validated } from '@/lib/api/respond';
import { TrendResponse } from '@/lib/contracts/analysis';
import { teamByAbbreviation } from '@/lib/teams';

/**
 * GET /api/trend?team=BKN
 *
 * One team across every season loaded for it — the year-over-year view.
 */
export async function GET(request: Request) {
  const team = teamByAbbreviation(new URL(request.url).searchParams.get('team') ?? '');
  if (!team) return badRequest('team must be an NBA abbreviation like "BKN"');
  try {
    const payload = await getTrend(team.teamId);
    if (payload.seasons.length === 0) return notFound(`No seasons loaded for ${team.abbreviation}`);
    return validated(TrendResponse, payload, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    return serverError(error, 'GET /api/trend');
  }
}
