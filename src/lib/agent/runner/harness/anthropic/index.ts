/**
 * The `anthropic` runner — the control. Wraps the claude-agent-sdk path
 * (`initializeAgent` + `runAgent`) that was inline in `linear.ts` before the
 * runner seam. Owns only the agent loop + model transport; the shared pipeline
 * (skill install, prompt, ask bridge, error routing, outro) stays in `linear.ts`.
 *
 * Implements both entry points:
 *   - `run`     for linear mode (one call per program)
 *   - `runTask` for orchestrator mode (one call for the seed plan, one per
 *               drained task). This is the only harness that supports
 *               orchestrator today; pi omits `runTask` and the orchestrator
 *               runner fails loudly when handed a harness without it.
 */

import { getUI } from '@ui';
import { Harness, DEFAULT_AGENT_MODEL } from '@lib/constants';
import {
  initializeAgent,
  runAgent as executeAgent,
  AgentErrorType,
} from '@lib/agent/agent-interface';
import { analytics } from '@utils/analytics';
import { getLogFilePath, logToFile } from '@utils/debug';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { sessionToOptions } from '@lib/agent/runner/shared/bootstrap';
import type { AgentRunConfig } from '@lib/agent/agent-interface';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';

/**
 * Run an agent, and if the gateway plan-gates the requested model (403 →
 * `MODEL_PLAN_GATED`), retry once on the default model. A free-tier org whose
 * plan excludes the model a task was routed to (e.g. opus) would otherwise die
 * at that step; the rest of the run already succeeds on the default model, so
 * completing this step there is plan-safe. Paid orgs never hit the 403, so
 * never fall back. When the fallback also fails, the plan-gated error is
 * returned unchanged for the pipeline to surface.
 */
export async function runWithPlanFallback(
  agent: AgentRunConfig,
  run: (agent: AgentRunConfig) => Promise<AgentResult>,
  analyticsProperties?: Record<string, unknown>,
): Promise<AgentResult> {
  const result = await run(agent);
  if (
    result.error !== AgentErrorType.MODEL_PLAN_GATED ||
    !agent.model ||
    agent.model === DEFAULT_AGENT_MODEL
  ) {
    return result;
  }
  logToFile(
    `[anthropic] model ${agent.model} plan-gated; retrying on ${DEFAULT_AGENT_MODEL}`,
  );
  analytics.wizardCapture('agent model plan fallback', {
    from_model: agent.model,
    to_model: DEFAULT_AGENT_MODEL,
    ...analyticsProperties,
  });
  return run({ ...agent, model: DEFAULT_AGENT_MODEL });
}

export const anthropicBackend: AgentHarness = {
  name: Harness.anthropic,

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const {
      session,
      config,
      programConfig,
      boot,
      prompt,
      spinner,
      askBridge,
      middleware,
      model,
    } = inputs;
    const { skillsBaseUrl, credentials, wizardFlags, wizardMetadata } = boot;
    const { accessToken, host } = credentials;

    getUI().log.step('Initializing Claude agent...');
    const agent = await initializeAgent(
      {
        workingDirectory: session.installDir,
        posthogMcpUrl: host.mcpUrl,
        posthogApiKey: accessToken,
        host,
        additionalMcpServers: config.additionalMcpServers,
        detectPackageManager:
          config.detectPackageManager ?? detectNodePackageManagers,
        skillsBaseUrl,
        wizardFlags,
        wizardMetadata,
        integrationLabel: config.integrationLabel,
        askBridge,
        askMaxQuestions: config.maxQuestions,
        allowedTools: programConfig.allowedTools,
        disallowedTools: programConfig.disallowedTools,
        getPendingQuestion: () => session.pendingQuestion,
        modelOverride: model,
      },
      sessionToOptions(session),
    );
    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");
    logToFile('[agent-runner] agent initialized');

    return runWithPlanFallback(agent, (a) =>
      executeAgent(
        a,
        prompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.estimatedDurationMinutes,
          spinnerMessage: config.spinnerMessage,
          successMessage: config.successMessage,
          errorMessage:
            config.errorMessage ?? `${config.integrationLabel} failed`,
          additionalFeatureQueue: config.additionalFeatureQueue ?? [],
          abortCases: config.abortCases,
          emitStepEvents: config.trackStepProgress ?? false,
        },
        middleware,
      ),
    );
  },

  async runTask(inputs: TaskRunInputs): Promise<AgentResult> {
    const {
      session,
      programConfig,
      boot,
      prompt,
      spinner,
      model,
      allowedTools,
      disallowedTools,
      orchestrator,
      spinnerMessage,
      successMessage,
      errorMessage,
      additionalFeatureQueue,
      requestRemark,
      analyticsProperties,
    } = inputs;
    const options = sessionToOptions(session);

    // Per-task agent config — the wizard-tools MCP server is bound to the
    // orchestrator context (queue store + current task id) so complete_task /
    // enqueue_task attribute to the right agent when tasks run in parallel.
    const agent = await initializeAgent(
      {
        workingDirectory: session.installDir,
        posthogMcpUrl: boot.credentials.host.mcpUrl,
        posthogApiKey: boot.credentials.accessToken,
        host: boot.credentials.host,
        detectPackageManager: detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        wizardFlags: boot.wizardFlags,
        wizardMetadata: boot.wizardMetadata,
        integrationLabel: programConfig.id,
        orchestrator,
      },
      options,
    );

    return runWithPlanFallback(
      { ...agent, model, allowedTools, disallowedTools },
      (a) =>
        executeAgent(a, prompt, options, spinner, {
          spinnerMessage,
          successMessage,
          errorMessage,
          additionalFeatureQueue,
          requestRemark,
          analyticsProperties,
        }),
      analyticsProperties,
    );
  },
};
