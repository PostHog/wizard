#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const WIZARD_VERSION = (() => {
  // npm/pnpm set this when running via package scripts
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Fallback: read package.json relative to this file
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(dirname(__filename), '..', 'package.json'), 'utf-8'),
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

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

yargs(hideBin(process.argv))
  .env('POSTHOG_WIZARD')
  // global options
  .options({
    debug: {
      default: false,
      describe: 'Enable verbose logging\nenv: POSTHOG_WIZARD_DEBUG',
      type: 'boolean',
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
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        // Use LoggingUI for CI mode (no dependencies, no prompts)
        setUI(new LoggingUI());
        if (!options.apiKey) {
          getUI().intro(chalk.inverse(`PostHog Wizard`));
          getUI().log.error(
            'CI mode requires --api-key (personal API key phx_xxx)',
          );
          process.exit(1);
        }
        if (!options.installDir) {
          getUI().intro(chalk.inverse(`PostHog Wizard`));
          getUI().log.error(
            'CI mode requires --install-dir (directory to install PostHog in)',
          );
          process.exit(1);
        }

        void runWizard(options as Parameters<typeof runWizard>[0]);
      } else if (isNonInteractiveEnvironment()) {
        // Non-interactive non-CI: error out
        getUI().intro(chalk.inverse(`PostHog Wizard`));
        getUI().log.error(
          'This installer requires an interactive terminal (TTY) to run.\n' +
            'It appears you are running in a non-interactive environment.\n' +
            'Please run the wizard in an interactive terminal.\n\n' +
            'For CI/CD environments, use --ci mode:\n' +
            '  npx @posthog/wizard --ci --api-key phx_xxx --install-dir .',
        );
        process.exit(1);
      } else if (options.playground) {
        // Playground mode: launch the TUI primitives playground
        void (async () => {
          const { startPlayground } = await import(
            './src/ui/tui/playground/start-playground.js'
          );
          startPlayground(WIZARD_VERSION);
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
              projectId: options.projectId as string | undefined,
            });
            tui.store.session = session;

            // Detect framework while IntroScreen shows its spinner.
            // Runs concurrently — IntroScreen reacts when detection completes.
            const { FRAMEWORK_REGISTRY } = await import(
              './src/lib/registry.js'
            );
            const { detectIntegration } = await import('./src/run.js');
            const installDir = session.installDir ?? process.cwd();

            const { DETECTION_TIMEOUT_MS } = await import(
              './src/lib/constants.js'
            );
            const detectedIntegration = await Promise.race([
              detectIntegration(installDir),
              new Promise<undefined>((resolve) =>
                setTimeout(() => resolve(undefined), DETECTION_TIMEOUT_MS),
              ),
            ]);

            if (detectedIntegration) {
              const config = FRAMEWORK_REGISTRY[detectedIntegration];

              // Run gatherContext for the friendly variant label
              if (config.metadata.gatherContext) {
                try {
                  const context = await Promise.race([
                    config.metadata.gatherContext({
                      installDir,
                      debug: session.debug,
                      forceInstall: session.forceInstall,
                      default: false,
                      signup: session.signup,
                      localMcp: session.localMcp,
                      ci: session.ci,
                      menu: session.menu,
                      benchmark: session.benchmark,
                    }),
                    new Promise<Record<string, never>>((resolve) =>
                      setTimeout(() => resolve({}), DETECTION_TIMEOUT_MS),
                    ),
                  ]);
                  for (const [key, value] of Object.entries(context)) {
                    if (!(key in session.frameworkContext)) {
                      tui.store.setFrameworkContext(key, value);
                    }
                  }
                } catch {
                  // Detection failed — will show generic name
                }
              }

              tui.store.setFrameworkConfig(detectedIntegration, config);

              if (!session.detectedFrameworkLabel) {
                tui.store.setDetectedFramework(config.metadata.name);
              }
            }

            // Feature discovery — deterministic scan of package.json deps
            try {
              const { readFileSync } = await import('fs');
              const pkgPath = require('path').join(installDir, 'package.json');
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
              };
              const depNames = Object.keys(allDeps);

              const { DiscoveredFeature } = await import(
                './src/lib/wizard-session.js'
              );

              if (
                depNames.some((d) =>
                  ['stripe', '@stripe/stripe-js'].includes(d),
                )
              ) {
                tui.store.addDiscoveredFeature(DiscoveredFeature.Stripe);
              }

              // LLM SDK detection — sourced from PostHog LLM analytics skill
              const LLM_PACKAGES = [
                'openai',
                '@anthropic-ai/sdk',
                'ai',
                '@ai-sdk/openai',
                'langchain',
                '@langchain/openai',
                '@langchain/langgraph',
                '@google/generative-ai',
                '@google/genai',
                '@instructor-ai/instructor',
                '@mastra/core',
                'portkey-ai',
              ];
              if (depNames.some((d) => LLM_PACKAGES.includes(d))) {
                tui.store.addDiscoveredFeature(DiscoveredFeature.LLM);
              }
            } catch {
              // No package.json or parse error — skip feature discovery
            }

            // Signal detection is done — IntroScreen shows picker or results
            tui.store.setDetectionComplete();

            // Wait for IntroScreen confirmation
            await tui.waitForSetup();

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
              const tui = startTUI(WIZARD_VERSION, Flow.McpAdd);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
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
  })
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
