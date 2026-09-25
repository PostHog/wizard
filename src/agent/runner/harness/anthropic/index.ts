// Supported legacy SDK fallback; both this adapter and Pi implement run and runTask.

import { Harness } from '@shared/constants';
import {
  initializeAgent,
  runAgent as executeAgent,
} from '@agent/agent-interface';
import { createAioCapture } from '@agent/aio-capture';
import { getLogFilePath, logToFile } from '@utils/debug';
import { detectNodePackageManagers } from '@utils/package-manager';
import { runOptions } from '@agent/runner/shared/bootstrap';
import { currentAccessToken } from '@shared/oauth-session';
import { createEmitLog } from '@agent/runner/shared/progress-collector';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';

export const anthropicBackend: AgentHarness = {
  name: Harness.anthropic,

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const {
      config: runConfig,
      input,
      boot,
      emit,
      prompt,
      spinner,
      askBridge,
      middleware,
      model,
    } = inputs;
    const config = runConfig.run;
    const { skillsBaseUrl, credentials, wizardFlags, wizardMetadata } = boot;
    const { accessToken, host, projectApiKey } = credentials;
    const log = createEmitLog(emit);

    const capture = createAioCapture({
      enabled: input.flags.captureAio,
      projectApiKey,
      apiHost: host.apiHost,
      runTags: wizardMetadata,
    });

    log.step('Initializing Claude agent...');
    const agent = await initializeAgent(
      {
        workingDirectory: input.installDir,
        posthogMcpUrl: host.mcpUrl,
        posthogApiKey: accessToken,
        currentPosthogApiKey: () => currentAccessToken(credentials),
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
        getPendingQuestion: askBridge?.getPendingQuestion,
        askMaxQuestions: config.maxQuestions,
        allowedTools: runConfig.allowedTools,
        disallowedTools: runConfig.disallowedTools,
        modelOverride: model,
        capture,
        emit,
      },
      runOptions(input),
    );
    log.step(`Verbose logs: ${getLogFilePath()}`);
    log.success("Agent initialized. Let's get cooking!");
    logToFile('[agent-runner] agent initialized');

    return executeAgent(
      { ...agent, signal: inputs.signal },
      prompt,
      runOptions(input),
      spinner,
      {
        estimatedDurationMinutes: config.estimatedDurationMinutes,
        spinnerMessage: config.spinnerMessage,
        successMessage: config.successMessage,
        errorMessage:
          config.errorMessage ?? `${config.integrationLabel} failed`,
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
      config,
      input,
      boot,
      emit,
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
      requestRemark,
      analyticsProperties,
    } = inputs;
    const options = runOptions(input);

    const capture = createAioCapture({
      enabled: input.flags.captureAio,
      projectApiKey: boot.credentials.projectApiKey,
      apiHost: boot.credentials.host.apiHost,
      runTags: boot.wizardMetadata,
    });

    // Per-task agent config — the wizard-tools MCP server is bound to the
    // orchestrator context (queue store + current task id) so complete_task /
    // enqueue_task attribute to the right agent when tasks run in parallel.
    const agent = await initializeAgent(
      {
        workingDirectory: input.installDir,
        posthogMcpUrl: boot.credentials.host.mcpUrl,
        posthogApiKey: boot.credentials.accessToken,
        currentPosthogApiKey: () => currentAccessToken(boot.credentials),
        host: boot.credentials.host,
        detectPackageManager: detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        programId: boot.programId,
        wizardFlags: boot.wizardFlags,
        wizardMetadata: boot.wizardMetadata,
        integrationLabel: config.programId,
        // Only a task allowed to ask carries a bridge, so the Write/Edit pause
        // that rides on a pending question stays inside that task's agent.
        askBridge,
        getPendingQuestion: askBridge?.getPendingQuestion,
        orchestrator,
        capture,
        emit,
      },
      options,
    );

    return executeAgent(
      { ...agent, model, allowedTools, disallowedTools, signal: inputs.signal },
      prompt,
      options,
      spinner,
      {
        spinnerMessage,
        successMessage,
        errorMessage,
        requestRemark,
        analyticsProperties,
      },
    );
  },
};
