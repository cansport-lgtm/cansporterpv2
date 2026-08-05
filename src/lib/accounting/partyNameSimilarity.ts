/**
 * Near-duplicate detection for party / billing-customer names.
 *
 * Duplicate accounting parties are created when the same real-world business
 * is entered under a slightly different name ("Osama Trader" vs
 * "Osama Traders"), which silently splits its ledger. These helpers give every
 * entry point a consistent way to detect that before it happens.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizePartyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"()&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Spacing-free comparison key that also ignores a trailing "s", so
 * "M.M. Traders", "MM Traders" and "MM Trader" all collapse to "mmtrader".
 */
function comparisonKey(name: string): string {
  const n = normalizePartyName(name).replace(/\s+/g, "");
  return n.endsWith("s") ? n.slice(0, -1) : n;
}

/**
 * True when two names refer to the same party for all practical purposes:
 * identical after case/punctuation/spacing normalization and an optional
 * trailing "s". Safe to auto-merge on (used by the billing-party resolver).
 */
export function isSamePartyName(a: string, b: string): boolean {
  return comparisonKey(a) === comparisonKey(b);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * True when two names are suspiciously close but not necessarily the same:
 * same-party equal, or within a small typo distance. Used to WARN the user;
 * never used to merge automatically.
 */
export function isSimilarPartyName(a: string, b: string): boolean {
  if (isSamePartyName(a, b)) return true;
  const na = normalizePartyName(a);
  const nb = normalizePartyName(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen < 4) return false;
  const threshold = maxLen >= 10 ? 2 : 1;
  return levenshtein(na, nb) <= threshold;
}

/**
 * Find the first existing name that is similar to `name` but not literally the
 * same entry (trim-equal). Returns null when there is nothing to warn about.
 */
export function findSimilarPartyName(name: string, existing: string[]): string | null {
  const target = name.trim();
  if (!target) return null;
  for (const candidate of existing) {
    if (!candidate) continue;
    if (candidate.trim() === target) continue;
    if (isSimilarPartyName(target, candidate)) return candidate;
  }
  return null;
}
