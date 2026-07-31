'use client';

import { useSyncExternalStore } from 'react';

/**
 * Does the reader prefer reduced motion?
 *
 * Non-negotiable per CLAUDE.md: when this is true the plates render their final static
 * state immediately — no draw-in, no bloom. Not a shorter animation; none.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: `matchMedia` IS an external
 * store, and subscribing to it properly avoids the synchronous-setState-in-effect pattern
 * that causes cascading renders. It also gives the right SSR answer by construction — the
 * server snapshot returns `true`, so the first paint is static and a reader who asked for
 * no motion never sees a frame of it.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(QUERY).matches;
}

/** On the server there is no preference to read, so assume the quieter option. */
function getServerSnapshot(): boolean {
  return true;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
