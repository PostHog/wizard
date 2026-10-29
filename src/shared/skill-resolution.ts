/**
 * Skill resolution by criteria. A task names the skills it needs by tags plus
 * the run's traits, by explicit id, or as a narrowed menu its agent picks from.
 * Context-mill owns each skill's tags; the wizard owns the criteria and traits.
 */

import type { SkillEntry } from './skill-menu';

/** The run's trait values as tags, keyed by trait name (e.g. `framework` → `['nextjs']`). */
export type TraitTags = Readonly<Record<string, readonly string[] | undefined>>;

/** How a task names one skill. */
export type SkillCriteria =
  | {
      /** Keep only skills that carry every one of these tags. */
      tags: readonly string[];
      /** Traits whose tags a skill must carry too; a run without the trait matches nothing. */
      require?: readonly string[];
      /** Traits whose tags rank the matches; a tag no skill carries changes nothing. */
      prefer?: readonly string[];
      /** No match fails the preflight rather than running the task without the skill. */
      required?: boolean;
    }
  | { id: string }
  | { choose: { tags: readonly string[] } };

/** The tag that breaks a ranking tie. */
export const DEFAULT_SKILL_TAG = 'default';

/** The tag a skill carries for the framework it serves; content tags such as `python` only describe it. */
export function frameworkTag(framework: string): string {
  return `framework:${framework}`;
}

/**
 * A skill's tags, plus its `group`, `framework` and `default` fields as tags,
 * so a menu published before tags resolves the same as one with them.
 */
export function skillTags(entry: SkillEntry): ReadonlySet<string> {
  const tags = new Set(entry.tags ?? []);
  if (entry.group) tags.add(entry.group);
  if (entry.framework) tags.add(frameworkTag(entry.framework));
  if (entry.default) tags.add(DEFAULT_SKILL_TAG);
  return tags;
}

/** The skills carrying every tag, in menu order. The menu an agent chooses from. */
export function skillsWithTags(
  entries: readonly SkillEntry[],
  tags: readonly string[],
): SkillEntry[] {
  return entries.filter((entry) => {
    const carried = skillTags(entry);
    return tags.every((tag) => carried.has(tag));
  });
}

/**
 * The skill criteria pick, or undefined when none matches or the agent picks
 * (`choose`). Ranked by preferred tags matched, then the `default` tag, then
 * menu order.
 */
export function resolveSkill(
  entries: readonly SkillEntry[],
  criteria: SkillCriteria,
  traits: TraitTags,
): SkillEntry | undefined {
  if ('id' in criteria) return entries.find((e) => e.id === criteria.id);
  if ('choose' in criteria) return undefined;

  let candidates = skillsWithTags(entries, criteria.tags);
  for (const trait of criteria.require ?? []) {
    const values = traits[trait] ?? [];
    if (values.length === 0) return undefined;
    candidates = candidates.filter((entry) => {
      const carried = skillTags(entry);
      return values.some((value) => carried.has(value));
    });
  }

  const preferred = (criteria.prefer ?? []).flatMap((t) => traits[t] ?? []);
  let best: SkillEntry | undefined;
  let bestScore = -1;
  for (const entry of candidates) {
    const carried = skillTags(entry);
    const score =
      preferred.filter((tag) => carried.has(tag)).length * 2 +
      (carried.has(DEFAULT_SKILL_TAG) ? 1 : 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The criteria an orchestrator task's frontmatter skill id stands for today:
 * that exact id when the menu has it, else its family's variant for the
 * run's framework.
 */
export function legacySkillCriteria(
  entries: readonly SkillEntry[],
  skillId: string,
): SkillCriteria {
  return entries.some((e) => e.id === skillId)
    ? { id: skillId }
    : { tags: [skillId], require: ['framework'] };
}
