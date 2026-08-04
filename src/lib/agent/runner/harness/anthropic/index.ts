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
import { Harness } from '@lib/constants';
import {
  initializeAgent,
  runAgent as executeAgent,
} from '@lib/agent/agent-interface';
import { createAioCapture } from '@lib/agent/aio-capture';
import { getLogFilePath, logToFile } from '@utils/debug';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { sessionToOptions } from '@lib/agent/runner/shared/bootstrap';
import { getRotatingCredential } from '@lib/agent/rotating-credential';
import { getTokenEndpoint } from '@utils/oauth';
import type { WizardSession } from '@lib/wizard-session';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';

/** Undefined without a refresh token, which is the CI case (keys don't expire). */
function rotatingCredentialFor(session: WizardSession): string | undefined {
  const { refreshToken, expiresAt } = session.credentials ?? {};
  if (!refreshToken || !expiresAt) return undefined;
  return getRotatingCredential({
    accessToken: session.credentials!.accessToken,
    refreshToken,
    expiresAt,
    ...getTokenEndpoint(session.baseUrl),
  });
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
    const { accessToken, host, projectApiKey } = credentials;

    const capture = createAioCapture({
      enabled: session.captureAio,
      projectApiKey,
      apiHost: host.apiHost,
      runTags: wizardMetadata,
    });

    getUI().log.step('Initializing Claude agent...');
    const agent = await initializeAgent(
      {
        workingDirectory: session.installDir,
        posthogMcpUrl: host.mcpUrl,
        posthogApiKey: accessToken,
        apiKeyHelperPath: rotatingCredentialFor(session),
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
        capture,
      },
      sessionToOptions(session),
    );
    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");
    logToFile('[agent-runner] agent initialized');

    return executeAgent(
      agent,
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
        triageProvider: boot.triageProvider,
      },
      middleware,
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

    const capture = createAioCapture({
      enabled: session.captureAio,
      projectApiKey: boot.credentials.projectApiKey,
      apiHost: boot.credentials.host.apiHost,
      runTags: boot.wizardMetadata,
    });

    // Per-task agent config — the wizard-tools MCP server is bound to the
    // orchestrator context (queue store + current task id) so complete_task /
    // enqueue_task attribute to the right agent when tasks run in parallel.
    const agent = await initializeAgent(
      {
        workingDirectory: session.installDir,
        posthogMcpUrl: boot.credentials.host.mcpUrl,
        posthogApiKey: boot.credentials.accessToken,
        apiKeyHelperPath: rotatingCredentialFor(session),
        host: boot.credentials.host,
        detectPackageManager: detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        wizardFlags: boot.wizardFlags,
        wizardMetadata: boot.wizardMetadata,
        integrationLabel: programConfig.id,
        orchestrator,
        capture,
      },
      options,
    );

    return executeAgent(
      { ...agent, model, allowedTools, disallowedTools },
      prompt,
      options,
      spinner,
      {
        spinnerMessage,
        successMessage,
        errorMessage,
        additionalFeatureQueue,
        requestRemark,
        analyticsProperties,
      },
    );
  },
};
