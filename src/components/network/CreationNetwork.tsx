'use client';

import { useState } from 'react';

import type { Grain, GrainResponse } from '@/lib/contracts';
import { color, encoding, font, network, type } from '@/lib/design/tokens';
import {
  ACID_THRESHOLD_PPB,
  buildConnections,
  buildOrigination,
  buildReading,
  buildRoleNodes,
  buildStrands,
  formatPct,
  type RoleNode,
  type StrandBundle,
} from '@/lib/network/model';
import type { SeasonScope } from '@/lib/data/scope';
import { formatScope, methodologyFootnote } from '@/lib/data/scope';
import {
  arcSequence,
  nodeSettleMs,
  NODE_FADE_MS,
  NODE_STAGGER_MS,
} from '@/lib/motion/play';
import {
  DIM_OPACITY,
  connectionLabel,
  isDimmed,
  isNodeDimmed,
  isSelected,
  type ConnectionSelection,
} from '@/lib/network/selection';

/**
 * FIG. 12b — Creation Network, position as role.
 *
 * A faithful React + hand-rolled SVG rebuild of `design/creation-network.html`, fed by a
 * real `GrainResponse`. Every element is JSX; d3 appears only as maths (scale/geometry) in
 * `lib/network/model`, never touching the DOM.
 *
 * Interactive from Stage 3: each connection is a focusable target that selects itself,
 * dimming the rest of the field so the emphasised arc ties to the court plate beside it.
 *
 * Stage 4 adds the draw-in as a TRANSITION layer: arcs grow along their paths in
 * volume-order after the nodes land. The settled composition is unchanged — with
 * `animate={false}` (or reduced motion) this renders exactly the Stage 1 plate.
 */

const VIEW = network.viewBox;

/**
 * Dash length for the reveal mask. Comfortably longer than any arc in the viewBox, so the
 * mask sweeps fully open regardless of the connection's length.
 */
const REVEAL_LENGTH = 1600;

/**
 * What the plate is a picture of, per scope.
 *
 * Hardcoding "FIVE-MAN UNIT" was true while the tool only drew lineups; at team and player
 * grain it captions the wrong subject on an otherwise correct plate.
 */
const SUBJECT: Record<Grain, string> = {
  team: 'FULL ROSTER',
  lineup: 'FIVE-MAN UNIT',
  player: 'ONE PLAYER',
};

/** Node label placement: the design pushes labels away from the plate's centre column. */
function labelAnchor(node: RoleNode): {
  tx: number; ty: number; iy: number; anchor: 'start' | 'middle' | 'end';
} {
  const isCentreColumn = Math.abs(node.x - VIEW.width / 2) < 120;
  if (isCentreColumn) {
    // Centre nodes label above or below, whichever keeps clear of the strand bundles.
    const above = node.y < VIEW.height / 2;
    return above
      ? { tx: node.x, ty: node.y - 50, iy: node.y - 63, anchor: 'middle' }
      : { tx: node.x, ty: node.y + 52, iy: node.y + 39, anchor: 'middle' };
  }
  const toRight = node.x > VIEW.width / 2;
  return toRight
    ? { tx: node.x + 46, ty: node.y + 4, iy: node.y - 9, anchor: 'start' }
    : { tx: node.x - 46, ty: node.y + 4, iy: node.y - 9, anchor: 'end' };
}

