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

  detectWarehouseSourcesForSuggestion(ctx, installDir);

  ctx.setDetectionComplete();
}

/**
 * Scan for data warehouse source signals (Postgres, Stripe, Hubspot, …).
 *
 * Measurement first: we don't yet know what share of runs even *have* a
 * connectable source, and that number decides whether an inline connect flow
 * is worth building. Running the scan here answers it from real runs.
 *
 * The result also drives a suggestion — a `nextSteps` bullet on the outro and
 * a line in the setup report pointing at `wizard warehouse`. Deliberately a
 * suggestion and not an inline agent run: chaining a second, credential-
 * collecting agent run in front of the outro means any of its seven terminal
 * failure paths (abort, no-progress, rate limit, …) would `process.exit()` and
 * cost the user the success outro *and* the post-outro MCP / Slack steps, on a
 * run where PostHog installed fine.
 *
 * Deliberately calls `detectWarehouseSources` rather than the warehouse
 * program's own `detectWarehousePrerequisites`: that wrapper writes
 * `frameworkContext.detectError` when it finds nothing, which is right for
 * `wizard warehouse` (an empty result makes the whole program pointless) but
 * here would surface a spurious error on the IntroScreen — and, in CI, trip
 * the non-interactive prerequisites abort. No sources is a silent no-op.
 */
function detectWarehouseSourcesForSuggestion(
  ctx: ProgramReadyContext,
  installDir: string,
): void {
  const sources = detectWarehouseSources(installDir);

  // Captured on every run, including the empty case — the denominator is the
  // whole point. Without the zero rows "20% of runs have a Postgres" is
  // unanswerable.
  analytics.wizardCapture('warehouse sources detected', {
    warehouse_source_count: sources.length,
    warehouse_source_kinds: sources.map((s) => s.kind),
    warehouse_source_modes: sources.map((s) => s.mode),
  });

  if (sources.length === 0) return;

  // Tag subsequent events too, so any downstream funnel can slice on what the
  // project had available without re-joining to the event above.
  analytics.setTag(
    'warehouse_source_kinds',
    sources.map((s) => s.kind).join(','),
  );
  analytics.setTag('warehouse_source_count', sources.length);

  ctx.setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
}
