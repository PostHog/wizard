import { VERSION } from '@lib/version';
import { logToFile, getLogFilePath } from '@utils/debug';
import { runAgent } from '@lib/agent/agent-runner';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { Harness, Sequence } from '@lib/constants';
import type { startTUI as StartTUIFn } from '@ui/tui/start-tui';
import type { WizardStore } from '@ui/tui/store';
import type { WizardSession } from '@lib/wizard-session';
import type { TaskStreamPush as TaskStreamPushClass } from '@lib/task-stream/task-stream-push';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { runCleanups } from '@utils/wizard-abort';
import { join } from 'node:path';

const WIZARD_VERSION = VERSION;

type Step = ProgramConfig['steps'][number];

/** The session a run step's agent runs in: scoped to the step's target dir
 * (e.g. a monorepo sub-app) with its own framework context, after any prep.
 * A step without `targetDir` runs in the live session, unchanged. */
async function prepareRunSession(
  step: Step,
  live: WizardSession,
): Promise<WizardSession> {
  const session = step.targetDir
    ? {
        ...live,
        installDir: step.targetDir(live),
        frameworkContext: { ...live.frameworkContext },
      }
    : live;
  if (step.onRunPrep) await step.onRunPrep(session);
  return session;
}

/** Advance one step of a composed run to completion: the auth screen
 * authenticates (every later run reuses it); a step carrying its own `run`
 * thunk runs that agent in its dir and is recorded in `completedRuns`; the
 * host program's own run screen runs `config.run`; any other screen waits for
 * the user to satisfy `isComplete`.
 *
 * `moreRunsFollow` marks the host run as composed when another run step is
 * still to come — see `hasLaterRun`. */
async function advanceStep(
  step: Step,
  store: WizardStore,
  config: ProgramConfig,
  moreRunsFollow = false,
): Promise<void> {
  if (step.screenId === 'auth') {
    await authenticate(store.session, config.id);
  } else if (step.run) {
    await step.run(await prepareRunSession(step, store.session));
    store.completeRunStep(step.id);
  } else if (step.screenId === 'run') {
    await runAgent(config, await prepareRunSession(step, store.session), {
      composed: moreRunsFollow,
    });
    // Record it the same way a `run` thunk is recorded, so its `isComplete`
    // survives the next run resetting the shared `runPhase`. Only when another
    // run follows: for a terminal run the outro has already been pushed, and
    // `completeRunStep` would clear the task list out from under it.
    if (moreRunsFollow) store.completeRunStep(step.id);
  } else if (step.isComplete) {
    await store.waitUntil(step.isComplete);
  }
}

/**
 * Whether any step after `index` will still run an agent.
 *
 * Exactly one run per invocation may be non-composed: that run owns the outro
 * and the analytics shutdown (`runner/sequence/linear.ts`), so anything after
 * it would render into a torn-down UI with a dead analytics client. The last
 * run wins, which means the host program's own run screen has to be composed
 * whenever a later run step is still coming.
 *
 * Evaluated live rather than precomputed, because `show` predicates depend on
 * answers the user gives during the walk — the default flow's warehouse run is
 * only shown once the offer screen has been answered.
 *
 * Stops at the outro for the same reason the walk does: a run step past it is
 * never reached, so counting it would compose the last run that actually
 * happens and leave nothing to push the outro.
 */
export function hasLaterRun(
  steps: readonly Step[],
  index: number,
  session: WizardSession,
): boolean {
  const rest = steps.slice(index + 1);
  const outroAt = rest.findIndex((s) => s.screenId === 'outro');
  const reachable = outroAt === -1 ? rest : rest.slice(0, outroAt);
  return reachable.some((s) => s.run != null && (!s.show || s.show(session)));
}

