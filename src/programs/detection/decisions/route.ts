/** Probability-routed framework detection: the Decisions API classifies, static registry order stays the fallback. */

import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import type { Integration } from '@shared/constants';
import { logToFile } from '@utils/debug';
import { detectFramework } from '../framework';
import {
  detectWithDecisions,
  summarizeDecisionsReport,
  type DecisionsDetectionReport,
} from './index';

/** off: static only. shadow: both run, static decides. primary: Decisions decides above the gates. */
export type DecisionsMode = 'off' | 'shadow' | 'primary';

/** Accept the Decisions answer outright at or above this probability. Starting point; calibrate from shadow runs. */
export const DECISIONS_ACCEPT_PROBABILITY = 0.85;
/** Between the gates, the answer needs static agreement or a static miss. */
export const DECISIONS_AGREE_PROBABILITY = 0.6;

/** Dev builds only; published builds are pinned to 'off'. */
export function getDecisionsMode(): DecisionsMode {
  if (IS_PRODUCTION_BUILD) return 'off';
  const raw = runtimeEnv('WIZARD_DECISIONS_DETECTION')?.toLowerCase();
  return raw === 'shadow' || raw === 'primary' ? raw : 'off';
}

export type RoutedDetection = {
  integration: Integration | undefined;
  source: 'static' | 'decisions';
  decisionsReport: DecisionsDetectionReport | null;
};

/** Pure routing decision, exported for testing. */
export function routeIntegration(
  decisions: { integration: Integration | null; probability: number } | null,
  staticResult: Integration | undefined,
): { integration: Integration | undefined; source: 'static' | 'decisions' } {
  if (!decisions || decisions.integration === null) {
    return { integration: staticResult, source: 'static' };
  }
  if (decisions.probability >= DECISIONS_ACCEPT_PROBABILITY) {
    return { integration: decisions.integration, source: 'decisions' };
  }
  if (
    decisions.probability >= DECISIONS_AGREE_PROBABILITY &&
    (staticResult === undefined || staticResult === decisions.integration)
  ) {
    return { integration: decisions.integration, source: 'decisions' };
  }
  return { integration: staticResult, source: 'static' };
}

/** Drop-in for detectFramework; a failed Decisions call never blocks the run. */
export async function detectFrameworkRouted(
  installDir: string,
): Promise<RoutedDetection> {
  const mode = getDecisionsMode();
  if (mode === 'off') {
    const integration = await detectFramework(installDir);
    return { integration, source: 'static', decisionsReport: null };
  }

  const [staticResult, decisionsReport] = await Promise.all([
    detectFramework(installDir),
    detectWithDecisions(installDir).catch((error: unknown) => {
      logToFile(`[decisions] detection failed: ${String(error)}`);
      return null;
    }),
  ]);

  if (decisionsReport) {
    const framework = decisionsReport.framework;
    const agree = (framework?.integration ?? null) === (staticResult ?? null);
    logToFile(
      `[decisions] mode=${mode} framework=${framework?.choice ?? 'refused'} ` +
        `p=${framework ? framework.probability.toFixed(2) : 'n/a'} ` +
        `static=${staticResult ?? 'none'} agree=${String(agree)} ` +
        `ms=${decisionsReport.durationMs} tokens=${decisionsReport.usage.inputTokens}`,
    );
    logToFile(
      `[decisions] report: ${JSON.stringify(
        summarizeDecisionsReport(decisionsReport),
      )}`,
    );
  }

  if (mode === 'shadow' || !decisionsReport) {
    return { integration: staticResult, source: 'static', decisionsReport };
  }
  return {
    ...routeIntegration(decisionsReport.framework, staticResult),
    decisionsReport,
  };
}
