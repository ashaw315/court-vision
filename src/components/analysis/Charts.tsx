import { color } from '@/lib/design/tokens';

/** Rolling mean over a window, defined from the first point (shorter windows at the start). */
export function rolling(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * A small line chart with a zero baseline. Zero means "exactly what the model expected",
 * so a line above it is shooting better than the typical return from those spots.
 */
export function ZeroLine({
  series,
  height = 120,
}: {
  series: Array<{ label: string; values: number[]; stroke: string }>;
  height?: number;
}) {
  const width = 600;
  const all = series.flatMap((s) => s.values);
  if (all.length < 2) {
    return <p style={{ fontSize: 11, color: color.muted }}>NOT ENOUGH GAMES TO CHART</p>;
  }
  const max = Math.max(1, ...all.map(Math.abs));
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => (i / Math.max(1, n - 1)) * width;
  const y = (v: number) => height / 2 - (v / max) * (height / 2 - 6);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={series.map((s) => s.label).join(' vs ')}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={color.rule} strokeWidth={1} />
      {series.map((s) => (
        <polyline
          key={s.label}
          fill="none"
          stroke={s.stroke}
          strokeWidth={1.6}
          points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        />
      ))}
    </svg>
  );
}
