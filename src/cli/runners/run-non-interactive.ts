import {
  POSTHOG_DOCS_URL,
  checkLocalServices,
  getLocalDev,
  POSTHOG_LOCAL_URL,
  getUI,
  setUI,
  analytics,
  ErrorCodes,
  classifyRunFailure,
  detectErrorCode,
  emitWizardError,
} from '@store';
import type {
  Harness,
  Sequence,
  CloudRegion,
  ProgramConfig,
  FlowStore,
  RunStore,
  TaskStreamPush,
  OutroData,
  RunPhase as RunPhaseT,
} from '@store/types';
import { LoggingUI } from '@tui/console';
import { runConfigFor, getAuditChecks, flowFor } from '@store/programs';
import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import { resolveNoTelemetry } from './resolve-no-telemetry.js';
import { createControlHooks } from '../control-hooks.js';
import { join } from 'node:path';

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

/** The credentials every non-interactive mode accepts, for error messages. */
export const API_KEY_HINT =
  'personal API key phx_xxx or wizard-app OAuth access token pha_xxx';

/**
 * The single non-interactive validation layer: requires api-key and
 * install-dir. Every non-interactive entry point routes through
 * `runNonInteractive`, so this is the one place these checks live. UI must be
 * initialized before calling.
 */
export function validateNonInteractiveOptions(
  options: Record<string, unknown>,
  mode: NonInteractiveMode,
): void {
  const label = modeLabel(mode);
  if (!options.apiKey) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(`${label} mode requires --api-key (${API_KEY_HINT})`);
    emitWizardError({
      code: ErrorCodes.ArgsMissingApiKey,
      message: `${label} mode requires --api-key (${API_KEY_HINT})`,
    });
    process.exit(1);
  }
  if (!options.installDir) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(
      `${label} mode requires --install-dir (directory to install in)`,
    );
    emitWizardError({
      code: ErrorCodes.ArgsMissingInstallDir,
      message: `${label} mode requires --install-dir`,
    });
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
    const { buildSession, RunPhase, OutroKind } = await import('@store');
    const { readEnvironment } = await import('@store');
    const { readApiKeyFromEnv } = await import('@store');
    const { configureLogFileFromEnvironment, logToFile } = await import(
      '@store'
    );
    const { wizardAbort, WizardError } = await import('@store');

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
      localDev: options.localDev as boolean | undefined,
      localMcp: options.localMcp as boolean | undefined,
      localPosthog: options.localPosthog as boolean | undefined,
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
      captureAio: options.captureAio as boolean | undefined,
      ...env,
      // After the spread: yargs already resolves flag-over-env for --region,
      // so the parsed value must win over the raw env bag.
      region: (options.region ?? env.region) as CloudRegion | undefined,
    });
    session.programLabel = config.id;
    if (config.skillId) {
      session.skillId = config.skillId;
    }
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the PostHog setup wizard');
    getUI().log.info(`Running ${config.id} in ${modeLabel(mode)} mode`);

    // Before auth: a dead local PostHog otherwise surfaces as "Failed to fetch
    // user data". Aborts even non-interactively — a CI run pointed at a local
    // server that isn't there is testing nothing.
    const localServicesError = await checkLocalServices({
      ...getLocalDev(),
      localMcp: session.localMcp,
      localPosthog: session.baseUrl === POSTHOG_LOCAL_URL,
    });
    if (localServicesError) {
      await wizardAbort({
        code: ErrorCodes.EnvLocalServicesDown,
        message: localServicesError,
      });
      return;
    }

    // Headless streams run state to the PostHog backend so the web app can show
    // live progress. Reuses the interactive TaskStreamPush + FlowStore (no Ink
    // render): HeadlessUI keeps LoggingUI's output and feeds task updates into
    // the store; this runner drives the phase transitions. Headless pushes to
    // PostHog (the web app is that run's only UI); `--ci` is synthetic, so it
    // dumps locally and pushes nothing. Telemetry consent gates the push only.
    let store: FlowStore | null = null;
    let taskStream: TaskStreamPush | null = null;
    let runStream:
      | ((config: ProgramConfig, run: RunStore) => TaskStreamPush)
      | null = null;
    // Starts this process's one run on the flow and streams it; assigned once the store exists.
    let beginRun: () => RunStore = () => {
      throw new Error('the run store is not configured yet');
    };
    {
      const { FlowStore } = await import('@store');
      const { HeadlessUI } = await import('@tui/console');
      const { TaskStreamPush, PostHogDestination, createFileDestination } =
        await import('@store');

      // `''` resolves to the default path, so `--ci` always dumps.
      const logTarget =
        mode === 'ci' ? options.taskStreamLog ?? '' : options.taskStreamLog;
      const fileDestination = createFileDestination(logTarget);
      const posthogDestination =
        mode === 'headless' && !session.noTelemetry
          ? new PostHogDestination({
              // The store forks the session on its first commit; read the live one.
              getCredentials: () =>
                store?.session.credentials ?? session.credentials,
              onError: (e) => logToFile('[headless task-stream]', e.message),
            })
          : null;
      const destinations = [
        ...(posthogDestination ? [posthogDestination] : []),
        ...(fileDestination ? [fileDestination] : []),
      ];

      const headlessStore = new FlowStore(flowFor(config.id).flow);
      store = headlessStore;
      // A controlled run answers the agent's questions over the socket, so the
      // ask bridge stays wired despite `ci`.
      if (options.controlSocket) session.e2eAsk = true;
      headlessStore.session = session;
      if (options.controlSocket) {
        const { StoreUI } = await import('@store');
        setUI(new StoreUI(headlessStore));
      } else {
        setUI(new HeadlessUI(headlessStore));
      }
      const streamFor = (
        runConfig: ProgramConfig,
        run: RunStore,
      ): TaskStreamPush =>
        new TaskStreamPush({
          store: run,
          programId: runConfig.streamWorkflowId ?? runConfig.id,
          skillId: run.session.skillId ?? undefined,
          destinations,
          eventPlanPath: runConfig.eventPlanFile
            ? join(run.session.installDir, runConfig.eventPlanFile)
            : undefined,
          auditChecks: runConfig.auditLedgerFile
            ? () => getAuditChecks(headlessStore.session)
            : undefined,
          enabled: destinations.length > 0,
        });
      if (options.controlSocket) {
        // Every POST /runs is one independent run with its own store and stream.
        runStream = streamFor;
      } else {
        beginRun = () => {
          const run = headlessStore.startRun(session);
          taskStream = streamFor(config, run);
          taskStream.attach();
          return run;
        };
      }
      if (fileDestination) {
        logToFile(`[task-stream] ${mode} dump: ${fileDestination.path}`);
      }
    }

    // wizardAbort exits via process.exit, so flush the terminal phase before any
    // exit. No-op for CI.
    const settleStream = async (
      phase: RunPhaseT,
      outroData?: OutroData,
    ): Promise<void> => {
      if (!store || options.controlSocket) return;
      // An abort before the run starts still reports through a run of its own.
      if (!taskStream) beginRun();
      if (!taskStream) return;
      if (outroData) store.setOutroData(outroData);
      store.setRunPhase(phase);
      await taskStream.shutdown(2000);
    };

    try {
      // An issued gateway bearer replaces the mint for `--ci` and, in dev builds, for a harness-driven headless run.
      if (
        mode === 'ci' ||
        (!IS_PRODUCTION_BUILD && runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE'))
      ) {
        const { configureGatewayFromCIEnvironment } = await import('@agent');
        configureGatewayFromCIEnvironment(
          Number(session.projectId),
          session.region ?? 'us',
        );
      }

      // Controlled headless: nothing runs until the parent asks. Detection,
      // independent runs, and the exit all arrive over the socket.
      if (options.controlSocket && store) {
        const controlledStore = store;
        const { attachControlServer } = await import('@store/control');
        const { runAgent } = await import('@agent');
        const { VERSION } = await import('@store');
        let release: () => void = () => undefined;
        const served = new Promise<void>((resolve) => {
          release = resolve;
        });
        const handle = await attachControlServer(controlledStore, {
          socketPath: options.controlSocket as string,
          surface: 'headless',
          version: VERSION,
          program: config.id,
          hooks: createControlHooks({
            store: controlledStore,
            programId: config.id,
            runAgent,
            runStream: runStream ?? undefined,
            shutdown: () => {
              release();
              return Promise.resolve();
            },
          }),
        });
        process.once('SIGINT', release);
        process.once('SIGTERM', release);
        logToFile(`[control] serving ${config.id} on ${handle.socketPath}`);
        await served;
        process.off('SIGINT', release);
        process.off('SIGTERM', release);
        await handle.close();
        // Each run shut its own stream; nothing else holds the loop, so the process ends with status 0.
        return;
      }

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
          setUnsupportedVersion: (info: {
            current: string;
            minimum: string;
            docsUrl: string;
          }) => {
            session.unsupportedVersion = info;
          },
          addDiscoveredFeature: () => undefined,
          setDetectionComplete: () => undefined,
          setPosthogSdkDetected: (detected: boolean) => {
            session.posthogSdkDetected = detected;
          },
        };
        for (const step of config.steps) {
          if (step.onReady) {
            await step.onReady(readyCtx);
          }
        }

        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (session.unsupportedVersion) {
          const { current, minimum, docsUrl } = session.unsupportedVersion;
          const message = `Detected framework version ${current} is not supported. Minimum supported version is ${minimum}.`;
          await settleStream(RunPhase.Error, {
            kind: OutroKind.Error,
            message,
            errorCode: ErrorCodes.DetectUnsupportedVersion,
          });
          await wizardAbort({
            code: ErrorCodes.DetectUnsupportedVersion,
            message: `${message}\n\nSee ${docsUrl}`,
            error: new WizardError(
              `${config.id} unsupported framework version`,
              {
                integration: config.id,
                current,
                minimum,
              },
              ErrorCodes.DetectUnsupportedVersion,
            ),
          });
        }
        if (detectError) {
          const code = detectErrorCode(detectError.kind);
          const detectKind = detectError.kind;
          // `kind` stays in the detail: several kinds share one code, so it is
          // the only thing telling a host which precondition actually failed.
          const detail = { ...detectError };
          await settleStream(RunPhase.Error, {
            kind: OutroKind.Error,
            message: `Prerequisites not met: ${detectKind}`,
            errorCode: code,
            errorDetail: detail,
          });
          await wizardAbort({
            code,
            detail,
            message: `Prerequisites not met: ${detectKind}\n\nSee ${
              runDef?.docsUrl ?? POSTHOG_DOCS_URL
            }`,
            error: new WizardError(
              `${config.id} prerequisites failed`,
              {
                integration: config.id,
                detect_error_kind: detectKind,
              },
              code,
            ),
          });
        }
      }

      const { runAgent } = await import('@agent');
      const run = beginRun();
      run.setRunPhase(RunPhase.Running);
      await runAgent(runConfigFor(config), run.session);
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
      // A coded failure is a decision with its own message; anything else is
      // unexpected and gets the generic framing.
      const failure = classifyRunFailure(error);
      await settleStream(RunPhase.Error, {
        kind: OutroKind.Error,
        message: errorMessage,
        errorCode: failure.code,
      });
      await wizardAbort({
        code: failure.code,
        message: failure.coded
          ? `${errorMessage}${debugInfo}`
          : `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
        error: error as Error,
      });
    }
  })().catch((error: unknown) => {
    emitWizardError({
      code: ErrorCodes.InternalUnhandled,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
