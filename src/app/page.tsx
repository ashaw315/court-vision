import Link from 'next/link';

import { label } from '@/components/analysis/Shell';
import { getTeamSeasons } from '@/lib/api/queries';
import { color, font } from '@/lib/design/tokens';
import { TEAMS, teamById } from '@/lib/teams';

/**
 * The league index: every loaded team-season, grouped by season, so any team can be opened
 * from here. Teams that are not loaded for a season are listed but not linked — an honest
 * gap rather than a link that 404s.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const loaded = await getTeamSeasons();
  const seasons = [...new Set(loaded.map((r) => r.season))].sort().reverse();
  const key = (season: string, teamId: number) => `${season}:${teamId}`;
  const byKey = new Map(loaded.map((r) => [key(r.season, r.teamId), r]));

  return (
    <main style={{ background: color.shell, minHeight: '100vh', padding: 'clamp(20px, 4vw, 48px)', color: color.ink, fontFamily: font.mono }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontFamily: font.serif, fontSize: 'clamp(34px, 6vw, 58px)', lineHeight: 0.95, margin: 0 }}>
          Court Vision
        </h1>
        <p style={{ ...label, marginTop: 10, maxWidth: 640, lineHeight: 1.7 }}>
          How every NBA team creates baskets: who sets up whom, where on the floor it lands, and
          what opponents do against them. Pick a season and a team.
        </p>

        {seasons.length === 0 && (
          <p style={{ fontSize: 12, marginTop: 36 }}>No team-seasons are loaded yet.</p>
        )}

        {seasons.map((season) => (
          <section key={season} style={{ marginTop: 40 }}>
            <h2 style={{ fontFamily: font.serif, fontSize: 26, margin: '0 0 12px' }}>{season}</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {TEAMS.map((team) => {
                const row = byKey.get(key(season, team.teamId));
                const name = teamById(team.teamId)!;
                return (
                  <li key={team.teamId} style={{ fontSize: 12 }}>
                    {row ? (
                      <Link
                        href={`/${season}/${team.abbreviation.toLowerCase()}`}
                        style={{ color: color.ink, display: 'block', padding: '8px 10px', border: `1px solid ${color.rule}` }}
                      >
                        <strong>{team.abbreviation}</strong> {name.name}
                        <span style={{ ...label, display: 'block', marginTop: 2 }}>
                          {row.gamesValidated}/{row.gamesScheduled} games
                        </span>
                      </Link>
                    ) : (
                      <span style={{ color: color.muted, display: 'block', padding: '8px 10px', border: `1px dashed ${color.rule}` }}>
                        {team.abbreviation} {name.name}
                        <span style={{ ...label, display: 'block', marginTop: 2 }}>not loaded</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
