// Supported legacy SDK fallback; both this adapter and Pi implement run and runTask.

import { Harness } from '@shared/constants';
import {
  AgentErrorType,
  initializeAgent,
  runAgent as executeAgent,
} from '../../../agent-interface';
import { createAioCapture } from '../../../aio-capture';
import { getLogFilePath, logToFile } from '@utils/debug';
import { detectNodePackageManagers } from '@utils/package-manager';
import { runOptions } from '../../shared/bootstrap';
import { createEmitLog } from '../../shared/progress-collector';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '../types';

const hostCancelled = (): AgentResult => ({
  kind: 'abort',
  classification: AgentErrorType.ABORT,
  message: 'Agent run cancelled',
});

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
        host,
        additionalMcpServers: config.additionalMcpServers,
        detectPackageManager:
          config.detectPackageManager ?? detectNodePackageManagers,
        skillsBaseUrl,
        wizardFlags,
        wizardMetadata,
        programId: boot.programId,
        inferenceAuth: boot.inferenceAuth,
        programCommandments: runConfig.programCommandments,
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
    if (inputs.signal?.aborted) return hostCancelled();
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
      additionalFeatureQueue,
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
        host: boot.credentials.host,
        detectPackageManager: detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        programId: boot.programId,
        inferenceAuth: boot.inferenceAuth,
        programCommandments: config.programCommandments,
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
    if (inputs.signal?.aborted) return hostCancelled();

    return executeAgent(
      { ...agent, model, allowedTools, disallowedTools, signal: inputs.signal },
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
