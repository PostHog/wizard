import {
  MCP_ANALYTICS_ABORT_CASES,
  config as mcpAnalytics,
} from '@programs/mcp-analytics';

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
  it('wires the mcp-analytics abort cases into the run config', () => {
    // `run` is statically a defined object for this program (createSkillProgram
    // always sets it, and never uses the session-derived function form).
    const run = mcpAnalytics.run;
    if (!run || typeof run === 'function') {
      throw new Error('expected a static run object');
    }
    expect(run.abortCases).toBe(MCP_ANALYTICS_ABORT_CASES);
  });
});
