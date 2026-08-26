/**
 * §6: fuzzy-match the AI's `owner` string against `members.name`.
 *
 * No match keeps `owner_name_raw` and leaves `owner_member_id` null, which is
 * what the UI flags in amber for the lead to assign. Guessing here would put
 * the wrong person's name on someone else's task, which is exactly the failure
 * that destroys trust in the notes.
 */

export interface MatchableMember {
  id: string;
  name: string;
}

export interface OwnerMatch {
  memberId: string | null;
  /** Downgraded to "low" whenever the match was not unambiguous. */
  confidence: "high" | "low";
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Classic Levenshtein, bounded by the short strings we compare here. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

export function matchOwner(
  rawOwner: string,
  members: MatchableMember[],
  stated: "high" | "low" = "high",
): OwnerMatch {
  const owner = normalize(rawOwner);
  const unassigned: OwnerMatch = { memberId: null, confidence: "low" };

  if (!owner || owner === "unknown" || owner === "unassigned" || owner === "?") {
    return unassigned;
  }

  const candidates = members.map((member) => ({
    member,
    full: normalize(member.name),
    first: normalize(member.name).split(" ")[0] ?? "",
  }));

  const exact = candidates.filter((c) => c.full === owner);
  if (exact.length === 1) return { memberId: exact[0].member.id, confidence: stated };

  // First name only — the common case in a standup ("Ali", "Sara").
  const byFirst = candidates.filter((c) => c.first === owner);
  if (byFirst.length === 1) return { memberId: byFirst[0].member.id, confidence: stated };
  // Two people called Ali: the lead has to say which one.
  if (byFirst.length > 1) return unassigned;

  const contains = candidates.filter(
    (c) => c.full.startsWith(`${owner} `) || c.full.endsWith(` ${owner}`),
  );
  if (contains.length === 1) {
    return { memberId: contains[0].member.id, confidence: "low" };
  }

  // Transcription mangles proper nouns, so allow a near miss on longer names.
  const scored = candidates
    .map((c) => ({
      c,
      distance: Math.min(editDistance(owner, c.full), editDistance(owner, c.first)),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  const runnerUp = scored[1];
  const tolerance = owner.length <= 4 ? 1 : 2;

  if (
    best &&
    best.distance <= tolerance &&
    (!runnerUp || runnerUp.distance > best.distance)
  ) {
    return { memberId: best.c.member.id, confidence: "low" };
  }

  return unassigned;
}