function NodeMark({
  node,
  dimmed,
  fadeDelay,
}: {
  node: RoleNode;
  dimmed: boolean;
  /** ms delay for the land-in, or null to render settled. */
  fadeDelay: number | null;
}) {
  const R = network.nodeRadius;
  const anchor = labelAnchor(node);
  const clipId = `fill-${node.personId}`;

  // Fill height IS the assisted split: a node filled 80% reads 80% assisted, with the
  // empty portion being self-created. A null split (no made baskets) draws empty — never
  // a full or zero-filled node, because that would assert a measure we do not have.
  const split = node.assistedPct ?? 0;
  const fillTop = node.y + R - 2 * R * split;

  return (
    <g
      opacity={dimmed ? DIM_OPACITY : 1}
      style={
        fadeDelay === null
          ? undefined
          : {
            animation: `cv-node ${NODE_FADE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${fadeDelay}ms both`,
            transformOrigin: `${node.x}px ${node.y}px`,
          }
      }
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={node.x - R} y={fillTop} width={2 * R} height={2 * R} />
        </clipPath>
      </defs>

      <circle cx={node.x} cy={node.y} r={R} fill={color.ground} />
      {node.assistedPct !== null && (
        <>
          <circle
            cx={node.x}
            cy={node.y}
            r={R}
            fill={color.rust}
            opacity={encoding.fillOpacity}
            clipPath={`url(#${clipId})`}
          />
          {/* Hairline at the fill level — reads the value precisely off the node. */}
          <line
            x1={node.x - R + 1.5}
            y1={fillTop}
            x2={node.x + R - 1.5}
            y2={fillTop}
            stroke={color.structure}
            strokeWidth={0.6}
            opacity={0.6}
          />
        </>
      )}
      <circle
        cx={node.x}
        cy={node.y}
        r={R}
        fill="none"
        stroke={color.ink}
        strokeWidth={encoding.ringWidth}
      />

      <text
        x={anchor.tx}
        y={anchor.iy}
        textAnchor={anchor.anchor}
        fill={color.mutedLight}
        style={{
          fontFamily: font.mono,
          fontSize: type.nodeIndex.size,
          letterSpacing: type.nodeIndex.letterSpacing,
        }}
      >
        {node.index}
      </text>
      <text
        x={anchor.tx}
        y={anchor.ty}
        textAnchor={anchor.anchor}
        fill={color.ink}
        style={{
          fontFamily: font.mono,
          fontSize: type.nodeName.size,
          letterSpacing: type.nodeName.letterSpacing,
        }}
      >
        {node.name.toUpperCase()}
      </text>
      <text
        x={anchor.tx}
        y={anchor.ty + 13}
        textAnchor={anchor.anchor}
        fill={color.rustDeep}
        style={{
          fontFamily: font.mono,
          fontSize: type.nodeReadout.size,
          letterSpacing: type.nodeReadout.letterSpacing,
        }}
      >
        {node.assistedPct === null
          ? 'NO MADE BASKETS'
          : `${formatPct(node.assistedPct)} ASSISTED`}
      </text>
    </g>
  );
}

/**
 * One connection, as an interactive target.
 *
 * The visible marks are hairlines — far too thin to click reliably — so a single fat
 * invisible path sits behind them carrying the pointer and focus. That path is the
 * button; the strands are its appearance.
 *
 * Rendered as a real focusable element with a role and keyboard handling rather than a
 * click-only `<path>`, so keyboard users are not locked out and Stage 6 has nothing to
 * retrofit.
 */
