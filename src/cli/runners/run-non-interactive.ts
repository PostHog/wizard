/** The non-interactive command runner: check the arguments, start the headless host, and exit with its code. */
import path from 'path';
import type { ProgramConfig } from '@programs/types';
import type { HeadlessMode } from '@headless';
import type { Harness, Sequence } from '@shared/constants';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import type { CloudRegion } from '@utils/types';
import { readEnvironment } from '@utils/environment';
import { readApiKeyFromEnv } from '@utils/env-api-key';
import { runtimeEnv } from '@env';
import { consoleLog } from '@shared/console-log';
import { controlMode } from '@cli/control-flags';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { withSignals } from './signals';

/** User-facing label for a non-interactive mode. */
function modeLabel(mode: HeadlessMode): string {
  return mode === 'headless' ? 'Headless' : 'CI';
}

/** The credentials every non-interactive mode accepts, for error messages. */
export const API_KEY_HINT =
  'personal API key phx_xxx or wizard-app OAuth access token pha_xxx';

/**
 * The single non-interactive validation layer: requires api-key and
 * install-dir. Every non-interactive entry point routes through
 * `runNonInteractive`, so this is the one place these checks live.
 */
export function validateNonInteractiveOptions(
  options: Record<string, unknown>,
  mode: HeadlessMode,
): void {
  const label = modeLabel(mode);
  if (!options.apiKey) {
    consoleLog.intro('PostHog Wizard');
    consoleLog.log.error(`${label} mode requires --api-key (${API_KEY_HINT})`);
    emitWizardError({
      code: ErrorCodes.ArgsMissingApiKey,
      message: `${label} mode requires --api-key (${API_KEY_HINT})`,
    });
    process.exit(1);
  }
  if (!options.installDir) {
    consoleLog.intro('PostHog Wizard');
    consoleLog.log.error(
      `${label} mode requires --install-dir (directory to install in)`,
    );
    emitWizardError({
      code: ErrorCodes.ArgsMissingInstallDir,
      message: `${label} mode requires --install-dir`,
    });
    process.exit(1);
  }
}

/** Run `config` in the headless host, for CI (`runWizardCI`) and headless (`runWizardHeadless`) runs. */
export function runNonInteractive(
  config: ProgramConfig,
  options: Record<string, unknown>,
  mode: HeadlessMode,
): void {
  validateNonInteractiveOptions(options, mode);

  const env = readEnvironment();
  const installDir = path.isAbsolute(options.installDir as string)
    ? (options.installDir as string)
    : path.join(process.cwd(), options.installDir as string);
  withSignals(async (signal) => {
    const { runHeadless } = await import('@headless');
    return runHeadless(config, {
      mode,
      session: {
        debug: options.debug as boolean | undefined,
        installDir,
        ci: true,
        signup: options.signup as boolean | undefined,
        localDev: options.localDev as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        localPosthog: options.localPosthog as boolean | undefined,
        apiKey: (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined,
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
      },
      taskStreamLog: options.taskStreamLog as string | undefined,
      runId:
        (options.runId as string | undefined) ??
        runtimeEnv('POSTHOG_WIZARD_RUN_ID'),
      control:
        typeof options.controlSocket === 'string'
          ? {
              socketPath: options.controlSocket,
              mode: controlMode(options),
            }
          : undefined,
      signal,
    });
  });
}
