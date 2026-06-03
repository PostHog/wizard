#!/usr/bin/env node
import { satisfies } from 'semver';

// Run the Node-version check before pulling in the rest of the imports so
// users on too-old Node see a friendly message instead of a `SyntaxError`
// from one of our dependencies' modern features.
const MIN_NODE_VERSION = '>=18.17.0';
if (!satisfies(process.version, MIN_NODE_VERSION)) {
  // eslint-disable-next-line no-console
  console.log(
    `PostHog wizard needs Node.js ${MIN_NODE_VERSION}. Detected ${process.version} — please upgrade Node and re-run.`,
  );
  process.exit(1);
}

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { VERSION } from '@lib/version';

const WIZARD_VERSION = VERSION;

import { isNonInteractiveEnvironment } from '@utils/environment';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { getSubcommandPrograms, Program } from '@lib/programs/program-registry';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import type { startTUI as StartTUIFn } from '@ui/tui/start-tui';
import type { TaskStreamPush as TaskStreamPushClass } from '@lib/task-stream/task-stream-push';
import { POSTHOG_DOCS_URL } from '@lib/constants';
import { runtimeEnv, IS_PRODUCTION_BUILD } from '@env';

// Test mock server — only loaded when NODE_ENV is 'test'.
// In production builds, tsdown replaces process.env.NODE_ENV with 'production',
// making this block dead code.
if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

/** Shared yargs options for skill-based program subcommands. */
const skillSubcommandOptions = {
  debug: {
    default: false,
    describe: 'Enable verbose logging',
    type: 'boolean' as const,
  },
  'install-dir': {
    describe: 'Directory to install in',
    type: 'string' as const,
  },
  'local-mcp': {
    default: false,
    describe: 'Use local MCP server',
    type: 'boolean' as const,
  },
  benchmark: {
    default: false,
    describe: 'Run in benchmark mode',
    type: 'boolean' as const,
  },
  'yara-report': {
    default: false,
    describe: 'Print YARA scanner summary',
    type: 'boolean' as const,
    hidden: true,
  },
};

