/** The TUI command runner: parse the launch values, start the TUI host, and exit with its code. */
import type { ProgramConfig, SessionArgs } from '@programs/types';
import type { Harness, Sequence } from '@shared/constants';
import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import { controlMode } from '@cli/control-flags';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { withSignals } from './signals';

/** The TUI session a command's parsed options launch: a program's run or a tool's screens. */
export function tuiSessionArgs(
  options: Record<string, unknown>,
): SessionArgs & { integrate?: boolean } {
  return {
    debug: options.debug as boolean | undefined,
    localDev: options.localDev as boolean | undefined,
    localMcp: options.localMcp as boolean | undefined,
    localPosthog: options.localPosthog as boolean | undefined,
    installDir: (options.installDir as string) || process.cwd(),
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
    captureAio: options.captureAio as boolean | undefined,
  };
}

/** Run a full wizard program in the TUI. */
export function runWizard(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  withSignals(async (signal) => {
    // Loaded here, not at startup: a headless run never loads the TUI.
    const { runTui } = await import('@tui');
    const controlSocket =
      !IS_PRODUCTION_BUILD && typeof options.controlSocket === 'string'
        ? options.controlSocket
        : undefined;
    return runTui(config, {
      session: tuiSessionArgs(options),
      skillId: options.skillId as string | undefined,
      taskStreamLog: options.taskStreamLog as string | undefined,
      runId:
        (options.runId as string | undefined) ??
        runtimeEnv('POSTHOG_WIZARD_RUN_ID'),
      // A controlled TUI serves its store over the socket; the flow still runs here.
      control: controlSocket
        ? { socketPath: controlSocket, mode: controlMode(options) }
        : undefined,
      signal,
    });
  });
}
