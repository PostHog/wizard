/** Skill resolution: which menu skill a name stands for in one run. The README's `@shared/skill-resolution` entry has the rule. */

import { Integration } from './constants';
import type { SkillEntry } from './skill-menu';

/** The run's values per match key, such as `{ framework: ['nextjs'] }`. */
export type MatchKeys = Readonly<Record<string, readonly string[] | undefined>>;

/** The tag that breaks a ranking tie. */
export const DEFAULT_SKILL_TAG = 'default';

/** The match key every framework family pick requires. */
export const FRAMEWORK_KEY = 'framework';

/** Prefix of exact-major SDK reference skill families. */
const SDK_FAMILY_PREFIX = 'sdk-posthog-';

const INTEGRATION_VALUES = new Set<string>(Object.values(Integration));

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

function matchEntryAgainstKeys(
  entry: SkillEntry,
  keys: MatchKeys,
): {
  agreeing: number;
  disagrees: boolean;
  declared: Map<string, string[]>;
  isDefault: boolean;
} {
  const tags = skillTags(entry);
  const declared = matchKeysOf(tags);
  let agreeing = 0;
  let disagrees = false;
  for (const [key, values] of declared) {
    const run = Object.hasOwn(keys, key) ? keys[key] : undefined;
    if (!run?.length) continue;
    if (values.some((value) => run.includes(value))) agreeing += 1;
    else disagrees = true;
  }
  return {
    agreeing,
    disagrees,
    declared,
    isDefault: tags.has(DEFAULT_SKILL_TAG),
  };
}

/** The skill `name` stands for, a menu id or a skill family, or undefined when none fits the run's match keys. */
export function resolveSkill(
  entries: readonly SkillEntry[],
  name: string,
  keys: MatchKeys,
): SkillEntry | undefined {
  const exact = entries.find((entry) => entry.id === name);
  if (exact) return exact;

  const familyEntries = entries.filter((entry) => entry.family === name);
  if (familyEntries.length === 0) return undefined;

  const familyUsesFramework = familyEntries.some((entry) =>
    matchKeysOf(skillTags(entry)).has(FRAMEWORK_KEY),
  );
  if (familyUsesFramework && !keys[FRAMEWORK_KEY]?.length) return undefined;

  let best: SkillEntry | undefined;
  let bestScore = -1;
  for (const entry of familyEntries) {
    const check = matchEntryAgainstKeys(entry, keys);
    if (familyUsesFramework && !check.declared.has(FRAMEWORK_KEY)) continue;
    if (check.disagrees) continue;

    const score = check.agreeing * 2 + (check.isDefault ? 1 : 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function familyUsesWizardFramework(
  entries: readonly SkillEntry[],
  keys: MatchKeys,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const runFrameworks = keys[FRAMEWORK_KEY];
  for (const entry of entries) {
    const group = entry.family ?? '';
    if (result.get(group)) continue;
    const fwValues = matchKeysOf(skillTags(entry)).get(FRAMEWORK_KEY) ?? [];
    result.set(
      group,
      fwValues.some(
        (value) =>
          INTEGRATION_VALUES.has(value) ||
          Boolean(runFrameworks?.includes(value)),
      ),
    );
  }
  return result;
}

/**
 * Filter a category's menu entries for `load_skill_menu`: drop entries whose
 * wizard match keys disagree with `keys` (ignoring non-wizard `framework:`
 * taxonomies such as AI provider tags on `ai-observability`), and collapse
 * `sdk-posthog-*` families to their resolved pick unless multiple majors apply.
 */
export function filterSkillsForRun(
  entries: readonly SkillEntry[],
  keys: MatchKeys,
): SkillEntry[] {
  const usesWizardFramework = familyUsesWizardFramework(entries, keys);
  const nonFrameworkKeys: MatchKeys =
    FRAMEWORK_KEY in keys ? { ...keys, [FRAMEWORK_KEY]: undefined } : keys;
  const winners = new Map<string, SkillEntry | undefined>();
  return entries.filter((entry) => {
    const effectiveKeys = usesWizardFramework.get(entry.family ?? '')
      ? keys
      : nonFrameworkKeys;
    const check = matchEntryAgainstKeys(entry, effectiveKeys);
    if (check.disagrees) return false;
    if (entry.family?.startsWith(SDK_FAMILY_PREFIX)) {
      const hasMultiMajorKey = [...check.declared.keys()].some(
        (key) => (effectiveKeys[key]?.length ?? 0) > 1,
      );
      if (hasMultiMajorKey) return true;
      if (!winners.has(entry.family)) {
        winners.set(
          entry.family,
          resolveSkill(entries, entry.family, effectiveKeys),
        );
      }
      return winners.get(entry.family)?.id === entry.id;
    }
    return true;
  });
}
