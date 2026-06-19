/**
 * The `anthropic` backend — the control. Wraps the existing claude-agent-sdk
 * path (`initializeAgent` + `runAgent`) verbatim behind the `AgentBackend`
 * seam. Behavior is unchanged from when this lived inline in `linear.ts`.
 */

import { getUI } from '../../../../ui';
import { getLogFilePath, logToFile } from '../../../../utils/debug';
import { detectNodePackageManagers } from '../../../detection/package-manager';
import { initializeAgent, runAgent as executeAgent } from '../../agent-interface';
import { sessionToOptions } from '../shared/bootstrap';
import type { AgentBackend, AgentResult, BackendRunInputs } from './types';

export const anthropicBackend: AgentBackend = {
  name: 'anthropic',

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const { session, config, programConfig, boot, prompt, spinner, askBridge } =
      inputs;

    getUI().log.step('Initializing Claude agent...');
    const agent = await initializeAgent(
      {
        workingDirectory: session.installDir,
        posthogMcpUrl: boot.mcpUrl,
        posthogApiKey: boot.accessToken,
        posthogApiHost: boot.host,
        additionalMcpServers: config.additionalMcpServers,
        detectPackageManager:
          config.detectPackageManager ?? detectNodePackageManagers,
        skillsBaseUrl: boot.skillsBaseUrl,
        wizardFlags: boot.wizardFlags,
        wizardMetadata: boot.wizardMetadata,
        integrationLabel: config.integrationLabel,
        askBridge,
        askMaxQuestions: config.maxQuestions,
        allowedTools: programConfig.allowedTools,
        disallowedTools: programConfig.disallowedTools,
        getPendingQuestion: () => session.pendingQuestion,
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
      },
      inputs.middleware,
    );
  },
};
