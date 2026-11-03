import {
  MCP_ANALYTICS_ABORT_CASES,
  MCP_SCAN_KEY,
  MCP_TARGET_KEY,
  config as mcpAnalytics,
} from '@programs/mcp-analytics';
import type { ProgramRun } from '@programs/program-contract';
import { testRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { buildSession, type WizardSession } from '@services/session';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';

const credentials = {
  projectId: 42,
  projectApiKey: 'phc_example',
  accessToken: 'example',
  host: HostResolution.fromApiHost('https://eu.i.posthog.com'),
};

async function runConfig(
  session: WizardSession = buildSession({}),
): Promise<ProgramRun> {
  const run = mcpAnalytics.run;
  if (!run) throw new Error('Expected an MCP analytics run');
  return typeof run === 'function' ? run(session, testRunnerContext()) : run;
}

function sessionWith(context: Record<string, unknown>): WizardSession {
  const session = buildSession({ installDir: '/example/server' });
  Object.assign(session.frameworkContext, context);
  return session;
}

describe('MCP_ANALYTICS_ABORT_CASES', () => {
  // These are the exact `[ABORT] <reason>` strings the mcp-analytics skill
  // emits (context-mill `context/skills/mcp-analytics/description.md`), with
  // the `[ABORT] ` prefix already stripped — matching what the runner passes
  // to `AbortCase.match` (src/agent/runner/sequence/linear.ts).
  const reasons = [
    'no mcp server found',
    'unsupported language for mcp analytics',
    'could not locate the server entry point',
    'go mcp server is not built on the official go-sdk',
    'go toolchain older than 1.25',
    'ruby mcp server is not built on the official mcp gem',
    'ruby older than 3.0',
    'ruby mcp gem older than 1.4',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = MCP_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });

  it('frames the unsupported-language abort as TypeScript, Python, Go, and Ruby supported', () => {
    // Python (`posthog.mcp`), Go (`posthogmcpsdk`), and Ruby (`PostHog::MCP`)
    // have shipped — the copy must name every supported language and not call
    // any of them "on the roadmap".
    const [langCase] = MCP_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test('unsupported language for mcp analytics'),
    );
    expect(langCase).toBeDefined();
    const copy = `${langCase.message} ${langCase.body}`;
    expect(copy.toLowerCase()).not.toContain('roadmap');
    // The package names are the contract; a bare language word would also
    // match inside `go-sdk` or `posthog-ruby`.
    for (const sdk of [
      '@posthog/mcp',
      'posthog.mcp',
      'posthogmcpsdk',
      'PostHog::MCP',
    ]) {
      expect(copy).toContain(sdk);
    }
  });
});

describe('mcp-analytics config', () => {
  it('wires the mcp-analytics abort cases into the run config', async () => {
    expect((await runConfig()).abortCases).toBe(MCP_ANALYTICS_ABORT_CASES);
  });

  it('runs the agent in the selected server directory', () => {
    const targetDir = mcpAnalytics.runSteps?.run?.targetDir;
    expect(
      targetDir?.(
        sessionWith({
          [MCP_TARGET_KEY]: { directory: '/example/apps/search' },
        }),
      ),
    ).toBe('/example/apps/search');
    expect(targetDir?.(sessionWith({}))).toBe('/example/server');
  });

  it.each([
    [
      'a selected entry point',
      {
        [MCP_TARGET_KEY]: {
          directory: '/example/server',
          entryPoint: '/example/server/src/tools.ts',
        },
      },
      ['"src/tools.ts"', 'Verify it and instrument this server'],
    ],
    [
      'a selected application',
      { [MCP_TARGET_KEY]: { directory: '/example/server' } },
      ['follow local workspace imports', 'do not instrument every consumer'],
    ],
    [
      'a launcher',
      {
        [MCP_SCAN_KEY]: {
          directory: '/example/server',
          candidates: [],
          discoveryHint: 'launcher',
        },
      },
      ['Trace its imports and package metadata', 'Do not edit node_modules'],
    ],
    [
      'shared library code',
      {
        [MCP_SCAN_KEY]: {
          directory: '/example/server',
          candidates: [],
          discoveryHint: 'shared_library',
        },
      },
      ['Find the runnable consumer', 'Do not treat the shared constructor'],
    ],
  ])('guides the agent to %s', async (_case, context, expected) => {
    const prompt = (await runConfig(sessionWith(context))).customPrompt?.(
      credentials,
    );
    expect(prompt).toContain('Make only additive changes');
    for (const text of expected) expect(prompt).toContain(text);
  });

  it('keeps agent discovery available without a selection', async () => {
    const prompt = (await runConfig()).customPrompt?.(credentials);
    expect(prompt).toContain('detect the language and server style');
    expect(prompt).not.toContain('The user selected');
  });

  it('links completion to the authenticated project and explains how to send data', async () => {
    const session = buildSession({});
    const outro = (await runConfig(session)).buildOutroData?.(
      session,
      credentials,
    );
    expect(outro?.kind).toBe(OutroKind.Success);
    expect(outro?.primaryLink?.url).toBe(
      'https://eu.posthog.com/project/42/mcp-analytics',
    );
    const steps = outro?.nextSteps?.items.join(' ');
    expect(steps).toContain('start or redeploy');
    expect(steps).toContain('check that the tool call arrived');
  });
});
