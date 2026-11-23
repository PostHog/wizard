/** The `wizard-project-discovery` flag: what project discovery may change for a run. */

import { WIZARD_PROJECT_DISCOVERY_FLAG_KEY } from '@shared/constants';
import { analytics } from '@utils/analytics';

/**
 * off: today's path; discovery runs dark from the run directory.
 * one-project: the walk up to the workspace root, and one picked project per run.
 * run-lists: everything in one-project, plus runs of several pairs.
 */
export type ProjectDiscoveryMode = 'off' | 'one-project' | 'run-lists';

/** The mode a flag snapshot sets. Anything but the two on-values is `off`. */
export function projectDiscoveryMode(
  flags: Readonly<Record<string, string>>,
): ProjectDiscoveryMode {
  const value = flags[WIZARD_PROJECT_DISCOVERY_FLAG_KEY];
  return value === 'one-project' || value === 'run-lists' ? value : 'off';
}

/**
 * The run's mode. A failed flag read is `off`, so discovery never changes a run
 * it cannot place. Only discovery calls this: before login, and once more right
 * after it, when the flag can answer for the person. It keeps the answer in
 * `Discovery.mode`, and every other step reads that, so a run never holds two
 * modes at once.
 */
export async function loadProjectDiscoveryMode(): Promise<ProjectDiscoveryMode> {
  try {
    return projectDiscoveryMode(await analytics.getAllFlagsForWizard());
  } catch {
    return 'off';
  }
}
