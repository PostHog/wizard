/** Skill resolution: which menu skill a name stands for in one run. The README's `@shared/skill-resolution` entry has the rule. */

import type { SkillEntry } from './skill-menu';

/** The run's values per match key, such as `{ framework: ['nextjs'] }`. */
export type MatchKeys = Readonly<Record<string, readonly string[] | undefined>>;

/** The tag that breaks a ranking tie. */
export const DEFAULT_SKILL_TAG = 'default';

/** The match key every family pick requires. */
export const FRAMEWORK_KEY = 'framework';

/** An entry's tags, with its `framework` and `default` fields as tags, so a menu without tags resolves the same. */
export function skillTags(entry: SkillEntry): ReadonlySet<string> {
  const tags = new Set(entry.tags ?? []);
  if (entry.framework) tags.add(`${FRAMEWORK_KEY}:${entry.framework}`);
  if (entry.default) tags.add(DEFAULT_SKILL_TAG);
  return tags;
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

/** The skill `name` stands for, a menu id or a skill family, or undefined when none fits the run's match keys. */
export function resolveSkill(
  entries: readonly SkillEntry[],
  name: string,
  keys: MatchKeys,
): SkillEntry | undefined {
  const exact = entries.find((entry) => entry.id === name);
  if (exact) return exact;
  if (!keys[FRAMEWORK_KEY]?.length) return undefined;

  let best: SkillEntry | undefined;
  let bestScore = -1;
  for (const entry of entries) {
    if (entry.group !== name) continue;
    const tags = skillTags(entry);
    const declared = matchKeysOf(tags);
    if (!declared.has(FRAMEWORK_KEY)) continue;

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
