import { notFound } from 'next/navigation';

import { ShotMap } from '@/components/analysis/Court';
import { fmt, pointsPerShot } from '@/components/analysis/format';
import { Section, Shell, Table } from '@/components/analysis/Shell';
import { getMatchup, getTeamSeasonLabels } from '@/lib/api/analysis';
import { parseSeason } from '@/lib/api/params';
import { getSeasonScope } from '@/lib/api/queries';
import { DEFAULT_SEASON, formatScope } from '@/lib/data/scope';
import { color } from '@/lib/design/tokens';
import { teamByAbbreviation, teamLabel } from '@/lib/teams';

export const dynamic = 'force-dynamic';

export default async function MatchupPage({
  params,
}: {
  params: Promise<{ season: string; team: string; opponent: string }>;
}) {
  const { season: rawSeason, team: rawTeam, opponent: rawOpponent } = await params;
  const season = parseSeason(rawSeason, DEFAULT_SEASON);
  const team = teamByAbbreviation(rawTeam);
  const opponent = teamByAbbreviation(rawOpponent);
  if (!season.ok || !team || !opponent || team.teamId === opponent.teamId) notFound();

  const scope = { season: season.value, teamId: team.teamId };
  const seasonScope = await getSeasonScope(scope);
  if (seasonScope === null) notFound();

  const [matchup, seasons] = await Promise.all([
    getMatchup(scope, opponent.teamId),
    getTeamSeasonLabels(team.teamId),
  ]);

  return (
    <Shell
      title={`${team.abbreviation} vs ${opponent.abbreviation}`}
      subtitle={`${formatScope(seasonScope, matchup.games.length)} · ${teamLabel(team)} against ${teamLabel(opponent)}`}
      seasons={seasons}
      currentSeason={season.value}
      teamPath={team.abbreviation.toLowerCase()}
    >
      {matchup.games.length === 0 ? (
        <p style={{ fontSize: 12, color: color.text, maxWidth: 560 }}>
          No validated games between these teams in {season.value}. Either they did not meet, or the
          games did not pass validation for {team.abbreviation}.
        </p>
      ) : (
        <>
          <Section
            title="Games"
            note={`Field-goal attempts only. A dash means there is no data for ${opponent.abbreviation}'s side of that game: either ${opponent.abbreviation} is not loaded for this season or that side did not pass validation.`}
          >
            <Table
              head={['Date', 'Site', `${team.abbreviation} FG pts`, `${opponent.abbreviation} FG pts`, `${team.abbreviation} pts/shot`]}
              rows={matchup.games.map((g) => [
                g.playedOn ?? g.gameId,
                g.home ? 'Home' : 'Away',
                g.offense.points,
                g.defense ? g.defense.points : '—',
                fmt(pointsPerShot(g.offense) ?? 0, 2),
              ])}
            />
          </Section>
          <Section title="Shot maps">
            <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <ShotMap shots={matchup.teamShots} label={`${team.abbreviation} shots`} />
              <ShotMap
                shots={matchup.opponentShots}
                label={`${opponent.abbreviation} shots`}
                accent={color.structure}
                unavailable={matchup.games.some((g) => g.defense) ? undefined : `no validated ${opponent.abbreviation} data for these games`}
              />
            </div>
          </Section>
        </>
      )}
    </Shell>
  );
}
