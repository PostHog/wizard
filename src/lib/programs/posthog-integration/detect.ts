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
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import {
  detectFramework,
  discoverFeatures,
  gatherFrameworkContext,
  checkFrameworkVersion,
} from '@lib/detection/index';
import { analytics } from '@utils/analytics';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';

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

  detectWarehouseSourcesForOffer(ctx, installDir);

  ctx.setDetectionComplete();
}

/**
 * Scan for data warehouse source signals (Postgres, Stripe, Hubspot, …) so the
 * warehouse-offer step can propose connecting them as part of setup.
 *
 * Deliberately calls `detectWarehouseSources` rather than the warehouse
 * program's own `detectWarehousePrerequisites`: that wrapper writes
 * `frameworkContext.detectError` when it finds nothing, which is right for
 * `wizard warehouse` (an empty result makes the whole program pointless) but
 * would surface a spurious error on the IntroScreen here. Embedded, "no
 * sources" is a silent skip — the offer step simply never shows.
 */
function detectWarehouseSourcesForOffer(
  ctx: ProgramReadyContext,
  installDir: string,
): void {
  const sources = detectWarehouseSources(installDir);
  if (sources.length === 0) return;

  // Tag every subsequent event with what was detected, so the funnel can
  // separate "was never offered" from "was offered and declined".
  analytics.setTag(
    'warehouse_source_kinds',
    sources.map((s) => s.kind).join(','),
  );
  analytics.setTag(
    'warehouse_source_modes',
    sources.map((s) => `${s.kind}:${s.mode}`).join(','),
  );
  analytics.setTag('warehouse_source_count', sources.length);

  ctx.setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
}
