/**
 * Generic skill bootstrap runner.
 *
 * Given a skill ID, installs it from context-mill and runs the agent
 * against it. Callers (like revenue-runner) just pass config — the
 * whole install + OAuth + run + outro pipeline lives here.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  type WizardSession,
  type OutroData,
  OutroKind,
} from './wizard-session';
import { getOrAskForProjectData } from '../utils/setup-utils';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import {
  initializeAgent,
  runAgent,
  AgentErrorType,
  buildWizardMetadata,
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from './health-checks/readiness';
import { enableDebugLogs, initLogFile, logToFile } from '../utils/debug';
import { createBenchmarkPipeline } from './middleware/benchmark';
import {
  wizardAbort,
  WizardError,
  registerCleanup,
} from '../utils/wizard-abort';
import { formatScanReport, writeScanReport } from './yara-hooks';
import { detectNodePackageManagers } from './package-manager-detection';
import { getSkillsBaseUrl } from './constants';
import { installSkillById, type InstallSkillResult } from './wizard-tools';
import type { WizardOptions } from '../utils/types';

/**
 * Configuration for a skill-based workflow.
 */
export interface SkillBootstrapConfig {
  /** Context-mill skill ID to install (e.g. 'revenue-analytics-setup') */
  skillId: string;
  /** Analytics integration label */
  integrationLabel: string;
  /** Extra context prepended to the agent prompt */
  promptContext?: string;
  /** Outro success message */
  successMessage: string;
  /** Report file the agent should write */
  reportFile: string;
  /** Docs URL for the outro */
  docsUrl: string;
  /** Spinner message during agent run */
  spinnerMessage: string;
  /** Estimated duration in minutes */
  estimatedDurationMinutes: number;
  /**
   * Optional abort handler. When the agent emits `[ABORT] <reason>`, the
   * middleware force-kills the SDK query and this callback is invoked to
   * produce the full OutroData the error screen will render. The workflow
   * owns the entire rendering — no merging, no defaults from the runner.
   *
   * Must return `kind: OutroKind.Error` (the TypeScript type enforces it).
   * If not specified, aborts fall through to a generic error outro.
   */
  onAbort?: (reason: string) => OutroData;
}

function sessionToOptions(session: WizardSession): WizardOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    forceInstall: false,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    menu: false,
    benchmark: session.benchmark,
    yaraReport: session.yaraReport,
  };
}

