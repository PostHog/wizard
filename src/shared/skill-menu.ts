/**
 * The skill menu: what context-mill publishes as `skill-menu.json` and how the
 * wizard reads it. Skill-backed CLI commands, the family picker, the skill
 * source screen and the agent's install path all resolve skills through this
 * one fetch, so it lives in shared and depends on nothing in the agent.
 */

import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { fetchWithRetry, type RetryOpts } from '@shared/fetch-retry';

export type SkillEntry = {
  id: string;
  name: string;
  downloadUrl: string;
  /** The skill family, set on fetch from the category the menu lists the entry under, with `/` as `-`. */
  family?: string;
  /** This entry's download is a bundle JSON of every variant, not a single skill's zip. */
  bundle?: boolean;
  /** Human name for the skill. Older menus omit it. */
  title?: string;
  /** What the skill covers. */
  description?: string;
  /** What the skill is, and as `key:value` the projects it is written for; see `@shared/skill-resolution`. */
  tags?: string[];
  /** The product whose pages, from the framework's pack, complete this skill; see `@shared/skill-composition`. */
  frameworkReferences?: string;
  /** Menu-only: the variants inside a bundle, expanded into entries of their own on fetch. */
  variants?: SkillVariant[];
};

/** One variant inside a bundle entry. */
export type SkillVariant = {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
};

/**
 * Entry in the wizard's runtime CLI registry. Mirrors the shape context-mill
 * publishes under `cliEntries` inside `skill-menu.json`. The wizard uses these
 * to register skill-backed subcommands at runtime instead of from a baked
 * build-time snapshot.
 */
export type CliEntry = {
  skillId: string;
  role: 'command' | 'skill' | 'internal';
  command?: string;
  parentCommand?: string;
  default?: boolean;
  displayName: string;
  description: string;
};

export interface SkillMenu {
  /** The context-mill release that built the menu (`dev` for a local build). */
  buildVersion?: string;
  categories: Record<string, SkillEntry[]>;
  /**
   * Skills exposed as CLI commands. Optional because context-mill releases
   * older than the runtime-resolver cutover don't emit this field.
   */
  cliEntries?: CliEntry[];
}

/** Expand a bundle entry into one entry per variant, so the menu reads the same whether a group ships bundled or as zips. */
export function expandBundleEntry(entry: SkillEntry): SkillEntry[] {
  if (!entry.bundle || !entry.variants) return [entry];
  return entry.variants.map((variant) => ({
    ...variant,
    name: entry.name,
    bundle: true,
    downloadUrl: entry.downloadUrl,
    ...(entry.title && !variant.title ? { title: entry.title } : {}),
    ...(entry.description && !variant.description
      ? { description: entry.description }
      : {}),
  }));
}

/** A category's skill family: its key with `/` as `-`, so `integration/install` is `integration-install`. */
const skillFamily = (category: string): string => category.replaceAll('/', '-');

/** The menu as the wizard reads it: each bundle expanded into its variants, and each entry given its family. */
export function prepareSkillMenu(menu: SkillMenu): SkillMenu {
  for (const [category, entries] of Object.entries(menu.categories)) {
    const family = skillFamily(category);
    menu.categories[category] = entries
      .flatMap(expandBundleEntry)
      .map((entry) => ({ ...entry, family }));
  }
  return menu;
}

/**
 * Fetch the skill menu from the skills server.
 * Returns parsed data on success, `null` on failure.
 */
export async function fetchSkillMenu(
  skillsBaseUrl: string,
  opts: RetryOpts = {},
): Promise<SkillMenu | null> {
  const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
  try {
    logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);
    const resp = await fetchWithRetry(menuUrl, opts);
    const data = prepareSkillMenu((await resp.json()) as SkillMenu);
    // Every later event, the terminal one included, says which release the run's skills came from.
    if (data.buildVersion) {
      analytics.setTag('context_mill_version', data.buildVersion);
    }
    logToFile(
      `fetchSkillMenu: loaded (${
        Object.keys(data.categories).length
      } categories)`,
    );
    return data;
  } catch (err: any) {
    logToFile(`fetchSkillMenu: error: ${err.message}`);
    return null;
  }
}
