import type { NextResponse } from 'next/server';

import { getSeasonScope, type TeamScope } from '@/lib/api/queries';
import { parseSeason } from '@/lib/api/params';
import { badRequest, notFound } from '@/lib/api/respond';
import { DEFAULT_SEASON, type SeasonScope } from '@/lib/data/scope';
import { NETS_TEAM_ID, teamByAbbreviation } from '@/lib/teams';

/**
 * Resolve `?season=2025-26&team=BKN` into a loaded team-season.
 *
 * Both parameters are optional and default to the landing scope (the current default season
 * and Brooklyn), so a bare `/api/team` keeps working. A syntactically valid team-season that
 * has not been loaded is a 404 — "no data for that team-season" is a different answer from
 * an empty one, and the client should not have to guess which it got.
 */
export async function resolveTeamScope(
  url: URL,
): Promise<
  | { ok: true; scope: TeamScope; seasonScope: SeasonScope }
  | { ok: false; response: NextResponse }
> {
  const season = parseSeason(url.searchParams.get('season'), DEFAULT_SEASON);
  if (!season.ok) return { ok: false, response: badRequest(season.error) };

  const abbreviation = url.searchParams.get('team');
  let teamId = NETS_TEAM_ID;
  if (abbreviation !== null && abbreviation.trim() !== '') {
    const team = teamByAbbreviation(abbreviation);
    if (!team) {
      return {
        ok: false,
        response: badRequest(`team must be an NBA abbreviation like "BKN", got ${JSON.stringify(abbreviation)}`),
      };
    }
    teamId = team.teamId;
  }

  const scope = { season: season.value, teamId };
  const loaded = await getSeasonScope(scope);
  if (loaded === null) {
    return {
      ok: false,
      response: notFound(`No data loaded for team ${teamId} in ${season.value}.`),
    };
  }
  return { ok: true, scope, seasonScope: loaded };
}
