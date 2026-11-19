/** Shared resolved SDK major skill installer for orchestrator and linear sequences. */
import * as fs from 'fs';
import * as path from 'path';
import type { LLMProvider } from '@posthog/warlock';
import {
  resolveSdkSkillEntries,
  type PostHogSdkSpec,
} from '@shared/posthog-sdks';
import { downloadSkill } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import {
  DEFAULT_SKILL_TAG,
  skillTags,
  type MatchKeys,
} from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { scanInstalledSkill } from '../../yara-hooks';

export const WIZARD_CACHE_DIR = '.posthog-wizard-cache';
export const SDK_SKILLS_ROOT = `${WIZARD_CACHE_DIR}/sdk`;

export interface NonDefaultSdkRef {
  pkg: string;
  major: string;
}

export type SdkSkillInstallResult =
  | {
      kind: 'ok';
      sdkSkillPaths: string[];
      nonDefaultSdks: NonDefaultSdkRef[];
    }
  | { kind: 'aborted' };

export interface PlannedSdkSkills {
  entries: SkillEntry[];
  nonDefaultSdks: NonDefaultSdkRef[];
  /** One prompt fact per detected SDK major that has no skill in the menu. */
  noSkillFacts: string[];
}

/** The prompt fact for an SDK major with no matching skill. */
export function noSkillFact(pkg: string, major: string): string {
  return (
    `This project is on ${pkg} ${major}.x and no version-specific SDK skill is available for it. ` +
    `Stay on the installed major and check the installed package's own source or types before writing a call.`
  );
}

/**
 * Verify every existing segment beneath `installDir` through `relSegments` is a
 * non-symlink directory confined within `realpathSync(installDir)`.
 */
function resolveConfinedCacheTarget(
  installDir: string,
  relSegments: readonly string[],
  opts?: { allowMissingRoot?: boolean },
): string | null {
  if (
    relSegments.length === 0 ||
    relSegments.some((s) => !s || s === '.' || s === '..')
  ) {
    return null;
  }
  // installDir may itself be a link; only the segments beneath it must be plain folders.
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(installDir);
  } catch (err) {
    if (
      opts?.allowMissingRoot &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return path.join(installDir, ...relSegments);
    }
    return null;
  }
  if (!rootStat.isDirectory()) return null;

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(installDir);
  } catch {
    return null;
  }

  let current = installDir;
  for (const segment of relSegments) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        break;
      }
      return null;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return null;
    }
    try {
      const realCurrent = fs.realpathSync(current);
      if (
        realCurrent !== realRoot &&
        !realCurrent.startsWith(realRoot + path.sep)
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return path.join(installDir, ...relSegments);
}

/**
 * Remove the wizard cache directory (or a subdirectory such as `'sdk'`,
 * pruning the root if empty) on both explicit disposal and process exit.
 * Refuses to follow or delete through symlinks escaping `installDir`.
 */
export function registerWizardCacheCleanup(
  installDir: string,
  subDir?: string,
): () => void {
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      const subSegments = subDir ? subDir.split(/[\\/]+/).filter(Boolean) : [];
      const cacheRoot = resolveConfinedCacheTarget(installDir, [
        WIZARD_CACHE_DIR,
      ]);
      if (!cacheRoot) return;
      const target =
        subSegments.length > 0
          ? resolveConfinedCacheTarget(installDir, [
              WIZARD_CACHE_DIR,
              ...subSegments,
            ])
          : cacheRoot;
      if (!target) return;
      fs.rmSync(target, { recursive: true, force: true });
      if (subDir) {
        const safeCacheRoot = resolveConfinedCacheTarget(installDir, [
          WIZARD_CACHE_DIR,
        ]);
        if (
          safeCacheRoot &&
          fs.existsSync(safeCacheRoot) &&
          fs.readdirSync(safeCacheRoot).length === 0
        ) {
          fs.rmdirSync(safeCacheRoot);
        }
      }
    } catch (error) {
      try {
        analytics.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { step: 'wizard_cache_cleanup' },
        );
      } catch {
        // Cleanup reporting must not replace the run result.
      }
    }
  };
  const unregister = registerCleanup(cleanup);
  return () => {
    unregister();
    cleanup();
  };
}

/** The major detected for this project; an entry may carry several `<trait>:<n>` tags, so its tags never decide. */
function extractMajor(
  entry: SkillEntry,
  spec: PostHogSdkSpec,
  matchKeys: MatchKeys,
): string | undefined {
  const fromKeys = matchKeys[spec.trait]?.[0];
  if (fromKeys) return fromKeys;
  return entry.id.match(/-v(\d+)$/)?.[1];
}

