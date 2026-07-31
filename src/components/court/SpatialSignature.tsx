import type { ShotEvent } from '@/lib/contracts';
import { color, font, type } from '@/lib/design/tokens';
import {
  COURT,
  COURT_VIEW,
  HOOP,
  cornerLineEnd,
  isInsideCrop,
  shotToCourt,
  threePointArcPath,
} from '@/lib/court/geometry';
import { buildSpatialReading, type ConnectionShots } from '@/lib/court/connection';
import type { SeasonScope } from '@/lib/data/scope';
import { formatScope, methodologyFootnote } from '@/lib/data/scope';
import { SHOT_BLOOM_MS, shotBloomDelay } from '@/lib/motion/play';
import { formatShare } from '@/lib/network/model';

/**
 * FIG. 12c — Spatial Signature: where one creation connection puts the ball in.
 *
 * The companion plate to the Creation Network. Same tokens, same framing, same hairline
 * vocabulary, so the two read as a matched pair — the network says WHO creates for whom,
 * this says WHERE that creation scores.
 *
 * Fed by the network's selection (Stage 3). Stage 4 adds the bloom as a transition layer:
 * with `animate={false}` (or reduced motion) this renders exactly the Stage 2 static court.
 */

/** Court furniture, drawn as a delicate plate rather than a realistic floor. */
function CourtLines() {
  const cornerEndY = cornerLineEnd();

  return (
    <>
      {/* Structural hairlines — sidelines, key, circles, arc. */}
      <g
        fill="none"
        stroke={color.structure}
        strokeWidth={0.9}
        opacity={0.6}
        strokeLinecap="round"
      >
        {/* Sidelines and baseline, drawn as one open path like the design. */}
        <path
          d={`M${COURT.sidelineLeftX},${COURT.cropY} L${COURT.sidelineLeftX},${COURT.baselineY} `
            + `L${COURT.sidelineRightX},${COURT.baselineY} L${COURT.sidelineRightX},${COURT.cropY}`}
        />
        <rect
          x={COURT.key.x}
          y={COURT.key.y}
          width={COURT.key.width}
          height={COURT.key.height}
        />
        <circle
          cx={COURT.freeThrowCircle.cx}
          cy={COURT.freeThrowCircle.cy}
          r={COURT.freeThrowCircle.r}
        />
        {/* Three-point arc, generated at a true 23.75 ft from the hoop. */}
        <path d={threePointArcPath()} />
        {/* Corner segments, meeting the arc exactly where it ends. */}
        <line
          x1={COURT.cornerLineLeftX}
          y1={COURT.baselineY}
          x2={COURT.cornerLineLeftX}
          y2={cornerEndY}
        />
        <line
          x1={COURT.cornerLineRightX}
          y1={COURT.baselineY}
          x2={COURT.cornerLineRightX}
          y2={cornerEndY}
        />
      </g>

      {/* Backboard and rim, in ink — the one place the court asserts itself. */}
      <g fill="none" stroke={color.ink} strokeWidth={1.1} opacity={0.8} strokeLinecap="round">
        <line
          x1={COURT.backboard.x1}
          y1={COURT.backboard.y}
          x2={COURT.backboard.x2}
          y2={COURT.backboard.y}
        />
        <circle cx={HOOP.x} cy={HOOP.y} r={COURT.rimRadius} />
      </g>

      {/* Centre line and the dashed crop edge at 40 ft. */}
      <g stroke={color.structure} strokeWidth={0.6} opacity={0.35} strokeDasharray="1 5">
        <line x1={HOOP.x} y1={COURT.baselineY} x2={HOOP.x} y2={COURT.cropY} />
        <line
          x1={COURT.sidelineLeftX}
          y1={COURT.cropY}
          x2={COURT.sidelineRightX}
          y2={COURT.cropY}
        />
      </g>
    </>
  );
}

/**
 * One made basket.
 *
 * Twos are open rust rings with a centre dot; threes are acid discs with a thin outer
 * ring — the same green the network uses for high-value connections, so the two plates
 * share one meaning for the colour.
 */
