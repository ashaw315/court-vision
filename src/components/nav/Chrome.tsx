'use client';

import type { Grain } from '@/lib/contracts';
import { color, font, type } from '@/lib/design/tokens';

/**
 * Navigation chrome in the plate's own language.
 *
 * Mono type, the plate palette, hairline rules, square corners — the same vocabulary the
 * plates use. A rounded UI-kit toggle would read as browser chrome bolted onto a printed
 * figure; these controls should look like part of the instrument.
 */

const controlBase = {
  fontFamily: font.mono,
  fontSize: type.headerNote.size,
  letterSpacing: type.headerNote.letterSpacing,
  background: 'transparent',
  borderRadius: 0,
  cursor: 'pointer',
} as const;

/** The three data scopes, in the order they narrow. */
export const GRAINS: Array<{ value: Grain; label: string }> = [
  { value: 'team', label: 'TEAM' },
  { value: 'lineup', label: 'LINEUP' },
  { value: 'player', label: 'PLAYER' },
];

export function GrainSelector({
  grain,
  onChange,
  disabled = false,
}: {
  grain: Grain;
  onChange: (grain: Grain) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Data scope"
      style={{ display: 'flex', border: `1px solid ${color.rule}` }}
    >
      {GRAINS.map(({ value, label }, index) => {
        const active = value === grain;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(value)}
            style={{
              ...controlBase,
              padding: '6px 16px',
              border: 'none',
              borderLeft: index > 0 ? `1px solid ${color.rule}` : 'none',
              // The active scope inverts — the strongest signal available without adding
              // a colour the palette does not have.
              background: active ? color.ink : 'transparent',
              color: active ? color.ground : color.muted,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Shared select styling — a plate control, not a browser dropdown. */
const selectStyle = {
  ...controlBase,
  color: color.text,
  border: `1px solid ${color.rule}`,
  padding: '6px 10px',
  maxWidth: 460,
} as const;

export function LineupPicker({
  lineups,
  selected,
  onSelect,
  minMinutes,
  onMinMinutes,
  emitFloorMinutes,
  disabled = false,
}: {
  lineups: Array<{ groupId: string; displayNames: string[]; minutes: number }>;
  selected: string | null;
  onSelect: (groupId: string) => void;
  minMinutes: number;
  onMinMinutes: (minutes: number) => void;
  emitFloorMinutes: number;
  disabled?: boolean;
}) {
  const visible = lineups.filter((lineup) => lineup.minutes >= minMinutes);

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <select
        aria-label="Five-man unit"
        value={selected ?? ''}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        style={selectStyle}
      >
        {visible.map((lineup) => (
          <option key={lineup.groupId} value={lineup.groupId}>
            {`${lineup.displayNames.join(' · ')} — ${lineup.minutes.toFixed(0)} min`}
          </option>
        ))}
      </select>

      {/*
        The display threshold, owned by the frontend.
        This is the emit-floor decision paying off: the ETL emits everything down to 25
        minutes, and the UI chooses how much of that to surface. Minutes ride on every row
        so a thin unit is never mistaken for a substantial one.
      */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.mono,
          fontSize: type.footer.size,
          letterSpacing: type.footer.letterSpacing,
          color: color.mutedLight,
        }}
      >
        MIN
        <select
          aria-label="Minimum minutes"
          value={minMinutes}
          disabled={disabled}
          onChange={(event) => onMinMinutes(Number(event.target.value))}
          style={{ ...selectStyle, padding: '3px 6px' }}
        >
          <option value={50}>50 MIN</option>
          <option value={emitFloorMinutes}>{emitFloorMinutes} MIN — ALL</option>
        </select>
        <span>{visible.length} UNITS</span>
      </label>
    </div>
  );
}

export function PlayerPicker({
  players,
  selected,
  onSelect,
  disabled = false,
}: {
  players: Array<{ personId: number; displayName: string; shotCount: number }>;
  selected: number | null;
  onSelect: (personId: number) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Player"
      value={selected ?? ''}
      disabled={disabled}
      onChange={(event) => onSelect(Number(event.target.value))}
      style={selectStyle}
    >
      {players.map((player) => (
        <option key={player.personId} value={player.personId}>
          {`${player.displayName} — ${player.shotCount} shots`}
        </option>
      ))}
    </select>
  );
}

/** A quiet status line — loading and error share one slot so the layout never jumps. */
export function StatusLine({
  state,
  message,
}: {
  state: 'loading' | 'error' | 'idle';
  message?: string;
}) {
  if (state === 'idle') return null;
  return (
    <span
      role={state === 'error' ? 'alert' : 'status'}
      style={{
        fontFamily: font.mono,
        fontSize: type.footer.size,
        letterSpacing: type.footer.letterSpacing,
        color: state === 'error' ? color.rustDeep : color.mutedLight,
      }}
    >
      {state === 'error' ? (message ?? 'COULD NOT LOAD — TRY AGAIN') : 'LOADING…'}
    </span>
  );
}