function ConnectionArc({
  bundle,
  selected,
  dimmed,
  interactive,
  label,
  onActivate,
  draw,
}: {
  bundle: StrandBundle;
  selected: boolean;
  dimmed: boolean;
  interactive: boolean;
  label: string;
  onActivate?: () => void;
  /** Draw-in timing, or null to render the finished arc immediately. */
  draw: { delay: number; duration: number } | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const maskId = `reveal-${bundle.assisterId}-${bundle.shooterId}`;

  // Hover and keyboard focus both lift a connection out of the field so it reads as
  // clickable. Dimmed arcs stay visible as context — the unit's shape is still the point.
  const active = hovered || focused;
  const groupOpacity = dimmed ? (active ? DIM_OPACITY * 2.4 : DIM_OPACITY) : 1;
  const emphasis = selected || (active && !dimmed);

  return (
    <g
      opacity={groupOpacity}
      style={{ cursor: interactive ? 'pointer' : undefined }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/*
        The draw-in reveals each bundle through a MASK rather than by animating its own
        `stroke-dasharray`.

        Animating the dasharray was a regression: a dotted strand's pattern IS its
        dasharray, so overwriting it to draw meant every faint connection rendered solid
        for the duration — and with animation on by default, solid is what readers saw.
        The mask leaves each strand's own dash pattern completely untouched, so a dotted
        arc draws dotted and stays dotted.
      */}
      {draw && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <path
              d={bundle.hitPath}
              fill="none"
              stroke="#fff"
              strokeWidth={64}
              strokeLinecap="round"
              strokeDasharray={REVEAL_LENGTH}
              strokeDashoffset={REVEAL_LENGTH}
              style={{
                animation: `cv-draw ${draw.duration}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${draw.delay}ms both`,
              }}
            />
          </mask>
        </defs>
      )}

      <g mask={draw ? `url(#${maskId})` : undefined}>
        {bundle.strands.map((strand, i) => (
          <path
            key={i}
            d={strand.d}
            fill="none"
            stroke={strand.color}
            strokeWidth={emphasis ? strand.width * 1.9 : strand.width}
            strokeDasharray={strand.dash}
            strokeLinecap="round"
            opacity={emphasis ? Math.min(1, strand.opacity * 1.5) : strand.opacity}
            markerEnd={strand.marker ? `url(#ah-${strand.marker})` : undefined}
          />
        ))}
      </g>

      {interactive && (
        <path
          d={bundle.hitPath}
          fill="none"
          // Invisible, but a comfortable target. `stroke` must be set (not `none`) for
          // pointer events to register along the path.
          stroke="transparent"
          strokeWidth={22}
          strokeLinecap="round"
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={label}
          onClick={onActivate}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              // Space would scroll the page otherwise.
              event.preventDefault();
              onActivate?.();
            }
          }}
          style={{ cursor: 'pointer', outline: 'none' }}
        />
      )}

      {/* Selected marker — a dashed rail along the connection, so which arc is selected
          stays obvious even when the court beside it is scrolled out of view. */}
      {selected && (
        <path
          d={bundle.hitPath}
          fill="none"
          stroke={bundle.isHighValue ? color.acidDeep : color.rustDeep}
          strokeWidth={0.7}
          strokeDasharray="2 3"
          strokeLinecap="round"
          opacity={0.55}
          pointerEvents="none"
        />
      )}

      {/* Focus ring, drawn rather than left to the UA outline — a browser outline on an
          SVG path renders as a useless bounding box. Keyboard users need to see where
          they are before they commit to activating. */}
      {focused && (
        <path
          d={bundle.hitPath}
          fill="none"
          stroke={color.ink}
          strokeWidth={2.4}
          strokeLinecap="round"
          opacity={0.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

export type CreationNetworkProps = {
  data: GrainResponse;
  /** The connection currently selected, or null at rest. */
  selection?: ConnectionSelection | null;
  /** Called when a connection is activated by click or keyboard. */
  onSelectConnection?: (selection: ConnectionSelection) => void;
  /** The time scope every figure on this plate is summed over. */
  scope?: SeasonScope | null;
  /** What the plate dropped to stay legible, if anything — stated, never implied. */
  densityNote?: string | null;
  /**
   * Play the draw-in. When false the plate renders its final static composition
   * immediately — which is what `prefers-reduced-motion` gets, and what the server
   * renders.
   */
  animate?: boolean;
};

export function CreationNetwork({
  data,
  selection = null,
  onSelectConnection,
  scope = null,
  densityNote = null,
  animate = false,
}: CreationNetworkProps) {
  const nodes = buildRoleNodes(data);
  const connections = buildConnections(data.edges);
  const { bundles, labels } = buildStrands(connections, nodes, {
    warm: color.rust,
    acid: color.acid,
  });
  const nameById = new Map(data.players.map((player) => [player.personId, player.displayName]));
  const interactive = typeof onSelectConnection === 'function';
  const origination = buildOrigination(nodes);
  const reading = buildReading(connections, nodes);

  /**
   * The play is a pure render-time decision, not a state machine.
   *
   * `animate` is false for reduced motion and on the server, so those render the settled
   * plate directly. When true, the CSS animations run once and finish on their own — no
   * timer, no setState, nothing to unwind. React re-rendering for hover or focus does not
   * restart them, because a CSS animation only replays if the element remounts, and the
   * `playKey` on this subtree is what controls that.
   */
  // Nodes land top-down (creators first), matching how the plate is read.
  // Not manually memoized: these are cheap Map builds over arrays this render already
  // computed, and the React Compiler memoizes the component for us.
  const nodeIndex = new Map(
    [...nodes]
      .sort((a, b) => a.y - b.y)
      .map((node, i) => [node.personId, i * NODE_STAGGER_MS] as const),
  );

  const settle = nodeSettleMs(nodes.length);
  const arcTimings = new Map(
    arcSequence(connections, settle).map(
      (timing) => [`${timing.assisterId}-${timing.shooterId}`, timing] as const,
    ),
  );

  const playing = animate;

  const topShare = connections[0]?.share ?? 0;
  const topThree = connections.slice(0, 3).reduce((sum, c) => sum + c.share, 0);
  const character = topThree >= 40 ? 'CONCENTRATED' : topThree >= 28 ? 'BALANCED' : 'DISTRIBUTED';

  const monoLabel = (size: number, spacing: string, fill: string) => ({
    fontFamily: font.mono,
    fontSize: size,
    letterSpacing: spacing,
    color: fill,
  });

  return (
    <div
      style={{
        width: '100%',
        maxWidth: plateWidth,
        margin: '0 auto',
        background: color.ground,
        color: color.ink,
        fontFamily: font.mono,
        padding: 'clamp(20px, 3vw, 34px) clamp(18px, 4vw, 56px) 44px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── header rule ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          paddingBottom: 9,
          borderBottom: `1px solid ${color.rule}`,
          ...monoLabel(type.header.size, type.header.letterSpacing, color.muted),
        }}
      >
        <span>FIG. 12b — CREATION NETWORK · {SUBJECT[data.scope.grain]} · POSITION AS ROLE</span>
        <span style={{ whiteSpace: 'nowrap' }}>N.º 0034 · 05 · CVN · MMXXVI</span>
      </div>

      {/* ── title ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 18,
          paddingTop: 22,
        }}
      >
        <h1
          style={{
            fontFamily: font.serif,
            fontWeight: type.title.weight,
            fontSize: 'clamp(34px, 4.2vw, 58px)',
            lineHeight: type.title.lineHeight,
            letterSpacing: type.title.letterSpacing,
            margin: 0,
          }}
        >
          Creation Network
        </h1>
        <div
          style={{
            fontFamily: font.serif,
            fontStyle: 'italic',
            fontSize: type.subhead.size,
            lineHeight: type.subhead.lineHeight,
            color: color.text,
            paddingBottom: 4,
          }}
        >
          arranged by role —<br />creators above, scorers below
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            textAlign: 'right',
            paddingBottom: 6,
            ...monoLabel(type.headerNote.size, type.headerNote.letterSpacing, color.muted),
          }}
        >
          VERTICAL AXIS · CREATION ORIGINATED
          <br />
          {/*
            Shares are computed over the arcs actually drawn, so on a thinned plate they
            sum to 100% OF THOSE ARCS — not of the team's whole season. Saying "100% of
            assisted creation" there would contradict the density note directly below,
            which reports the real share of the season these arcs carry.
          */}
          ARCS SUM TO 100% OF {densityNote ? 'CREATION SHOWN' : 'ASSISTED CREATION'}
          {scope && (
            <>
              <br />
              {/* Every figure on this plate is a season total. Saying so is the point —
                  without it a reader cannot tell one game from a whole season. */}
              <span style={{ color: color.rustDeep }}>
                {formatScope(scope).toUpperCase()}
                {methodologyFootnote(scope) && '\u2009*'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── state line ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 26,
          paddingTop: 10,
          ...monoLabel(type.headerNote.size, type.headerNote.letterSpacing, color.mutedLight),
        }}
      >
        <span>§A / RESTING STATE{densityNote ? '' : ' · ALL CONNECTIONS SHOWN'}</span>
        <span style={{ color: color.rustDeep }}>
          TOP CONNECTION {formatPct(topShare / 100, topShare % 1 === 0 ? 0 : 1)} · {character}
        </span>
        <span>{data.scope.label.toUpperCase()}</span>
        {/* A thinned plate must say so on its face, not only in a tooltip. */}
        {densityNote && <span style={{ color: color.muted }}>{densityNote}</span>}
      </div>

      {/* ── the network ─────────────────────────────────────────────── */}
      <div style={{ position: 'relative', marginTop: 4 }}>
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
          role="img"
          aria-label={`Creation network for ${data.scope.label}. ${reading}`}
        >
          <defs>
            <marker
              id="ah-warm"
              viewBox="0 0 8 8"
              refX="6.2"
              refY="3"
              markerWidth="6.4"
              markerHeight="6.4"
              orient="auto"
            >
              <path
                d="M0.8,0.8 L6,3 L0.8,5.2"
                fill="none"
                stroke={color.rust}
                strokeWidth="0.75"
                strokeLinecap="round"
              />
            </marker>
            <marker
              id="ah-acid"
              viewBox="0 0 8 8"
              refX="6.2"
              refY="3"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path
                d="M0.8,0.8 L6,3 L0.8,5.2"
                fill="none"
                stroke={color.acid}
                strokeWidth="0.9"
                strokeLinecap="round"
              />
            </marker>
          </defs>

          {/* role-space bands */}
          <g>
            <line
              x1={network.axisLeft}
              y1={network.originatesY}
              x2={network.axisRight}
              y2={network.originatesY}
              stroke={color.rule}
              strokeWidth={0.6}
              strokeDasharray="1 5"
            />
            <line
              x1={network.axisLeft}
              y1={network.receivesY}
              x2={network.axisRight}
              y2={network.receivesY}
              stroke={color.rule}
              strokeWidth={0.6}
              strokeDasharray="1 5"
            />
            <text
              x={network.axisLeft}
              y={network.originatesY - 10}
              fill={color.mutedLight}
              style={{
                fontFamily: font.mono,
                fontSize: type.axisCaption.size,
                letterSpacing: type.axisCaption.letterSpacing,
              }}
            >
              ORIGINATES CREATION
            </text>
            <text
              x={network.axisLeft}
              y={network.receivesY + 16}
              fill={color.mutedLight}
              style={{
                fontFamily: font.mono,
                fontSize: type.axisCaption.size,
                letterSpacing: type.axisCaption.letterSpacing,
              }}
            >
              RECEIVES CREATION
            </text>
          </g>

          {/* woven strand bundles — density encodes share; each bundle is one target */}
          <g>
            {bundles.map((bundle) => {
              const selected = isSelected(selection, bundle);
              const dimmed = isDimmed(selection, bundle);
              const assister = nameById.get(bundle.assisterId) ?? String(bundle.assisterId);
              const shooter = nameById.get(bundle.shooterId) ?? String(bundle.shooterId);

              return (
                <ConnectionArc
                  key={`${bundle.assisterId}-${bundle.shooterId}`}
                  bundle={bundle}
                  selected={selected}
                  dimmed={dimmed}
                  interactive={interactive}
                  label={connectionLabel(assister, shooter, bundle.share, selected)}
                  onActivate={
                    onSelectConnection
                      ? () =>
                        onSelectConnection({
                          assisterId: bundle.assisterId,
                          shooterId: bundle.shooterId,
                        })
                      : undefined
                  }
                  draw={
                    playing
                      ? arcTimings.get(`${bundle.assisterId}-${bundle.shooterId}`) ?? null
                      : null
                  }
                />
              );
            })}
          </g>

          {/* % labels, only on connections >= 7% */}
          <g>
            {labels.map((label, i) => (
              <text
                key={i}
                x={label.x}
                y={label.y}
                textAnchor="middle"
                fill={label.color}
                // A label recedes with its own arc; leaving it bright would let the
                // dimmed field keep competing with the selected connection.
                opacity={isDimmed(selection, label) ? DIM_OPACITY : 1}
                style={{
                  fontFamily: font.mono,
                  fontSize: type.arcLabel.size,
                  letterSpacing: type.arcLabel.letterSpacing,
                }}
              >
                {label.text}
              </text>
            ))}
          </g>

          <g>
            {nodes.map((node) => (
              <NodeMark
                key={node.personId}
                node={node}
                dimmed={isNodeDimmed(selection, node.personId)}
                fadeDelay={playing ? nodeIndex.get(node.personId) ?? 0 : null}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* ── footer ──────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 18,
          borderTop: `1px solid ${color.rule}`,
          paddingTop: 14,
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 'clamp(24px, 4vw, 60px)',
        }}
      >
        <Encoding />
        <Reading text={reading} />
        <Origination rows={origination} />
        <div style={{ flex: 1 }} />
        <div
          style={{
            textAlign: 'right',
            lineHeight: 1.8,
            ...monoLabel(type.footer.size, type.footer.letterSpacing, color.mutedLight),
          }}
        >
          COURT VISION NETWORK
          <br />
          PLATE 1 / 2 — POSITION AS ROLE
        </div>
      </div>

      {/* The methodology note. 72 next to an 82-game season reads as an error unless the
          gap is named — stating it plainly is a credibility signal, not an apology. */}
      {scope && methodologyFootnote(scope) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: `1px solid ${color.rule}`,
            ...monoLabel(type.footer.size, type.footer.letterSpacing, color.muted),
          }}
        >
          {methodologyFootnote(scope)}
        </div>
      )}
    </div>
  );
}

const plateWidth = network.viewBox.width * 1.36; // the design's 1440px page

function SectionMark({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type.sectionMark.size,
        letterSpacing: type.sectionMark.letterSpacing,
        color: color.mutedLight,
      }}
    >
      {children}
    </div>
  );
}

