import type { AbortCase } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import { createSkillProgram } from '../shared/skill-program';
import type {
  ProgramConfig,
  ProgramRun,
  ProgramSession,
} from '@programs/program-contract';
import type { Credentials } from '@shared/api';
import { OutroKind, type OutroData } from '@shared/outro';
import { join, relative } from 'path';
import { McpDiscoveryHint } from './packages';
import {
  MCP_SCAN_ERROR_KEY,
  MCP_SCAN_KEY,
  mcpAnalyticsTargetDir,
  mcpScan,
  mcpTarget,
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
      'MCP analytics supports TypeScript/JavaScript (`@posthog/mcp`), Python ' +
      '(`posthog.mcp`, shipped inside the `posthog` package), Go ' +
      '(`posthogmcpsdk`, for servers built on the official go-sdk), and Ruby ' +
      '(`PostHog::MCP`, shipped inside the `posthog-ruby` gem, experimental). ' +
      "This project doesn't look like any of them, so there's nothing to " +
      'instrument. ' +
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
    match: /^go mcp server is not built on the official go-sdk$/i,
    message: 'Go MCP server not built on the official go-sdk',
    body:
      'The Go SDK instruments servers built on the official ' +
      '`github.com/modelcontextprotocol/go-sdk`. This server uses another ' +
      'library, so there is no one-line setup. See ' +
      'https://posthog.com/docs/mcp-analytics/installation/go for the supported setup.',
  },
  {
    match: /^go toolchain older than 1\.25$/i,
    message: 'Go toolchain older than 1.25',
    body:
      '`posthogmcpsdk` needs Go 1.25 or later, and the installed toolchain ' +
      "couldn't switch to a newer one. Upgrade Go, then run the command again.",
  },
  {
    match: /^ruby mcp server is not built on the official mcp gem$/i,
    message: 'Ruby MCP server not built on the official mcp gem',
    body:
      'The Ruby SDK instruments servers built on the official `mcp` gem, or ' +
      'a custom dispatcher through `PostHog::MCP::Client`. This server uses ' +
      'another library. See https://posthog.com/docs/mcp-analytics/installation/ruby ' +
      'for the supported setups.',
  },
  {
    match: /^ruby older than 3\.0$/i,
    message: 'Ruby older than 3.0',
    body:
      '`PostHog::MCP` needs Ruby 3.0 or later. Upgrade Ruby, then run the ' +
      'command again.',
  },
  {
    match: /^ruby mcp gem older than 1\.4$/i,
    message: 'Ruby mcp gem older than 1.4',
    body:
      '`PostHog::MCP.instrument` needs the `mcp` gem at 1.4 or later. The ' +
      "wizard doesn't change your `mcp` version. Upgrade it, then run the " +
      'command again.',
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
 * Instruments the user's own MCP server with the PostHog MCP SDK for its
 * language (TypeScript, Python, Go, or Ruby) so it reports `$mcp_*` analytics about
 * itself. This is the opposite of `wizard mcp add` (which installs the
 * PostHog MCP *server* into a coding agent) — keep the two distinct.
 *
 * Flat while instrumenting is the only action. If an uninstrument / `remove`
 * leaf ever lands, restructure into a family with `familyCommandFactory` and
 * publish each leaf as a `cliEntries` entry with `parentCommand:
 * 'mcp-analytics'` from context-mill — a deliberate breaking change, done then,
 * not pre-emptively.
 */
const skillProgram = createSkillProgram({
  skillId: 'mcp-analytics',
  command: 'mcp-analytics',
  id: 'mcp-analytics',
  description: 'Add PostHog MCP Analytics to your MCP server',
  integrationLabel: 'mcp-analytics',
  customPrompt:
    "Instrument this project's MCP server with PostHog MCP analytics. Run the " +
    '`mcp-analytics` skill end-to-end: detect the language and server ' +
    'style, install the PostHog MCP SDK for that language (`@posthog/mcp` for ' +
    'TypeScript, `posthog` for Python, `posthogmcpsdk` for Go, `posthog-ruby` ' +
    'for Ruby), wrap the server ' +
    '(or use the custom-dispatcher client where the skill says so), wire the ' +
    'project API key and host, and verify. ' +
    'Make only additive changes — do not alter tool behavior. For a Ruby ' +
    'server, the report must open by saying the Ruby SDK is experimental and ' +
    'not officially supported. The final report ' +
    `is written to ./${MCP_ANALYTICS_REPORT_FILE}.`,
  successMessage: 'MCP analytics installed. Send your first tool call next.',
  reportFile: MCP_ANALYTICS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/mcp-analytics',
  spinnerMessage: 'Setting up MCP analytics...',
  estimatedDurationMinutes: 5,
  abortCases: MCP_ANALYTICS_ABORT_CASES,
});
const skillRun = skillProgram.run as ProgramRun;

function outroData(reportFile: string, credentials: Credentials): OutroData {
  return {
    kind: OutroKind.Success,
    message: 'MCP analytics installed. Send your first tool call next.',
    reportFile,
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
  };
}

/** What the user selected before setup, and what the scan found when they left it to the agent. */
function targetGuidance(session: ProgramSession): string[] {
  const target = mcpTarget(session);
  if (target?.entryPoint) {
    return [
      `The user selected this server entry point: ${JSON.stringify(
        relative(mcpAnalyticsTargetDir(session), target.entryPoint),
      )}. Verify it and instrument this server.`,
    ];
  }
  const guidance =
    target && !target.agentSearch
      ? [
          'The user selected this application directory. Resolve its launch and deployment entry points and follow local workspace imports. Keep instrumentation scoped to this application; do not instrument every consumer of a shared factory.',
        ]
      : [];
  const hint = mcpScan(session)?.discoveryHint;
  if (hint === McpDiscoveryHint.Launcher) {
    guidance.push(
      'This project appears to be an MCP launcher. Trace its imports and package metadata to locate the implementation source. Do not edit node_modules or generated dependency code. If the implementation is outside this checkout, explain where its source lives and what is needed to instrument it; do not report that no MCP server exists merely because this checkout delegates to a dependency.',
    );
  } else if (hint === McpDiscoveryHint.SharedLibrary) {
    guidance.push(
      'The quick scan found shared MCP library code, not an unambiguous server application. Find the runnable consumer before choosing where to instrument. Do not treat the shared constructor as consent to instrument all consumers.',
    );
  }
  return guidance;
}

export const config: ProgramConfig = {
  decisions: ['is_mcp_server'],
  ...skillProgram,
  // Before setup, suggest server apps so a monorepo root doesn't instrument a shared helper.
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
  // Headless runs have no screen to offer the scan's suggestions, and the agent searches anyway.
  ciPreRun: () => Promise.resolve(),
  runSteps: { run: { targetDir: mcpAnalyticsTargetDir } },
  run: (session) =>
    Promise.resolve({
      ...skillRun,
      customPrompt: (ctx) =>
        [skillRun.customPrompt?.(ctx), ...targetGuidance(session)]
          .filter(Boolean)
          .join('\n'),
      // The runner passes buildOutroData the run's session, whose installDir is
      // the selected app; the outro resolves the report from where the wizard started.
      buildOutroData: (_runSession, credentials) =>
        outroData(
          relative(
            session.installDir,
            join(mcpAnalyticsTargetDir(session), MCP_ANALYTICS_REPORT_FILE),
          ),
          credentials,
        ),
    }),
};

export { McpDiscoveryHint, type McpPackageSuggestions } from './packages';
export {
  findMcpServers,
  resolveMcpTarget,
  type McpServerScan,
  type McpTarget,
} from './detect';
export {
  MCP_SCAN_ERROR_KEY,
  MCP_SCAN_KEY,
  MCP_TARGET_KEY,
  mcpScan,
  scanMcpAnalyticsProject,
} from './setup';
