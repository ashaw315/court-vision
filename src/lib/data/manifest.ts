import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/**
 * The ETL run manifest that ships with the tracked dataset.
 *
 * Describes the RUN rather than the data — how many games were scheduled, how many
 * validated, how many were excluded and why. That is why it is not in the database: those
 * numbers are properties of the pipeline execution, not rows to query.
 *
 * Read once and cached. Server-only (it touches the filesystem), which is fine — the scope
 * is resolved in a server component and passed down as plain data.
 */

const Manifest = z.object({
  gamesInSchedule: z.number().int().nonnegative(),
  aggregatedFrom: z.number().int().nonnegative(),
});
export type Manifest = z.infer<typeof Manifest>;

let cached: Manifest | null | undefined;

export function datasetManifest(): Manifest | null {
  if (cached !== undefined) return cached;

  try {
    const file = path.join(process.cwd(), 'data', 'season.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const parsed = Manifest.safeParse(raw.manifest);
    // A malformed manifest degrades to "no footnote" rather than to a wrong one: better
    // to say nothing about the schedule than to state a figure we cannot verify.
    cached = parsed.success ? parsed.data : null;
  } catch {
    cached = null;
  }

  return cached;
}
