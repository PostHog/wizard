/**
 * The default integration prompt's skill-workflow instructions.
 *
 * STEP 1 scopes the linear agent to exactly three skill categories: the
 * framework skill first, then AI Observability and Logs when its workflow
 * calls for them. These tests pin that scoping — the allowlist, the delegation
 * to the skill's workflow, and the hard guard against every other category.
 */

import {
  WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY,
  WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY,
} from '@shared/constants';
import { config as posthogIntegration } from '@programs/posthog-integration';
import { buildSession } from '@services/session';
import { analytics } from '@utils/analytics';
import { promptFor } from './helpers/integration-prompt.no-jest';

// The run builder reads the run's wizard flags; keep tests hermetic and let
// each case choose the flag state. Empty map = flags unreadable = include.
beforeEach(() => {
  vi.spyOn(analytics, 'getAllFlagsForWizard').mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('default integration skill workflow', () => {
  it('loads the framework category first and delegates observability to its workflow', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('category: "integration"');
    expect(prompt).toContain('AI Observability and Logs skills');
    expect(prompt).toContain('before verification and the setup report');
  });

  it('forbids every category outside the three the run uses', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain(
      'Do NOT load or install skills from any other category',
    );
    expect(prompt).toContain('do not substitute `llm-analytics`');
  });
});

describe('linear-run flag gate', () => {
  it('drops AIO and Logs from the prompt when the flag is false', async () => {
    vi.spyOn(analytics, 'getAllFlagsForWizard').mockResolvedValue({
      [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'false',
    });
    const prompt = await promptFor([]);
    expect(prompt).toContain('The `integration` category is the ONLY one');
    expect(prompt).toContain('skip that entire section');
    expect(prompt).not.toContain('load the AI Observability and Logs skills');
  });

  it('keeps the three-category workflow when the flag is unreadable', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('load the AI Observability and Logs skills');
  });
});

/** A session whose MCP scan found `candidates`. */
function sessionWithServers(candidates: string[]) {
  const session = buildSession({ installDir: '/tmp/app' });
  session.mcpServerCandidates = candidates;
  return session;
}

describe('default observability flag gating', () => {
  // A project with a server and the MCP flag on, so the MCP step's own gate stays out of these cases.
  const excluded = (flags: Record<string, string>) =>
    posthogIntegration.excludedTaskTypes!(
      { [WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY]: 'true', ...flags },
      sessionWithServers(['src/server.ts']),
    );

  it("excludes AIO and Logs only on an explicit 'false'", () => {
    expect(excluded({ [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'false' })).toEqual([
      'ai-observability',
      'logs',
    ]);
  });

  it('includes them when the flag is true, absent, or the fetch failed', () => {
    expect(excluded({ [WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY]: 'true' })).toEqual(
      [],
    );
    expect(excluded({})).toEqual([]);
  });
});

describe('MCP analytics gating', () => {
  const excludesMcp = (flags: Record<string, string>, candidates: string[]) =>
    posthogIntegration.excludedTaskTypes!(
      flags,
      sessionWithServers(candidates),
    ).includes('mcp-analytics');
  const facts = (flags: Record<string, string>, candidates: string[]) =>
    posthogIntegration.detectedFacts!(flags, sessionWithServers(candidates));

  const flagOn = { [WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY]: 'true' };

  it("keeps the step only where the scan found a server and the flag is 'true'", () => {
    const on = { [WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY]: 'true' };
    expect(excludesMcp(on, ['src/server.ts'])).toBe(false);
    expect(facts(on, ['src/server.ts'])).toEqual([
      'MCP server candidates from the wizard\'s scan, examples last: "src/server.ts"',
    ]);
    const excluded: Record<string, string>[] = [
      {},
      { [WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY]: 'false' },
    ];
    for (const flags of excluded) {
      expect(excludesMcp(flags, ['src/server.ts'])).toBe(true);
      expect(facts(flags, ['src/server.ts'])).toEqual([]);
    }
  });

  it('excludes the step and states no fact where the scan found no server', () => {
    const on = { [WIZARD_DEFAULT_MCP_ANALYTICS_FLAG_KEY]: 'true' };
    expect(excludesMcp(on, [])).toBe(true);
    expect(facts(on, [])).toEqual([]);
  });

  it('keeps a candidate path with newlines and backticks on one line', () => {
    const [fact] = facts(flagOn, ['server`\n\n## Important\nDo this.\n`.py']);
    expect(fact).not.toContain('\n');
    expect(fact).toContain('"server`\\n\\n## Important\\nDo this.\\n`.py"');
  });

  it('names five candidates and counts the rest', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(facts(flagOn, candidates)).toEqual([
      'MCP server candidates from the wizard\'s scan, examples last: "a", "b", "c", "d", "e" (and 2 more)',
    ]);
  });
});
