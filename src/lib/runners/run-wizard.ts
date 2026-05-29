import { VERSION } from '@lib/version';
import { runtimeEnv } from '@env';
import type { ProgramConfig } from '@lib/programs/program-step';

const WIZARD_VERSION = VERSION;

/**
 * Run a full wizard program in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
export function runWizard(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();

      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession } = await import('@lib/wizard-session');
      const { TaskStreamPush } = await import('@lib/task-stream/index');
      const { FileDestination } = await import(
        '@lib/task-stream/destinations/file'
      );
      const { PostHogDestination } = await import(
        '@lib/task-stream/destinations/posthog'
      );
      const { analytics } = await import('@utils/analytics');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tui = startTUI(WIZARD_VERSION, config.id as any);

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        forceInstall: options.forceInstall as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        installDir,
        ci: false,
        signup: options.signup as boolean | undefined,
        apiKey: options.apiKey as string | undefined,
        projectId: options.projectId as string | undefined,
        email: options.email as string | undefined,
        menu: options.menu as boolean | undefined,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
      });
      session.programLabel = config.id;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      } else if (config.skillId) {
        session.skillId = config.skillId;
      }

      tui.store.session = session;

      const taskStream = new TaskStreamPush({
        store: tui.store,
        programId: config.id,
        destinations: [new FileDestination(), new PostHogDestination()],
      });
      tui.store.onTasksChanged = () => void taskStream.push();

      await tui.store.runReadyHooks();
      await tui.store.getGate('intro');
      await tui.store.getGate('health-check');

      const skipAgent = config.run == null;

      if (skipAgent) {
        const { getOrAskForProjectData } = await import('@utils/setup-utils');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData({
            signup: session.signup,
            ci: session.ci,
            apiKey: session.apiKey,
            projectId: session.projectId,
          });
        tui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        const { runAgent } = await import('@lib/agent/agent-runner');
        await runAgent(config, tui.store.session);
      }

      const isDone = (): boolean =>
        skipAgent
          ? tui.store.session.outroDismissed
          : tui.store.session.skillsComplete;

      await new Promise<void>((resolve) => {
        const unsub = tui.store.subscribe(() => {
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

      try {
        await taskStream.dispose();
      } catch (error) {
        analytics.captureException(error as Error);
      }
      tui.unmount();
      process.exit(0);
    } catch (err) {
      if (runtimeEnv('DEBUG') || runtimeEnv('POSTHOG_WIZARD_DEBUG')) {
        // eslint-disable-next-line no-console
        console.error('TUI init failed:', err);
      }
    }
  })();
}
