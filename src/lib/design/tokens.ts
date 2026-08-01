/**
 * Design tokens — the single source of truth for the whole frontend.
 *
 * Every value is extracted verbatim from `design/creation-network.html` (the resolved
 * design exported from Claude Design), not eyeballed. Where a number appears here it can
 * be found in that file; where the design left something implicit it is called out in a
 * comment rather than quietly invented.
 */

/**
 * Palette. Counts below are occurrences in the design file — a rough guide to how load-
 * bearing each colour is, and a reminder that the accent is deliberately scarce.
 */
export const color = {
  /** Page ground behind the plate. */
  shell: '#EDE7D8',
  /** Plate ground. */
  ground: '#F2EDE0',
  /** Primary ink — titles, node rings. */
  ink: '#1E1B16',
  /** The workhorse warm. Arcs, node fill, origination bars. */
  rust: '#A8442A',
  /** Darker rust for emphasised text — % labels, readouts. */
  rustDeep: '#8A3520',
  /** Body/annotation text. */
  text: '#4A4438',
  /**
   * Mono label grey. Darkened from the design's #7C7261 (4.05:1 on the bone ground — below
   * AA for the 8.5–11px mono this colour is used for). 4.85:1 now, deliberately kept just
   * UNDER rust's 5.10 so annotation never out-weighs the accent.
   */
  muted: '#6E6657',
  /**
   * Lighter mono grey — section markers, axis captions. The worst offender in the audit at
   * 2.73:1: legible on the designer's display, not on real ones. 4.64:1 now, still the
   * lightest text tone so the hierarchy is unchanged.
   */
  mutedLight: '#71695A',
  /**
   * Hairlines and rules. Darkened from #C9C0AC (1.55:1). Structure, not text, so it stays
   * well below the text tones — but the plate's rules were disappearing entirely.
   */
  rule: '#B0A896',
  /** Court/structure lines, node fill hairline. */
  structure: '#6E6555',
  /**
   * Empty track behind origination bars. Darkened from #E2DAC7 (1.19:1 — invisible) so the
   * bar's full extent reads and a short bar is legible as a proportion. It must stay well
   * below the rust bar it sits behind, so this is tuned by eye against the bar rather than
   * pushed to a text-grade ratio.
   */
  track: '#B5AC97',
  /**
   * The acid accent. Rare by design — highest-value connections only.
   *
   * HUE AND MEANING UNCHANGED: this is the shot-value encoding. Only text-weight variants
   * below are adjusted, never this mark fill.
   */
  acid: '#A9BE12',
  /**
   * Darker acid, for acid-coloured text (contrast on the light ground). Same hue, deepened
   * from #7C8C0A (3.20:1) to clear AA where it labels data.
   */
  acidDeep: '#637008',
} as const;

/**
 * Typefaces. The CSS variables are set by `next/font` in the root layout (self-hosted,
 * non-blocking); the literal names are the fallback so these tokens still resolve if a
 * component is rendered outside that layout — e.g. in a test or a standalone story.
 */
export const font = {
  mono: "var(--font-mono, 'JetBrains Mono'), ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "var(--font-serif, 'Playfair Display'), Georgia, serif",
} as const;

/**
 * Type scale. The design works almost entirely between 8.5px and 17px, with one 58px
 * title — the contrast between the two is the whole typographic idea, so these are kept
 * exact rather than rounded into a tidy scale.
 */
export const type = {
  title: { size: 58, weight: 700, lineHeight: 0.9, letterSpacing: '-0.012em' },
  subhead: { size: 17, lineHeight: 1.22 },
  reading: { size: 14.5, lineHeight: 1.5 },
  nodeName: { size: 12, letterSpacing: '0.12em' },
  nodeReadout: { size: 9, letterSpacing: '0.14em' },
  nodeIndex: { size: 8.5, letterSpacing: '0.2em' },
  arcLabel: { size: 10, letterSpacing: '0.1em' },
  axisCaption: { size: 8.5, letterSpacing: '0.2em' },
  sectionMark: { size: 9, letterSpacing: '0.18em' },
  legend: { size: 9.5, letterSpacing: '0.13em' },
  header: { size: 9.5, letterSpacing: '0.18em' },
  headerNote: { size: 9.5, letterSpacing: '0.16em' },
  footer: { size: 9, letterSpacing: '0.16em' },
} as const;

/** Plate frame — the 1440px page and its padding, straight from the design. */
export const plate = {
  width: 1440,
  padding: '34px 56px 44px',
} as const;

/**
 * Network geometry. The viewBox and every constant the design's own render script uses,
 * so the React rebuild produces the same drawing rather than a lookalike.
 */
export const network = {
  viewBox: { width: 1060, height: 700 },
  /** Node radius (R in the design script). */
  nodeRadius: 22,
  /** Gap between node edge and where a strand starts (GAP in the design script). */
  nodeGap: 7,
  /** Arc bow as a fraction of chord length (`arcCurvature` prop default). */
  curvature: 0.2,
  /** Perpendicular spacing between strands in a bundle (`weaveSpread` prop default). */
  weaveSpread: 2.2,
  /** Role-space band lines and their captions. */
  originatesY: 118,
  receivesY: 600,
  axisLeft: 70,
  axisRight: 990,
  /** Centre used by the design to push % labels outward from the middle of the plate. */
  labelOrigin: { x: 530, y: 360 },
} as const;

/**
 * Encoding rules, isolated because they are claims about the data rather than styling.
 */
export const encoding = {
  /** Below this share of unit creation, a connection carries no % label. */
  labelMinShare: 7,
  /**
   * At or above this share a connection is DOMINANT: a solid woven bundle. Below it the
   * connection is FAINT and draws as dotted hairlines that recede into texture.
   */
  denseMinShare: 6,
  /** A faint connection at or above this share gets two hairlines instead of one. */
  faintPairShare: 3,
  /**
   * Strand-count range for dominant bundles. The span is deliberately wide — this is the
   * plate's primary magnitude read, and a narrow range makes connections unrankable at a
   * glance.
   */
  denseMinStrands: 4,
  denseMaxStrands: 18,
  /** Node fill opacity. */
  fillOpacity: 0.82,
  /** Node ring. */
  ringWidth: 0.85,
} as const;
