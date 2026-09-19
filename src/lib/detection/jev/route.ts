/**
 * Confidence-routed framework detection: Jev classifies, static registry
 * order stays the fallback. Three modes via WIZARD_JEV_DETECTION:
 *
 *   off      (default) static detection only, untouched.
 *   shadow   run both, log agreement; static still decides.
 *   primary  Jev decides above the confidence gates, static below them.
 *
 * Dev builds only — published builds are pinned to 'off'.
 */

import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import type { Integration } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { detectFramework } from '../framework.js';
import {
  detectWithJev,
  summarizeJevReport,
  type JevDetectionReport,
} from './index.js';

export type JevMode = 'off' | 'shadow' | 'primary';

/** Accept Jev's answer outright at or above this confidence. */
export const JEV_ACCEPT_CONFIDENCE = 0.85;
/** Between the gates, Jev needs static agreement (or a static miss) to win. */
export const JEV_AGREE_CONFIDENCE = 0.6;

export function getJevMode(): JevMode {
  if (IS_PRODUCTION_BUILD) return 'off';
  const raw = runtimeEnv('WIZARD_JEV_DETECTION')?.toLowerCase();
  return raw === 'shadow' || raw === 'primary' ? raw : 'off';
}

export type RoutedDetection = {
  integration: Integration | undefined;
  source: 'static' | 'jev';
  jevReport: JevDetectionReport | null;
};

/** Pure routing decision — exported for testing. */
export function routeIntegration(
  jev: { integration: Integration | null; confidence: number } | null,
  staticResult: Integration | undefined,
): { integration: Integration | undefined; source: 'static' | 'jev' } {
  if (!jev || jev.integration === null) {
    return { integration: staticResult, source: 'static' };
  }
  if (jev.confidence >= JEV_ACCEPT_CONFIDENCE) {
    return { integration: jev.integration, source: 'jev' };
  }
  if (jev.confidence >= JEV_AGREE_CONFIDENCE) {
    if (staticResult === undefined || staticResult === jev.integration) {
      return { integration: jev.integration, source: 'jev' };
    }
  }
  return { integration: staticResult, source: 'static' };
}

/**
 * Drop-in replacement for detectFramework in the main detect step. In 'off'
 * mode it IS detectFramework; otherwise both detectors run concurrently and
 * the mode decides who wins. A failed Jev call never blocks the run.
 */
export async function detectFrameworkRouted(
  installDir: string,
): Promise<RoutedDetection> {
  const mode = getJevMode();
  if (mode === 'off') {
    const integration = await detectFramework(installDir);
    return { integration, source: 'static', jevReport: null };
  }

  const [staticResult, jevReport] = await Promise.all([
    detectFramework(installDir),
    detectWithJev(installDir).catch((error: unknown) => {
      logToFile(`[jev] detection failed: ${String(error)}`);
      return null;
    }),
  ]);

  if (jevReport) {
    const agree = jevReport.framework.integration === (staticResult ?? null);
    logToFile(
      `[jev] mode=${mode} framework=${jevReport.framework.choice} ` +
        `conf=${jevReport.framework.confidence.toFixed(2)} ` +
        `static=${staticResult ?? 'none'} agree=${String(agree)} ` +
        `ms=${jevReport.durationMs} tokens=${jevReport.usage.inputTokens}`,
    );
    logToFile(`[jev] report: ${JSON.stringify(summarizeJevReport(jevReport))}`);
  }

  if (mode === 'shadow' || !jevReport) {
    return { integration: staticResult, source: 'static', jevReport };
  }
  const routed = routeIntegration(jevReport.framework, staticResult);
  return { ...routed, jevReport };
}
