import { Integration } from '@shared/constants';
import {
  detectFramework,
  gatherFrameworkContext,
} from '@programs/detection/index';
import {
  scopeInstallDirToProject,
  type ProjectScopeSession,
} from '@programs/detection/project-scope';
import type { FrameworkDetectionState } from '@programs/detection/context';
import type { ProgramCiHost } from '@programs/host-capabilities';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { createSkillProgram } from '@programs/agent-skill/index';
import { REPLAY_VISION_OPTIONS } from './run.js';
export { REPLAY_VISION_ABORT_CASES } from './run.js';
import { detectPostHogIntegration } from '@programs/posthog-integration/detect';
import type {
  ProgramConfig,
  ProgramReadyContext,
} from '@programs/program-step';
import { analytics } from '@utils/analytics';
import { ErrorCodes } from '@shared/errors';

/**
 * The platforms session replay can actually record on. Replay vision watches
 * recordings, so a platform with no recordings has nothing to set up — the
 * run must stop before any work, not after a pointless agent run.
 *
 * Web frameworks record through posthog-js (server-rendered frameworks
 * included — they serve pages), and the mobile SDKs with replay support are
 * React Native, Android, iOS, and Flutter. Excluded: pure backend targets
 * (`javascript_node`, `python`, `ruby`) and KMP, which has no replay support
 * yet.
 */
export const REPLAY_VISION_SUPPORTED: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
  Integration.nuxt,
  Integration.vue,
  Integration.reactRouter,
  Integration.tanstackStart,
  Integration.tanstackRouter,
  Integration.angular,
  Integration.astro,
  Integration.sveltekit,
  Integration.javascript_web,
  Integration.django,
  Integration.flask,
  Integration.fastapi,
  Integration.laravel,
  Integration.rails,
  Integration.reactNative,
  Integration.android,
  Integration.swift,
  Integration.flutter,
]);

type ReplayVisionCiSession = ProjectScopeSession &
  FrameworkDetectionState & {
    integration: Integration | null;
    skillId: string | null;
  };

async function abortUnsupportedPlatform(
  integration: Integration,
  abort: ProgramCiHost['abort'],
): Promise<void> {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  // This is a clean, intentional exit, not a crash. Count it with a normal
  // event keyed on the platform so aborts roll up into one series. Do not hand
  // the abort an `error` — that forwards to captureException and mints a
  // new error-tracking issue per install location and per platform.
  analytics.wizardCapture('replay-vision unsupported platform', {
    integration,
  });
  await abort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `Session replay isn't available for ${name} projects, and Replay ` +
      'vision needs session recordings to watch — so there is nothing to ' +
      'set up here.\n\n' +
      'If this repo also contains a web or mobile app, run the command from ' +
      'that project directory instead. See what replay supports at:\n' +
      '  https://posthog.com/docs/session-replay',
  });
}

/**
 * `[ABORT]` reasons the replay-vision skill emits when the run can't proceed.
 * Kept in sync with the stop conditions in the skill's `description.md`
 * (context-mill `context/skills/replay-vision`).
 */

/**
 * Framework detection ahead of the run, exactly like the default integration
 * program. The orchestrator requires it: `session.skillId` must hold the
 * detected framework id before the run arm starts, because the runner
 * resolves the reference integration skill and every task's mini-skill
 * variants (`integration-v2-install`, `integration-v2-init`, …) against it in
 * preflight. Without it the session would still carry the program's own
 * skill id and preflight would abort.
 *
 * The platform gate runs on a direct detectFramework call BEFORE the full
 * detect writes to the store: store setters replace the session with a
 * shallow copy, so `ctx.session` read after detectPostHogIntegration would
 * be the stale pre-copy object (see the warning in detect.ts).
 */
const detectBeforeFlow = async (ctx: ProgramReadyContext) => {
  const integration = await detectFramework(ctx.session.installDir);
  if (integration && !REPLAY_VISION_SUPPORTED.has(integration)) {
    await abortUnsupportedPlatform(integration, (failure) =>
      ctx.abort(failure),
    );
    return;
  }
  await detectPostHogIntegration(ctx);
};

const base = createSkillProgram(REPLAY_VISION_OPTIONS);

/**
 * `wizard replay-vision` — flat skill command on the orchestrator sequence.
 *
 * Makes session replay record (server toggle + client init check), then
 * creates vision scanners scoped to the product's key flows, read out of the
 * repo. The orchestrator runs the `replay-vision` agent flow (context-mill
 * `context/agents/replay-vision`): the seed enqueues the install/init tasks
 * (copied from integration-v2, sharing its step-skills) when the project has
 * no PostHog yet, so the command works on uninstrumented repos instead of
 * aborting.
 *
 * Departures from a plain `createSkillProgram`:
 * - `onReady` detection, so `session.skillId` carries the framework id the
 *   orchestrator's preflight resolves reference + mini-skill variants with.
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` mirrors the default integration program: scope the install dir
 *   to the right project (monorepos), then detect the framework — the
 *   headless equivalent of onReady.
 */
export const replayVisionConfig: ProgramConfig = {
  ...base,
  agentFlow: 'replay-vision',
  onReady: detectBeforeFlow,

  ciPreRun: async (
    session: ReplayVisionCiSession,
    host: ProgramCiHost,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, host);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await host.abort({
        code: ErrorCodes.DetectNoFramework,
        message: 'Could not auto-detect your framework for this project.',
      });
      return;
    }
    if (!REPLAY_VISION_SUPPORTED.has(integration)) {
      await abortUnsupportedPlatform(integration, (failure) =>
        host.abort(failure),
      );
      return;
    }
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
    const detectedLabel =
      frameworkConfig.metadata.getDetectedFrameworkLabel?.(context);
    if (detectedLabel) session.detectedFrameworkLabel = detectedLabel;
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
  },
};
