import { POSTHOG_DOCS_URL, type Harness, type Sequence } from '@lib/constants';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import type { ProgramConfig } from '@lib/programs/program-step';
import { analytics } from '@utils/analytics';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import type { WizardStore } from '@ui/tui/store';
import type { TaskStreamPush } from '@lib/task-stream/task-stream-push';
import { join } from 'node:path';
import type { OutroData, RunPhase as RunPhaseT } from '@lib/wizard-session';

/**
 * The two non-interactive run modes. Both drive the same pipeline today; the
 * mode is threaded explicitly (rather than sniffed from a flag) so the dispatch
 * picks an entry point — runWizardCI vs runWizardHeadless — and this core stays
 * mode-agnostic except at the few documented forks. The string values double as
 * the analytics `build` tag, so they segment runs in analytics and on
 * LLM-gateway traces (which read analytics.build).
 */
export type NonInteractiveMode = 'ci' | 'headless';

/** User-facing label for a non-interactive mode. */
function modeLabel(mode: NonInteractiveMode): string {
  return mode === 'headless' ? 'Headless' : 'CI';
}

/**
 * The single non-interactive validation layer: defaults region and requires
 * api-key and install-dir. Every non-interactive entry point routes through
 * `runNonInteractive`, so this is the one place these checks live. UI must be
 * initialized before calling.
 */
export function validateNonInteractiveOptions(
  options: Record<string, unknown>,
  mode: NonInteractiveMode,
): void {
  const label = modeLabel(mode);
  const keyHint =
    mode === 'headless'
      ? 'personal API key phx_xxx or pha_ OAuth access token'
      : 'personal API key phx_xxx';
  if (!options.region) options.region = 'us';
  if (!options.apiKey) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(`${label} mode requires --api-key (${keyHint})`);
    process.exit(1);
  }
  if (!options.installDir) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(
      `${label} mode requires --install-dir (directory to install in)`,
    );
    process.exit(1);
  }
}

/**
 * Non-interactive pipeline shared by CI (`runWizardCI`) and headless
 * (`runWizardHeadless`) runs.
 *
 * Validates flags, builds a `ci:true` session, runs `config.ciPreRun` (or the
 * program's `onReady` hooks by default), executes `runAgent`, and routes any
 * failure through `wizardAbort`. `wizardAbort` owns all exits — never add a
 * raw `process.exit` here.
 *
 * `mode` is the only difference between the two callers today (it sets the
 * analytics build tag and the user-facing label). Keeping it a parameter is
 * what lets CI and headless share this body now and diverge later — branch on
 * `mode` here, or stop sharing this function entirely.
 */
