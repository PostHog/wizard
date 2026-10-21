/**
 * Core integration detection step.
 *
 * Runs framework detection, context gathering, version checking,
 * and feature discovery. Writes results to the store via the
 * ProgramReadyContext so the IntroScreen can display them.
 *
 * This is the same work that bin.ts $0 handler does inline —
 * extracted here so the `integrate` subcommand can reuse it.
 */

import type { ProgramReadyContext } from '@programs/contract';
import {
  mayReportScanResults,
  reportableDiscoveredFeatures,
  ScanConsent,
} from '@shared/run-state';
import type { ProgramSession } from '@programs/contract';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { detectFramework } from './framework';
import { discoverFeatures } from './features';
import { checkFrameworkVersion, gatherFrameworkContext } from './context';
import { analytics } from '@utils/analytics';
import {
  getCodebaseScan,
  scannedWarehouseSources,
} from '../codebase-scan/scan';
import {
  DETECTED_WAREHOUSE_SOURCES_KEY,
  getDetectedWarehouseSources,
} from '../warehouse-sources/detect';
import { findPackageJsons } from './package-scanning';

// Session-free, so runProgram can stamp without loading the session.

export async function detectPostHogIntegration(
  ctx: ProgramReadyContext,
): Promise<void> {
  const session = ctx.session;
  const installDir = session.installDir;

  const detectedIntegration = await detectFramework(installDir);

  if (detectedIntegration) {
    const config = FRAMEWORK_REGISTRY[detectedIntegration];

    const sessionOptions = {
      installDir,
      debug: session.debug,
      signup: session.signup,
      ci: session.ci,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    };

    // Gather framework-specific context (e.g., router type)
    const context = await gatherFrameworkContext(config, sessionOptions);
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        ctx.setFrameworkContext(key, value);
      }
    }

    ctx.setFrameworkConfig(detectedIntegration, config);
    // Must go through the store setter: setFrameworkConfig (above) calls
    // nanostore setKey, which replaces the session with a shallow copy —
    // a direct `session.skillId = ...` here would write to the stale
    // pre-copy object and the live session would never see it.
    ctx.setSkillId(detectedIntegration);

    const detectedLabel = config.metadata.getDetectedFrameworkLabel?.(context);
    if (detectedLabel) {
      ctx.setDetectedFramework(detectedLabel);
    } else if (!session.detectedFrameworkLabel) {
      ctx.setDetectedFramework(config.metadata.name);
    }

    // Version check
    const versionResult = await checkFrameworkVersion(config, sessionOptions);
    if (versionResult.supported !== true) {
      ctx.setUnsupportedVersion(versionResult.supported);
    }
  }

  // Feature discovery
  for (const feature of discoverFeatures(installDir)) {
    ctx.addDiscoveredFeature(feature);
  }

  await offerScannedWarehouseSources(ctx);
  detectExistingPostHog(ctx, installDir);

  ctx.setDetectionComplete();
}

/**
 * How the scan went, for the reporter to read later. Three states, and the
 * absent one carries the most weight:
 *
 *   absent   this program never scanned. Only `posthog-integration` runs the
 *            scan below, but every program's intro screen resolves consent
 *            through the same store method, so the reporter is reached on runs
 *            where no scan ever happened.
 *   'failed' the scan threw, or had no tool catalog to match against. A
 *            zero-count row would read as "scanned, found nothing", which is
 *            a different fact.
 *   'ok'     the scan ran. Zero sources is a real result and gets reported.
 */
const WAREHOUSE_SCAN_STATE_KEY = 'warehouseScanState';
type WarehouseScanState = 'ok' | 'failed';

/**
 * Stash the run's scanned warehouse sources (Postgres, Stripe, Hubspot, …)
 * for a `wizard warehouse` suggestion on the outro. The scan itself runs
 * unconditionally before `onReady`, before the intro screen has asked about
 * sharing. Reporting what it found is a separate, later concern. See
 * `reportWarehouseSourcesDetected` below.
 *
 * Deliberately a suggestion, not an inline agent run: a second credential-
 * collecting agent run before the outro could end the run on any of its
 * failure paths and cost the user the success outro on a run where PostHog
 * installed fine.
 */
async function offerScannedWarehouseSources(
  ctx: ProgramReadyContext,
): Promise<void> {
  const scan = getCodebaseScan(ctx.session);
  if (!scan) return;
  if (scan.failed) {
    ctx.setFrameworkContext(WAREHOUSE_SCAN_STATE_KEY, 'failed');
    return;
  }
  // Before the empty-list return: a scan that found nothing still ran, and
  // those rows are the denominator.
  ctx.setFrameworkContext(WAREHOUSE_SCAN_STATE_KEY, 'ok');
  const sources = await scannedWarehouseSources(ctx.session);
  if (sources.length === 0) return;
  ctx.setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
}

/**
 * The single place scan results become telemetry. Called from
 * `WizardStore.completeSetup()`, the point consent becomes final — the privacy
 * panel's choice is reversible until then, so nothing may report earlier.
 * The org stamp is a separate concern: `runProgram` makes it once, after the
 * first login, rather than at consent resolution.
 *
 * Returns true when consent has resolved and the caller should latch
 * `warehouseSourcesReported`, which is not the same as "this sent something":
 * a decline, a failed scan, and a program that never scanned all resolve
 * without sending.
 */
export function reportWarehouseSourcesDetected(
  session: ProgramSession,
): boolean {
  if (session.warehouseSourcesReported) return false;
  // 'undecided' means come back later, not no.
  if (session.scanConsent === ScanConsent.Undecided) return false;

  if (mayReportScanResults(session)) {
    const sources = getDetectedWarehouseSources(session);

    // Only an 'ok' scan has something to say. Absent means this program never
    // scanned, and reporting a zero count there would invent a scan that never
    // ran; 'failed' already fired captureException.
    const scanState = session.frameworkContext[WAREHOUSE_SCAN_STATE_KEY] as
      | WarehouseScanState
      | undefined;
    if (scanState !== 'ok') return true;

    // Captured on every run, including the empty case. The denominator is
    // the whole point: without the zero rows, "20% of runs have a Postgres"
    // is unanswerable.
    // Same consent gate as `sessionProperties`. PostHog derives AI SDK
    // detection from these and the source kinds.
    const discoveredFeatures = reportableDiscoveredFeatures(session);
    analytics.wizardCapture('warehouse sources detected', {
      warehouse_source_count: sources.length,
      warehouse_source_kinds: sources.map((s) => s.kind),
      warehouse_source_modes: sources.map((s) => s.mode),
      ...(discoveredFeatures
        ? { discovered_features: discoveredFeatures }
        : {}),
    });

    if (sources.length > 0) {
      // Tag subsequent events too, so any downstream funnel can slice on what the
      // project had available without re-joining to the event above.
      analytics.setTag(
        'warehouse_source_kinds',
        sources.map((s) => s.kind).join(','),
      );
      analytics.setTag('warehouse_source_count', sources.length);
    }
  }
  // Nothing on 'declined': saved insights read every row of this event as a
  // scan that ran. Decline rate comes from 'intro menu selected' instead.

  return true;
}

/** Dependency-level signal, not a verified install. A failed scan reports false. */
export function detectExistingPostHog(
  ctx: Pick<ProgramReadyContext, 'setPosthogSdkDetected'>,
  installDir: string,
): void {
  try {
    const pkgJsons = findPackageJsons(installDir);
    ctx.setPosthogSdkDetected(pkgJsons.some((p) => p.posthogSdks.length > 0));
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'detectExistingPosthog' },
    );
    ctx.setPosthogSdkDetected(false);
  }
}