const cli = yargs(hideBin(process.argv))
  .env('POSTHOG_WIZARD')
  // global options
  .options({
    debug: {
      default: false,
      describe: 'Enable verbose logging\nenv: POSTHOG_WIZARD_DEBUG',
      type: 'boolean',
    },
    region: {
      describe: 'PostHog cloud region\nenv: POSTHOG_WIZARD_REGION',
      choices: ['us', 'eu'],
      type: 'string',
    },
    default: {
      default: true,
      describe:
        'Use default options for all prompts\nenv: POSTHOG_WIZARD_DEFAULT',
      type: 'boolean',
    },
    signup: {
      default: false,
      describe:
        'Create a new PostHog account during setup\nenv: POSTHOG_WIZARD_SIGNUP',
      type: 'boolean',
    },
    'local-mcp': {
      default: false,
      describe:
        'Use local MCP server at http://localhost:8787/mcp\nenv: POSTHOG_WIZARD_LOCAL_MCP',
      type: 'boolean',
    },
    'api-key': {
      describe:
        'PostHog personal API key (phx_xxx) for authentication\nenv: POSTHOG_WIZARD_API_KEY',
      type: 'string',
    },
    'project-id': {
      describe:
        'PostHog project ID to use (optional; when not set, uses default from API key or OAuth)\nenv: POSTHOG_WIZARD_PROJECT_ID',
      type: 'string',
    },
    email: {
      describe:
        'Email address for signup (used with --signup)\nenv: POSTHOG_WIZARD_EMAIL',
      type: 'string',
    },
    telemetry: {
      default: true,
      describe:
        'Send wizard run state to PostHog (pass --no-telemetry to disable)\nenv: POSTHOG_WIZARD_TELEMETRY',
      type: 'boolean',
    },
  })
  .command(
    ['$0'],
    'Run the PostHog setup wizard',
    (yargs) => {
      return yargs.options({
        'force-install': {
          default: false,
          describe:
            'Force install packages even if peer dependency checks fail\nenv: POSTHOG_WIZARD_FORCE_INSTALL',
          type: 'boolean',
        },
        'install-dir': {
          describe:
            'Directory to install PostHog in\nenv: POSTHOG_WIZARD_INSTALL_DIR',
          type: 'string',
        },
        playground: {
          default: false,
          describe: 'Launch the TUI primitives playground',
          type: 'boolean',
        },
        integration: {
          describe: 'Integration to set up',
          choices: [
            'nextjs',
            'astro',
            'react',
            'svelte',
            'react-native',
            'tanstack-router',
            'tanstack-start',
          ],
          type: 'string',
        },
        menu: {
          default: false,
          describe:
            'Show menu for manual integration selection instead of auto-detecting\nenv: POSTHOG_WIZARD_MENU',
          type: 'boolean',
        },
        benchmark: {
          default: false,
          describe:
            'Run in benchmark mode with per-phase token tracking\nenv: POSTHOG_WIZARD_BENCHMARK',
          type: 'boolean',
        },
        'yara-report': {
          default: false,
          describe:
            'Print YARA scanner summary after the agent run\nenv: POSTHOG_WIZARD_YARA_REPORT',
          type: 'boolean',
          hidden: true,
        },
        skill: {
          describe:
            'Run a specific context-mill skill by ID\nenv: POSTHOG_WIZARD_SKILL',
          type: 'string',
        },
        name: {
          describe:
            'Name for account creation with --ci --signup\nenv: POSTHOG_WIZARD_NAME',
          type: 'string',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        if (!options.region) options.region = 'us';
        if (!options.installDir) {
          setUI(new LoggingUI());
          getUI().intro('PostHog Wizard');
          getUI().log.error(
            'CI mode requires --install-dir (directory to install in)',
          );
          process.exit(1);
          return;
        }
        if (!options.apiKey && !options.signup) {
          setUI(new LoggingUI());
          getUI().intro('PostHog Wizard');
          getUI().log.error(
            'CI mode requires --api-key (personal API key phx_xxx). ' +
              'To create a new account instead, use --signup --email you@example.com.',
          );
          process.exit(1);
          return;
        }
        if (!options.apiKey && options.signup && !options.email) {
          setUI(new LoggingUI());
          getUI().intro('PostHog Wizard');
          getUI().log.error(
            'CI --signup requires --email to create a new account.',
          );
          process.exit(1);
          return;
        }
        // Warn (don't fail) on unexpected key prefix — `phx_` is the personal
        // API key the LLM Gateway expects.
        if (options.apiKey) {
          const apiKeyValue = String(options.apiKey);
          if (!apiKeyValue.startsWith('phx_')) {
            setUI(new LoggingUI());
            getUI().intro('PostHog Wizard');
            const prefix = apiKeyValue.slice(0, 4);
            let hint = '';
            if (prefix === 'pha_') {
              hint =
                ' (pha_ is an OAuth access token — CI mode expects a personal API key)';
            } else if (prefix === 'phc_') {
              hint =
                ' (phc_ is a project/client key — CI mode expects a personal API key)';
            }
            getUI().log.warn(
              `--api-key does not start with "phx_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`,
            );
          }
        }
        void (async () => {
          // If --signup but no existing key, provision a new account first and
          // use its personal API key for the rest of the CI install.
          if (!options.apiKey && options.signup) {
            setUI(new LoggingUI());
            getUI().intro('PostHog Wizard');
            try {
              const { provisionNewAccount } = await import(
                '@utils/provisioning'
              );
              const signupRegion = (options.region as string).toUpperCase() as
                | 'US'
                | 'EU';
              getUI().log.info(
                `Provisioning new PostHog account for ${String(
                  options.email,
                )} in ${signupRegion}...`,
              );
              const result = await provisionNewAccount(
                options.email as string,
                options.name ?? '',
                signupRegion,
              );
              if (!result.personalApiKey) {
                getUI().log.error(
                  'Provisioning succeeded but no personal API key was returned — cannot continue install.',
                );
                process.exit(1);
                return;
              }
              getUI().log.success('Account ready.');
              getUI().log.info(`  Project API Key:  ${result.projectApiKey}`);
              getUI().log.info(`  Personal API Key: ${result.personalApiKey}`);
              getUI().log.info(`  Host:             ${result.host}`);
              options.apiKey = result.personalApiKey;
              if (options.projectId == null) {
                options.projectId = result.projectId;
              }
            } catch (error) {
              const msg =
                error instanceof Error ? error.message : String(error);
              getUI().log.error(`Provisioning failed: ${msg}`);
              process.exit(1);
              return;
            }
          }

          const { posthogIntegrationConfig } = await import(
            '@lib/programs/posthog-integration/index'
          );
          const { FRAMEWORK_REGISTRY } = await import('@lib/registry');
          const { detectFramework, gatherFrameworkContext } = await import(
            '@lib/detection/index'
          );
          const { analytics } = await import('@utils/analytics');
          const { wizardAbort } = await import('@utils/wizard-abort');

          // preRun: honor --integration, else auto-detect, then gather
          // framework context. Bypasses onReady hooks by design.
          runWizardCI(posthogIntegrationConfig, options, async (session) => {
            const integration =
              session.integration ??
              (await detectFramework(session.installDir));
            if (!integration) {
              await wizardAbort({
                message:
                  'Could not auto-detect your framework. Please specify --integration on the command line.',
              });
              return;
            }
            session.integration = integration;
            analytics.setTag('integration', integration);

            const frameworkConfig = FRAMEWORK_REGISTRY[integration];
            session.frameworkConfig = frameworkConfig;

            const context = await gatherFrameworkContext(frameworkConfig, {
              installDir: session.installDir,
              debug: session.debug,
              forceInstall: session.forceInstall,
              default: false,
              signup: session.signup,
              localMcp: session.localMcp,
              ci: true,
              menu: session.menu,
              benchmark: session.benchmark,
              yaraReport: session.yaraReport,
            });
            for (const [key, value] of Object.entries(context)) {
              if (!(key in session.frameworkContext)) {
                session.frameworkContext[key] = value;
              }
            }
          });
        })().catch(() => {
          process.exit(1);
        });
      } else if (isNonInteractiveEnvironment()) {
        // Non-interactive non-CI: error out
        getUI().intro(`PostHog Wizard`);
        if (IS_PRODUCTION_BUILD) {
          getUI().log.error(
            'This installer requires an interactive terminal (TTY) to run.\n' +
              'It appears you are running in a non-interactive environment.\n\n' +
              'Non-interactive (CI) mode is not supported in published builds.\n',
          );
        } else {
          getUI().log.error(
            'This installer requires an interactive terminal (TTY) to run.\n' +
              'It appears you are running in a non-interactive environment.\n' +
              'Please run the wizard in an interactive terminal.\n\n' +
              'For CI/CD environments, use --ci mode:\n' +
              '  npx @posthog/wizard --ci --region us --api-key phx_xxx',
          );
        }
        process.exit(1);
      } else if (options.playground) {
        // Playground mode: launch the TUI primitives playground
        void (async () => {
          const { startPlayground } = await import(
            '@ui/tui/playground/start-playground'
          );
          (startPlayground as (version: string) => void)(WIZARD_VERSION);
        })();
      } else if (options.skill) {
        // Run a specific skill by ID
        void (async () => {
          const { createSkillProgram } = await import(
            '@lib/programs/agent-skill/index'
          );
          const skillId = options.skill as string;
          const config = createSkillProgram({
            skillId,
            command: 'skill',
            id: 'agent-skill',
            description: `Run skill: ${skillId}`,
            integrationLabel: skillId,
            successMessage: `${skillId} completed!`,
            reportFile: `posthog-${skillId}-report.md`,
            docsUrl: POSTHOG_DOCS_URL,
            spinnerMessage: `Running ${skillId}...`,
            estimatedDurationMinutes: 5,
          });
          runWizard(config, { ...options, skillId });
        })();
      } else {
        // Interactive TTY: run core-integration through the unified program path.
        // Same codepath as `npx @posthog/wizard integrate`.
        void (async () => {
          const { posthogIntegrationConfig } = await import(
            '@lib/programs/posthog-integration/index'
          );
          runWizard(posthogIntegrationConfig, options);
        })();
      }
    },
  )
  .command('mcp <command>', 'MCP server management commands', (yargs) => {
    return yargs
      .command(
        'add',
        'Install PostHog MCP server to supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Add local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
            features: {
              describe:
                'Comma-separated list of features to enable (default: all)',
              type: 'string',
            },
            'api-key': {
              describe:
                'PostHog personal API key (phx_xxx) for MCP authentication',
              type: 'string',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          const mcpFeatures = options.features
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          void (async () => {
            const { readApiKeyFromEnv } = await import('@utils/env-api-key');
            const apiKey =
              (options.apiKey as string | undefined) || readApiKeyFromEnv();

            try {
              const { startTUI } = await import('@ui/tui/start-tui');
              const { buildSession } = await import('@lib/wizard-session');

              const tui = startTUI(WIZARD_VERSION, Program.McpAdd);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
                mcpFeatures,
                apiKey,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { addMCPServerToClientsStep } = await import(
                '@steps/add-mcp-server-to-clients/index'
              );
              await addMCPServerToClientsStep({
                local: options.local,
                features: mcpFeatures,
                apiKey,
              });
            }
          })();
        },
      )
      .command(
        'remove',
        'Remove PostHog MCP server from supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Remove local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          void (async () => {
            try {
              const { startTUI } = await import('@ui/tui/start-tui');
              const { buildSession } = await import('@lib/wizard-session');

              const tui = startTUI(WIZARD_VERSION, Program.McpRemove);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { removeMCPServerFromClientsStep } = await import(
                '@steps/add-mcp-server-to-clients/index'
              );
              await removeMCPServerFromClientsStep({
                local: options.local,
              });
            }
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (add or remove)')
      .help();
  });

cli.command(
  'provision',
  'Create a new PostHog account (headless, no TUI)',
  (yargs) => {
    return yargs
      .options({
        email: {
          describe: 'Email address for the new account',
          type: 'string' as const,
          demandOption: true,
        },
        region: {
          describe: 'Cloud region (us or eu)',
          choices: ['us', 'eu'] as const,
          default: 'us',
        },
        name: {
          describe: 'Name for the new account',
          type: 'string' as const,
          default: '',
        },
        json: {
          describe:
            'Emit JSON result to stdout (defaults to true when stdout is not a TTY)',
          type: 'boolean' as const,
        },
      })
      .example('wizard provision --email matt+test@posthog.com --region us', '')
      .example(
        'wizard provision --email user@example.com --region eu --json',
        '',
      );
  },
  (argv) => {
    const email = argv.email;
    const region = argv.region.toUpperCase() as 'US' | 'EU';
    const name = argv.name ?? '';
    const jsonMode =
      argv.json === undefined ? !process.stdout.isTTY : argv.json;

    if (!jsonMode) {
      setUI(new LoggingUI());
    }

    void (async () => {
      try {
        const { provisionNewAccount } = await import('@utils/provisioning');
        if (!jsonMode) {
          getUI().log.info(`Provisioning account for ${email} in ${region}...`);
        }
        const result = await provisionNewAccount(email, name, region);
        if (jsonMode) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
        } else {
          getUI().log.success('Account provisioned successfully:');
          getUI().log.info(`  API Key:       ${result.projectApiKey}`);
          getUI().log.info(`  Host:          ${result.host}`);
          getUI().log.info(`  Project ID:    ${result.projectId}`);
          getUI().log.info(`  Account ID:    ${result.accountId}`);
          getUI().log.info(`  Access Token:  ${result.accessToken}`);
          getUI().log.info(`  Refresh Token: ${result.refreshToken}`);
          if (result.personalApiKey) {
            getUI().log.info(`  Personal API Key: ${result.personalApiKey}`);
          }
        }
        process.exit(0);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const code = msg.includes('already associated')
          ? 'email_exists'
          : 'provisioning_failed';
        if (jsonMode) {
          process.stderr.write(`${JSON.stringify({ error: msg, code })}\n`);
        } else {
          getUI().log.error(`Provisioning failed: ${msg}`);
        }
        process.exit(1);
      }
    })();
  },
);

// ── Skill-based program subcommands (derived from registry) ─────────
for (const programConfig of getSubcommandPrograms()) {
  cli.command(
    programConfig.command!,
    programConfig.description,
    (y) =>
      y.options({
        ...skillSubcommandOptions,
        ...(programConfig.cliOptions ?? {}),
      }),
    (argv) => {
      const extras =
        programConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
      const options = { ...argv, ...extras };
      if (options.ci) {
        runWizardCI(programConfig, options);
      } else {
        runWizard(programConfig, options);
      }
    },
  );
}

// CI mode (--ci) is only supported in dev/test. It is left undeclared in
// published builds (NODE_ENV==='production'), so .strictOptions() below rejects
// it as an unknown argument there — exactly like any other unrecognized flag.
if (!IS_PRODUCTION_BUILD) {
  cli.option('ci', {
    default: false,
    describe:
      'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
    type: 'boolean',
  });
}

cli
  .strictOptions()
  // A custom fail callback in yargs neither exits nor rethrows on its own (it
  // just returns, after which yargs would run the command handler anyway), so
  // throw to halt before dispatch. The catch around parse() renders the error
  // in red at the top and exits non-zero — instead of yargs' default of
  // dumping full help with the error buried at the bottom.
  .fail((msg, err) => {
    throw err || new Error(msg);
  })
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? cli.terminalWidth() : 80);

// In published builds, `--ci` is undeclared, so yargs would reject it as
// "Unknown arguments: ci" — accurate but unhelpful, since --help doesn't list
// --ci either and the user has no path forward. POSTHOG_WIZARD_CI silently
// no-ops for the same reason (yargs only resolves env vars for declared
// options). Detect both up front and exit with a message that explains why
// and what to do instead.
if (IS_PRODUCTION_BUILD) {
  const args = process.argv.slice(2);
  const argvHasCI = args.some(
    (a) => a === '--ci' || a === '--no-ci' || a.startsWith('--ci='),
  );
  const envHasCI =
    process.env.POSTHOG_WIZARD_CI != null &&
    process.env.POSTHOG_WIZARD_CI !== '';
  if (argvHasCI || envHasCI) {
    exitWithProductionCIError();
  }
}

try {
  cli.parse();
} catch (err) {
  const RED = '\x1b[31m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${RED}${BOLD}✖ ${message}${RESET}\n`);
  process.stderr.write('Run with --help to see available options.\n');
  process.exit(1);
}

function exitWithProductionCIError(): never {
  const RED = '\x1b[31m';
  const BOLD = '\x1b[1m';
  const RESET = '\x1b[0m';
  process.stderr.write(
    `${RED}${BOLD}✖ CI mode is not currently supported in published builds.${RESET}\n`,
  );
  process.exit(1);
}

// `--no-telemetry` flips `telemetry: false` via yargs negation;
// `POSTHOG_WIZARD_NO_TELEMETRY` is honoured separately so the env-var
// form documented in the README keeps working.
function resolveNoTelemetry(options: Record<string, unknown>): boolean {
  if (options.telemetry === false) return true;
  const env = process.env.POSTHOG_WIZARD_NO_TELEMETRY;
  if (env == null || env === '') return false;
  const norm = env.toLowerCase();
  return norm !== '0' && norm !== 'false';
}

/**
 * Run a full wizard program in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
function runWizard(
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
      const { logToFile } = await import('@utils/debug');

      tui = startTUI(WIZARD_VERSION, config.id as any);
      const activeTui = tui;

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
        integration: options.integration as any,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
        noTelemetry: resolveNoTelemetry(options),
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
        if (activeTui.store.session.runPhase === RunPhase.Running) {
          activeTui.store.setRunPhase(RunPhase.Error);
        }
        void activeStream.shutdown(2000).finally(() => {
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
      await activeTui.store.getGate('intro');
      await activeTui.store.getGate('health-check');

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
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        const { runAgent } = await import('@lib/agent/agent-runner');
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
      if (runtimeEnv('DEBUG') || runtimeEnv('POSTHOG_WIZARD_DEBUG')) {
        console.error('TUI init failed:', err); // eslint-disable-line no-console
      }
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
      process.exit(1);
    }
  })();
}

/**
 * CI-mode pipeline shared by every non-interactive entry point.
 *
 * Validates flags, builds a `ci:true` session, runs `preRun` (or the
 * program's `onReady` hooks by default), executes `runAgent`, and
 * routes any failure through `wizardAbort`. `wizardAbort` owns all
 * exits — never add a raw `process.exit` here.
 */
function runWizardCI(
  config: ProgramConfig,
  options: Record<string, unknown>,
  preRun?: (session: WizardSession) => Promise<void>,
): void {
  setUI(new LoggingUI());
  if (!options.region) options.region = 'us';
  if (!options.apiKey) {
    getUI().intro('PostHog Wizard');
    getUI().log.error('CI mode requires --api-key (personal API key phx_xxx)');
    process.exit(1);
  }
  if (!options.installDir) {
    getUI().intro('PostHog Wizard');
    getUI().log.error(
      'CI mode requires --install-dir (directory to install in)',
    );
    process.exit(1);
  }

  void (async () => {
    const path = await import('path');
    const { buildSession } = await import('@lib/wizard-session');
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
      forceInstall: options.forceInstall as boolean | undefined,
      installDir,
      ci: true,
      signup: options.signup as boolean | undefined,
      localMcp: options.localMcp as boolean | undefined,
      apiKey,
      email: options.email as string | undefined,
      menu: options.menu as boolean | undefined,
      integration: options.integration as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      projectId: options.projectId as string | undefined,
      benchmark: options.benchmark as boolean | undefined,
      yaraReport: options.yaraReport as boolean | undefined,
      noTelemetry: resolveNoTelemetry(options),
      ...env,
    });
    session.programLabel = config.id;
    if (config.skillId) {
      session.skillId = config.skillId;
    }
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the PostHog setup wizard');
    getUI().log.info(`Running ${config.id} in CI mode`);

    try {
      if (preRun) {
        await preRun(session);
      } else {
        // Run onReady hooks against a minimal store-less context.
        const readyCtx = {
          session,
          setFrameworkContext: (key: string, value: unknown) => {
            session.frameworkContext[key] = value;
          },
          setFrameworkConfig: () => undefined,
          setDetectedFramework: () => undefined,
          setUnsupportedVersion: () => undefined,
          addDiscoveredFeature: () => undefined,
          setDetectionComplete: () => undefined,
        };
        for (const step of config.steps) {
          if (step.onReady) {
            await step.onReady(readyCtx);
          }
        }

        // Surface detectError written by the program's detect hook.
        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (detectError) {
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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error && error.stack ? error.stack : undefined;

      logToFile(`[bin.ts CI] ERROR: ${errorMessage}`);
      if (errorStack) logToFile(`[bin.ts CI] STACK: ${errorStack}`);

      const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';
      const docsUrl =
        session.frameworkConfig?.metadata.docsUrl ??
        runDef?.docsUrl ??
        POSTHOG_DOCS_URL;
      await wizardAbort({
        message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
        error: error as Error,
      });
    }
  })().catch(() => {
    process.exit(1);
  });
}
