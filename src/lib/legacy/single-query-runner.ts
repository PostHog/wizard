/**
 * OLD FLOW: Single-query agent runner.
 *
 * Used when the `wizard-queued-workflow` feature flag is OFF.
 * Sends one monolithic prompt that does everything in a single agent conversation.
 *
 * Delete this file once the queued workflow is the only path.
 */

import { SPINNER_MESSAGE, type FrameworkConfig } from '../framework-config.js';
import type { WizardSession } from '../wizard-session.js';
import { runAgent } from '../agent-interface.js';
import type { SpinnerHandle } from '../../ui/wizard-ui.js';
import type { WizardOptions } from '../../utils/types.js';
import { getUI } from '../../ui/index.js';
import { buildIntegrationPrompt } from './integration-prompt';

/**
 * OLD FLOW: Run the entire integration in a single agent query.
 *
 * Enqueues a single "Integration" queue item so the RunScreen
 * displays tasks under it like the queued workflow does.
 *
 * Returns the agent result so the caller can handle errors uniformly.
 */
export async function runSingleQueryFlow(args: {
  agent: Awaited<
    ReturnType<typeof import('../agent-interface.js')['initializeAgent']>
  >;
  config: FrameworkConfig;
  session: WizardSession;
  options: WizardOptions;
  spinner: SpinnerHandle;
  promptContext: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    projectId: number;
  };
  frameworkContext: Record<string, unknown>;
  middleware?: Parameters<typeof runAgent>[5];
}) {
  const integrationPrompt = buildIntegrationPrompt(
    args.config,
    args.promptContext,
    args.frameworkContext,
  );

  // Set a single queue item so the RunScreen shows tasks nested under it
  const queueItem = { id: 'integration', label: 'Integration' };
  getUI().setCurrentQueueItem(queueItem);

  const result = await runAgent(
    args.agent,
    integrationPrompt,
    args.options,
    args.spinner,
    {
      estimatedDurationMinutes: args.config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: args.config.ui.successMessage,
      errorMessage: 'Integration failed',
      additionalFeatureQueue: args.session.additionalFeatureQueue,
    },
    args.middleware,
  );

  getUI().completeQueueItem(queueItem);
  getUI().setCurrentQueueItem(null);

  return result;
}
