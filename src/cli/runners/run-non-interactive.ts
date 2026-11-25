/** The non-interactive command runner: check the arguments, start the headless host, and exit with its code. */
import path from 'path';
import type { ProgramConfig } from '@programs/types';
import { modeLabel, type NonInteractiveMode } from '@headless';
import type { Harness, Sequence } from '@shared/constants';
import { ErrorCodes, emitWizardError, type ErrorCode } from '@shared/errors';
import type { CloudRegion } from '@utils/types';
import { readEnvironment } from '@utils/environment';
import { readApiKeyFromEnv } from '@utils/env-api-key';
import { runtimeEnv } from '@env';
import { configureLogFileFromEnvironment } from '@utils/debug';
import { consoleLog } from '@shared/console-log';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { runDiscoveryTest, wantsDiscoveryTest } from './run-discovery-test';
import { withSignals } from './signals';

/** The credentials every non-interactive mode accepts, for error messages. */
export const API_KEY_HINT =
  'personal API key phx_xxx or wizard-app OAuth access token pha_xxx';

/**
 * The single non-interactive validation layer: refuses `--signup`, and
 * requires api-key and install-dir. Every non-interactive entry point routes
 * through `runNonInteractive`, so this is the one place these checks live.
 * Exits 1 on the first failure; true when the options can run.
 */
export function validateNonInteractiveOptions(
  options: Record<string, unknown>,
  mode: NonInteractiveMode,
): boolean {
  const label = modeLabel(mode);
  if (options.signup) {
    return refuse(
      ErrorCodes.ArgsSignupNonInteractive,
      `${label} mode can't sign up: sign-up needs a browser, so --signup only works in an interactive run. ` +
        'Sign up for PostHog in a browser, then run the Wizard again with --api-key.',
    );
  }
  if (!options.apiKey) {
    return refuse(
      ErrorCodes.ArgsMissingApiKey,
      `${label} mode requires --api-key (${API_KEY_HINT})`,
    );
  }
  if (!options.installDir) {
    return refuse(
      ErrorCodes.ArgsMissingInstallDir,
      `${label} mode requires --install-dir`,
      `${label} mode requires --install-dir (directory to install in)`,
    );
  }
  return true;
}

/**
 * Decide whether to warn about an unexpected `--api-key` prefix, and with what
 * message. Returns `null` when the key is acceptable.
 *
 * CI and headless accept the same two credentials: a personal API key (`phx_`)
 * and a `pha_` OAuth access token minted under the wizard's own OAuth
 * application (cloud runs, and the CI bot). Both authenticate the mint the
 * same way. Anything else is unexpected and warns.
 *
 * Extracted as a pure predicate so it can be unit-tested without a UI.
 */
export function keyPrefixWarning(apiKey: string | undefined): string | null {
  if (!apiKey || apiKey.startsWith('phx_') || apiKey.startsWith('pha_')) {
    return null;
  }
  const hint = apiKey.startsWith('phc_')
    ? ' (phc_ is a project/client key; expected a personal API key or a wizard-app token)'
    : '';
  return `--api-key does not start with "phx_" or "pha_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`;
}

function warnOnUnexpectedKeyPrefix(apiKey: string | undefined): void {
  const message = keyPrefixWarning(apiKey);
  if (!message) return;
  consoleLog.intro('PostHog Wizard');
  consoleLog.log.warn(message);
}

/** Print the refusal and exit 1; it only returns where `process.exit` is stubbed. */
function refuse(code: ErrorCode, message: string, shown = message): false {
  consoleLog.intro('PostHog Wizard');
  consoleLog.log.error(shown);
  emitWizardError({ code, message });
  process.exit(1);
}

/** Run `config` in the headless host, for CI (`runWizardCI`) and headless (`runWizardHeadless`) runs. */
export function runNonInteractive(
  config: ProgramConfig,
  options: Record<string, unknown>,
  mode: NonInteractiveMode,
): void {
  if (wantsDiscoveryTest(options)) return runDiscoveryTest(config, options);
  if (!validateNonInteractiveOptions(options, mode)) return;
  warnOnUnexpectedKeyPrefix(options.apiKey as string | undefined);
  configureLogFileFromEnvironment();

  const env = readEnvironment();
  const installDir = path.resolve(options.installDir as string);
  // One project per run: a repeated flag keeps the last one, as yargs reads a repeated string.
  const project = [options.project].flat().at(-1) as string | undefined;
  withSignals(async (signal) => {
    const { runHeadless } = await import('@headless');
    return runHeadless(config, {
      mode,
      session: {
        debug: options.debug as boolean | undefined,
        installDir,
        ci: true,
        localDev: options.localDev as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        localPosthog: options.localPosthog as boolean | undefined,
        apiKey: (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined,
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
      project,
      runId:
        (options.runId as string | undefined) ??
        runtimeEnv('POSTHOG_WIZARD_RUN_ID'),
      signal,
    });
  });
}
