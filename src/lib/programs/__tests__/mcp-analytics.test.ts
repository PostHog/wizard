import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
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

  it('gives every case a stable reason code', () => {
    // `reason_code` on `wizard: agent aborted` is the funnel's grouping key, so
    // a case without one is invisible to it.
    const codes = MCP_ANALYTICS_ABORT_CASES.map((c) => c.code);
    expect(codes.every(Boolean)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // Observed on real aborts: the model appended a trailing clause on the same
  // line, so the captured reason carries more than the intended phrase. These
  // used to fall through to the generic "aborted" screen.
  it.each([
    'no mcp server found` case.',
    'no mcp server found — this project only has a client',
    'unsupported language for mcp analytics (Go)',
  ])('still matches when the model pads the reason: %j', (reason) => {
    const matched = MCP_ANALYTICS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
  });

  it('gives the no-server abort a way forward instead of a dead end', () => {
    // This is the single most common abort, and it is terminal for the user —
    // the copy has to cover the three things it actually means.
    const [noServer] = MCP_ANALYTICS_ABORT_CASES.filter(
      (c) => c.code === 'no_mcp_server',
    );
    expect(noServer).toBeDefined();
    const copy = noServer.body.toLowerCase();
    expect(copy).toContain('--install-dir');
    expect(copy).toContain('mcp add');
    expect(noServer.docsUrl).toBeTruthy();
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

  it('attaches the language probe without mutating the shared step list', () => {
    expect(mcpAnalyticsConfig.steps[0].onReady).toBeTypeOf('function');
    // AGENT_SKILL_STEPS is shared by every skill program — mutating it here
    // would fire this probe on `audit`, `revenue-analytics`, and the rest.
    expect(AGENT_SKILL_STEPS[0].onReady).toBeUndefined();
    expect(mcpAnalyticsConfig.steps.map((s) => s.id)).toEqual(
      AGENT_SKILL_STEPS.map((s) => s.id),
    );
  });
});
