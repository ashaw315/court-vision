import Link from 'next/link';
import type { ReactNode } from 'react';

import { color, font } from '@/lib/design/tokens';

export const label = {
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: '0.16em',
  color: color.muted,
  textTransform: 'uppercase' as const,
};

export function Shell({
  title,
  subtitle,
  seasons,
  currentSeason,
  teamPath,
  children,
}: {
  title: string;
  subtitle: string;
  /** Seasons loaded for this team, for the switcher. */
  seasons: string[];
  currentSeason: string;
  /** Lower-case abbreviation used in URLs. */
  teamPath: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        background: color.shell,
        minHeight: '100vh',
        padding: 'clamp(20px, 4vw, 48px)',
        color: color.ink,
        fontFamily: font.mono,
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <nav style={{ ...label, display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 28 }} aria-label="Views">
          <Link href="/" style={{ color: color.rustDeep }}>All teams</Link>
          <Link href={`/${currentSeason}/${teamPath}`} style={{ color: color.rustDeep }}>Creation network</Link>
          <Link href={`/${currentSeason}/${teamPath}/analysis`} style={{ color: color.rustDeep }}>Analysis</Link>
        </nav>
        <h1 style={{ fontFamily: font.serif, fontSize: 'clamp(34px, 6vw, 58px)', lineHeight: 0.95, margin: 0 }}>
          {title}
        </h1>
        <p style={{ ...label, marginTop: 10 }}>{subtitle}</p>
        {seasons.length > 1 && (
          <p style={{ ...label, marginTop: 14 }}>
            Season{' '}
            {seasons.map((s) => (
              <Link
                key={s}
                href={`/${s}/${teamPath}/analysis`}
                aria-current={s === currentSeason ? 'page' : undefined}
                style={{
                  marginRight: 12,
                  color: s === currentSeason ? color.ink : color.rustDeep,
                  fontWeight: s === currentSeason ? 700 : 400,
                  textDecoration: s === currentSeason ? 'none' : 'underline',
                }}
              >
                {s}
              </Link>
            ))}
          </p>
        )}
        <div style={{ marginTop: 36 }}>{children}</div>
      </div>
    </main>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontFamily: font.serif, fontSize: 24, margin: '0 0 4px' }}>{title}</h2>
      {note && <p style={{ ...label, margin: '0 0 16px', maxWidth: 760, lineHeight: 1.7, textTransform: 'none', letterSpacing: '0.04em', fontSize: 11 }}>{note}</p>}
      {children}
    </section>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    // Focusable so a keyboard user can scroll a table that is wider than a phone screen.
    <div role="region" aria-label={`Table: ${head.join(', ')}`} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" style={{ ...label, textAlign: i === 0 ? 'left' : 'right', padding: '6px 10px', borderBottom: `1px solid ${color.rule}`, fontWeight: 400 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ textAlign: c === 0 ? 'left' : 'right', padding: '6px 10px', borderBottom: `1px solid ${color.track}`, fontVariantNumeric: 'tabular-nums' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
