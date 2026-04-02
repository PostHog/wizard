/**
 * Entry point for the setup-revenue-analytics command.
 *
 * Orchestrates: language detection → Stripe detection → PostHog distinct_id
 * detection → Stripe docs fetching → prompt building → agent execution.
 */

import type { WizardSession } from '../lib/wizard-session';
import { getUI } from '../ui';
import { detectLanguage } from './language-detection';
import { detectStripe } from './stripe-detection';
import { detectPostHogDistinctId } from './posthog-detection';
import { getStripeDocs } from './stripe-docs';
import { buildRevenueAnalyticsPrompt } from './prompt-builder';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
  buildWizardMetadata,
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from '../lib/agent-interface';
import { getOrAskForProjectData } from '../utils/setup-utils';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from '../lib/health-checks/readiness';
import { analytics } from '../utils/analytics';
import { initLogFile, logToFile, enableDebugLogs } from '../utils/debug';
import {
  wizardAbort,
  WizardError,
  registerCleanup,
} from '../utils/wizard-abort';
import { formatScanReport, writeScanReport } from '../lib/yara-hooks';

export async function runSetupRevenueAnalytics(
  session: WizardSession,
): Promise<void> {
  initLogFile();
  logToFile('[setup-revenue-analytics] START');

  if (session.debug) {
    enableDebugLogs();
  }

  getUI().intro('PostHog Revenue Analytics Setup');

  // 1. Detect language
  getUI().log.step('Detecting project language...');
  const language = await detectLanguage(session.installDir);
  if (!language) {
    return wizardAbort({
      message:
        'Could not detect the project language. Revenue analytics setup requires a Node.js, Python, Ruby, PHP, Go, Java, or .NET project.',
    });
  }
  logToFile(`[setup-revenue-analytics] language=${language}`);
  getUI().log.success(`Detected language: ${language}`);

  // 2. Detect Stripe SDK
  getUI().log.step('Scanning for Stripe SDK...');
  const stripeResult = detectStripe(session.installDir, language);
  if (!stripeResult) {
    return wizardAbort({
      message:
        'No Stripe SDK detected in this project. Install the Stripe SDK for your language first, then re-run this command.',
    });
  }
  logToFile(
    `[setup-revenue-analytics] stripe=${stripeResult.sdkPackage} v=${stripeResult.sdkVersion}`,
  );
  getUI().log.success(
    `Found Stripe SDK: ${stripeResult.sdkPackage}${
      stripeResult.sdkVersion ? ` v${stripeResult.sdkVersion}` : ''
    }`,
  );

  if (stripeResult.customerCreationCalls.length > 0) {
    getUI().log.info(
      `  Customer creation calls: ${stripeResult.customerCreationCalls.length} location(s)`,
    );
  }
  if (stripeResult.chargeCalls.length > 0) {
    getUI().log.info(
      `  Charge/payment calls: ${stripeResult.chargeCalls.length} location(s)`,
    );
  }

  // 3. Detect PostHog distinct_id
  getUI().log.step('Looking for PostHog distinct_id usage...');
  const posthogResult = await detectPostHogDistinctId(
    session.installDir,
    language,
  );
  if (posthogResult.distinctIdExpression) {
    logToFile(
      `[setup-revenue-analytics] distinct_id=${posthogResult.distinctIdExpression}`,
    );
    getUI().log.success(
      `Found distinct_id expression: ${posthogResult.distinctIdExpression}`,
    );
  } else {
    getUI().log.warn(
      'Could not detect PostHog distinct_id usage. The agent will search your codebase to find it.',
    );
  }

  // 4. Fetch Stripe docs
  getUI().log.step('Fetching Stripe documentation...');
  const stripeDocs = await getStripeDocs(language, stripeResult.sdkVersion);
  getUI().log.success('Stripe docs ready');

  // 5. Build prompt
  const prompt = buildRevenueAnalyticsPrompt({
    language,
    stripeDetection: stripeResult,
    posthogDetection: posthogResult,
    stripeDocs,
  });
  logToFile('[setup-revenue-analytics] prompt built');

  // 6. Health check
  if (!session.readinessResult) {
    logToFile('[setup-revenue-analytics] evaluating readiness');
    const readiness = await evaluateWizardReadiness();
    if (readiness.decision === WizardReadiness.No) {
      await getUI().showBlockingOutage(readiness);
    }
  }

  // 7. Settings conflict check
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  if (settingsConflicts.length > 0) {
    await getUI().showSettingsOverride(settingsConflicts, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
  }

  // 8. Authenticate
  logToFile('[setup-revenue-analytics] starting auth');
  const { projectApiKey, host, accessToken, projectId, cloudRegion } =
    await getOrAskForProjectData({
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      projectId: session.projectId,
    });

  session.credentials = { accessToken, projectApiKey, host, projectId };
  getUI().setCredentials(session.credentials);

  analytics.wizardCapture('revenue_analytics started', {
    language,
    stripe_version: stripeResult.sdkVersion,
    customer_creation_calls: stripeResult.customerCreationCalls.length,
    charge_calls: stripeResult.chargeCalls.length,
    distinct_id_found: !!posthogResult.distinctIdExpression,
  });

  // 9. Compute MCP URL and skills URL
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  const skillsBaseUrl = session.localMcp
    ? 'http://localhost:8765'
    : 'https://github.com/PostHog/context-mill/releases/latest/download';

  // 10. Initialize and run agent
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

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

  getUI().startRun();

  const spinner = getUI().spinner();

  const { detectPackageManager: getPackageManagerDetector } = await import(
    './package-manager.js'
  );
  const detectPackageManager = getPackageManagerDetector(language);

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      detectPackageManager,
      skillsBaseUrl,
      wizardFlags,
      wizardMetadata,
    },
    {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: false,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: false,
      benchmark: session.benchmark,
      projectId: session.projectId,
      apiKey: session.apiKey,
      yaraReport: session.yaraReport,
    },
  );

  const agentResult = await runAgent(
    agent,
    prompt,
    {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: false,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: false,
      benchmark: session.benchmark,
      projectId: session.projectId,
      apiKey: session.apiKey,
      yaraReport: session.yaraReport,
    },
    spinner,
    {
      estimatedDurationMinutes: 3,
      spinnerMessage: 'Setting up revenue analytics...',
      successMessage: 'Revenue analytics setup complete',
      errorMessage: 'Revenue analytics setup failed',
    },
  );

  // Handle errors
  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message: `Could not access the PostHog MCP server.\n\nPlease try again, or follow the manual setup guide:\nhttps://posthog.com/docs/revenue-analytics/connect-to-customers`,
      error: new WizardError('Agent could not access PostHog MCP server', {
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    await wizardAbort({
      message:
        'Security violation detected.\n\nPlease report this to: wizard@posthog.com',
      error: new WizardError('YARA scanner terminated session', {
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
        error_type: agentResult.error,
      }),
    });
  }

  analytics.wizardCapture('revenue_analytics completed', {
    language,
  });

  getUI().outro(
    'Revenue analytics setup complete! Visit your PostHog dashboard to see revenue data.',
  );

  await analytics.shutdown('success');
}
