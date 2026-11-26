import type { MapShot } from '@/lib/contracts/analysis';
import { color } from '@/lib/design/tokens';

/**
 * A half-court shot map. Court units are tenths of a foot with the basket at the origin
 * (x -250..250, y -50..420); SVG's y runs down, so y is flipped.
 */
export function ShotMap({
  shots,
  label,
  accent = color.rust,
}: {
  shots: MapShot[];
  label: string;
  accent?: string;
}) {
  const made = shots.filter((s) => s.made);
  const missed = shots.filter((s) => !s.made);
  const y = (v: number) => 420 - v;
  // Three-point line: 23.75 ft arc (237.5) from the basket, 22 ft straight corners.
  const arcStartY = Math.sqrt(237.5 ** 2 - 220 ** 2);
  const threeLine =
    `M-220,${y(-50)} L-220,${y(arcStartY)} A237.5,237.5 0 0 1 220,${y(arcStartY)} L220,${y(-50)}`;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox="-260 -10 520 490"
        role="img"
        aria-label={`${label}: ${shots.length} attempts, ${made.length} made`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <rect x={-250} y={y(420)} width={500} height={470} fill="none" stroke={color.rule} strokeWidth={1} />
        <rect x={-80} y={y(140)} width={160} height={190} fill="none" stroke={color.structure} strokeWidth={1} />
        <circle cx={0} cy={y(0)} r={7.5} fill="none" stroke={color.structure} strokeWidth={1} />
        <path d={threeLine} fill="none" stroke={color.structure} strokeWidth={1} />
        {missed.map((s, i) => (
          <circle key={`m${i}`} cx={s.locX} cy={y(s.locY)} r={3} fill="none" stroke={color.muted} strokeWidth={0.8} opacity={0.45} />
        ))}
        {made.map((s, i) => (
          <circle key={`h${i}`} cx={s.locX} cy={y(s.locY)} r={3.4} fill={accent} opacity={0.7} />
        ))}
      </svg>
      <figcaption style={{ fontSize: 10, letterSpacing: '0.14em', color: color.muted, marginTop: 6 }}>
        {label.toUpperCase()} · {shots.length} ATTEMPTS · {made.length} MADE
      </figcaption>
    </figure>
  );
}
