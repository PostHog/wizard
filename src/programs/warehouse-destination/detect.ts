/**
 * Warehouse-destination program detection step.
 *
 * Reads the run's codebase scan for warehouses PostHog can export to, and
 * writes a `detectError` into frameworkContext for the intro screen when the
 * install directory is unusable. Finding no warehouse is not an error: the
 * intro screen asks the user which one they run.
 */

import { existsSync, statSync } from 'fs';
import { analytics } from '@utils/analytics';
import type { ProgramSession } from '@programs/program-contract';
import type { AbortCase } from '@agent/types';
import {
  scannedWarehouseDestinations,
  scannedWarehouseSources,
  tagScanResults,
} from '@services/codebase-scan';
import {
  DETECTED_WAREHOUSE_DESTINATIONS_KEY,
  DETECTED_WAREHOUSE_SOURCES_KEY,
  getDetectedWarehouseDestinations,
  WAREHOUSE_DESTINATION_TYPES,
  type WarehouseDestinationType,
} from '@services/warehouse-sources';

/** Structured detection errors rendered by the intro screen. */
export type WarehouseDestinationDetectError = {
  kind: 'bad-directory';
  path: string;
  reason: 'missing' | 'not-dir' | 'unreadable';
};

/** frameworkContext key holding the warehouse the user picked on the intro screen. */
export const CHOSEN_WAREHOUSE_DESTINATION_KEY = 'chosenWarehouseDestination';

/** The warehouse to export to: the user's pick, else the first one detected. */
export function getChosenWarehouseDestination(
  session: ProgramSession,
): WarehouseDestinationType | null {
  const chosen = session.frameworkContext[CHOSEN_WAREHOUSE_DESTINATION_KEY];
  if (
    typeof chosen === 'string' &&
    (WAREHOUSE_DESTINATION_TYPES as readonly string[]).includes(chosen)
  ) {
    return chosen as WarehouseDestinationType;
  }
  return getDetectedWarehouseDestinations(session)[0]?.type ?? null;
}

/** `[ABORT] <reason>` cases the skill can emit. */
export const WAREHOUSE_DESTINATION_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] Warehouse destinations not enabled
    match: /^warehouse destinations not enabled\.?$/i,
    message: 'Warehouse destinations are not enabled',
    body:
      'Your PostHog project cannot connect a warehouse from the terminal yet. ' +
      'Set up a batch export in PostHog instead.',
    docsUrl: 'https://posthog.com/docs/cdp/batch-exports',
  },
  {
    // Skill emits: [ABORT] Warehouse connection not saved
    match: /^warehouse connection not saved\.?$/i,
    message: 'Warehouse connection not saved',
    body:
      'PostHog found no saved connection for your warehouse. Open the ' +
      'connect link again, save the credentials, and rerun this command.',
    docsUrl: 'https://posthog.com/docs/cdp/batch-exports',
  },
  {
    // Skill emits: [ABORT] Warehouse connection test failed
    match: /^warehouse connection test failed\.?$/i,
    message: 'Warehouse connection test failed',
    body:
      'PostHog could not write to your warehouse with the saved connection. ' +
      'Check the permissions of the user or service account, then try again.',
    docsUrl: 'https://posthog.com/docs/cdp/batch-exports',
  },
];

/** Record which warehouses the scan found, for the intro screen and the prompt. */
export async function detectWarehouseDestinationPrerequisites(
  session: ProgramSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): Promise<void> {
  const fail = (error: WarehouseDestinationDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;
  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      {
        step: 'detectWarehouseDestinationPrerequisites.stat',
        path: installDir,
      },
    );
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  const destinations = await scannedWarehouseDestinations(session);
  tagScanResults(session, setFrameworkContext, {
    warehouse_destination_types: destinations.map((d) => d.type).join(','),
    warehouse_destination_count: destinations.length,
  });
  setFrameworkContext(DETECTED_WAREHOUSE_DESTINATIONS_KEY, destinations);
  setFrameworkContext(
    DETECTED_WAREHOUSE_SOURCES_KEY,
    await scannedWarehouseSources(session),
  );
}
