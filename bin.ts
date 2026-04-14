#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { VERSION } from './src/lib/version.js';

const WIZARD_VERSION = VERSION;

const NODE_VERSION_RANGE = '>=18.17.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `PostHog wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import { runWizard } from './src/run';
import { isNonInteractiveEnvironment } from './src/utils/environment';
import { getUI, setUI } from './src/ui';
import { LoggingUI } from './src/ui/logging-ui';
import type { Integration } from './src/lib/constants';
import type { FrameworkConfig } from './src/lib/framework-config';
import { getSubcommandWorkflows } from './src/lib/workflows/workflow-registry';
import type { WorkflowConfig } from './src/lib/workflows/workflow-step';
import {
  detectFramework,
  discoverFeatures,
  gatherFrameworkContext,
  checkFrameworkVersion,
} from './src/lib/detection';

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

/**
 * Shared handler for skill-based workflow subcommands.
 * Starts the TUI, runs ready hooks, waits for the intro gate,
 * runs skill bootstrap, and waits for outro dismissal.
 */
function runSkillWorkflow(
  config: WorkflowConfig,
  options: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();

      const { startTUI } = await import('./src/ui/tui/start-tui.js');
      const { buildSession } = await import('./src/lib/wizard-session.js');

      // flowKey values match Flow enum values by convention
      const tui = startTUI(WIZARD_VERSION, config.flowKey as any);

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        installDir,
        ci: false,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
      });
      tui.store.session = session;

      await tui.store.runReadyHooks();
      await tui.store.getGate('intro');

      const { runWorkflow, bootstrapToRunConfig } = await import(
        './src/lib/workflow-runner.js'
      );
      const runConfig = config.buildRunConfig
        ? await config.buildRunConfig(tui.store.session)
        : bootstrapToRunConfig(config.bootstrap!);
      await runWorkflow(tui.store.session, runConfig);

      tui.store.onEnterScreen('outro' as any, () => {
        // Screen is already outro — listen for dismissal
      });
      await new Promise<void>((resolve) => {
        const unsub = tui.store.subscribe(() => {
          if (tui.store.session.outroDismissed) {
            unsub();
            resolve();
          }
        });
        if (tui.store.session.outroDismissed) {
          unsub();
          resolve();
        }
      });
      process.exit(0);
    } catch (err) {
      if (process.env.DEBUG || process.env.POSTHOG_WIZARD_DEBUG) {
        console.error('TUI init failed:', err); // eslint-disable-line no-console
      }
    }
  })();
}