/**
 * Synchronously resolve all applicable `sdk-posthog-*` skill entries so callers
 * can record non-default framing and no-skill facts before any download starts.
 */
export function planSdkSkillInstalls(opts: {
  menuEntries: readonly SkillEntry[];
  matchKeys: MatchKeys;
  frameworkSdkFamily?: string;
}): PlannedSdkSkills {
  const { menuEntries, matchKeys, frameworkSdkFamily } = opts;
  const entries: SkillEntry[] = [];
  const seenIds = new Set<string>();
  const nonDefaultSdks: NonDefaultSdkRef[] = [];
  const seenNonDefault = new Set<string>();
  const noSkillFacts: string[] = [];

  for (const pick of resolveSdkSkillEntries({
    menuEntries,
    matchKeys,
    frameworkSdkFamily,
  })) {
    if (pick.kind === 'no-skill') {
      logToFile(
        `[sdk-skills] no skill for ${pick.family}${
          pick.major ? ` major ${pick.major}` : ''
        }; continuing without one`,
      );
      if (pick.spec && pick.major) {
        noSkillFacts.push(noSkillFact(pick.spec.key, pick.major));
      }
      continue;
    }

    if (!seenIds.has(pick.entry.id)) {
      seenIds.add(pick.entry.id);
      entries.push(pick.entry);
    }

    // Record non-default framing before download so a failed download never
    // tricks downstream prompts into treating latest-major EXAMPLE.md as matching.
    if (!skillTags(pick.entry).has(DEFAULT_SKILL_TAG) && pick.spec) {
      const major = extractMajor(pick.entry, pick.spec, pick.matchKeys);
      const refKey = `${pick.spec.key}:${major ?? ''}`;
      if (major && !seenNonDefault.has(refKey)) {
        seenNonDefault.add(refKey);
        nonDefaultSdks.push({ pkg: pick.spec.key, major });
      }
    }
  }

  return { entries, nonDefaultSdks, noSkillFacts };
}

/** Download and triage-scan all resolved SDK skill entries concurrently. */
export async function installPlannedSdkSkills(
  plan: PlannedSdkSkills,
  opts: {
    installDir: string;
    triageProvider?: LLMProvider;
    skillsRoot?: string;
    signal?: AbortSignal;
  },
): Promise<SdkSkillInstallResult> {
  const {
    installDir,
    triageProvider,
    skillsRoot = SDK_SKILLS_ROOT,
    signal,
  } = opts;

  if (plan.entries.length === 0) {
    return {
      kind: 'ok',
      sdkSkillPaths: [],
      nonDefaultSdks: plan.nonDefaultSdks,
    };
  }

  const rootSegments = path.isAbsolute(skillsRoot)
    ? []
    : skillsRoot.split(/[\\/]+/).filter(Boolean);
  if (
    !resolveConfinedCacheTarget(installDir, rootSegments, {
      allowMissingRoot: true,
    })
  ) {
    logToFile(
      `[sdk-skills] refusing cache write through unsafe or symlinked path: ${skillsRoot}`,
    );
    return {
      kind: 'ok',
      sdkSkillPaths: [],
      nonDefaultSdks: plan.nonDefaultSdks,
    };
  }

  const results = await Promise.all(
    plan.entries.map(async (sdkEntry) => {
      if (
        !resolveConfinedCacheTarget(
          installDir,
          [...rootSegments, sdkEntry.id],
          { allowMissingRoot: true },
        )
      ) {
        logToFile(
          `[sdk-skills] refusing cache write through unsafe or symlinked path: ${skillsRoot}/${sdkEntry.id}`,
        );
        return {
          sdkEntry,
          res: { success: false, error: 'unsafe-cache-path' },
        };
      }
      const res = await downloadSkill(sdkEntry, installDir, {
        skillsRoot,
        scan: (dir) => scanInstalledSkill(dir, triageProvider),
      });
      return { sdkEntry, res };
    }),
  );
  if (signal?.aborted) return { kind: 'aborted' };

  const sdkSkillPaths: string[] = [];
  for (const { sdkEntry, res } of results) {
    if (!res.success) {
      logToFile(
        `[sdk-skills] unavailable: ${res.error ?? 'download-failed'} (${
          sdkEntry.id
        })`,
      );
      continue;
    }
    sdkSkillPaths.push(path.posix.join(skillsRoot, sdkEntry.id, 'SKILL.md'));
  }

  return {
    kind: 'ok',
    sdkSkillPaths,
    nonDefaultSdks: plan.nonDefaultSdks,
  };
}
