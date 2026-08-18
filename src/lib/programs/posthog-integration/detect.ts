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

import type { ProgramReadyContext } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import {
  detectFramework,
  discoverFeatures,
  gatherFrameworkContext,
  checkFrameworkVersion,
} from '@lib/detection/index';
import { analytics } from '@utils/analytics';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';
import {
  DETECTED_WAREHOUSE_SOURCES_KEY,
  getDetectedWarehouseSources,
} from '@lib/programs/warehouse-source/detect';

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
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
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

    if (!session.detectedFrameworkLabel) {
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

  detectWarehouseSourcesForSuggestion(ctx, installDir);

  ctx.setDetectionComplete();
}

/**
 * Scan for data warehouse source signals (Postgres, Stripe, Hubspot, …) and,
 * when found, stash them for a `wizard warehouse` suggestion on the outro.
 * Runs unconditionally during `detect`, before the intro screen has asked
 * about sharing. Reporting what this finds is a separate, later concern.
 * See `reportWarehouseSourcesDetected` below.
 *
 * Deliberately a suggestion, not an inline agent run: a second credential-
 * collecting agent run before the outro could `process.exit()` on any of its
 * failure paths and cost the user the success outro on a run where PostHog
 * installed fine.
 *
 * Calls `detectWarehouseSources` (a pure scan) rather than the warehouse
 * program's `detectWarehousePrerequisites`, which writes a `detectError` when
 * it finds nothing — that's right for `wizard warehouse` but here would show a
 * spurious error and trip the CI prerequisites abort. No sources is a no-op.
 *
 * Best-effort: never let a scan failure break the wizard flow.
 */
function detectWarehouseSourcesForSuggestion(
  ctx: ProgramReadyContext,
  installDir: string,
): void {
  try {
    const sources = detectWarehouseSources(installDir);
    if (sources.length === 0) return;
    ctx.setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'detectWarehouseSourcesForSuggestion' },
    );
  }
}

/**
 * Reports the warehouse-scan result to PostHog, once consent is known.
 *
 * The scan itself runs during `detect`, before the intro screen has been
 * seen, so reporting can't happen from inside it: `scanConsent` is still
 * 'undecided' at that point. This is called instead from the two places
 * `WizardStore` resolves consent, `completeSetup()` and the decline path,
 * so it's the single place scan results become telemetry. Both call sites
 * fire in the same run (the decline path always precedes a `completeSetup()`
 * call), so this is idempotent: it returns false, doing nothing, once
 * `session.warehouseSourcesReported` is already true. The caller sets that
 * flag when this returns true.
 */
export function reportWarehouseSourcesDetected(
  session: WizardSession,
): boolean {
  if (session.warehouseSourcesReported) return false;
  if (session.scanConsent === 'undecided') return false;

  if (session.scanConsent === 'granted') {
    const sources = getDetectedWarehouseSources(session);

    // Captured on every run, including the empty case. The denominator is
    // the whole point: without the zero rows, "20% of runs have a Postgres"
    // is unanswerable.
    analytics.wizardCapture('warehouse sources detected', {
      warehouse_source_count: sources.length,
      warehouse_source_kinds: sources.map((s) => s.kind),
      warehouse_source_modes: sources.map((s) => s.mode),
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
  // 'declined': no capture at all, on purpose. This event's contract is
  // "detection ran, here is what it found", and several saved insights key
  // off that (a denominator that counts every occurrence with no property
  // filter, and a detection-rate ratio over it), so a decline row would
  // corrupt both. The decline itself is already captured as 'intro menu
  // selected' with value: 'continue-no-scan', fired unconditionally by the
  // intro screen's selection handler.

  return true;
}
