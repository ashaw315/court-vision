import { GrainResponse } from '@/lib/contracts';
import { parseGroupId } from '@/lib/api/params';
import { getLineup, getLineupGrain } from '@/lib/api/queries';
import { badRequest, notFound, serverError, validated } from '@/lib/api/respond';

/**
 * GET /api/lineup/[groupId]
 *
 * A five-man unit's assist network and shot map, FILTERED to the intervals that unit was
 * actually on court for — the lineup-filtered capability the project exists to provide.
 * Read-only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId: raw } = await params;

  const parsed = parseGroupId(raw);
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const groupId = parsed.value;

  try {
    const lineup = await getLineup(groupId);
    if (lineup === null) {
      // A well-formed groupId can miss for THREE different reasons, and the message used
      // to name only the last of them. Claiming "below the emit floor" for a five that is
      // really the 287-minute unit with its ids out of order sends someone debugging in
      // entirely the wrong direction, so all three are stated.
      return notFound(
        `No lineup with groupId ${groupId}. A groupId must list the five person ids in `
          + 'canonical sorted order; the five may also never have played together, or may '
          + 'fall below the 25-minute emit floor and so not be stored.',
      );
    }

    const payload = await getLineupGrain(lineup);
    return validated(GrainResponse, payload);
  } catch (error) {
    return serverError(error, `GET /api/lineup/${groupId}`);
  }
}
