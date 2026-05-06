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

import { isNonInteractiveEnvironment } from './src/utils/environment';
import { getUI, setUI } from './src/ui';
import { LoggingUI } from './src/ui/logging-ui';
import { getSubcommandWorkflows } from './src/lib/workflows/workflow-registry';
import type { WorkflowConfig } from './src/lib/workflows/workflow-step';
import type { WizardSession } from './src/lib/wizard-session';
import { POSTHOG_DOCS_URL } from './src/lib/constants';
import { runtimeEnv } from '@env';

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
    email: {
      describe:
        'Email address for signup (used with --signup)\nenv: POSTHOG_WIZARD_EMAIL',
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
        skill: {
          describe:
            'Run a specific context-mill skill by ID\nenv: POSTHOG_WIZARD_SKILL',
          type: 'string',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        if (!options.region) options.region = 'us';
        if (!options.apiKey) {
          setUI(new LoggingUI());
          getUI().intro('PostHog Wizard');
          getUI().log.error(
            'CI mode requires --api-key (personal API key phx_xxx)',
          );
          process.exit(1);
          return;
        }
        if (!options.installDir) {
          setUI(new LoggingUI());
          getUI().intro('PostHog Wizard');
          getUI().log.error(
            'CI mode requires --install-dir (directory to install in)',
          );
          process.exit(1);
          return;
        }
        void (async () => {
          const { posthogIntegrationConfig } = await import(
            './src/lib/workflows/posthog-integration/index.js'
          );
          const { FRAMEWORK_REGISTRY } = await import('./src/lib/registry.js');
          const { detectFramework, gatherFrameworkContext } = await import(
            './src/lib/detection/index.js'
          );
          const { analytics } = await import('./src/utils/analytics.js');
          const { wizardAbort } = await import('./src/utils/wizard-abort.js');

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
      } else if (options.skill) {
        // Run a specific skill by ID
        void (async () => {
          const { createSkillWorkflow } = await import(
            './src/lib/workflows/agent-skill/index.js'
          );
          const skillId = options.skill as string;
          const config = createSkillWorkflow({
            skillId,
            command: 'skill',
            flowKey: 'agent-skill',
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
        // Interactive TTY: run core-integration through the unified workflow path.
        // Same codepath as `npx @posthog/wizard integrate`.
        void (async () => {
          const { posthogIntegrationConfig } = await import(
            './src/lib/workflows/posthog-integration/index.js'
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

// Audit-only options. `--areas` constrains the run to a subset of audit
// areas (Installation, Identification, Web Analytics, …). When omitted
// the agent runs everything its discovery determines applies.
const auditSubcommandOptions = {
  areas: {
    describe:
      'Comma-separated audit areas to constrain the run to (e.g. "Web Analytics, Feature Flags"). See --help for the full list.',
    type: 'string' as const,
  },
};

// ── Skill-based workflow subcommands (derived from registry) ─────────
for (const wfConfig of getSubcommandWorkflows()) {
  const isAudit = wfConfig.command === 'audit';
  cli.command(
    wfConfig.command!,
    wfConfig.description,
    (y) =>
      isAudit
        ? y.options({ ...skillSubcommandOptions, ...auditSubcommandOptions })
        : y.options(skillSubcommandOptions),
    (argv) => {
      const options = { ...argv };
      if (options.ci) {
        runWizardCI(wfConfig, options);
      } else {
        runWizard(wfConfig, options);
      }
    },
  );
}

cli
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? cli.terminalWidth() : 80).argv;

/**
 * Run a full wizard workflow in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
function runWizard(
  config: WorkflowConfig,
  options: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();

      const { startTUI } = await import('./src/ui/tui/start-tui.js');
      const { buildSession } = await import('./src/lib/wizard-session.js');
      const { TaskStreamPush } = await import('./src/lib/task-stream/index.js');
      const { FileDestination } = await import(
        './src/lib/task-stream/destinations/file.js'
      );
      const { PostHogDestination } = await import(
        './src/lib/task-stream/destinations/posthog.js'
      );
      const { analytics } = await import('./src/utils/analytics.js');

      const tui = startTUI(WIZARD_VERSION, config.flowKey as any);

      const auditAreas = await maybeParseAuditAreas(config, options);

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
        auditAreas,
      });
      session.workflowLabel = config.flowKey;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      }

      tui.store.session = session;

      // Task stream — pushes state to external consumers on task changes
      const taskStream = new TaskStreamPush({
        store: tui.store,
        workflowId: config.flowKey,
        destinations: [new FileDestination(), new PostHogDestination()],
      });
      tui.store.onTasksChanged = () => void taskStream.push();

      await tui.store.runReadyHooks();
      await tui.store.getGate('intro');
      await tui.store.getGate('health-check');

      const skipAgent = config.run == null;

      if (skipAgent) {
        const { getOrAskForProjectData } = await import(
          './src/utils/setup-utils.js'
        );
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
        const { runAgent } = await import('./src/lib/agent/agent-runner.js');
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
        console.error('TUI init failed:', err); // eslint-disable-line no-console
      }
    }
  })();
}

/**
 * CI-mode pipeline shared by every non-interactive entry point.
 *
 * Validates flags, builds a `ci:true` session, runs `preRun` (or the
 * workflow's `onReady` hooks by default), executes `runAgent`, and
 * routes any failure through `wizardAbort`. `wizardAbort` owns all
 * exits — never add a raw `process.exit` here.
 */
function runWizardCI(
  config: WorkflowConfig,
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
    const { buildSession } = await import('./src/lib/wizard-session.js');
    const { readEnvironment } = await import('./src/utils/environment.js');
    const { readApiKeyFromEnv } = await import('./src/utils/env-api-key.js');
    const { configureLogFileFromEnvironment, logToFile } = await import(
      './src/utils/debug.js'
    );
    const { wizardAbort, WizardError } = await import(
      './src/utils/wizard-abort.js'
    );

    configureLogFileFromEnvironment();

    const env = readEnvironment();
    const apiKey =
      (options.apiKey as string) ?? readApiKeyFromEnv() ?? undefined;
    const installDir = path.isAbsolute(options.installDir as string)
      ? (options.installDir as string)
      : path.join(process.cwd(), options.installDir as string);

    const auditAreas = await maybeParseAuditAreas(config, options);

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
      auditAreas,
      ...env,
    });
    session.workflowLabel = config.flowKey;
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the PostHog setup wizard');
    getUI().log.info(`Running ${config.flowKey} in CI mode`);

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

        // Surface detectError written by the workflow's detect hook.
        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (detectError) {
          await wizardAbort({
            message: `Prerequisites not met: ${detectError.kind}\n\nSee ${
              runDef?.docsUrl ?? POSTHOG_DOCS_URL
            }`,
            error: new WizardError(`${config.flowKey} prerequisites failed`, {
              integration: config.flowKey,
              detect_error_kind: detectError.kind,
            }),
          });
        }
      }

      const { runAgent } = await import('./src/lib/agent/agent-runner.js');
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

/**
 * Parse `--areas` into a typed AuditArea[]. Returns `undefined` when the
 * workflow isn't audit or no flag was passed. Logs a hint listing every
 * allowed area when unknown values are passed (and ignores them).
 */
async function maybeParseAuditAreas(
  config: WorkflowConfig,
  options: Record<string, unknown>,
): Promise<import('./src/lib/workflows/audit/areas').AuditArea[] | undefined> {
  if (config.command !== 'audit') return undefined;
  const areasArg = options.areas as string | undefined;
  if (!areasArg) return undefined;

  const { parseAuditAreas, formatAreasHint } = await import(
    './src/lib/workflows/audit/areas.js'
  );
  const { areas, unknown } = parseAuditAreas(areasArg);
  if (unknown.length > 0) {
    getUI().log.warn(
      `Ignoring unknown audit area(s): ${unknown.join(
        ', ',
      )}. Allowed areas: ${formatAreasHint()}.`,
    );
  }
  return areas.length > 0 ? areas : undefined;
}
