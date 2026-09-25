/**
 * The skill menu: what context-mill publishes as `skill-menu.json` and how the
 * wizard reads it. Skill-backed CLI commands, the family picker, the skill
 * source screen and the agent's install path all resolve skills through this
 * one fetch, so it lives in shared and depends on nothing in the agent.
 */

import { logToFile } from '@utils/debug';
import { fetchWithRetry, type RetryOpts } from '@shared/fetch-retry';

export type SkillEntry = {
  id: string;
  name: string;
  downloadUrl: string;
  /** The hyphenated skill-group prefix of `id` (e.g. `posthog-integration-install`). */
  group?: string;
  /** The detection id this variant serves (e.g. `rails`, `react-router`). */
  framework?: string;
  /** The variant a bare framework id resolves to when its family has several. */
  default?: boolean;
  /** This entry's download is a bundle JSON of every variant, not a single skill's zip. */
  bundle?: boolean;
  /** Menu-only: the variants inside a bundle, expanded into entries of their own on fetch. */
  variants?: { id: string; framework?: string; default?: boolean }[];
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
    group: entry.group,
    bundle: true,
    downloadUrl: entry.downloadUrl,
  }));
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
    const data = (await resp.json()) as SkillMenu;
    for (const [category, entries] of Object.entries(data.categories)) {
      data.categories[category] = entries.flatMap(expandBundleEntry);
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
