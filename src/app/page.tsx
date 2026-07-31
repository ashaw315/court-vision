import { CourtVision } from '@/components/CourtVision';
import { GrainResponse } from '@/lib/contracts';
import { getSeasonScope, getTeamGrain } from '@/lib/api/queries';
import { color } from '@/lib/design/tokens';

/**
 * The instrument, landing on the team scope.
 *
 * A server component — it fetches and validates the broadest scope, then hands a plain
 * `GrainResponse` to the client component that owns grain, selection and fetching. Data is
 * read through the same query layer the API routes use, so the page and `GET /api/team`
 * cannot diverge, and the landing view costs no client round-trip.
 */

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [payload, scope] = await Promise.all([
    getTeamGrain(),
    // The validated game count every figure is summed over — read from the data.
    getSeasonScope(),
  ]);

  // Validated here too: the component types itself against the contract, so a payload
  // that does not satisfy it is a bug worth surfacing rather than rendering around.
  const parsed = GrainResponse.safeParse(payload);
  if (!parsed.success) {
    return (
      <Notice
        title="Data failed contract validation"
        detail="The team payload did not match the Phase 2 contract. See the server log."
      />
    );
  }

  return <CourtVision initialData={parsed.data} scope={scope} />;
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
