import { Instrument } from '@/components/Instrument';
import { GrainResponse } from '@/lib/contracts';
import { getLineup, getLineupGrain, getSeasonScope } from '@/lib/api/queries';
import { color } from '@/lib/design/tokens';

/**
 * The instrument for one lineup: network as index, court as detail.
 *
 * A server component — it fetches and validates, then hands a plain `GrainResponse` to the
 * client component that owns selection. Data is read through the same query layer the API
 * routes use, so the page and `GET /api/lineup/[groupId]` cannot diverge.
 *
 * The top unit (~287 min) is hardcoded on purpose; grain switching and pickers are Stage 5.
 */

const TOP_LINEUP = '-1629008-1629611-1629651-1641730-1642856-';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const lineup = await getLineup(TOP_LINEUP);
  if (!lineup) {
    return <Notice title="Lineup not found" detail={`No stored unit for ${TOP_LINEUP}.`} />;
  }

  const [payload, scope] = await Promise.all([
    getLineupGrain(lineup),
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
        detail="The lineup payload did not match the Phase 2 contract. See the server log."
      />
    );
  }

  // Stage 3: the network is the index and owns selection; the court resolves beside it
  // when a connection is chosen. Still the hardcoded top lineup — pickers are Stage 5.
  return <Instrument data={parsed.data} scope={scope} />;
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