function ShotMark({
  shot,
  bloomDelay,
}: {
  shot: ShotEvent;
  /** ms delay for the bloom, or null to render settled. */
  bloomDelay: number | null;
}) {
  const point = shotToCourt(shot.locX, shot.locY);
  const bloom =
    bloomDelay === null
      ? undefined
      : {
        animation: `cv-bloom ${SHOT_BLOOM_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${bloomDelay}ms both`,
        // Scale about the mark itself, so a basket grows in place rather than
        // sliding in from the court's origin.
        transformOrigin: `${point.x}px ${point.y}px`,
      };

  if (shot.shotValue === 3) {
    return (
      <g style={bloom}>
        <circle cx={point.x} cy={point.y} r={5.4} fill={color.acid} opacity={0.92} />
        <circle
          cx={point.x}
          cy={point.y}
          r={9.6}
          fill="none"
          stroke={color.acidDeep}
          strokeWidth={0.7}
          opacity={0.75}
        />
      </g>
    );
  }

  return (
    <g style={bloom}>
      <circle
        cx={point.x}
        cy={point.y}
        r={5.8}
        fill="none"
        stroke={color.rust}
        strokeWidth={0.9}
        opacity={0.85}
      />
      <circle cx={point.x} cy={point.y} r={1.1} fill={color.rust} opacity={0.85} />
    </g>
  );
}

export type SpatialSignatureProps = {
  connection: ConnectionShots;
  /** The time scope every figure on this plate is summed over. */
  scope?: SeasonScope | null;
  /** Play the bloom. False renders the settled Stage 2 court immediately. */
  animate?: boolean;
};

export function SpatialSignature({
  connection,
  scope = null,
  animate = false,
}: SpatialSignatureProps) {
  const { tally } = connection;
  const reading = buildSpatialReading(connection);

  // Shots outside the 40 ft crop cannot be drawn honestly, so they are counted and named
  // rather than clamped to the edge — a mark at the crop line would assert a location the
  // shot does not have. (On the validated connection this is zero.)
  const visible = connection.shots.filter((shot) =>
    isInsideCrop(shotToCourt(shot.locX, shot.locY)),
  );
  const clipped = connection.shots.length - visible.length;

  const caption = `${connection.assisterName.toUpperCase()} → ${connection.shooterName.toUpperCase()}`
    + ` · ${formatShare(Math.round(connection.share * 10) / 10)} OF UNIT CREATION`
    + ` · ${tally.total} ${tally.total === 1 ? 'BASKET' : 'BASKETS'}`;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1440,
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
          fontSize: type.header.size,
          letterSpacing: type.header.letterSpacing,
          color: color.muted,
        }}
      >
        <span>FIG. 12c — SPATIAL SIGNATURE · ONE CONNECTION</span>
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
          Spatial Signature
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
          where this connection<br />puts the ball in
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            textAlign: 'right',
            paddingBottom: 6,
            fontSize: type.headerNote.size,
            letterSpacing: type.headerNote.letterSpacing,
            color: color.muted,
          }}
        >
          HALF COURT · MADE BASKETS ONLY
          <br />
          POSITION = SHOT LOCATION, AT REST
        </div>
      </div>

      {/* ── connection caption ──────────────────────────────────────── */}
      <div
        style={{
          fontSize: type.headerNote.size,
          letterSpacing: type.headerNote.letterSpacing,
          color: color.rustDeep,
          paddingTop: 10,
        }}
      >
        {caption}
        {scope && (
          <>
            {' · '}
            {/* The basket and point counts above are season totals; without this a
                reader cannot tell them from a single game's. */}
            <span style={{ color: color.muted }}>
              {formatScope(scope).toUpperCase()}
              {methodologyFootnote(scope) && '\u2009*'}
            </span>
          </>
        )}
      </div>

      {/* ── court + side panel ──────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 'clamp(24px, 4vw, 56px)',
          marginTop: 10,
        }}
      >
        <div style={{ flex: '1 1 460px', maxWidth: 760 }}>
          <svg
            viewBox={`0 0 ${COURT_VIEW.width} ${COURT_VIEW.height}`}
            style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
            role="img"
            aria-label={
              `Half court showing ${tally.total} made baskets from `
              + `${connection.assisterName} to ${connection.shooterName}. ${reading}`
            }
          >
            <CourtLines />

            <g>
              {visible.map((shot, index) => (
                <ShotMark
                  key={`${shot.gameId}-${shot.eventId}`}
                  shot={shot}
                  bloomDelay={animate ? shotBloomDelay(index, visible.length) : null}
                />
              ))}
            </g>

            <text
              x={COURT.sidelineLeftX}
              y={COURT_VIEW.height - 18}
              fill={color.mutedLight}
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: '0.2em',
              }}
            >
              HALF COURT · 50 FT WIDE · CROPPED AT 40 FT
            </text>
            <text
              x={COURT.sidelineRightX}
              y={COURT_VIEW.height - 18}
              textAnchor="end"
              fill={color.mutedLight}
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: '0.2em',
              }}
            >
              FIG. 12c
            </text>
          </svg>
        </div>

        <div
          style={{
            width: 330,
            flex: '0 1 330px',
            display: 'flex',
            flexDirection: 'column',
            gap: 26,
            paddingTop: 8,
          }}
        >
          <Encoding tally={tally} clipped={clipped} />
          <Reading text={reading} />
          <Tally tally={tally} />
        </div>
      </div>

      {/* ── footer ──────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 22,
          borderTop: `1px solid ${color.rule}`,
          paddingTop: 14,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: type.footer.size,
          letterSpacing: type.footer.letterSpacing,
          color: color.mutedLight,
        }}
      >
        <span>PAIRS WITH FIG. 12b — CREATION NETWORK</span>
        <span>COURT VISION NETWORK · PLATE 2 / 2 — SPATIAL SIGNATURE</span>
      </div>

      {/* Same methodology note as the network plate — the counts above are season totals
          over the validated subset, and the gap to 82 needs naming wherever it appears. */}
      {scope && methodologyFootnote(scope) && (
        <div
          style={{
            marginTop: 10,
            fontSize: type.footer.size,
            letterSpacing: type.footer.letterSpacing,
            color: color.muted,
          }}
        >
          {methodologyFootnote(scope)}
        </div>
      )}
    </div>
  );
}

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

