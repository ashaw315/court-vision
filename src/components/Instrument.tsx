'use client';

import { useState } from 'react';

import { SpatialSignature } from '@/components/court/SpatialSignature';
import { CreationNetwork } from '@/components/network/CreationNetwork';
import type { GrainResponse } from '@/lib/contracts';
import { selectConnection } from '@/lib/court/connection';
import { color, font, type } from '@/lib/design/tokens';
import {
  toggleSelection,
  type ConnectionSelection,
} from '@/lib/network/selection';

/**
 * The instrument: the network as index, the court as detail.
 *
 * Owns the one piece of state that fuses the two plates — which connection is selected —
 * and passes the SAME selection to both, which is what guarantees the court's caption and
 * count always describe the emphasised arc.
 *
 * At rest the network stands alone: it is the index, and there is nothing to detail yet.
 * Selecting a connection resolves the court beside it, because reading structure and space
 * together is the whole point of the pairing.
 *
 * No motion here — Stage 4 owns that. Selection simply reflows.
 */
export function Instrument({ data }: { data: GrainResponse }) {
  const [selection, setSelection] = useState<ConnectionSelection | null>(null);

  const connection = selection
    ? selectConnection(data, selection.assisterId, selection.shooterId)
    : null;

  const handleSelect = (clicked: ConnectionSelection) => {
    setSelection((current) => toggleSelection(current, clicked));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '24px 0 48px',
        background: color.shell,
        minHeight: '100vh',
      }}
    >
      {connection && (
        <SelectionBar
          label={`${connection.assisterName} → ${connection.shooterName}`}
          count={connection.tally.total}
          onClear={() => setSelection(null)}
        />
      )}

      {/*
        Side by side once a connection is selected — both plates fully readable at once.
        `minWidth: 0` on each column lets the SVGs shrink inside the flex row instead of
        forcing an overflow; below the breakpoint the columns wrap and stack.
      */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 24,
          padding: '0 clamp(0px, 1vw, 16px)',
        }}
      >
        <div style={{ flex: connection ? '1 1 640px' : '1 1 100%', minWidth: 0 }}>
          <CreationNetwork
            data={data}
            selection={selection}
            onSelectConnection={handleSelect}
          />
        </div>

        {connection && (
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <SpatialSignature connection={connection} />
          </div>
        )}
      </div>

      {!connection && <RestingHint />}
    </div>
  );
}

/**
 * The clear affordance, plus a plain statement of what is selected.
 *
 * The emphasised arc already carries the selection visually; this makes it nameable and
 * gives an obvious way back to rest that does not require finding the arc again.
 */
function SelectionBar({
  label,
  count,
  onClear,
}: {
  label: string;
  count: number;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        maxWidth: 1440,
        width: '100%',
        margin: '0 auto',
        padding: '0 clamp(18px, 4vw, 56px)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
        fontFamily: font.mono,
        fontSize: type.headerNote.size,
        letterSpacing: type.headerNote.letterSpacing,
        color: color.muted,
      }}
    >
      <span style={{ color: color.rustDeep }}>
        SHOWING {label.toUpperCase()} · {count} {count === 1 ? 'BASKET' : 'BASKETS'}
      </span>
      <button
        type="button"
        onClick={onClear}
        style={{
          font: 'inherit',
          letterSpacing: 'inherit',
          color: color.muted,
          background: 'transparent',
          border: `1px solid ${color.rule}`,
          borderRadius: 0,
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        CLEAR SELECTION
      </button>
    </div>
  );
}

/** Tells a first-time reader the network is interactive, without shouting. */
function RestingHint() {
  return (
    <div
      style={{
        maxWidth: 1440,
        width: '100%',
        margin: '0 auto',
        padding: '0 clamp(18px, 4vw, 56px)',
        boxSizing: 'border-box',
        fontFamily: font.mono,
        fontSize: type.headerNote.size,
        letterSpacing: type.headerNote.letterSpacing,
        color: color.mutedLight,
      }}
    >
      SELECT A CONNECTION TO SEE WHERE IT SCORES
    </div>
  );
}
