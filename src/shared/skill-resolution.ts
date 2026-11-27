/** Skill resolution: which menu skill a name stands for in one run. The README's `@shared/skill-resolution` entry has the rule. */

import type { SkillEntry } from './skill-menu';

/** The run's values per match key, such as `{ framework: ['nextjs'] }`. */
export type MatchKeys = Readonly<Record<string, readonly string[] | undefined>>;

/** The tag that breaks a ranking tie. */
export const DEFAULT_SKILL_TAG = 'default';

/** Match key required for framework family picks (skipped when resolving non-framework trait skills). */
export const FRAMEWORK_KEY = 'framework';

/** An entry's tags. */
export function skillTags(entry: SkillEntry): ReadonlySet<string> {
  return new Set(entry.tags ?? []);
}

/** The `key:value` tags among `tags`, as values per key. */
function matchKeysOf(tags: ReadonlySet<string>): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const tag of tags) {
    const at = tag.indexOf(':');
    if (at <= 0) continue;
    const key = tag.slice(0, at);
    keys.set(key, [...(keys.get(key) ?? []), tag.slice(at + 1)]);
  }
  return keys;
}

/** Whether a family matches on keys other than the framework, such as an SDK's major: one of its skills declares a key, and none the framework. */
function isTraitFamily(
  entries: readonly SkillEntry[],
  family: string,
): boolean {
  const declared = entries
    .filter((entry) => entry.family === family)
    .map((entry) => matchKeysOf(skillTags(entry)));
  return (
    declared.some((keys) => keys.size > 0) &&
    !declared.some((keys) => keys.has(FRAMEWORK_KEY))
  );
}

/** The skill `name` stands for, a menu id or a skill family, or undefined when none fits the run's match keys. */
export function resolveSkill(
  entries: readonly SkillEntry[],
  name: string,
  keys: MatchKeys,
): SkillEntry | undefined {
  const exact = entries.find((entry) => entry.id === name);
  if (exact) return exact;
  const byFramework = !isTraitFamily(entries, name);
  if (byFramework && !keys[FRAMEWORK_KEY]?.length) return undefined;

  let best: SkillEntry | undefined;
  let bestScore = -1;
  for (const entry of entries) {
    if (entry.family !== name) continue;
    const tags = skillTags(entry);
    const declared = matchKeysOf(tags);
    if (byFramework && !declared.has(FRAMEWORK_KEY)) continue;

    let agreeing = 0;
    let disagrees = false;
    for (const [key, values] of declared) {
      const run = Object.hasOwn(keys, key) ? keys[key] : undefined;
      if (!run?.length) continue;
      if (values.some((value) => run.includes(value))) agreeing += 1;
      else disagrees = true;
    }
    if (disagrees) continue;

    const score = agreeing * 2 + (tags.has(DEFAULT_SKILL_TAG) ? 1 : 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** One skill per trait family the run has a value for, such as the SDK skill for the installed major. */
export function resolveTraitSkills(
  entries: readonly SkillEntry[],
  keys: MatchKeys,
): SkillEntry[] {
  const hasValue = (key: string) =>
    Object.hasOwn(keys, key) && Boolean(keys[key]?.length);
  const families = new Set(
    entries
      .filter((entry) =>
        [...matchKeysOf(skillTags(entry)).keys()].some(hasValue),
      )
      .flatMap((entry) => entry.family ?? []),
  );
  return [...families]
    .filter((family) => isTraitFamily(entries, family))
    .flatMap((family) => resolveSkill(entries, family, keys) ?? []);
}