function LegendRow({ children, swatch }: { children: React.ReactNode; swatch: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {swatch}
      <span
        style={{
          fontFamily: font.mono,
          fontSize: type.legend.size,
          letterSpacing: type.legend.letterSpacing,
          color: color.text,
        }}
      >
        {children}
      </span>
    </div>
  );
}

function Encoding() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <SectionMark>§B / ENCODING</SectionMark>

      <LegendRow
        swatch={
          <svg width={92} height={14} style={{ display: 'block', overflow: 'visible' }}>
            <path d="M2,3 C26,3 62,3 90,3" fill="none" stroke={color.rust} strokeWidth={1} strokeDasharray="0.1 5.5" strokeLinecap="round" opacity={0.6} />
            {[8, 9.6, 11.2, 12.8].map((y) => (
              <path key={y} d={`M2,${y} C26,${y} 62,${y} 90,${y}`} fill="none" stroke={color.rust} strokeWidth={0.5} strokeLinecap="round" opacity={0.6} />
            ))}
          </svg>
        }
      >
        DENSITY · SHARE OF UNIT CREATION
      </LegendRow>

      <LegendRow
        swatch={
          <svg width={92} height={12} style={{ display: 'block', overflow: 'visible' }}>
            <path d="M2,4 C26,4 62,4 90,4" fill="none" stroke={color.rust} strokeWidth={1.6} strokeLinecap="round" opacity={0.8} />
            <path d="M2,10 C26,10 62,10 90,10" fill="none" stroke={color.acid} strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        }
      >
        {/* Stated as points per MADE basket, because attempts-per-connection is not
            derivable from this data — the legend must not imply a figure we lack. */}
        HUE · SHOT VALUE — ACID = {ACID_THRESHOLD_PPB.toFixed(2)}+ PTS / MADE BASKET
      </LegendRow>

      <LegendRow
        swatch={
          <svg width={92} height={26} style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <clipPath id="lg-a"><rect x={0} y={16.4} width={30} height={12} /></clipPath>
              <clipPath id="lg-b"><rect x={34} y={6.6} width={30} height={22} /></clipPath>
            </defs>
            <circle cx={12} cy={13} r={11} fill={color.rust} opacity={encoding.fillOpacity} clipPath="url(#lg-a)" />
            <circle cx={12} cy={13} r={11} fill="none" stroke={color.ink} strokeWidth={encoding.ringWidth} />
            <circle cx={46} cy={13} r={11} fill={color.rust} opacity={encoding.fillOpacity} clipPath="url(#lg-b)" />
            <circle cx={46} cy={13} r={11} fill="none" stroke={color.ink} strokeWidth={encoding.ringWidth} />
          </svg>
        }
      >
        NODE FILL · ASSISTED SPLIT — EMPTY = SELF-CREATOR
      </LegendRow>
    </div>
  );
}

function Reading({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 330 }}>
      <SectionMark>§C / READING</SectionMark>
      <div
        style={{
          fontFamily: font.serif,
          fontStyle: 'italic',
          fontSize: type.reading.size,
          lineHeight: type.reading.lineHeight,
          color: color.text,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Origination({
  rows,
}: {
  rows: Array<{ personId: number; name: string; share: number; label: string }>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <SectionMark>§D / ORIGINATION</SectionMark>
      {rows.map((row) => (
        <div
          key={row.personId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: font.mono,
            fontSize: type.legend.size,
            letterSpacing: type.legend.letterSpacing,
            color: color.text,
          }}
        >
          <span style={{ width: 106 }}>{row.name.toUpperCase()}</span>
          <span
            style={{
              width: 170,
              height: 3,
              background: color.track,
              display: 'block',
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                background: color.rust,
                opacity: 0.85,
                width: `${row.share}%`,
              }}
            />
          </span>
          <span style={{ color: color.rustDeep }}>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
