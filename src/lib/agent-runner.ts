import { type FrameworkConfig } from './framework-config';
import { type WizardSession, OutroKind } from './wizard-session';
import {
  tryGetPackageJson,
  isUsingTypeScript,
  getOrAskForProjectData,
} from '../utils/setup-utils';
import type { PackageDotJson } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import {
  initializeAgent,
  runAgent,
  AgentErrorType,
  AgentSignals,
  buildWizardMetadata,
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';

import * as semver from 'semver';
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
import { runSingleQueryFlow } from './legacy/single-query-runner';
import { runQueuedWorkflow } from './queued-workflow-runner';

/**
 * Build a WizardOptions bag from a WizardSession (for code that still expects WizardOptions).
 */
function sessionToOptions(session: WizardSession): WizardOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    forceInstall: session.forceInstall,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    menu: session.menu,
    benchmark: session.benchmark,
    projectId: session.projectId,
    apiKey: session.apiKey,
    yaraReport: session.yaraReport,
  };
}

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 *
 * All user decisions come from the session — no UI prompts.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  session: WizardSession,
): Promise<void> {
  initLogFile();
  logToFile(`[agent-runner] START integration=${config.metadata.integration}`);

  if (session.debug) {
    enableDebugLogs();
  }

  // Version check
  if (config.detection.minimumVersion && config.detection.getInstalledVersion) {
    logToFile('[agent-runner] checking version');
    const version = await config.detection.getInstalledVersion(
      sessionToOptions(session),
    );
    if (version) {
      logToFile(
        `[agent-runner] version=${version} minimum=${config.detection.minimumVersion}`,
      );
      const coerced = semver.coerce(version);
      if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
        const docsUrl =
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
        await wizardAbort({
          message:
            `Sorry: the wizard can't help you with ${config.metadata.name} ${version}. ` +
            `Upgrade to ${config.metadata.name} ${config.detection.minimumVersion} or later, ` +
            `or check out the manual setup guide.\n\n` +
            `Setup ${config.metadata.name} manually: ${docsUrl}`,
        });
      }
    }
  }

  // Compute skills server URL (needed for agent tool calls)
  const skillsBaseUrl = session.localMcp
    ? 'http://localhost:8765'
    : 'https://github.com/PostHog/context-mill/releases/latest/download';

  // Check all external service health (skip if TUI already ran it in bin.ts)
  if (!session.readinessResult) {
    logToFile('[agent-runner] evaluating wizard readiness');
    const readiness = await evaluateWizardReadiness();
    logToFile(`[agent-runner] readiness=${readiness.decision}`);
    if (readiness.decision === WizardReadiness.No) {
      await getUI().showBlockingOutage(readiness);
    } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
      getUI().setReadinessWarnings(readiness);
    }
  }

  // Check ALL settings sources for blocking overrides before login.
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  logToFile(
    `[agent-runner] settings conflicts: ${
      settingsConflicts.length > 0
        ? settingsConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none'
    }`,
  );

  if (settingsConflicts.length > 0) {
    // Capture analytics for each conflict variation
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
    logToFile('[agent-runner] settings override resolved');
  }

  const typeScriptDetected = isUsingTypeScript({
    installDir: session.installDir,
  });
  session.typescript = typeScriptDetected;

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null = null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await tryGetPackageJson({ installDir: session.installDir });
    if (packageJson) {
      const { hasPackageInstalled } = await import('../utils/package-json.js');
      if (!hasPackageInstalled(config.detection.packageName, packageJson)) {
        getUI().log.warn(
          `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
        );
      }
      frameworkVersion = config.detection.getVersion(packageJson);
    } else {
      getUI().log.warn(
        'Could not find package.json. Continuing anyway — the agent will handle it.',
      );
    }
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.wizardCapture('agent started', {
    integration: config.metadata.integration,
  });

  // Get PostHog credentials (region auto-detected from token)
  logToFile('[agent-runner] starting OAuth');
  const { projectApiKey, host, accessToken, projectId, cloudRegion } =
    await getOrAskForProjectData({
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      projectId: session.projectId,
    });

  session.credentials = { accessToken, projectApiKey, host, projectId };

  // Notify TUI that credentials are available (resolves past AuthScreen)
  getUI().setCredentials(session.credentials);

  // Framework context was already gathered by SetupScreen + detection
  const frameworkContext = session.frameworkContext;

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  const promptContext = {
    frameworkVersion: frameworkVersion || 'latest',
    typescript: typeScriptDetected,
    projectApiKey,
    host,
    projectId,
  };

  // Initialize and run agent
  const spinner = getUI().spinner();

  // Evaluate all feature flags at the start of the run so they can be sent to the LLM gateway
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  // Determine MCP URL: CLI flag > env var > production default
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);

  // Register YARA report as cleanup so it fires on any exit path (including wizardAbort)
  if (session.yaraReport) {
    registerCleanup(() => {
      const reportPath = writeScanReport();
      if (reportPath) {
        const summary = formatScanReport();
        getUI().log.info(`YARA scan report: ${reportPath}${summary ?? ''}`);
      }
    });
  }

  getUI().startRun();

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      skillsBaseUrl,
      wizardFlags,
      wizardMetadata,
    },
    sessionToOptions(session),
  );

  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : undefined;

  // ── Feature flag: queued workflow vs old single-query flow ──
  const useQueuedWorkflow = wizardFlags['wizard-queued-workflow'] === 'true';
  logToFile(`[agent-runner] wizard-queued-workflow=${useQueuedWorkflow}`);

  let agentResult: Awaited<ReturnType<typeof runAgent>>;

  if (useQueuedWorkflow) {
    agentResult = await runQueuedWorkflow(
      agent,
      config,
      session,
      sessionToOptions(session),
      promptContext,
      frameworkContext,
      spinner,
      middleware,
    );
  } else {
    // OLD FLOW — single monolithic prompt (see legacy/ folder)
    agentResult = await runSingleQueryFlow({
      agent,
      config,
      session,
      options: sessionToOptions(session),
      spinner,
      promptContext,
      frameworkContext,
      middleware,
    });
  }

  // Handle error cases detected in agent output
  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message: `Could not access the PostHog MCP server\n\nThe wizard was unable to connect to the PostHog MCP server.\nThis could be due to a network issue or a configuration problem.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access PostHog MCP server', {
        integration: config.metadata.integration,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message: `Could not access the setup resource\n\nThe wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.metadata.integration,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    await wizardAbort({
      message:
        'Security violation detected\n\nThe YARA scanner terminated the session after detecting a security violation.\nThis may indicate prompt injection, poisoned skill files, or a policy breach.\n\nPlease report this to: wizard@posthog.com',
      error: new WizardError('YARA scanner terminated session', {
        integration: config.metadata.integration,
        error_type: AgentErrorType.YARA_VIOLATION,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: config.metadata.integration,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this error to: wizard@posthog.com`,
      error: new WizardError(`API error: ${agentResult.message}`, {
        integration: config.metadata.integration,
        error_type: agentResult.error,
      }),
    });
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (auto-accept)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    const { uploadEnvironmentVariablesStep } = await import(
      '../steps/index.js'
    );
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      session,
    });
    if (uploadedEnvVars.length > 0) {
      analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
        action: 'wizard_env_vars_uploaded',
        integration: config.metadata.integration,
        variable_count: uploadedEnvVars.length,
        variable_keys: uploadedEnvVars,
      });
    }
  }

  // MCP installation is handled by McpScreen — no prompt here

  // Build outro data and store it for OutroScreen
  const continueUrl = session.signup
    ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
    : undefined;

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
  ].filter(Boolean);

  session.outroData = {
    kind: OutroKind.Success,
    changes,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
  };

  getUI().outro(`Successfully installed PostHog!`);

  await analytics.shutdown('success');
}

// Re-export for tests
export { extractInstalledSkillId } from './queued-workflow-runner';
