import {
  MCP_ANALYTICS_ABORT_CASES,
  mcpAnalyticsConfig,
} from '@lib/programs/mcp-analytics/index';

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
  it('wires the mcp-analytics abort cases into the run config', () => {
    // `run` is statically a defined object for this program (createSkillProgram
    // always sets it, and never uses the session-derived function form).
    const run = mcpAnalyticsConfig.run;
    if (!run || typeof run === 'function') {
      throw new Error('expected a static run object');
    }
    expect(run.abortCases).toBe(MCP_ANALYTICS_ABORT_CASES);
  });
});
