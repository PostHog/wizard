import type { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { detectFramework } from '@services/detection';
import { detectPostHogIntegration } from '@services/detection';
import { gatherFrameworkContext } from '@services/detection';
import { noteDetectedFramework } from '@services/detection';
import { scopeInstallDirToProject } from '@services/detection';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import type {
  CiRunnerContext,
  ProgramReadyContext,
  ProgramSession,
} from '@programs/program-contract';
import {
  abortNoFrameworkDetected,
  type NoFrameworkGuidance,
} from './abort-no-framework';

/** The platforms a program runs on, and how it stops on the others. */
export interface PlatformGate {
  supported: ReadonlySet<Integration>;
  /** Throws the program's own `ProgramAbort` for a detected but unsupported platform. */
  abortUnsupported: (integration: Integration) => never;
  /** Overrides the no-framework abort's message and docs link. */
  noFramework?: NoFrameworkGuidance;
}

async function detectSupportedFramework(
  installDir: string,
  gate: PlatformGate,
): Promise<Integration> {
  const integration = await detectFramework(installDir);
  if (!integration) {
    abortNoFrameworkDetected(gate.noFramework);
  }
  if (!gate.supported.has(integration)) {
    gate.abortUnsupported(integration);
  }
  return integration;
}

/**
 * `onReady` for a platform-gated orchestrator program: stop on an
 * unsupported platform, then run the full detect.
 *
 * The gate runs on its own `detectFramework` call before the full detect
 * writes to the store: store setters replace the session with a shallow copy,
 * so `ctx.session` read after `detectPostHogIntegration` would be stale.
 */
export function platformGatedOnReady(
  gate: PlatformGate,
): (ctx: ProgramReadyContext) => Promise<void> {
  return async (ctx) => {
    await detectSupportedFramework(ctx.session.installDir, gate);
    await detectPostHogIntegration(ctx);
  };
}

/**
 * `ciPreRun`, the headless `onReady`: scope the install dir to the project
 * (monorepos), gate the platform, then record the framework on the session.
 * `session.skillId` gets the framework id because the orchestrator resolves
 * the reference skill and every task's skill variants against it.
 */
export function platformGatedCiPreRun(
  gate: PlatformGate,
): (session: ProgramSession, runner: CiRunnerContext) => Promise<void> {
  return async (session, runner) => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectSupportedFramework(
      session.installDir,
      gate,
    );
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;
    session.skillId = integration;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      signup: session.signup,
      ci: true,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
    noteDetectedFramework(session, frameworkConfig, context, runner.log);
  };
}