/**
 * Run a full wizard program in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
export function runWizard(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  let tui: ReturnType<typeof StartTUIFn> | null = null;
  let taskStream: TaskStreamPushClass | null = null;
  let onSignal: (() => void) | null = null;
  let exitInProgress = false;

  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();

      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession, RunPhase } = await import('@lib/wizard-session');
      const { TaskStreamPush } = await import('@lib/task-stream/index');
      const { PostHogDestination } = await import(
        '@lib/task-stream/destinations/posthog'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tui = startTUI(WIZARD_VERSION, config.id as any);
      const activeTui = tui;

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        installDir,
        ci: false,
        signup: options.signup as boolean | undefined,
        apiKey: options.apiKey as string | undefined,
        projectId: options.projectId as string | undefined,
        email: options.email as string | undefined,
        baseUrl: options.baseUrl as string | undefined,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
        noTelemetry: resolveNoTelemetry(options),
        harness: options.harness as Harness | undefined,
        sequence: options.sequence as Sequence | undefined,
        model: options.model as string | undefined,
        integrate: options.integrate as boolean | undefined,
      });
      session.programLabel = config.id;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      } else if (config.skillId) {
        session.skillId = config.skillId;
      }

      activeTui.store.session = session;

      const taskStreamEnabled = !session.noTelemetry;
      taskStream = new TaskStreamPush({
        store: activeTui.store,
        programId: config.id,
        destinations: [
          new PostHogDestination({
            getCredentials: () => activeTui.store.session.credentials,
            onError: (err) => logToFile('[task-stream-push]', err.message),
          }),
        ],
        eventPlanPath: config.eventPlanFile
          ? join(session.installDir, config.eventPlanFile)
          : undefined,
        enabled: taskStreamEnabled,
      });
      const activeStream = taskStream;
      activeStream.attach();

      // Flush a terminal-phase push on Ctrl-C so the web app sees the
      // run ended in error rather than hanging on the last "running"
      // snapshot.
      let signalled = false;
      onSignal = (): void => {
        if (signalled || exitInProgress) return;
        signalled = true;
        logToFile('[run-wizard] signal received, flushing task stream');
        // Run cleanups synchronously first — settings restore is sync fs work
        // and must complete even if the stream shutdown below times out.
        runCleanups();
        if (activeTui.store.session.runPhase === RunPhase.Running) {
          activeTui.store.setRunPhase(RunPhase.Error);
        }
        void activeStream
          .shutdown(2000)
          .catch((e) =>
            logToFile('[run-wizard] task stream shutdown error on signal:', e),
          )
          .finally(() => {
            try {
              activeTui.unmount();
            } catch {
              // terminal may already be torn down
            }
            process.exit(130);
          });
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      await activeTui.store.runReadyHooks();
      // Settle the pre-run screens. `integration-check` is a no-op gate for
      // programs without it.
      await activeTui.store.getGate('intro');
      await activeTui.store.getGate('integration-check');
      await activeTui.store.getGate('health-check');

      const skipAgent = config.run == null;
      const shown = (s: ProgramConfig['steps'][number]) =>
        !s.show || s.show(activeTui.store.session);

      if (config.steps.some((s) => s.run)) {
        // A composed program: its step list splices in run steps that carry
        // their own agent (self-driving runs the integration before its own
        // run; the default flow runs the warehouse setup after its own).
        // Walk the list once, advancing each step to completion.
        for (const [i, step] of config.steps.entries()) {
          if (step.screenId === 'outro') break; // run-completion wait owns it
          if (!shown(step)) continue;
          await advanceStep(
            step,
            activeTui.store,
            config,
            hasLaterRun(config.steps, i, activeTui.store.session),
          );
        }
      } else if (skipAgent) {
        const { getOrAskForProjectData } = await import('@utils/setup-utils');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData({
            signup: session.signup,
            ci: session.ci,
            apiKey: session.apiKey,
            projectId: session.projectId,
            baseUrl: session.baseUrl,
            programId: config.id,
          });
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        await runAgent(config, activeTui.store.session);
      }

      const isDone = (): boolean =>
        skipAgent
          ? activeTui.store.session.outroDismissed
          : activeTui.store.session.skillsComplete;

      await new Promise<void>((resolve) => {
        const unsub = activeTui.store.subscribe(() => {
          if (isDone()) {
            unsub();
            resolve();
          }
        });
        if (isDone()) {
          unsub();
          resolve();
        }
      });

      exitInProgress = true;
      await activeStream.shutdown(2000);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      activeTui.unmount();
      process.exit(0);
    } catch (err) {
      // File-log first — the cleanup below can throw or exit.
      logToFile('[run-wizard] FATAL:', err);
      // Run cleanups before anything async so settings are restored even if
      // the stream shutdown hangs.
      runCleanups();
      // The task-stream debounce timer keeps the event loop alive, so
      // we have to drain it before exiting on the error path.
      exitInProgress = true;
      if (onSignal) {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
      if (taskStream) {
        try {
          await taskStream.shutdown(2000);
        } catch {
          // ignore
        }
      }
      if (tui) {
        try {
          tui.unmount();
        } catch {
          // ignore
        }
      }
      // Print after unmount — anything printed into the alt screen is wiped.
      // eslint-disable-next-line no-console
      console.error('Wizard run failed:', err);
      // eslint-disable-next-line no-console
      console.error(`Full logs: ${getLogFilePath()}`);
      process.exit(1);
    }
  })();
}
