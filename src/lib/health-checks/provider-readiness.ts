import type { BaseHealthResult } from './types';
import { ServiceHealthStatus } from './types';
import {
  checkAnthropicApiHealth,
  checkOpenAiResponsesHealth,
} from './statuspage';
import { getUI } from '@ui';
import { isNonInteractiveEnvironment } from '@utils/environment';
import { logToFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';

export type ModelProviderReadiness = {
  provider: 'anthropic' | 'openai';
  service: string;
  statusUrl: string;
  health: BaseHealthResult;
  blocksRun: boolean;
};

type ProviderTarget = Omit<ModelProviderReadiness, 'health' | 'blocksRun'> & {
  check: () => Promise<BaseHealthResult>;
};

function providerTargetForModel(modelId: string): ProviderTarget {
  if (modelId.startsWith('openai/')) {
    return {
      provider: 'openai',
      service: 'OpenAI Responses API',
      statusUrl: 'https://status.openai.com',
      check: checkOpenAiResponsesHealth,
    };
  }

  return {
    provider: 'anthropic',
    service: 'Anthropic API',
    statusUrl: 'https://status.claude.com',
    check: checkAnthropicApiHealth,
  };
}

/**
 * Check the exact upstream API selected by the final switchboard model.
 * Only a confirmed component outage blocks. Degraded status, lookup failures,
 * and unknown responses remain advisory so a status-page problem cannot stop a
 * working gateway route.
 */
export async function evaluateModelProviderReadiness(
  modelId: string,
): Promise<ModelProviderReadiness> {
  const target = providerTargetForModel(modelId);
  const health = await target.check();
  return {
    provider: target.provider,
    service: target.service,
    statusUrl: target.statusUrl,
    health,
    blocksRun: health.status === ServiceHealthStatus.Down,
  };
}

export async function enforceModelProviderReadiness(
  modelId: string,
): Promise<void> {
  const readiness = await evaluateModelProviderReadiness(modelId);
  const { health, service, statusUrl } = readiness;
  logToFile(
    `[health-checks] selected provider service=${service} status=${health.status}` +
      `${health.error ? ` error=${health.error}` : ''}`,
  );

  if (health.status === ServiceHealthStatus.Healthy) return;

  if (!readiness.blocksRun) {
    const detail = health.error
      ? `Status could not be confirmed: ${health.error}.`
      : `Current status: ${health.status}.`;
    getUI().log.warn(`${service} readiness warning. ${detail} Continuing.`);
    return;
  }

  const message = `${service} is reporting an outage. Check ${statusUrl} and try again later.`;

  // Keep CI behavior advisory, matching the existing infrastructure checks.
  if (isNonInteractiveEnvironment()) {
    getUI().log.warn(`${message} Continuing in non-interactive mode.`);
    return;
  }

  getUI().log.error(message);
  await wizardAbort({ message });
}