export function runNonInteractive(
  config: ProgramConfig,
  options: Record<string, unknown>,
  mode: NonInteractiveMode,
): void {
  setUI(new LoggingUI());
  validateNonInteractiveOptions(options, mode);
  // Upgrade the build tag so runs segment cleanly in analytics (and on
  // LLM-gateway traces, which read analytics.build). A published headless run
  // (cloud / CI/CD) tags 'headless'; a dev/test `--ci` run upgrades 'dev' to
  // 'ci'. The mode string is the tag value.
  analytics.setTag('build', mode);

  void (async () => {
    const path = await import('path');
    const { buildSession, RunPhase, OutroKind } = await import(
      '@lib/wizard-session'
    );
    const { readEnvironment } = await import('@utils/environment');
    const { readApiKeyFromEnv } = await import('@utils/env-api-key');
    const { configureLogFileFromEnvironment, logToFile } = await import(
      '@utils/debug'
    );
    const { wizardAbort, WizardError } = await import('@utils/wizard-abort');

    configureLogFileFromEnvironment();

    const env = readEnvironment();
    const apiKey =
      (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined;
    const installDir = path.isAbsolute(options.installDir as string)
      ? (options.installDir as string)
      : path.join(process.cwd(), options.installDir as string);

    const session = buildSession({
      debug: options.debug as boolean | undefined,
      installDir,
      ci: true,
      signup: options.signup as boolean | undefined,
      localMcp: options.localMcp as boolean | undefined,
      apiKey,
      email: options.email as string | undefined,
      projectId: options.projectId as string | undefined,
      baseUrl: options.baseUrl as string | undefined,
      benchmark: options.benchmark as boolean | undefined,
      yaraReport: options.yaraReport as boolean | undefined,
      noTelemetry: resolveNoTelemetry(options),
      harness: options.harness as Harness | undefined,
      sequence: options.sequence as Sequence | undefined,
      model: options.model as string | undefined,
      ...env,
    });
    session.programLabel = config.id;
    if (config.skillId) {
      session.skillId = config.skillId;
    }
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the PostHog setup wizard');
    getUI().log.info(`Running ${config.id} in ${modeLabel(mode)} mode`);

    // Headless streams run state to the PostHog backend so the web app can show
    // live progress. Reuses the interactive TaskStreamPush + WizardStore (no Ink
    // render): HeadlessUI keeps LoggingUI's output and feeds task updates into
    // the store; this runner drives the phase transitions. CI does not stream.
    let store: WizardStore | null = null;
    let taskStream: TaskStreamPush | null = null;
    if (mode === 'headless') {
      const { WizardStore } = await import('@ui/tui/store');
      const { HeadlessUI } = await import('@ui/headless-ui');
      const { TaskStreamPush, PostHogDestination } = await import(
        '@lib/task-stream/index'
      );

      store = new WizardStore(config.id);
      store.session = session;
      setUI(new HeadlessUI(store));
      taskStream = new TaskStreamPush({
        store,
        programId: config.id,
        destinations: [
          new PostHogDestination({
            getCredentials: () => session.credentials,
            onError: (e) => logToFile('[headless task-stream]', e.message),
          }),
        ],
        eventPlanPath: config.eventPlanFile
          ? join(session.installDir, config.eventPlanFile)
          : undefined,
        enabled: !session.noTelemetry,
      });
      taskStream.attach();
      store.setRunPhase(RunPhase.Running);
    }

    // wizardAbort exits via process.exit, so flush the terminal phase before any
    // exit. No-op for CI.
    const settleStream = async (
      phase: RunPhaseT,
      outroData?: OutroData,
    ): Promise<void> => {
      if (!store || !taskStream) return;
      if (outroData) store.setOutroData(outroData);
      store.setRunPhase(phase);
      await taskStream.shutdown(2000);
    };

    try {
      if (config.ciPreRun) {
        await config.ciPreRun(session);
      } else {
        const readyCtx = {
          session,
          setFrameworkContext: (key: string, value: unknown) => {
            session.frameworkContext[key] = value;
          },
          setFrameworkConfig: () => undefined,
          setDetectedFramework: () => undefined,
          // Non-interactive session is a plain object (no nanostore
          // copy-on-write), so direct assignment is safe here.
          setSkillId: (skillId: string | null) => {
            session.skillId = skillId;
          },
          setUnsupportedVersion: () => undefined,
          addDiscoveredFeature: () => undefined,
          setDetectionComplete: () => undefined,
        };
        for (const step of config.steps) {
          if (step.onReady) {
            await step.onReady(readyCtx);
          }
        }

        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (detectError) {
          await settleStream(RunPhase.Error, {
            kind: OutroKind.Error,
            message: `Prerequisites not met: ${detectError.kind}`,
          });
          await wizardAbort({
            message: `Prerequisites not met: ${detectError.kind}\n\nSee ${
              runDef?.docsUrl ?? POSTHOG_DOCS_URL
            }`,
            error: new WizardError(`${config.id} prerequisites failed`, {
              integration: config.id,
              detect_error_kind: detectError.kind,
            }),
          });
        }
      }

      const { runAgent } = await import('@lib/agent/agent-runner');
      await runAgent(config, session);
      await settleStream(RunPhase.Completed);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error && error.stack ? error.stack : undefined;

      logToFile(`[${mode}] ERROR: ${errorMessage}`);
      if (errorStack) logToFile(`[${mode}] STACK: ${errorStack}`);

      const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';
      const docsUrl =
        session.frameworkConfig?.metadata.docsUrl ??
        runDef?.docsUrl ??
        POSTHOG_DOCS_URL;
      await settleStream(RunPhase.Error, {
        kind: OutroKind.Error,
        message: errorMessage,
      });
      await wizardAbort({
        message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
        error: error as Error,
      });
    }
  })().catch(() => {
    process.exit(1);
  });
}
