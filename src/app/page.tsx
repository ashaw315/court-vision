import { CreationNetwork } from '@/components/network/CreationNetwork';
import { SpatialSignature } from '@/components/court/SpatialSignature';
import { GrainResponse } from '@/lib/contracts';
import { getLineup, getLineupGrain } from '@/lib/api/queries';
import { biggestConnection } from '@/lib/court/connection';
import { color } from '@/lib/design/tokens';

/**
 * Stage 1: the Creation Network plate for one lineup, static.
 *
 * The top unit (~287 min) is hardcoded here on purpose — grain switching and pickers are
 * Stage 5. Data is read through the same query layer the API routes use, so the page and
 * `GET /api/lineup/[groupId]` cannot diverge, and the payload is validated against the
 * Phase 2 contract before it reaches the component.
 */

const TOP_LINEUP = '-1629008-1629611-1629651-1641730-1642856-';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const lineup = await getLineup(TOP_LINEUP);
  if (!lineup) {
    return <Notice title="Lineup not found" detail={`No stored unit for ${TOP_LINEUP}.`} />;
  }

  const payload = await getLineupGrain(lineup);

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

  // Stage 2 shows the unit's biggest connection (Claxton → Porter Jr., 26 baskets).
  // Hardcoded on purpose — making it selectable from the network is Stage 3.
  const connection = biggestConnection(parsed.data);

  return (
    <main
      style={{
        background: color.shell,
        minHeight: '100vh',
        padding: '24px 0 48px',
        display: 'flex',
        flexDirection: 'column',
        gap: 48,
      }}
    >
      <CreationNetwork data={parsed.data} />
      {connection && <SpatialSignature connection={connection} />}
    </main>
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
