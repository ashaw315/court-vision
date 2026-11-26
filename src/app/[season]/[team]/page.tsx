import { notFound } from 'next/navigation';

import { CourtVision } from '@/components/CourtVision';
import { getSeasonScope, getTeamGrain } from '@/lib/api/queries';
import { parseSeason } from '@/lib/api/params';
import { GrainResponse } from '@/lib/contracts';
import { DEFAULT_SEASON } from '@/lib/data/scope';
import { color } from '@/lib/design/tokens';
import { teamByAbbreviation } from '@/lib/teams';

/**
 * One team-season, landing on the team scope.
 *
 * A server component — it resolves the URL to a loaded team-season, fetches and validates
 * the broadest scope, then hands a plain `GrainResponse` to the client component that owns
 * grain, selection and fetching. Data is read through the same query layer the API routes
 * use, so the page and `GET /api/team` cannot diverge.
 */

export const dynamic = 'force-dynamic';

export default async function TeamSeasonPage({
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

  const payload = await getTeamGrain(scope);

  // Validated here too: the component types itself against the contract, so a payload
  // that does not satisfy it is a bug worth surfacing rather than rendering around.
  const parsed = GrainResponse.safeParse(payload);
  if (!parsed.success) {
    return (
      <Notice
        title="Data failed contract validation"
        detail="The team payload did not match the contract. See the server log."
      />
    );
  }

  return (
    <CourtVision
      initialData={parsed.data}
      scope={seasonScope}
      season={season.value}
      team={team.abbreviation}
    />
  );
}

/** Empty/error states give direction, not mood. */
function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <main
      style={{
        background: color.shell,
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 460, color: color.text }}>
        <h1 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 28, margin: '0 0 8px' }}>
          {title}
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.7 }}>
          {detail}
        </p>
      </div>
    </main>
  );
}