export async function runSkillBootstrap(
  session: WizardSession,
  config: SkillBootstrapConfig,
): Promise<void> {
  initLogFile();
  logToFile(`[skill-runner] START ${config.integrationLabel}`);

  if (session.debug) {
    enableDebugLogs();
  }

  const skillsBaseUrl = getSkillsBaseUrl(session.localMcp);

  // Health check
  if (!session.readinessResult) {
    logToFile('[skill-runner] evaluating wizard readiness');
    const readiness = await evaluateWizardReadiness();
    logToFile(`[skill-runner] readiness=${readiness.decision}`);
    if (readiness.decision === WizardReadiness.No) {
      await getUI().showBlockingOutage(readiness);
    } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
      getUI().setReadinessWarnings(readiness);
    }
  }

  // Settings conflicts
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  if (settingsConflicts.length > 0) {
    for (const conflict of settingsConflicts) {
      const level = conflict.source === 'managed' ? 'org' : conflict.source;
      analytics.wizardCapture('settings conflict detected', {
        level,
        keys: conflict.keys,
      });
    }
    await getUI().showSettingsOverride(settingsConflicts, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
  }

  analytics.wizardCapture('agent started', {
    integration: config.integrationLabel,
  });

  // OAuth
  logToFile('[skill-runner] starting OAuth');
  const { projectApiKey, host, accessToken, projectId, cloudRegion } =
    await getOrAskForProjectData({
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      projectId: session.projectId,
    });

  session.credentials = { accessToken, projectApiKey, host, projectId };
  getUI().setCredentials(session.credentials);

  const spinner = getUI().spinner();
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);

  if (session.yaraReport) {
    registerCleanup(() => {
      const reportPath = writeScanReport();
      if (reportPath) {
        const summary = formatScanReport();
        getUI().log.info(`YARA scan report: ${reportPath}${summary ?? ''}`);
      }
    });
  }

  // Install the skill from context-mill before running the agent.
  logToFile(`[skill-runner] installing skill ${config.skillId}`);
  const installResult = await installSkillById(
    config.skillId,
    session.installDir,
    skillsBaseUrl,
  );
  if (installResult.kind !== 'ok') {
    await abortOnInstallFailure(config.integrationLabel, installResult);
    return;
  }
  logToFile(`[skill-runner] skill installed at ${installResult.path}`);

  getUI().startRun();

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      detectPackageManager: detectNodePackageManagers,
      skillsBaseUrl,
      wizardFlags,
      wizardMetadata,
    },
    sessionToOptions(session),
  );

  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : undefined;

  const prompt = buildBootstrapPrompt(
    config,
    installResult.path,
    projectId,
    projectApiKey,
    host,
  );

  const agentResult = await runAgent(
    agent,
    prompt,
    sessionToOptions(session),
    spinner,
    {
      estimatedDurationMinutes: config.estimatedDurationMinutes,
      spinnerMessage: config.spinnerMessage,
      successMessage: config.successMessage,
      errorMessage: `${config.integrationLabel} setup failed`,
      additionalFeatureQueue: [],
    },
    middleware,
  );

  // Error handling
  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    await wizardAbort({
      message:
        'Security violation detected.\nPlease report this to: wizard@posthog.com',
      error: new WizardError('YARA scanner terminated session', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.YARA_VIOLATION,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this to: wizard@posthog.com`,
      error: new WizardError(`API error: ${agentResult.message}`, {
        integration: config.integrationLabel,
        error_type: agentResult.error,
      }),
    });
  }

  // Agent emitted [ABORT] — the workflow's onAbort owns the full error
  // outro rendering. bin.ts waits for outroDismissed then exits with
  // code 1 based on outroData.kind.
  if (agentResult.error === AgentErrorType.ABORT) {
    const reason = agentResult.message ?? 'Unknown reason';
    logToFile(`[skill-runner] abort: ${reason}`);
    analytics.wizardCapture('agent aborted', {
      integration: config.integrationLabel,
      reason,
    });
    const outroData: OutroData = config.onAbort?.(reason) ?? {
      kind: OutroKind.Error,
      message: `${config.integrationLabel} setup aborted`,
      body: reason,
      docsUrl: config.docsUrl,
    };
    getUI().outroError(outroData);
    await analytics.shutdown('error');
    return;
  }

  // Outro — check if agent wrote the report
  const continueUrl = session.signup
    ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
    : undefined;

  const reportPath = join(session.installDir, config.reportFile);
  const reportExists = existsSync(reportPath);

  session.outroData = {
    kind: OutroKind.Success,
    message: config.successMessage,
    reportFile: reportExists ? config.reportFile : undefined,
    docsUrl: config.docsUrl,
    continueUrl,
  };

  getUI().outro(config.successMessage);
  await analytics.shutdown('success');
}

/**
 * Bootstrap prompt — skill is already installed, just follow it.
 */
function buildBootstrapPrompt(
  config: SkillBootstrapConfig,
  skillPath: string,
  projectId: number,
  projectApiKey: string,
  host: string,
): string {
  return `You have access to the PostHog MCP server.${
    config.promptContext ? ' ' + config.promptContext : ''
  }

Project context:
- PostHog Project ID: ${projectId}
- PostHog public token: ${projectApiKey}
- PostHog Host: ${host}

A PostHog skill has been installed at ${skillPath}/. Read ${skillPath}/SKILL.md and follow its instructions completely.

After completing the skill workflow, write a brief markdown report to ./${
    config.reportFile
  } summarizing:
- What changes were made to the project
- Which files were modified or created
- Any manual steps the user should take next

Important: You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.
`;
}

/**
 * Map an installSkillById failure to a user-facing error message and abort.
 */
async function abortOnInstallFailure(
  integrationLabel: string,
  result: InstallSkillResult,
): Promise<void> {
  if (result.kind === 'ok') return;

  const message = (() => {
    switch (result.kind) {
      case 'menu-fetch-failed':
        return 'Could not fetch the skill menu from context-mill.\nCheck your network connection and try again.';
      case 'skill-not-found':
        return `Could not find the "${result.skillId}" skill in the context-mill menu.\nPlease try again later.`;
      case 'download-failed':
        return `Failed to install skill: ${result.message}\nPlease try again.`;
    }
  })();

  await wizardAbort({
    message,
    error: new WizardError(`Skill install failed: ${result.kind}`, {
      integration: integrationLabel,
      error_type: result.kind,
    }),
  });
}