function Encoding({ tally, clipped }: { tally: ConnectionShots['tally']; clipped: number }) {
  const legendText = {
    fontFamily: font.mono,
    fontSize: type.legend.size,
    letterSpacing: type.legend.letterSpacing,
    color: color.text,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionMark>§E / ENCODING</SectionMark>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width={30} height={20} style={{ display: 'block' }}>
          <circle cx={14} cy={10} r={5.8} fill="none" stroke={color.rust} strokeWidth={0.9} opacity={0.85} />
          <circle cx={14} cy={10} r={1.1} fill={color.rust} opacity={0.85} />
        </svg>
        <span style={legendText}>TWO — {tally.rim + tally.mid} MADE</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width={30} height={22} style={{ display: 'block' }}>
          <circle cx={14} cy={11} r={5.4} fill={color.acid} opacity={0.92} />
          <circle cx={14} cy={11} r={9.6} fill="none" stroke={color.acidDeep} strokeWidth={0.7} opacity={0.75} />
        </svg>
        <span style={legendText}>THREE — {tally.three} MADE · HIGH VALUE</span>
      </div>

      <div style={{ ...legendText, lineHeight: 1.7, paddingTop: 2 }}>
        ONE MARK = ONE MADE BASKET,
        <br />
        PLOTTED AT ITS COURT LOCATION.
      </div>

      {/* Only appears if a basket falls beyond the crop — silence would be a lie. */}
      {clipped > 0 && (
        <div style={{ ...legendText, color: color.rustDeep, lineHeight: 1.7 }}>
          {clipped} BASKET{clipped === 1 ? '' : 'S'} BEYOND 40 FT, NOT SHOWN.
        </div>
      )}
    </div>
  );
}

function Reading({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionMark>§F / READING</SectionMark>
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

function Tally({ tally }: { tally: ConnectionShots['tally'] }) {
  const rows: Array<[string, number, string]> = [
    ['AT RIM', tally.rim, color.rustDeep],
    ['MID-RANGE', tally.mid, color.rustDeep],
    ['THREE', tally.three, color.acidDeep],
    ['POINTS FROM CONNECTION', tally.points, color.rustDeep],
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        borderTop: `1px solid ${color.rule}`,
        paddingTop: 12,
        fontFamily: font.mono,
        fontSize: type.legend.size,
        letterSpacing: type.legend.letterSpacing,
        color: color.text,
      }}
    >
      {rows.map(([label, value, valueColor]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{label}</span>
          <span style={{ color: valueColor }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
