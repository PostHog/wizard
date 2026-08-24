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
import {
  DiscoveredFeature,
  mayReportScanResults,
  ScanConsent,
  type WizardSession,
} from '@lib/wizard-session';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import {
  detectFramework,
  discoverFeatures,
  gatherFrameworkContext,
  checkFrameworkVersion,
} from '@lib/detection/index';
import { analytics } from '@utils/analytics';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';
import { AI_SOURCE_KINDS } from '@lib/warehouse-sources/registry';
import type { DetectedSource } from '@lib/warehouse-sources/types';
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

/** Set on failure so a crash is not reported as a scan that found nothing. */
const WAREHOUSE_SCAN_FAILED_KEY = 'warehouseScanFailed';

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
    ctx.setFrameworkContext(WAREHOUSE_SCAN_FAILED_KEY, true);
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'detectWarehouseSourcesForSuggestion' },
    );
  }
}

function hasAiSdkEvidence(
  session: WizardSession,
  sources: DetectedSource[],
): boolean {
  return (
    sources.some((s) => AI_SOURCE_KINDS.has(s.kind)) ||
    session.discoveredFeatures.includes(DiscoveredFeature.LLM)
  );
}

/**
 * Boolean only, on the org, never the list of kinds or any non-AI tool: a
 * decline must not leak even the shape of what local detection saw.
 */
function stampAiSdkDetected(
  session: WizardSession,
  sources: DetectedSource[],
): void {
  const organizationId = session.apiUser?.organization?.id;
  if (!organizationId) return;
  if (!hasAiSdkEvidence(session, sources)) return;

  analytics.groupIdentify('organization', organizationId, {
    wizard_ai_sdk_detected: true,
  });
}

/**
 * The single place scan results become telemetry. Called from the two points
 * `WizardStore` resolves consent, so it must stay idempotent.
 */
export function reportWarehouseSourcesDetected(
  session: WizardSession,
): boolean {
  if (session.warehouseSourcesReported) return false;
  // 'undecided' means come back later, not no.
  if (session.scanConsent === ScanConsent.Undecided) return false;

  if (mayReportScanResults(session)) {
    const sources = getDetectedWarehouseSources(session);
    stampAiSdkDetected(session, sources);

    // A crash must not read as "scanned, found nothing", which is what a
    // zero-count row means. captureException already fired at the failure.
    if (session.frameworkContext[WAREHOUSE_SCAN_FAILED_KEY]) return true;

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
  // Nothing on 'declined': saved insights read every row of this event as a
  // scan that ran. Decline rate comes from 'intro menu selected' instead.

  return true;
}
