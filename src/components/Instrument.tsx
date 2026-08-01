'use client';

import { useEffect, useRef, useState } from 'react';

import { SpatialSignature } from '@/components/court/SpatialSignature';
import { InfoPanel, InfoTab } from '@/components/InfoPanel';
import { CreationNetwork } from '@/components/network/CreationNetwork';
import type { GrainResponse } from '@/lib/contracts';
import { selectConnection } from '@/lib/court/connection';
import type { SeasonScope } from '@/lib/data/scope';
import { COURT_SLIDE_MS, playKey } from '@/lib/motion/play';
import {
  collapsePanel,
  initialPanelState,
  onSelectionChange,
  openPanel,
} from '@/lib/panel/state';
import { useReducedMotion } from '@/lib/motion/useReducedMotion';
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
 * Also owns the motion policy: whether the play runs at all (reduced motion), and the key
 * that decides WHEN it re-runs. Both plates animate only on load, lineup change and
 * connection select — never on an incidental re-render.
 */
export function Instrument({
  data,
  scope = null,
  densityNote = null,
  fullScope = null,
}: {
  data: GrainResponse;
  scope?: SeasonScope | null;
  /** What the plate had to drop to stay legible, if anything. Team grain only. */
  densityNote?: string | null;
  /** The scope before thinning, so §D can report true whole-scope shares. */
  fullScope?: GrainResponse | null;
}) {
  const [selection, setSelection] = useState<ConnectionSelection | null>(null);

  /**
   * A new scope means the old selection is meaningless — that connection may not exist in
   * the new data. Clearing on scope change keeps the court from showing a connection the
   * network no longer draws.
   *
   * Done by storing the scope alongside the selection and adjusting during render (React's
   * documented pattern for derived state) rather than in an effect — an effect would
   * render one frame of the new plate with the old connection still lit.
   */
  const scopeKey = `${data.scope.grain}:${data.scope.id ?? 'team'}`;
  const [lastScope, setLastScope] = useState(scopeKey);
  const scopeJustChanged = lastScope !== scopeKey;
  if (scopeJustChanged) {
    setLastScope(scopeKey);
    setSelection(null);
  }

  // Non-negotiable: a reader who asked for reduced motion gets the settled plates with no
  // draw-in and no bloom. This also governs the server render, where the hook reports
  // `true` and the first paint is therefore static.
  /**
   * The reading guide sits in the empty space beside the network at rest, and stands aside
   * when the court is summoned. Adjusted during render off the selection transition rather
   * than in an effect — an effect would paint one frame with both panels fighting.
   */
  const [panel, setPanel] = useState(initialPanelState);
  const [panelSawSelection, setPanelSawSelection] = useState(selection !== null);
  const hasSelection = selection !== null;
  if (panelSawSelection !== hasSelection) {
    setPanel(onSelectionChange(panel, panelSawSelection, hasSelection));
    setPanelSawSelection(hasSelection);
  }

  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion;

  // The play restarts only when this changes — a new lineup or a new selection. Hover,
  // focus and other re-renders produce the same key and no replay.
  const key = playKey(data.scope.id, selection);

  const connection = selection
    ? selectConnection(data, selection.assisterId, selection.shooterId)
    : null;

  /**
   * Keep the court mounted briefly after it is cleared, so it can slide OUT.
   *
   * Unmounting on deselect would make the panel vanish instantly, which is not a
   * transition — the brief says slides in AND out. `exiting` holds the last connection
   * just long enough to play the exit, then drops it.
   *
   * Under reduced motion there is no exit to play, so the panel is dropped immediately.
   */
  // The exiting connection travels WITH the scope it belonged to, so a slide-out can never
  // be replayed under a different subject's heading.
  const [exiting, setExiting] = useState<{ connection: typeof connection; scopeKey: string } | null>(null);
  // The previous connection AND the scope it belonged to. Tracking the connection alone was
  // the bug: on a grain change the effect stamped the outgoing connection with the NEW
  // scopeKey, so the guard below saw a match and slid the old scope's court back in one
  // frame after it had correctly cleared.
  const previous = useRef<{ connection: typeof connection; scopeKey: string }>({
    connection,
    scopeKey,
  });

  useEffect(() => {
    const was = previous.current;
    previous.current = { connection, scopeKey };

    // Only play the exit when the connection was cleared WITHIN one scope — a deselect.
    // A scope change is not a deselect; its court must go immediately, not slide.
    if (was.connection && !connection && animate && was.scopeKey === scopeKey) {
      setExiting({ connection: was.connection, scopeKey: was.scopeKey });
      const timer = window.setTimeout(() => setExiting(null), COURT_SLIDE_MS);
      return () => window.clearTimeout(timer);
    }
    setExiting(null);
    return undefined;
  }, [connection, animate, scopeKey]);

  /**
   * Never animate a connection out under a DIFFERENT scope's heading.
   *
   * The slide-out holds the last connection for COURT_SLIDE_MS so it can leave gracefully.
   * That is right for a deselect, but on a grain change it kept the previous scope's court
   * on screen while the network header already read the new one — measured at ~12 frames
   * where "FIVE-MAN UNIT" captioned a 94-basket team-grain connection. A stale reading is
   * worse than a missing transition, so a scope change drops the court immediately.
   */
  const exitingHere = exiting !== null
    && !scopeJustChanged
    && exiting.scopeKey === scopeKey
    ? exiting.connection
    : null;

  const shown = connection ?? exitingHere;
  const isExiting = connection === null && shown !== null;

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
        {panel.open ? (
          <div
            style={{
              flex: connection ? '0 1 330px' : '0 1 360px',
              minWidth: 0,
              // Reduced motion gets no slide — the guide simply is, or is not, there.
              animation: animate
                ? `cv-slide-in ${COURT_SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) both`
                : undefined,
            }}
          >
            <InfoPanel
              grain={data.scope.grain}
              scope={scope}
              onCollapse={() => setPanel(collapsePanel(panel))}
            />
          </div>
        ) : (
          <InfoTab onOpen={() => setPanel(openPanel(panel, hasSelection))} />
        )}

        <div style={{ flex: connection ? '1 1 560px' : '1 1 620px', minWidth: 0 }}>
          <CreationNetwork
            // Keyed on the LINEUP only, not the selection: selecting a connection must
            // dim the field, not replay the whole draw-in. A lineup change (Stage 5)
            // remounts and re-runs the play, which is exactly when it should.
            key={`network:${data.scope.id ?? 'team'}`}
            data={data}
            selection={selection}
            onSelectConnection={handleSelect}
            scope={scope}
            animate={animate}
            densityNote={densityNote}
            fullScope={fullScope}
          />
        </div>

        {shown && (
          <div
            style={{
              flex: '1 1 560px',
              minWidth: 0,
              // Slide in on select, out on clear. Reduced motion gets neither — the panel
              // simply is, or is not, there.
              animation: animate
                ? `${isExiting ? 'cv-slide-out' : 'cv-slide-in'} ${COURT_SLIDE_MS}ms `
                  + 'cubic-bezier(0.22, 0.61, 0.36, 1) both'
                : undefined,
              pointerEvents: isExiting ? 'none' : undefined,
            }}
          >
            <SpatialSignature
              // Remounting on selection change restarts the bloom for the new shot set;
              // without it React would reuse the settled marks and nothing would animate.
              key={key}
              connection={shown}
              scope={scope}
              animate={animate && !isExiting}
            />
          </div>
        )}
      </div>

      {!connection && !isExiting && <RestingHint />}
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
