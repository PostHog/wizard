/**
 * The run's one discovery: what the wizard learns by reading the repo. Every
 * program that sets `scansCodebase` reads this result instead of looking on its
 * own, so local suggestions, the warehouse flow, the self-driving prompt and
 * the report all agree. Each program derives its own view from it in
 * `onReady`; discovery writes no program's keys, so a composed run sees only
 * what its own program chose.
 *
 * Discovery always runs; consent only gates reporting (see `report.ts`).
 */

import { analytics } from '@utils/analytics';
import type {
  ProgramReadyContext,
  ProgramConfig,
} from '@programs/program-contract';
import type { ProgramSession } from '@programs/program-contract';
import {
  toWarehouseDestinations,
  toWarehouseSources,
} from '../warehouse-sources/detect';
import { loadSourceDetectors } from '../warehouse-sources/registry';
import type {
  DetectedDestination,
  DetectedSource,
} from '../warehouse-sources/types';
import { discoverTools, type DiscoveredTools } from './tools';
import { walkRepo, type RepoFiles } from './walk';

/** frameworkContext key holding the run's discovery, every discovered tool included. */
export const DISCOVERY_KEY = 'discovery';

export type Discovery = {
  /** The program whose detection ran discovery. */
  program: string;
  discoveredAt: string;
  /**
   * The directory discovery walked. A CI run can narrow `installDir` after
   * discovery, so the report fingerprints this one instead.
   */
  rootDir: string;
  /** The walk: tree, manifests, lockfiles, `.env` key names. Local only: never reported. */
  files: RepoFiles;
  tools: DiscoveredTools;
};

type DiscoveryContext = Pick<
  ProgramReadyContext,
  'session' | 'setFrameworkContext'
>;

/** The walk, or an empty one when it throws, so discovery stays best-effort. */
function walkSafely(rootDir: string): RepoFiles {
  try {
    return walkRepo(rootDir);
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'walkRepo' },
    );
    return {
      dir: rootDir,
      files: [],
      manifests: [],
      lockfiles: [],
      envKeys: [],
    };
  }
}

/** Discover once per run, for a program that sets `scansCodebase`. Best-effort: never throws. */
export async function runDiscovery(
  config: Pick<ProgramConfig, 'id' | 'scansCodebase'>,
  ctx: DiscoveryContext,
): Promise<void> {
  if (!config.scansCodebase) return;
  if (getDiscovery(ctx.session)) return;
  const detectors = await loadSourceDetectors(ctx.session.baseUrl);
  const rootDir = ctx.session.installDir;
  const discoveredAt = new Date().toISOString();
  const files = walkSafely(rootDir);
  const discovery = (tools: DiscoveredTools): Discovery => ({
    program: config.id,
    discoveredAt,
    rootDir,
    files,
    tools,
  });
  const failed: DiscoveredTools = { tools: [], complete: false, failed: true };
  // No catalog means discovery could not look, which is not the same as
  // finding nothing. The loader has already reported why.
  if (detectors.length === 0) {
    ctx.setFrameworkContext(DISCOVERY_KEY, discovery(failed));
    return;
  }
  try {
    ctx.setFrameworkContext(
      DISCOVERY_KEY,
      discovery(discoverTools(rootDir, detectors)),
    );
  } catch (error) {
    ctx.setFrameworkContext(DISCOVERY_KEY, discovery(failed));
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'scanCodebase' },
    );
  }
}

/** The warehouse sources discovery found, for a program that offers them. */
export async function discoveredWarehouseSources(
  session: ProgramSession,
): Promise<DetectedSource[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  // Resolves at once: discovery already waited for the same download.
  return toWarehouseSources(
    discovery.tools.tools,
    await loadSourceDetectors(session.baseUrl),
  );
}

/** The warehouses discovery found that PostHog can export to. */
export async function discoveredWarehouseDestinations(
  session: ProgramSession,
): Promise<DetectedDestination[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  return toWarehouseDestinations(
    discovery.tools.tools,
    await loadSourceDetectors(session.baseUrl),
  );
}

export function getDiscovery(
  session: Pick<ProgramSession, 'frameworkContext'>,
): Discovery | undefined {
  return session.frameworkContext[DISCOVERY_KEY] as Discovery | undefined;
}

/** frameworkContext key caching a walk of a directory discovery did not walk. Local only: never reported. */
const REPO_FILES_KEY = 'repoFiles';

/** The walk of `session.installDir`: discovery's when it walked that directory, else walked once and cached. */
export function getRepoFiles(
  session: ProgramSession,
  setFrameworkContext?: (key: string, value: unknown) => void,
): RepoFiles {
  const discovered = getDiscovery(session)?.files;
  if (discovered?.dir === session.installDir) return discovered;
  const kept = session.frameworkContext[REPO_FILES_KEY] as
    | RepoFiles
    | undefined;
  if (kept?.dir === session.installDir) return kept;
  const files = walkSafely(session.installDir);
  setFrameworkContext?.(REPO_FILES_KEY, files);
  return files;
}
