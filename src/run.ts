import { type WizardSession, buildSession } from './lib/wizard-session';

import type { CloudRegion } from './utils/types';

import {
  Integration,
  DETECTION_TIMEOUT_MS,
  WIZARD_INTERACTION_EVENT_NAME,
} from './lib/constants';
import { readEnvironment } from './utils/environment';
import { getUI } from './ui';
import path from 'path';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runAgentWizard } from './lib/agent-runner';
import { EventEmitter } from 'events';
import { logToFile } from './utils/debug';
import { wizardAbort } from './utils/wizard-abort';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  region?: CloudRegion;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  projectId?: string;
  menu?: boolean;
  benchmark?: boolean;
  yaraReport?: boolean;
};

export async function runWizard(argv: Args, session?: WizardSession) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  // Build session if not provided (CI mode passes one pre-built)
  if (!session) {
    session = buildSession({
      debug: finalArgs.debug,
      forceInstall: finalArgs.forceInstall,
      installDir: resolvedInstallDir,
      ci: finalArgs.ci,
      signup: finalArgs.signup,
      localMcp: finalArgs.localMcp,
      apiKey: finalArgs.apiKey,
      menu: finalArgs.menu,
      integration: finalArgs.integration,
      benchmark: finalArgs.benchmark,
      yaraReport: finalArgs.yaraReport,
      projectId: finalArgs.projectId,
    });
  }

  session.installDir = resolvedInstallDir;

  getUI().intro(`Welcome to the PostHog setup wizard`);

  if (session.ci) {
    getUI().log.info('Running in CI mode');
  }

  const integration =
    session.integration ?? (await detectAndResolveIntegration(session));

  session.integration = integration;
  analytics.setTag('integration', integration);

  const config = FRAMEWORK_REGISTRY[integration];
  session.frameworkConfig = config;

  // Run gatherContext if the framework has it and it hasn't already run
  // (bin.ts runs it early so IntroScreen can show the friendly label)
  const contextAlreadyGathered =
    Object.keys(session.frameworkContext).length > 0;
  if (config.metadata.gatherContext && !contextAlreadyGathered) {
    try {
      const context = await config.metadata.gatherContext({
        installDir: session.installDir,
        debug: session.debug,
        forceInstall: session.forceInstall,
        default: false,
        signup: session.signup,
        localMcp: session.localMcp,
        ci: session.ci,
        menu: session.menu,
        benchmark: session.benchmark,
        yaraReport: session.yaraReport,
      });
      for (const [key, value] of Object.entries(context)) {
        if (!(key in session.frameworkContext)) {
          session.frameworkContext[key] = value;
        }
      }
    } catch {
      // Detection failed — SetupScreen or agent will handle it
    }
  }

  try {
    await runAgentWizard(config, session);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;

    logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
    if (errorStack) {
      logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
    }

    const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';

    await wizardAbort({
      message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${config.metadata.docsUrl} to set up PostHog manually.${debugInfo}`,
      error: error as Error,
    });
  }
}

export async function detectIntegration(
  installDir: string,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    try {
      const detected = await Promise.race([
        config.detection.detect({ installDir }),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), DETECTION_TIMEOUT_MS),
        ),
      ]);
      if (detected) {
        return integration;
      }
    } catch {
      // Skip frameworks whose detection throws
    }
  }
}

async function detectAndResolveIntegration(
  session: WizardSession,
): Promise<Integration> {
  if (!session.menu) {
    const detectedIntegration = await detectIntegration(session.installDir);

    if (detectedIntegration) {
      getUI().setDetectedFramework(
        FRAMEWORK_REGISTRY[detectedIntegration].metadata.name,
      );
      analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
        action: 'wizard_framework_detected',
        integration: detectedIntegration,
        framework_name: FRAMEWORK_REGISTRY[detectedIntegration].metadata.name,
      });
      return detectedIntegration;
    }

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'wizard_framework_detection_failed',
    });
    getUI().log.info(
      "I couldn't detect your framework. Please choose one to get started.",
    );
  }

  // Fallback: in TUI mode the IntroScreen would handle this,
  // but for CI mode or when detection fails, abort with guidance.
  return wizardAbort({
    message:
      'Could not auto-detect your framework. Please specify --integration on the command line.',
  });
}
