import { redirect } from 'next/navigation';

import { DEFAULT_SEASON } from '@/lib/data/scope';

/**
 * The landing route. Until the league index lands, it opens the default team-season.
 * Kept as a redirect (not a copy of the page) so there is one place that renders a
 * team-season.
 */
export default function Home() {
  redirect(`/${DEFAULT_SEASON}/bkn`);
}
