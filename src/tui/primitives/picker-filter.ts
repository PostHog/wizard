/**
 * Filter-as-you-type matching for PickerMenu. Split out from the component so the
 * ranking is testable on its own — the component only decides when to call it.
 */

import Fuse, { type IFuseOptions } from 'fuse.js';

/** The searchable face of a picker option. PickerMenu's `PickerOption<T>` satisfies it. */
export interface Searchable {
  label: string;
  hint?: string;
  description?: string;
}

/**
 * Fuzzy fallback config. `ignoreLocation` because a term matching at the end of a
 * description is as good as one at the start, and Fuse's default distance window
 * would score the late match away. 0.5 is the loosest threshold that still bottoms
 * out: below it `gthb` misses `GitHub` entirely, which is the whole point of having
 * a fuzzy pass; above it the tail grows without surfacing anything new at the top.
 */
export const FUSE_OPTIONS: IFuseOptions<Searchable> = {
  keys: [
    { name: 'label', weight: 3 },
    { name: 'hint', weight: 1 },
    { name: 'description', weight: 1 },
  ],
  ignoreLocation: true,
  threshold: 0.5,
  includeScore: true,
};

export function buildPickerIndex<T extends Searchable>(options: T[]): Fuse<T> {
  return new Fuse(options, FUSE_OPTIONS as IFuseOptions<T>);
}

function haystack(option: Searchable): string {
  return `${option.label} ${option.hint ?? ''} ${
    option.description ?? ''
  }`.toLowerCase();
}

/**
 * Rank options against a query, best first, or `null` for an empty query.
 *
 * Two passes, literal before fuzzy. Anything that literally contains every
 * whitespace-separated term wins outright, in the list's own order — that covers how
 * people actually type (`git iss` → `GitHub issues`) and keeps the common case as
 * tight as a plain substring filter, which fuzzy matching on its own is not: Fuse at
 * a threshold loose enough to forgive `gthb` also lets a third of the list through
 * on `replay`.
 *
 * Only when nothing matches literally does Fuse get a turn, so a typo degrades to a
 * ranked guess instead of an empty list. Terms are AND-ed there too, each matched
 * fuzzily on its own — Fuse's bitap pass over the whole query would otherwise need
 * `git iss` to be a near-edit of the text it's matching. Scores are distances (0 is
 * exact) and sum across terms, hence the ascending sort; ties keep the order the
 * first term put them in, since the sort is stable.
 */
export function rankOptions<T extends Searchable>(
  fuse: Fuse<T>,
  options: T[],
  query: string,
): T[] | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return null;
  }

  const literal = options.filter((option) =>
    terms.every((term) => haystack(option).includes(term)),
  );
  if (literal.length) {
    return literal;
  }

  let surviving: Map<T, number> | null = null;
  for (const term of terms) {
    const hits = new Map<T, number>(
      fuse.search(term).map(({ item, score }) => [item, score ?? 0]),
    );
    if (surviving === null) {
      surviving = hits;
      continue;
    }
    // Deleting the current key mid-iteration is well-defined for a Map.
    for (const [option, total] of surviving) {
      const score = hits.get(option);
      if (score === undefined) {
        surviving.delete(option);
      } else {
        surviving.set(option, total + score);
      }
    }
  }

  return [...(surviving ?? [])]
    .sort(([, a], [, b]) => a - b)
    .map(([option]) => option);
}
