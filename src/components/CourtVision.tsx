'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Instrument } from '@/components/Instrument';
import {
  GrainSelector,
  LineupPicker,
  PlayerPicker,
  StatusLine,
} from '@/components/nav/Chrome';
import {
  GrainResponse,
  LineupsResponse,
  PlayersResponse,
  type Grain,
  type LineupSummary,
  type PlayersResponse as PlayersPayload,
} from '@/lib/contracts';
import type { SeasonScope } from '@/lib/data/scope';
import { color, font, type } from '@/lib/design/tokens';
import { grainUrl, unitForGrain } from '@/lib/nav/routes';
import { DENSITY, densityNoteText, scopeForPlate } from '@/lib/network/density';

/**
 * The whole instrument: one plate, three scopes.
 *
 * This component owns grain and unit selection and does the fetching; `Instrument` stays a
 * pure renderer of a `GrainResponse`. That is the point of the shared contract — the team,
 * lineup and player views are the SAME instrument fed three different scopes, not three
 * UIs. The only per-grain difference is a density limit passed as a parameter, and even
 * that goes through the contract-shaped `scopeForPlate` rather than a branch in the plate.
 *
 * Team is the landing scope: the broadest read of the offence, narrowing from there.
 */

type PlayerOption = PlayersPayload['players'][number];

/** Everything the chrome needs to populate its pickers, loaded once. */
type Catalog = {
  lineups: LineupSummary[];
  emitFloorMinutes: number;
  players: PlayerOption[];
};

const DEFAULT_MIN_MINUTES = 50;

/**
 * Fetch and validate against the contract.
 *
 * The API already validates on the way out; validating again on the way in means a drifted
 * or truncated payload fails loudly here instead of rendering as a subtly wrong plate.
 */
async function fetchValidated<T>(
  url: string,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success || parsed.data === undefined) {
    throw new Error(`${url} did not match the data contract`);
  }
  return parsed.data;
}

export function CourtVision({
  initialData,
  scope,
}: {
  /** The team scope, rendered by the server so the landing view needs no round-trip. */
  initialData: GrainResponse;
  scope: SeasonScope | null;
}) {
  const [grain, setGrain] = useState<Grain>('team');
  const [lineupId, setLineupId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [minMinutes, setMinMinutes] = useState(DEFAULT_MIN_MINUTES);

  const [data, setData] = useState<GrainResponse>(initialData);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('idle');
  const [message, setMessage] = useState<string>();

  // Load the picker catalog once. Both lists are small; the plate payloads are not, so
  // those stay on demand.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [lineups, players] = await Promise.all([
          fetchValidated(
            `/api/lineups?minMinutes=${DEFAULT_MIN_MINUTES}`,
            LineupsResponse,
            controller.signal,
          ),
          fetchValidated('/api/players', PlayersResponse, controller.signal),
        ]);
        setCatalog({
          lineups: lineups.lineups,
          emitFloorMinutes: lineups.emitFloorMinutes,
          players: players.players,
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        // A failed catalog disables the pickers but leaves the team plate standing —
        // the landing view does not depend on it.
        setCatalog(null);
      }
    })();
    return () => controller.abort();
  }, []);

  /**
   * The catalog is fetched at the default threshold, so lowering the threshold has to
   * refetch. Raising it only filters, which the picker already does client-side.
   */
  useEffect(() => {
    if (minMinutes >= DEFAULT_MIN_MINUTES) return;
    const controller = new AbortController();
    (async () => {
      try {
        const payload = await fetchValidated(
          `/api/lineups?minMinutes=${minMinutes}`,
          LineupsResponse,
          controller.signal,
        );
        setCatalog((current) =>
          current === null ? current : { ...current, lineups: payload.lineups },
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    })();
    return () => controller.abort();
  }, [minMinutes]);

  /**
   * Load the plate for the current scope.
   *
   * Requests are sequenced by a token rather than only aborted: a slow earlier response
   * must never overwrite a newer scope's plate. Aborting handles the common case; the
   * token handles the race where a response is already in flight past the abort point.
   */
  const requestToken = useRef(0);

  const load = useCallback((target: Grain, unitId: string | number | null) => {
    const url = grainUrl(target, unitId);
    if (url === null) return;

    const token = requestToken.current + 1;
    requestToken.current = token;
    const controller = new AbortController();

    setStatus('loading');
    setMessage(undefined);

    (async () => {
      try {
        const payload = await fetchValidated(url, GrainResponse, controller.signal);
        if (requestToken.current !== token) return;
        setData(payload);
        setStatus('idle');
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (requestToken.current !== token) return;
        setStatus('error');
        setMessage(
          target === 'team'
            ? 'COULD NOT LOAD THE TEAM SCOPE — TRY AGAIN'
            : 'COULD NOT LOAD THAT SELECTION — TRY AGAIN',
        );
      }
    })();

    return () => controller.abort();
  }, []);

  /** Switching grain moves to that scope's current selection, defaulting to the first. */
  function chooseGrain(next: Grain) {
    if (next === grain) return;
    setGrain(next);

    if (next === 'team') {
      load('team', null);
      return;
    }
    if (next === 'lineup') {
      const id = unitForGrain(lineupId, catalog?.lineups[0]?.groupId);
      setLineupId(id);
      load('lineup', id);
      return;
    }
    const id = unitForGrain(playerId, catalog?.players[0]?.personId);
    setPlayerId(id);
    load('player', id);
  }

  function chooseLineup(groupId: string) {
    setLineupId(groupId);
    load('lineup', groupId);
  }

  function choosePlayer(personId: number) {
    setPlayerId(personId);
    load('player', personId);
  }

  // The single per-grain parameter: how much the plate can legibly draw. Everything after
  // this point is grain-agnostic.
  const { data: plate, note } = scopeForPlate(data, DENSITY[data.scope.grain]);

  const busy = status === 'loading';

  return (
    <main
      style={{
        background: color.shell,
        minHeight: '100vh',
        // Nav height, published once so the reading guide's viewport cap tracks it.
        ['--cv-nav-h' as string]: '62px',
      }}
    >
      <nav
        aria-label="Scope"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '18px 24px',
          borderBottom: `1px solid ${color.rule}`,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: type.footer.size,
            letterSpacing: type.footer.letterSpacing,
            color: color.mutedLight,
          }}
        >
          SCOPE
        </span>

        <GrainSelector grain={grain} onChange={chooseGrain} disabled={busy} />

        {grain === 'lineup' && catalog && (
          <LineupPicker
            lineups={catalog.lineups}
            selected={lineupId}
            onSelect={chooseLineup}
            minMinutes={minMinutes}
            onMinMinutes={setMinMinutes}
            emitFloorMinutes={catalog.emitFloorMinutes}
            disabled={busy}
          />
        )}

        {grain === 'player' && catalog && (
          <PlayerPicker
            players={catalog.players}
            selected={playerId}
            onSelect={choosePlayer}
            disabled={busy}
          />
        )}

        <StatusLine state={status} message={message} />
      </nav>

      <Instrument
        data={plate}
        scope={scope}
        densityNote={densityNoteText(note)}
        // Same note the header renders, so §III's capping copy tracks the plate exactly.
        density={note}
        // The unthinned payload: §D reports shares of this, not of the drawn subgraph.
        fullScope={data}
      />
    </main>
  );
}
