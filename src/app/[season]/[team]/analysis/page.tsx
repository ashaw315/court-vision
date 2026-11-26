import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ShotMap } from '@/components/analysis/Court';
import { ZeroLine, rolling } from '@/components/analysis/Charts';
import {
  expectedPerShot, fmt, pct, pointsPerShot, signed,
} from '@/components/analysis/format';
import { Section, Shell, Table } from '@/components/analysis/Shell';
import { getDefense, getTimeline, getTrend, getValue } from '@/lib/api/analysis';
import { parseSeason } from '@/lib/api/params';
import { getAudit, getSeasonScope } from '@/lib/api/queries';
import { DEFAULT_SEASON, formatScope, methodologyFootnote } from '@/lib/data/scope';
import { color } from '@/lib/design/tokens';
import { teamById, teamByAbbreviation, teamLabel } from '@/lib/teams';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ season: string; team: string }>;
}) {
  const { season: rawSeason, team: rawTeam } = await params;
  const season = parseSeason(rawSeason, DEFAULT_SEASON);
  const team = teamByAbbreviation(rawTeam);
  if (!season.ok || !team) notFound();

  const scope = { season: season.value, teamId: team.teamId };
  const seasonScope = await getSeasonScope(scope);
  if (seasonScope === null) notFound();

  const [timeline, defense, value, trend, audit] = await Promise.all([
    getTimeline(scope), getDefense(scope), getValue(scope), getTrend(team.teamId), getAudit(scope),
  ]);
  const teamPath = team.abbreviation.toLowerCase();
  const nameOf = (id: number) => { const t = teamById(id); return t ? t.abbreviation : String(id); };

  const offenseAbove = timeline.games.map((g) => g.offense.points - g.offense.expectedPoints);
  const defenseAbove = timeline.games.filter((g) => g.defense).map((g) => (g.defense!.points - g.defense!.expectedPoints));
  const footnote = methodologyFootnote(seasonScope);
  const model = timeline.model;

  return (
    <Shell
      title={`${teamLabel(team)} — analysis`}
      subtitle={`${formatScope(seasonScope)} · field-goal attempts only`}
      seasons={trend.seasons.map((s) => s.season)}
      currentSeason={season.value}
      teamPath={teamPath}
    >
      <p style={{ fontSize: 11, lineHeight: 1.7, color: color.text, maxWidth: 760, marginTop: -20, marginBottom: 36 }}>
        Expected points compare each shot with what a typical attempt from that spot returned
        in {model.season} ({model.attempts.toLocaleString()} shots from {model.teams} {model.teams === 1 ? 'team' : 'teams'}).
        The model knows where a shot was taken and whether it was a two or a three — nothing about defenders or the clock.
        {model.teams < 30 && ' The league is not fully loaded for this season, so the model reflects only the teams that are.'}
      </p>

      <Section
        title="Game by game"
        note="Points above expected per game, smoothed over ten games. Above the line is shooting better than the typical return from those spots; for the opponent line, above the line is the other side shooting well against this team."
      >
        <ZeroLine
          series={[
            { label: 'This team, points above expected', values: rolling(offenseAbove, 10), stroke: color.rust },
            { label: 'Opponents, points above expected', values: rolling(defenseAbove, 10), stroke: color.structure },
          ]}
        />
        <p style={{ fontSize: 10, color: color.muted, marginTop: 6 }}>
          <span style={{ color: color.rust }}>■</span> THIS TEAM · <span style={{ color: color.structure }}>■</span> OPPONENTS
        </p>
      </Section>

      <Section
        title="Defence"
        note={`Shots opponents took against this team, in ${defense.gamesWithDefense} of ${defense.games} games with defensive data. Field-goal attempts only — free throws and turnovers are not in this data.`}
      >
        <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
          <ShotMap shots={defense.shots} label="Shots allowed" accent={color.structure} />
          <Table
            head={['Opponent', 'GP', 'Pts/shot for', 'Pts/shot allowed']}
            rows={defense.byOpponent.map((o) => [
              <Link key={o.opponentId} href={`/${season.value}/${teamPath}/vs/${nameOf(o.opponentId).toLowerCase()}`} style={{ color: color.rustDeep }}>
                {nameOf(o.opponentId)}
              </Link>,
              o.games,
              fmt(pointsPerShot(o.offense) ?? 0, 2),
              fmt(pointsPerShot(o.defense) ?? 0, 2),
            ])}
          />
        </div>
      </Section>

      <Section
        title="Shot-making against expected"
        note="Actual field-goal points minus the model's expectation for the same attempts. Small samples swing; read the attempts column first."
      >
        <Table
          head={['Shooter', 'Attempts', 'Points', 'Expected', 'Above expected']}
          rows={value.shooters.slice(0, 12).map((s) => [
            s.displayName, s.attempts, s.actualPoints, fmt(s.expectedPoints), signed(s.actualPoints - s.expectedPoints),
          ])}
        />
      </Section>

      <Section
        title="Points created per assist"
        note="Assisted baskets with a resolved assister, and what the shots they set up were worth. Assists whose passer could not be identified are not credited to anyone."
      >
        <Table
          head={['Creator', 'Assists', 'Points', 'Points / assist', 'Expected / assist']}
          rows={value.creators.slice(0, 12).map((c) => [
            c.displayName, c.assists, c.points, fmt(c.points / c.assists, 2), fmt(c.expectedPointsOnAssistedShots / c.assists, 2),
          ])}
        />
      </Section>

      <Section
        title="Season over season"
        note="This team across every season loaded for it. Each season is scored against that season's own model."
      >
        <Table
          head={['Season', 'Games', 'Pts/shot', 'Expected/shot', '3PA share', 'Assisted share', 'Pts/shot allowed']}
          rows={trend.seasons.map((s) => [
            <Link key={s.season} href={`/${s.season}/${teamPath}/analysis`} style={{ color: color.rustDeep }}>{s.season}</Link>,
            s.games,
            fmt(pointsPerShot(s.offense) ?? 0, 3),
            fmt(expectedPerShot(s.offense) ?? 0, 3),
            pct(s.offense.threes, s.offense.shots),
            pct(s.offense.madeAssisted, s.offense.made),
            s.defense ? fmt(pointsPerShot(s.defense) ?? 0, 3) : '—',
          ])}
        />
      </Section>

      <Section
        title="Data audit"
        note={`Loaded ${seasonScope.lastLoadedAt ? seasonScope.lastLoadedAt.slice(0, 10) : 'at an unrecorded date'}. A game is left out of every figure on these pages when this team's side fails a validation check; the list below is the complete set of exclusions.`}
      >
        {audit.length === 0 ? (
          <p style={{ fontSize: 12 }}>No games excluded.</p>
        ) : (
          <Table head={['Game', 'Failed check']} rows={audit.map((a) => [a.gameId, a.reasons.join('; ')])} />
        )}
      </Section>

      {footnote && <p style={{ fontSize: 10, color: color.muted, maxWidth: 760 }}>{footnote}</p>}
    </Shell>
  );
}
