import {
  MCP_ANALYTICS_ABORT_CASES,
  mcpAnalyticsConfig,
} from '@lib/programs/mcp-analytics/index';
import {
  buildSession,
  OutroKind,
  type WizardSession,
} from '@lib/wizard-session';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { HostResolution } from '@lib/host-resolution';
import {
  MCP_TARGET_KEY,
  MCP_SCAN_KEY,
} from '@lib/programs/mcp-analytics/setup';

const credentials = {
  projectId: 42,
  projectApiKey: 'phc_example',
  accessToken: 'example',
  host: HostResolution.fromApiHost('https://eu.i.posthog.com'),
};

async function runConfig(
  session: WizardSession = buildSession({}),
): Promise<ProgramRun> {
  const run = mcpAnalyticsConfig.run;
  if (!run) throw new Error('Expected an MCP analytics run');
  return typeof run === 'function' ? run(session) : run;
}

describe('MCP_ANALYTICS_ABORT_CASES', () => {
  // These are the exact `[ABORT] <reason>` strings the mcp-analytics skill
  // emits (context-mill `context/skills/mcp-analytics/description.md`), with
  // the `[ABORT] ` prefix already stripped — matching what the runner passes
  // to `AbortCase.match` (src/lib/agent/runner/sequence/linear.ts).
  const reasons = [
    'no mcp server found',
    'unsupported language for mcp analytics',
    'could not locate the server entry point',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = MCP_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });

  it('frames the unsupported-language abort as JS/TS *and* Python supported', () => {
    // Python (`posthog.mcp`) shipped in posthog v7.21.0 — the copy must not
    // claim JS/TS-only or call Python "on the roadmap".
    const [langCase] = MCP_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test('unsupported language for mcp analytics'),
    );
    expect(langCase).toBeDefined();
    const copy = `${langCase.message} ${langCase.body}`.toLowerCase();
    expect(copy).toContain('python');
    expect(copy).toContain('typescript');
    expect(copy).not.toContain('roadmap');
  });
});

describe('mcpAnalyticsConfig', () => {
  it('wires the mcp-analytics abort cases into the run config', async () => {
    const run = await runConfig();
    expect(run.abortCases).toBe(MCP_ANALYTICS_ABORT_CASES);
  });

  it('asks the agent to verify the selected server relative to its project', async () => {
    const session = buildSession({ installDir: '/example/server' });
    session.frameworkContext[MCP_TARGET_KEY] = {
      directory: '/example/server',
      entryPoint: '/example/server/src/tools.ts',
    };
    const run = await runConfig(session);
    const prompt = run.customPrompt?.(credentials);
    expect(prompt).toContain('"src/tools.ts"');
    expect(prompt).toContain('Verify it and instrument this server');
    expect(prompt).toContain('Make only additive changes');
  });

  it('keeps agent discovery available without a selected entry point', async () => {
    const run = await runConfig();
    const prompt = run.customPrompt?.(credentials);
    expect(prompt).toContain('detect the server style');
    expect(prompt).not.toContain('The user selected');
  });

  it('keeps a selected application scoped while following workspace imports', async () => {
    const session = buildSession({ installDir: '/example/apps/search' });
    session.frameworkContext[MCP_TARGET_KEY] = {
      directory: '/example/apps/search',
    };
    const prompt = (await runConfig(session)).customPrompt?.(credentials);
    expect(prompt).toContain('follow local workspace imports');
    expect(prompt).toContain('do not instrument every consumer');
  });

  it.each([
    [
      'launcher',
      'Trace its imports and package metadata',
      'Do not edit node_modules',
    ],
    [
      'shared_library',
      'Find the runnable consumer',
      'Do not treat the shared constructor',
    ],
  ])(
    'passes %s discovery guidance to the agent',
    async (discoveryHint, expected, guard) => {
      const session = buildSession({ installDir: '/example/server' });
      session.frameworkContext[MCP_SCAN_KEY] = {
        directory: '/example/server',
        candidates: [],
        discoveryHint,
      };
      session.frameworkContext[MCP_TARGET_KEY] = {
        directory: '/example/server',
      };
      const prompt = (await runConfig(session)).customPrompt?.(credentials);
      expect(prompt).toContain(expected);
      expect(prompt).toContain(guard);
    },
  );

  it('links completion to the authenticated project and explains how to send data', async () => {
    const session = buildSession({});
    const run = await runConfig(session);
    const outro = run.buildOutroData?.(session, credentials);
    expect(outro?.kind).toBe(OutroKind.Success);
    expect(outro?.primaryLink?.url).toBe(
      'https://eu.posthog.com/project/42/mcp-analytics',
    );
    expect(outro?.nextSteps?.items.join(' ')).toContain('start or redeploy');
    expect(outro?.nextSteps?.items.join(' ')).toContain(
      'check that the tool call arrived',
    );
  });
});
