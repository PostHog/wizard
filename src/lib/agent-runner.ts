import {
  DEFAULT_PACKAGE_INSTALLATION,
  type FrameworkConfig,
} from './framework-config';
import {
  ADDITIONAL_FEATURE_LABELS,
  type WizardSession,
  OutroKind,
} from './wizard-session';
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
  runMigrationAgent,
  runPostMigrationCleanup,
  AgentSignals,
  AgentErrorType,
  buildWizardMetadata,
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
  type MigrationResult,
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
import {
  loadAgentSessionCache,
  saveAgentSessionCache,
} from './agent-session-cache';
import {
  buildRunScope,
  getRunScopeKey,
  splitRunScope,
  RUN_WORK_AREA_LABELS,
  RunWorkArea,
  type WizardRunScope,
} from './run-scope';
import {
  scanCodebaseForCompetitors,
  formatAuditForPrompt,
  getCompetitorsFromFeatures,
  generateProjectContext,
} from './codebase-audit';
import {
  MIGRATION_ADDITIONAL_FEATURES,
  type AdditionalFeature,
} from './wizard-session';
import { preloadSkills, formatSkillsForPrompt } from './skill-preloader';

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

async function handleAgentResultOrAbort(
  agentResult: { error?: AgentErrorType; message?: string },
  config: FrameworkConfig,
): Promise<void> {
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
  logToFile('[agent-runner] resolving authentication');
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

  const runScope = buildRunScope(session.additionalFeatureQueue);
  const runScopeKey = getRunScopeKey(runScope);
  const integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
      projectApiKey,
      host,
      projectId,
    },
    frameworkContext,
    runScope,
  );

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

  const exactCachedSession = loadAgentSessionCache(
    session.installDir,
    config.metadata.integration,
    runScopeKey,
  );
  const fallbackCachedSession =
    exactCachedSession ??
    loadAgentSessionCache(
      session.installDir,
      config.metadata.integration,
      runScopeKey,
      { allowScopeMismatch: true },
    );
  const cachedSession = exactCachedSession ?? fallbackCachedSession;
  const scopeChangedSinceCachedRun =
    cachedSession != null && cachedSession.scopeKey !== runScopeKey;

  if (
    !scopeChangedSinceCachedRun &&
    cachedSession?.runStage === 'execution' &&
    cachedSession.todos.length
  ) {
    getUI().syncTodos(cachedSession.todos);
  }
  if (
    !scopeChangedSinceCachedRun &&
    cachedSession?.runStage === 'execution' &&
    cachedSession.eventPlan?.length
  ) {
    getUI().setEventPlan(cachedSession.eventPlan);
  }

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

  const persistCachedSession = ({
    sessionId,
    runStage,
    todos,
    eventPlan,
  }: {
    sessionId: string;
    runStage: 'discovery' | 'execution' | 'base_complete';
    todos: Array<{ content: string; status: string; activeForm?: string }>;
    eventPlan: Array<{ name: string; description: string }>;
  }) => {
    saveAgentSessionCache(
      session.installDir,
      config.metadata.integration,
      runScopeKey,
      sessionId,
      runStage,
      todos,
      eventPlan,
    );
  };

  // Determine whether to split migrations out for parallel execution
  const migrationSet = new Set<AdditionalFeature>(
    MIGRATION_ADDITIONAL_FEATURES as unknown as AdditionalFeature[],
  );
  const hasMigrations = session.additionalFeatureQueue.some((f) =>
    migrationSet.has(f),
  );
  const { baseScope, migrationFeatures } = splitRunScope(runScope);
  let migrationResults: MigrationResult[] = [];

  // Pre-compute codebase audit for migration agents (no LLM, runs in parallel
  // with the agent initialization above). Only scan for selected competitors.
  let auditManifestPromise: ReturnType<
    typeof scanCodebaseForCompetitors
  > | null = null;
  if (hasMigrations) {
    const competitors = getCompetitorsFromFeatures(migrationFeatures);
    logToFile(
      '[agent-runner] Starting codebase audit for competitors:',
      competitors,
    );
    auditManifestPromise = scanCodebaseForCompetitors(
      session.installDir,
      competitors,
    );
  }

  // Pre-install and pre-read skills so the agent can skip discovery.
  // Runs in parallel with the codebase audit.
  getUI().pushStatus('Pre-loading PostHog skills for this framework...');
  const preloadedSkills = await preloadSkills(
    session.installDir,
    skillsBaseUrl,
    config.metadata.integration,
    runScope,
  );
  const skillsContext = formatSkillsForPrompt(preloadedSkills);
  const projectContext = generateProjectContext(session.installDir);
  const canSkipDiscovery = preloadedSkills.length > 0;

  if (
    !scopeChangedSinceCachedRun &&
    hasMigrations &&
    cachedSession?.runStage === 'base_complete'
  ) {
    // Base setup already completed in a prior run — skip straight to migrations
    getUI().pushStatus(
      'Base setup already complete from a prior run. Running migrations...',
    );

    migrationResults = await runParallelMigrations(
      agent,
      cachedSession.sessionId,
      migrationFeatures,
      auditManifestPromise,
      sessionToOptions(session),
      config,
    );
  } else if (
    !scopeChangedSinceCachedRun &&
    cachedSession?.runStage === 'execution'
  ) {
    getUI().pushStatus(
      'Reopening the prior implementation session and refreshing the task list if needed...',
    );

    if (hasMigrations) {
      // Resume base setup only (migrations excluded), then fork for migrations
      const agentResult = await runAgent(
        agent,
        integrationPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage:
            'Reusing prior project analysis and resuming base setup with Claude Sonnet...',
          successMessage: 'Base setup complete',
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'execution_resume',
          additionalFeatureQueue: baseScope.selectedFeatures,
          useBaseStopHook: true,
          resumeSessionId: cachedSession.sessionId,
          resumeRunStage: 'execution',
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(agentResult, config);

      // Mark base as complete for future re-runs
      persistCachedSession({
        sessionId: cachedSession.sessionId,
        runStage: 'base_complete',
        todos: [],
        eventPlan: [],
      });

      // Run migrations in parallel after base setup
      migrationResults = await runParallelMigrations(
        agent,
        cachedSession.sessionId,
        migrationFeatures,
        auditManifestPromise,
        sessionToOptions(session),
        config,
      );
    } else {
      const agentResult = await runAgent(
        agent,
        integrationPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage:
            'Reusing prior project analysis and resuming implementation with Claude Sonnet...',
          successMessage: config.ui.successMessage,
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'execution_resume',
          additionalFeatureQueue: session.additionalFeatureQueue,
          resumeSessionId: cachedSession.sessionId,
          resumeRunStage: 'execution',
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(agentResult, config);
    }
  } else if (canSkipDiscovery && !cachedSession) {
    // Skills are pre-installed — skip discovery entirely and go straight to execution.
    // The agent gets all skill content and project context in its initial prompt.
    const enrichedPrompt = `${integrationPrompt}

${skillsContext}

${projectContext}

Skills have been pre-installed to .claude/skills/ — do not call load_skill_menu or install_skill. The skill content is provided above. Start implementing immediately.

Create a TodoWrite task list for the full scope, then execute the work. You may edit project files, set environment variables, and install packages as required by the workflow.`;

    getUI().pushStatus(
      'Skills pre-loaded. Starting implementation directly...',
    );

    if (hasMigrations) {
      const executionResult = await runAgent(
        agent,
        enrichedPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage: 'Implementing the base setup with Claude Sonnet...',
          successMessage: 'Base setup complete',
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'direct_execution',
          additionalFeatureQueue: baseScope.selectedFeatures,
          useBaseStopHook: true,
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(executionResult, config);

      const baseSession = loadAgentSessionCache(
        session.installDir,
        config.metadata.integration,
        runScopeKey,
      );

      if (baseSession?.sessionId) {
        persistCachedSession({
          sessionId: baseSession.sessionId,
          runStage: 'base_complete',
          todos: [],
          eventPlan: [],
        });

        migrationResults = await runParallelMigrations(
          agent,
          baseSession.sessionId,
          migrationFeatures,
          auditManifestPromise,
          sessionToOptions(session),
          config,
        );
      }
    } else {
      const executionResult = await runAgent(
        agent,
        enrichedPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage: 'Implementing PostHog with Claude Sonnet...',
          successMessage: config.ui.successMessage,
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'direct_execution',
          additionalFeatureQueue: session.additionalFeatureQueue,
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(executionResult, config);
    }
  } else {
    // Fallback: discovery → execution flow (cached sessions or skills not pre-loadable)
    const discoveryStatus = scopeChangedSinceCachedRun
      ? 'Reusing prior project context and reconciling it with the updated selected work...'
      : cachedSession
      ? 'Reopening the prior project analysis and checking what still applies...'
      : 'Reviewing the repository and gathering the full scope for this run...';
    getUI().pushStatus(discoveryStatus);

    const discoverySpinnerMessage = scopeChangedSinceCachedRun
      ? 'Reusing prior project analysis with Claude Sonnet and updating the selected work...'
      : cachedSession
      ? 'Reusing prior project analysis with Claude Sonnet...'
      : 'Analyzing your project with Claude Sonnet...';

    const discoveryResult = await runAgent(
      agent,
      integrationPrompt,
      sessionToOptions(session),
      spinner,
      {
        estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
        spinnerMessage: discoverySpinnerMessage,
        successMessage: 'Project analysis complete',
        errorMessage: 'Project analysis failed',
        modelOverride: agent.model,
        stageMode: 'discovery',
        finalizeMiddleware: false,
        captureCompletionAnalytics: false,
        additionalFeatureQueue: session.additionalFeatureQueue,
        resumeSessionId: cachedSession?.sessionId,
        resumeRunStage: 'discovery',
        resumeScopeChanged: scopeChangedSinceCachedRun,
        onCachedSessionUpdated: persistCachedSession,
      },
      middleware,
    );

    await handleAgentResultOrAbort(discoveryResult, config);

    const executionSession = loadAgentSessionCache(
      session.installDir,
      config.metadata.integration,
      runScopeKey,
    );

    if (!executionSession?.sessionId) {
      await wizardAbort({
        message:
          'Project analysis finished, but the wizard could not resume the implementation session.\n\nPlease try running the wizard again.',
        error: new WizardError('Missing cached session after discovery stage', {
          integration: config.metadata.integration,
        }),
      });
    }
    const executionSessionId = executionSession?.sessionId;

    getUI().pushStatus(
      'Initial analysis complete. Starting the implementation pass on Claude Sonnet...',
    );
    getUI().pushStatus(
      'Preparing the full-scope task list for this run before making code changes...',
    );

    if (hasMigrations) {
      // Run base setup only (migrations excluded from prompt)
      const executionResult = await runAgent(
        agent,
        integrationPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage:
            'Switching to Claude Sonnet to implement the base setup...',
          successMessage: 'Base setup complete',
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'execution',
          additionalFeatureQueue: baseScope.selectedFeatures,
          useBaseStopHook: true,
          resumeSessionId: executionSessionId,
          resumeRunStage: 'execution',
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(executionResult, config);

      // Mark base as complete for future re-runs
      persistCachedSession({
        sessionId: executionSessionId!,
        runStage: 'base_complete',
        todos: [],
        eventPlan: [],
      });

      // Run migrations in parallel after base setup
      migrationResults = await runParallelMigrations(
        agent,
        executionSessionId!,
        migrationFeatures,
        auditManifestPromise,
        sessionToOptions(session),
        config,
      );
    } else {
      const executionResult = await runAgent(
        agent,
        integrationPrompt,
        sessionToOptions(session),
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage:
            'Switching to Claude Sonnet to implement the requested work...',
          successMessage: config.ui.successMessage,
          errorMessage: 'Integration failed',
          modelOverride: agent.model,
          stageMode: 'execution',
          additionalFeatureQueue: session.additionalFeatureQueue,
          resumeSessionId: executionSessionId,
          resumeRunStage: 'execution',
          onCachedSessionUpdated: persistCachedSession,
        },
        middleware,
      );

      await handleAgentResultOrAbort(executionResult, config);
    }
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

  const migrationChangeLines = migrationResults.map((r) => {
    const label = ADDITIONAL_FEATURE_LABELS[r.feature];
    return r.success
      ? `${label} completed`
      : `${label} failed — re-run the wizard to retry`;
  });

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
    ...migrationChangeLines,
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

/**
 * Run selected migrations in parallel as forked agent sessions.
 *
 * Each migration forks from the base execution session so it inherits
 * the full project context and installed skills. Individual migration
 * failures are reported but do not abort the wizard — the base setup
 * has already succeeded.
 */
async function runParallelMigrations(
  agentConfig: Awaited<ReturnType<typeof initializeAgent>>,
  baseSessionId: string,
  migrationFeatures: AdditionalFeature[],
  auditManifestPromise: ReturnType<typeof scanCodebaseForCompetitors> | null,
  options: import('../utils/types').WizardOptions,
  config: FrameworkConfig,
): Promise<MigrationResult[]> {
  if (migrationFeatures.length === 0) return [];

  const auditManifest = auditManifestPromise ? await auditManifestPromise : {};
  const projectContext = generateProjectContext(agentConfig.workingDirectory);

  const migrationLabels = migrationFeatures
    .map((f) => ADDITIONAL_FEATURE_LABELS[f])
    .join(', ');

  logToFile('[agent-runner] Starting parallel migrations:', migrationLabels);
  getUI().pushStatus(
    `Base setup complete. Running ${migrationFeatures.length} migration${
      migrationFeatures.length > 1 ? 's' : ''
    } in parallel: ${migrationLabels}...`,
  );

  const migrationPromises = migrationFeatures.map((feature) => {
    const competitors = getCompetitorsFromFeatures([feature]);
    const auditContext =
      competitors.length > 0
        ? formatAuditForPrompt(auditManifest, competitors[0])
        : '';

    getUI().setMigrationStatus(feature, 'running');
    return runMigrationAgent(
      agentConfig,
      baseSessionId,
      feature,
      auditContext,
      projectContext,
      options,
      {
        onTodoSync: (todos) => {
          getUI().syncMigrationTodos(feature, todos);
        },
        onStatus: (status) => {
          getUI().pushStatus(
            `[${ADDITIONAL_FEATURE_LABELS[feature]}] ${status}`,
          );
        },
      },
    );
  });

  const results = await Promise.allSettled(migrationPromises);
  const migrationResults: MigrationResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const feature = migrationFeatures[i];
    const label = ADDITIONAL_FEATURE_LABELS[feature];

    if (result.status === 'fulfilled') {
      migrationResults.push(result.value);

      analytics.wizardCapture('agent migration completed', {
        migration: feature,
        integration: config.metadata.integration,
        success: result.value.success,
        duration_ms: result.value.durationMs,
        error_type: result.value.error,
      });

      if (result.value.remark) {
        analytics.capture('wizard agent remark', {
          remark: result.value.remark,
          migration: feature,
        });
      }

      if (result.value.success) {
        logToFile(`[agent-runner] ${label}: completed successfully`);
        getUI().setMigrationStatus(feature, 'completed');
      } else {
        logToFile(
          `[agent-runner] ${label}: failed — ${
            result.value.error ?? result.value.errorMessage
          }`,
        );
        getUI().setMigrationStatus(feature, 'failed');
      }
    } else {
      logToFile(`[agent-runner] ${label}: rejected — ${result.reason}`);
      getUI().setMigrationStatus(feature, 'failed');
      migrationResults.push({
        feature,
        success: false,
        errorMessage: String(result.reason),
        durationMs: 0,
      });
    }
  }

  // Report summary
  const succeeded = migrationResults.filter((r) => r.success).length;
  const total = migrationResults.length;

  if (succeeded === total) {
    getUI().pushStatus(
      `All ${total} migration${total > 1 ? 's' : ''} completed successfully.`,
    );
  } else {
    const failed = migrationResults
      .filter((r) => !r.success)
      .map((r) => ADDITIONAL_FEATURE_LABELS[r.feature])
      .join(', ');
    getUI().pushStatus(
      `${succeeded}/${total} migrations completed. Failed: ${failed}`,
    );
    getUI().log.warn(
      `Some migrations failed: ${failed}. You can re-run the wizard to retry.`,
    );
  }

  // Post-migration cleanup: the migration agents were told to skip package
  // install, lint/format, and setup report updates. Run a single cleanup
  // agent that handles all deferred housekeeping in one pass.
  if (succeeded > 0) {
    const completedLabels = migrationResults
      .filter((r) => r.success)
      .map((r) => ADDITIONAL_FEATURE_LABELS[r.feature]);

    getUI().pushStatus(
      'Running post-migration cleanup (install, lint, setup report)...',
    );
    logToFile(
      '[agent-runner] Starting post-migration cleanup for:',
      completedLabels,
    );

    const cleanupResult = await runPostMigrationCleanup(
      agentConfig,
      baseSessionId,
      completedLabels,
      options,
    );

    if (cleanupResult.success) {
      getUI().pushStatus('Post-migration cleanup complete.');
    } else {
      logToFile(
        '[agent-runner] Cleanup had issues:',
        cleanupResult.errorMessage,
      );
      getUI().pushStatus('Post-migration cleanup finished with warnings.');
    }
  }

  return migrationResults;
}

/**
 * Build the integration prompt for the agent.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    projectId: number;
  },
  frameworkContext: Record<string, unknown>,
  runScope: WizardRunScope,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  const workAreaDetails: Record<
    RunWorkArea,
    { label: string; skillCategory: string }
  > = {
    [RunWorkArea.ProductAnalytics]: {
      label: RUN_WORK_AREA_LABELS[RunWorkArea.ProductAnalytics],
      skillCategory: 'integration',
    },
    [RunWorkArea.ErrorTracking]: {
      label: RUN_WORK_AREA_LABELS[RunWorkArea.ErrorTracking],
      skillCategory: 'error-tracking',
    },
    [RunWorkArea.FeatureFlags]: {
      label: RUN_WORK_AREA_LABELS[RunWorkArea.FeatureFlags],
      skillCategory: 'feature-flags',
    },
    [RunWorkArea.LlmAnalytics]: {
      label: RUN_WORK_AREA_LABELS[RunWorkArea.LlmAnalytics],
      skillCategory: 'llm-analytics',
    },
  };

  const requestedWorkAreas = runScope.workAreas
    .map((workArea) => {
      const detail = workAreaDetails[workArea];
      return `- ${detail.label} (skill category: \`${detail.skillCategory}\`)`;
    })
    .join('\n');

  const selectedFeatures =
    runScope.selectedFeatures.length > 0
      ? runScope.selectedFeatures
          .map((feature) => `- ${ADDITIONAL_FEATURE_LABELS[feature]}`)
          .join('\n')
      : '- None';

  const nonRequestedWorkAreaLabels = Object.entries(workAreaDetails)
    .filter(
      ([workArea]) => !runScope.workAreas.includes(workArea as RunWorkArea),
    )
    .map(([, detail]) => detail.label);
  const nonRequestedGuardrail =
    nonRequestedWorkAreaLabels.length > 0
      ? `Do not implement unrelated PostHog areas that were not requested for this run (${nonRequestedWorkAreaLabels.join(
          ', ',
        )}). In particular, do not add generic product analytics/event capture work unless Product analytics is explicitly requested.`
      : 'Do not install or use extra PostHog skill categories beyond the requested work areas for this run.';
  const requestedSkillCategories = runScope.workAreas
    .map((workArea) => workAreaDetails[workArea].skillCategory)
    .join(', ');

  return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
    config.metadata.name
  } project.

Project context:
- PostHog Project ID: ${context.projectId}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog public token: ${context.projectApiKey}
- PostHog Host: ${context.host}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Requested work areas for this run:
${requestedWorkAreas}

Selected migrations or follow-up features:
${selectedFeatures}

Scope guardrail:
- ${nonRequestedGuardrail}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: Call load_skill_menu (from the wizard-tools MCP server) to see available skills.
   If the tool fails, emit: ${
     AgentSignals.ERROR_MCP_MISSING
   } Could not load skill menu and halt.

STEP 2: Choose the framework-matching skill or skills for the requested work areas only.
   Use only these skill categories: ${requestedSkillCategories}.
   For each requested work area, choose the matching skill category listed above and skip all unrelated categories.
   If Product analytics is not requested, do not install an \`integration\` skill just to do generic analytics setup.
   If no suitable skill is found for a requested work area, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 3: Call install_skill (from the wizard-tools MCP server) for each chosen skill ID.
   Do NOT run any shell commands to install skills.

STEP 4: Load each installed skill's SKILL.md file to understand what references are available.

STEP 5: Follow the skill workflow files in sequence for the requested work areas only. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 6: Set up environment variables for PostHog using the wizard-tools MCP server when the selected skills require them (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
}
