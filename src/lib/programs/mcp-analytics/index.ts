import type { AbortCase } from '@lib/agent/agent-runner';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { ProgramConfig } from '@lib/programs/program-step';
import { OutroKind, type WizardSession } from '@lib/wizard-session';
import { relative } from 'path';
import { ErrorCodes } from '@lib/errors';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import type { McpTarget } from './detect';
import {
  MCP_SCAN_KEY,
  MCP_SCAN_ERROR_KEY,
  MCP_TARGET_KEY,
  scanMcpAnalyticsProject,
} from './setup';

const MCP_ANALYTICS_REPORT_FILE = 'posthog-mcp-analytics-report.md';

/**
 * `[ABORT]` reasons the mcp-analytics skill emits when the project can't be
 * instrumented. Kept in sync with the stop conditions in the skill's
 * `description.md` (context-mill `context/skills/mcp-analytics`).
 */
export const MCP_ANALYTICS_ABORT_CASES: AbortCase[] = [
  {
    match: /^unsupported language for mcp analytics$/i,
    errorCode: ErrorCodes.DetectUnsupportedPlatform,
    message: 'Unsupported language for MCP analytics',
    body:
      'MCP analytics supports TypeScript/JavaScript (`@posthog/mcp`) and Python ' +
      '(`posthog.mcp`, shipped inside the `posthog` package). This project ' +
      "doesn't look like either, so there's nothing to instrument. " +
      'See https://posthog.com/docs/mcp-analytics for the supported setups.',
  },
  {
    match: /^no mcp server found$/i,
    message: 'No MCP server found',
    body:
      'This command instruments an existing MCP server with PostHog analytics, ' +
      'but no MCP server was found in this project. If you just want PostHog ' +
      'product analytics, run `npx @posthog/wizard` instead.',
  },
  {
    match: /^could not locate the server entry point$/i,
    message: 'Could not locate the MCP server entry point',
    body:
      "This project has MCP signals, but the agent couldn't find where the " +
      "server is constructed or requests are dispatched, so there's nowhere " +
      'safe to add instrumentation. See https://posthog.com/docs/mcp-analytics ' +
      'for the supported server styles, or point the wizard at the package ' +
      "that defines the server if it's in a monorepo subdirectory.",
  },
];

/**
 * `wizard mcp-analytics` — flat skill command.
 *
 * Instruments the user's own MCP server with the `@posthog/mcp` SDK so it
 * reports `$mcp_*` analytics about itself. This is the opposite of
 * `wizard mcp add` (which installs the PostHog MCP *server* into a coding
 * agent) — keep the two distinct.
 *
 * Flat while instrumenting is the only action. If an uninstrument / `remove`
 * leaf ever lands, restructure into a family with `familyCommandFactory` and
 * publish each leaf as a `cliEntries` entry with `parentCommand:
 * 'mcp-analytics'` from context-mill — a deliberate breaking change, done then,
 * not pre-emptively.
 */
const baseConfig = createSkillProgram({
  skillId: 'mcp-analytics',
  command: 'mcp-analytics',
  id: 'mcp-analytics',
  description: 'Add PostHog MCP analytics to your MCP server',
  integrationLabel: 'mcp-analytics',
  customPrompt:
    "Instrument this project's MCP server with PostHog MCP analytics. Run the " +
    '`mcp-analytics` skill end-to-end: detect the server style, install ' +
    'the appropriate SDK (`@posthog/mcp` and `posthog-node` for JavaScript/' +
    'TypeScript, or `posthog.mcp` from the `posthog` package for Python), ' +
    'instrument the server using its supported integration, wire the project ' +
    'API key and host, and verify. ' +
    'Make only additive changes — do not alter tool behavior. The final report ' +
    `is written to ./${MCP_ANALYTICS_REPORT_FILE}.`,
  successMessage: 'MCP analytics installed. Send your first tool call next.',
  reportFile: MCP_ANALYTICS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/mcp-analytics',
  spinnerMessage: 'Setting up MCP analytics...',
  estimatedDurationMinutes: 5,
  abortCases: MCP_ANALYTICS_ABORT_CASES,
  buildOutroData: (_session, credentials) => ({
    kind: OutroKind.Success,
    message: 'MCP analytics installed. Send your first tool call next.',
    reportFile: MCP_ANALYTICS_REPORT_FILE,
    primaryLink: {
      label: 'Open MCP analytics',
      url: `${credentials.host.appHost.replace(/\/$/, '')}/project/${
        credentials.projectId
      }/mcp-analytics`,
    },
    nextSteps: {
      heading: 'Get your first data',
      items: [
        'Set the environment variables listed in the setup report, then start or redeploy your server.',
        'Connect your agent and invoke a tool that is safe to run.',
        'Open MCP analytics in the selected project to check that the tool call arrived.',
      ],
    },
    docsUrl: 'https://posthog.com/docs/mcp-analytics/installation',
  }),
});

async function buildRun(session: WizardSession): Promise<ProgramRun> {
  if (!baseConfig.run)
    throw new Error('Missing MCP analytics run configuration');
  const run =
    typeof baseConfig.run === 'function'
      ? await baseConfig.run(session)
      : baseConfig.run;
  const target = session.frameworkContext[MCP_TARGET_KEY] as
    | McpTarget
    | undefined;
  return {
    ...run,
    customPrompt: (ctx) =>
      [
        run.customPrompt?.(ctx),
        target?.entryPoint
          ? `The user selected this server entry point: ${JSON.stringify(
              relative(session.installDir, target.entryPoint),
            )}. Verify it and instrument this server.`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
  };
}

export const mcpAnalyticsConfig: ProgramConfig = {
  ...baseConfig,
  steps: baseConfig.steps.map((step) =>
    step.id === 'intro'
      ? {
          ...step,
          screenId: 'mcp-analytics-intro',
          onReady: async (ctx) => {
            try {
              ctx.setFrameworkContext(
                MCP_SCAN_KEY,
                await scanMcpAnalyticsProject(ctx.session.installDir),
              );
            } catch (error) {
              ctx.setFrameworkContext(
                MCP_SCAN_ERROR_KEY,
                error instanceof Error
                  ? error.message
                  : 'Could not read this directory.',
              );
            }
          },
        }
      : step,
  ),
  run: buildRun,
};
