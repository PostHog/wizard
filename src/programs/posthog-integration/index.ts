import type { ProgramConfig, ProgramStep } from '@programs/program-step';
import { runProgramAgent } from '@programs/run-agent-legacy';
import type { ProgramRun } from '@programs/program-run';
import type { WizardSession } from '@lib/wizard-session';
import { mayReportScanResults } from '@shared/scan-consent';
import { RunPhase } from '@shared/run-state';
import { WIZARD_TOOL_NAMES } from '@agent';
import { tryGetPackageJson, isUsingTypeScript } from '@utils/setup-utils';
import { hasDeclaredDependency } from '@utils/package-json';
import { analytics } from '@utils/analytics';
import {
  detectFramework,
  gatherFrameworkContext,
} from '@programs/detection/index';
import { scopeInstallDirToProject } from '@programs/detection/project-scope';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@shared/errors';
import { getUI } from '@ui/index';
import { requestDeepLink } from '@utils/provisioning';
import { openTrackedLink } from '@utils/links';
import { getDetectedWarehouseSources } from '@programs/warehouse-source/detect';
import { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';
import {
  resolvePosthogIntegrationRun,
  resolvePosthogIntegrationSeedTasks,
} from './run.js';
import { EVENT_PLAN_FILE } from './constants.js';

const DASHBOARD_DEEP_LINK_KEY = 'dashboardDeepLink';

const warehouseSeedTasks: NonNullable<ProgramConfig['seedTasks']> = (session) =>
  resolvePosthogIntegrationSeedTasks(
    {
      warehouseSources: getDetectedWarehouseSources(session),
      flags: {
        ci: session.ci,
        signup: session.signup,
        e2eAsk: session.e2eAsk,
      },
      mayReportScanResults: mayReportScanResults(session),
    },
    (event, properties) => analytics.wizardCapture(event, properties),
  );

export { SETUP_REPORT_FILE } from './run.js';
export { EVENT_PLAN_FILE } from './constants.js';

export const posthogIntegrationConfig: ProgramConfig = {
  description: 'Set up PostHog SDK integration',
  id: 'posthog-integration',
  agentFlow: 'integration-v2',
  eventPlanFile: EVENT_PLAN_FILE,
  steps: POSTHOG_INTEGRATION_PROGRAM,
  // Basic integration runs without structured user input; drop wizard_ask
  // so the model can't pop modal prompts mid-run. The runner forwards this
  // list to the general-purpose subagent as well, so dispatched subagents
  // can't reach around the parent and ask either.
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],

  seedTasks: warehouseSeedTasks,

  // CI-mode prerequisite work: the headless equivalent of the detect step's
  // onReady hook. Auto-detect the framework, then gather context.
  ciPreRun: async (session: WizardSession): Promise<void> => {
    await scopeInstallDirToProject(session);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await wizardAbort({
        code: ErrorCodes.DetectNoFramework,
        message: 'Could not auto-detect your framework for this project.',
      });
      return;
    }
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      signup: session.signup,
      ci: true,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    const detectedLabel =
      frameworkConfig.metadata.getDetectedFrameworkLabel?.(context);
    if (detectedLabel) session.detectedFrameworkLabel = detectedLabel;
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
  },

  run: async (session: WizardSession): Promise<ProgramRun> => {
    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;
    const { run, hooks } = await resolvePosthogIntegrationRun(
      {
        installDir: session.installDir,
        frameworkConfig: session.frameworkConfig!,
        frameworkContext: session.frameworkContext,
        typescript: typeScriptDetected,
        additionalFeatureQueue: session.additionalFeatureQueue,
        warehouseSources: getDetectedWarehouseSources(session),
        flags: {
          ci: session.ci,
          signup: session.signup,
          e2eAsk: session.e2eAsk,
        },
        mayReportScanResults: mayReportScanResults(session),
        includeSeedTasks: false,
        dashboardDeepLink: session.frameworkContext[DASHBOARD_DEEP_LINK_KEY],
        notebookUrl: session.notebookUrl,
      },
      {
        readPackageJson: (installDir) => tryGetPackageJson({ installDir }),
        hasDeclaredDependency,
        warn: (message) => getUI().log.warn(message),
        setTag: (key, value) => analytics.setTag(key, value),
        capture: (event, properties) => analytics.capture(event, properties),
        uploadEnvironmentVariables: async (envVars, integration) => {
          const { uploadEnvironmentVariablesStep } = await import(
            '@steps/index'
          );
          return uploadEnvironmentVariablesStep(envVars, {
            integration,
            session,
          });
        },
        requestDeepLink: (credentials) =>
          requestDeepLink(credentials.accessToken, credentials.host),
        openDashboardDeepLink: (url) =>
          openTrackedLink(url, 'dashboard-deeplink', { auto: true }),
        getNotebookUrl: () => session.notebookUrl,
        setDashboardDeepLink: (url) => {
          session.frameworkContext[DASHBOARD_DEEP_LINK_KEY] = url;
        },
      },
    );
    return {
      ...run,
      postRun: async (_session, credentials) => {
        await hooks.postRun?.(credentials);
      },
      buildOutroNextSteps: (_session, credentials, completedSeededTypes) =>
        hooks.buildOutroNextSteps?.(credentials, completedSeededTypes),
      buildOutroData: (_session, credentials) =>
        hooks.buildOutroData?.(credentials) ?? null,
    };
  },
};

export { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';

/**
 * Self-contained run step that runs the integration agent. Other programs
 * import this and splice it into their own step list to compose the
 * integration's work as one of their run steps — self-driving sets up PostHog
 * this way before its own run. The host program supplies `show`/`onRunPrep`/
 * `targetDir`; this carries the run.
 */
export const integrationRunStep: ProgramStep = {
  id: 'run',
  label: 'Integration',
  screenId: 'run',
  // composed: runs inside the host program (self-driving), so skip the
  // integration's terminal outro + analytics shutdown of the shared client.
  run: (session) =>
    runProgramAgent(posthogIntegrationConfig, session, { composed: true }),
  isComplete: (session) =>
    session.runPhase === RunPhase.Completed ||
    session.runPhase === RunPhase.Error,
};
