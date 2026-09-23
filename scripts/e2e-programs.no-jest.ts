/**
 * `pnpm test:e2e:programs` — one real program run through `runProgram`, with
 * no TUI, no store and no session. This process is the host: it detects the
 * framework and supplies the integration effects a CLI host would.
 *
 *   APP_DIR=<workbench app copy> PROJECT_ID=… POSTHOG_KEY_FILE=… \
 *   WIZARD_CI_GATEWAY_TOKEN_FILE=… [PROGRAM=posthog-integration] \
 *   [E2E_RESULT_JSON=result.json] pnpm test:e2e:programs
 */
import fs from 'fs';
import path from 'path';
import { runProgram } from '@programs';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { detectFramework } from '@programs/detection/framework';
import type { ProgramOptions } from '@programs/run-program';
import {
  formatProgress,
  readE2eEnv,
  resolveE2eCredentials,
  writeE2eResult,
} from '@e2e-harness/surface-e2e';

type IntegrationEffects = NonNullable<ProgramOptions['integrationEffects']>;

const effects: IntegrationEffects = {
  readPackageJson: (installDir) => {
    const file = path.join(installDir, 'package.json');
    return Promise.resolve(
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
    );
  },
  hasDeclaredDependency: (name, packageJson) => {
    const pkg = packageJson as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } | null;
    return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
  },
  warn: (message) => console.warn(message),
  setTag: () => undefined,
  capture: () => undefined,
  // A synthetic run never writes to a hosting provider.
  uploadEnvironmentVariables: () => Promise.resolve([]),
  requestDeepLink: () => Promise.resolve(null),
  openDashboardDeepLink: () => undefined,
};

async function main(): Promise<void> {
  const e2e = readE2eEnv(process.env);
  const programId = process.env.PROGRAM || 'posthog-integration';
  const credentials = await resolveE2eCredentials(e2e);

  const integration =
    programId === 'posthog-integration'
      ? await detectFramework(e2e.appDir)
      : undefined;
  if (programId === 'posthog-integration' && !integration)
    throw new Error(`No supported framework detected in ${e2e.appDir}`);

  const outcome = await runProgram(
    programId,
    {
      installDir: e2e.appDir,
      credentials,
      integration: integration ?? null,
      frameworkConfig: integration
        ? FRAMEWORK_REGISTRY[integration]
        : undefined,
      frameworkContext: {},
      flags: { ci: true },
    },
    {
      integrationEffects: effects,
      onProgress: ({ event }) => {
        const line = formatProgress(event);
        if (line) console.log(line);
      },
    },
  );

  writeE2eResult({
    route: 'programs',
    programId,
    integration: integration ?? null,
    outcome: outcome.outcome,
    failure: outcome.failure?.message ?? null,
    settledRuns: outcome.settledRuns.length,
    tasks: outcome.runResults.flatMap((run) => run.snapshot.tasks),
  });
  console.log(`${programId}: ${outcome.outcome}`);
  if (outcome.outcome !== 'success') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
