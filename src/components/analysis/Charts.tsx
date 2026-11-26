import { color } from '@/lib/design/tokens';

/**
 * Rolling mean over a trailing window, defined from the first point (shorter windows at the
 * start). A `null` (no data for that game) stays `null` at its own index, so a series with
 * gaps stays aligned with a complete one on the same game axis; known values in the window
 * still average.
 */
export function rolling(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((v, i) => {
    if (v === null) return null;
    const known = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((x): x is number => x !== null);
    return known.reduce((a, b) => a + b, 0) / known.length;
  });
}

/** Split a series at gaps into runs of consecutive [index, value] points. */
function runs(values: Array<number | null>): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push([i, v]);
    }
  });
  if (current.length) out.push(current);
  return out;
}

/**
 * A small line chart with a zero baseline. Zero means "exactly what the model expected",
 * so a line above it is shooting better than the typical return from those spots.
 */
export function ZeroLine({
  series,
  height = 120,
}: {
  series: Array<{ label: string; values: Array<number | null>; stroke: string }>;
  height?: number;
}) {
  const width = 600;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
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
      {series.flatMap((s) =>
        runs(s.values).map((run) =>
          run.length === 1 ? (
            <circle key={`${s.label}-${run[0][0]}`} cx={x(run[0][0])} cy={y(run[0][1])} r={1.6} fill={s.stroke} />
          ) : (
            <polyline
              key={`${s.label}-${run[0][0]}`}
              fill="none"
              stroke={s.stroke}
              strokeWidth={1.6}
              points={run.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')}
            />
          ),
        ),
      )}
    </svg>
  );
}