/** Shared yargs options for skill-based workflow subcommands. */
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
    ci: {
      default: false,
      describe:
        'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
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
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        // Use LoggingUI for CI mode (no dependencies, no prompts)
        setUI(new LoggingUI());
        // Default region to 'us' if not specified
        if (!options.region) {
          options.region = 'us';
        }
        if (!options.apiKey) {
          getUI().intro(`PostHog Wizard`);
          getUI().log.error(
            'CI mode requires --api-key (personal API key phx_xxx)',
          );
          process.exit(1);
        }
        if (!options.installDir) {
          getUI().intro(`PostHog Wizard`);
          getUI().log.error(
            'CI mode requires --install-dir (directory to install PostHog in)',
          );
          process.exit(1);
        }

        void runWizard(options as Parameters<typeof runWizard>[0]);
      } else if (isNonInteractiveEnvironment()) {
        // Non-interactive non-CI: error out
        getUI().intro(`PostHog Wizard`);
        getUI().log.error(
          'This installer requires an interactive terminal (TTY) to run.\n' +
            'It appears you are running in a non-interactive environment.\n' +
            'Please run the wizard in an interactive terminal.\n\n' +
            'For CI/CD environments, use --ci mode:\n' +
            '  npx @posthog/wizard --ci --region us --api-key phx_xxx',
        );
        process.exit(1);
      } else if (options.playground) {
        // Playground mode: launch the TUI primitives playground
        void (async () => {
          const { startPlayground } = await import(
            './src/ui/tui/playground/start-playground.js'
          );
          (startPlayground as (version: string) => void)(WIZARD_VERSION);
        })();
      } else {
        // Interactive TTY: launch the Ink TUI
        void (async () => {
          try {
            const { startTUI } = await import('./src/ui/tui/start-tui.js');
            const { buildSession } = await import(
              './src/lib/wizard-session.js'
            );

            const tui = startTUI(WIZARD_VERSION);

            // Build session from CLI args and attach to store
            const session = buildSession({
              debug: options.debug as boolean | undefined,
              forceInstall: options.forceInstall as boolean | undefined,
              installDir: options.installDir as string | undefined,
              ci: false,
              signup: options.signup as boolean | undefined,
              localMcp: options.localMcp as boolean | undefined,
              apiKey: options.apiKey as string | undefined,
              menu: options.menu as boolean | undefined,
              integration: options.integration as Parameters<
                typeof buildSession
              >[0]['integration'],
              benchmark: options.benchmark as boolean | undefined,
              yaraReport: options.yaraReport as boolean | undefined,
              projectId: options.projectId as string | undefined,
            });
            tui.store.session = session;

            // Detect framework while IntroScreen shows its spinner.
            // Runs concurrently — IntroScreen reacts when detection completes.
            const { FRAMEWORK_REGISTRY } = (await import(
              './src/lib/registry.js'
            )) as { FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> };
            const installDir = session.installDir ?? process.cwd();

            const detectedIntegration = await detectFramework(installDir);

            if (detectedIntegration) {
              const config = FRAMEWORK_REGISTRY[detectedIntegration];

              const sessionOptions = {
                installDir,
                debug: session.debug,
                forceInstall: session.forceInstall,
                default: false,
                signup: session.signup,
                localMcp: session.localMcp,
                ci: session.ci,
                menu: session.menu,
                benchmark: session.benchmark,
                yaraReport: session.yaraReport,
              };

              // Gather framework-specific context (e.g., router type)
              const context = await gatherFrameworkContext(
                config,
                sessionOptions,
              );
              for (const [key, value] of Object.entries(context)) {
                if (!(key in session.frameworkContext)) {
                  tui.store.setFrameworkContext(key, value);
                }
              }

              tui.store.setFrameworkConfig(detectedIntegration, config);

              if (!session.detectedFrameworkLabel) {
                tui.store.setDetectedFramework(config.metadata.name);
              }

              // Early version check — surface on IntroScreen before user proceeds
              const versionResult = await checkFrameworkVersion(
                config,
                sessionOptions,
              );
              if (versionResult.supported !== true) {
                tui.store.setUnsupportedVersion(versionResult.supported);
              }
            }

            // Feature discovery — scan deps for Stripe, LLM, etc.
            for (const feature of discoverFeatures(installDir)) {
              tui.store.addDiscoveredFeature(feature);
            }

            // Signal detection is done — IntroScreen shows picker or results
            tui.store.setDetectionComplete();

            // Wait for IntroScreen confirmation
            await tui.waitForSetup();

            // Ensure health check has completed before starting the wizard.
            // The flow gate on Intro (readinessResult !== null) keeps the
            // TUI on IntroScreen until this resolves. If blocking, the
            // outage overlay was already pushed in the .then() callback.
            await tui.store.getGate('health-check');

            await runWizard(
              options as Parameters<typeof runWizard>[0],
              tui.store.session,
            );

            // Keep the outro screen visible — let process.exit() handle cleanup
          } catch (err) {
            // TUI unavailable (e.g., in test environment) — continue with default UI
            if (process.env.DEBUG || process.env.POSTHOG_WIZARD_DEBUG) {
              console.error('TUI init failed:', err); // eslint-disable-line no-console
            }
            await runWizard(options as Parameters<typeof runWizard>[0]);
          }
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
            const { readApiKeyFromEnv } = await import(
              './src/utils/env-api-key.js'
            );
            const apiKey =
              (options.apiKey as string | undefined) || readApiKeyFromEnv();

            try {
              const { startTUI } = await import('./src/ui/tui/start-tui.js');
              const { buildSession } = await import(
                './src/lib/wizard-session.js'
              );

              const { Flow } = await import('./src/ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpAdd);
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
                './src/steps/add-mcp-server-to-clients/index.js'
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
              const { startTUI } = await import('./src/ui/tui/start-tui.js');
              const { buildSession } = await import(
                './src/lib/wizard-session.js'
              );

              const { Flow } = await import('./src/ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpRemove);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { removeMCPServerFromClientsStep } = await import(
                './src/steps/add-mcp-server-to-clients/index.js'
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

// ── Skill-based workflow subcommands (derived from registry) ─────────
for (const wfConfig of getSubcommandWorkflows()) {
  cli.command(
    wfConfig.command!,
    wfConfig.description,
    (y) => y.options(skillSubcommandOptions),
    (argv) => runSkillWorkflow(wfConfig, { ...argv }),
  );
}

cli
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
