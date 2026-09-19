// Supported legacy SDK fallback; both this adapter and Pi implement run and runTask.

import { getUI } from '@store/ui';
import { Harness } from '@store/shared/constants';
import {
  initializeAgent,
  runAgent as executeAgent,
} from '../../../agent-interface.js';
import { createAioCapture } from '../../../aio-capture.js';
import { getLogFilePath, logToFile } from '@store/shared/debug';
import { detectNodePackageManagers } from '@store/detection/package-manager';
import { sessionToOptions } from '../../shared/bootstrap.js';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types.js';

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
        host,
        additionalMcpServers: config.additionalMcpServers,
        detectPackageManager:
          config.detectPackageManager ?? detectNodePackageManagers,
        skillsBaseUrl,
        wizardFlags,
        wizardMetadata,
        programId: boot.programId,
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
        resolveStepKey: config.resolveStepKey,
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
      askBridge,
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
        host: boot.credentials.host,
        detectPackageManager: detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        programId: boot.programId,
        wizardFlags: boot.wizardFlags,
        wizardMetadata: boot.wizardMetadata,
        integrationLabel: programConfig.id,
        // Only a task allowed to ask carries a bridge, so the Write/Edit pause
        // that rides on a pending question stays inside that task's agent.
        askBridge,
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
