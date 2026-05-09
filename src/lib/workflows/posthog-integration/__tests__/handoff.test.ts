import fs from 'fs';
import os from 'os';
import path from 'path';

import { Integration } from '../../../constants.js';
import { buildSession } from '../../../wizard-session.js';
import {
  NEXT_STEPS_FILE,
  NEXT_STEPS_HANDOFF_KEY,
  buildCodingAgentPrompt,
  buildCopyPasteBlock,
  buildHandoffBullet,
  buildNextStepsMarkdown,
  getNextStepsHandoff,
  setNextStepsHandoff,
  writeNextStepsFile,
  type NextStepsContext,
  type NextStepsHandoffStatus,
} from '../handoff.js';

function ctx(overrides: Partial<NextStepsContext> = {}): NextStepsContext {
  return {
    frameworkName: 'Next.js',
    integration: Integration.nextjs,
    reportFile: 'posthog-setup-report.md',
    envVarNames: [
      'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN',
      'NEXT_PUBLIC_POSTHOG_HOST',
    ],
    llmAnalyticsQueued: false,
    ...overrides,
  };
}

describe('buildNextStepsMarkdown', () => {
  it('renders the headline, the manifest pointer, and the required sections', () => {
    const md = buildNextStepsMarkdown(ctx());

    expect(md).toMatch(/^# PostHog setup: next steps/);
    expect(md).toContain('Next.js project');
    expect(md).toContain('## Verify before merging');
    expect(md).toContain('## Known SDK quirks');
    expect(md).toContain('## Project glue we did NOT touch');
    expect(md).toContain('## Token-absent behavior');
  });

  it('points the reader at the wizard run output for the agent prompt', () => {
    const md = buildNextStepsMarkdown(ctx());
    expect(md).toMatch(/coding agent[\s\S]*wizard.*run/i);
  });

  it('lists the configured env var names verbatim in the project glue section', () => {
    const md = buildNextStepsMarkdown(
      ctx({ envVarNames: ['POSTHOG_API_KEY', 'POSTHOG_HOST'] }),
    );
    expect(md).toContain('`POSTHOG_API_KEY`');
    expect(md).toContain('`POSTHOG_HOST`');
    expect(md).not.toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
  });

  it('omits the LLM smoke-test bullet when llmAnalyticsQueued is false', () => {
    const md = buildNextStepsMarkdown(ctx({ llmAnalyticsQueued: false }));
    expect(md).not.toContain('$ai_generation');
  });

  it('includes a strategy-agnostic LLM smoke-test bullet when llmAnalyticsQueued is true', () => {
    // The wizard can pick between multiple LLM-analytics strategies for
    // the same JS framework (PostHogAnthropic wrapper vs OTel
    // auto-instrumentation). The handoff bullet must not assume a
    // strategy — only the strategy-agnostic `$ai_generation` smoke-test
    // appears, and it points the reader at the report for specifics.
    const jsLlm = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    expect(jsLlm).toContain('$ai_generation');
    expect(jsLlm).toMatch(
      /See `posthog-setup-report\.md` for the specific LLM-analytics approach/,
    );

    const djangoLlm = buildNextStepsMarkdown(
      ctx({
        frameworkName: 'Django',
        integration: Integration.django,
        llmAnalyticsQueued: true,
      }),
    );
    expect(djangoLlm).toContain('$ai_generation');
  });

  it('does not bake any strategy-specific LLM advice into the handoff', () => {
    // Regression catch: do not re-introduce wrapper-vs-OTel-specific
    // guidance here (it belongs in the agent-written setup report).
    const md = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    expect(md).not.toContain('PostHogAnthropic');
    expect(md).not.toContain('messages.stream');
    expect(md).not.toContain('new Anthropic()');
    expect(md).not.toContain('@anthropic-ai/sdk');
  });

  it('renders the "no quirks recorded" stub on every integration today', () => {
    // No quirks are registered yet; the stub should be the default
    // render across every integration. Will need updating when the
    // wizard team registers strategy-agnostic quirks.
    for (const integration of [
      Integration.nextjs,
      Integration.django,
      Integration.swift,
    ]) {
      const md = buildNextStepsMarkdown(
        ctx({ integration, llmAnalyticsQueued: true }),
      );
      expect(md).toContain(
        'No additional quirks recorded for this integration',
      );
      expect(md).toContain('https://github.com/PostHog/wizard/issues');
    }
  });

  it('drops the source-maps glue item on backend-only integrations', () => {
    const django = buildNextStepsMarkdown(
      ctx({ frameworkName: 'Django', integration: Integration.django }),
    );
    expect(django).not.toContain('posthog-cli sourcemap');
  });

  it('keeps the source-maps glue item on browser-bundled integrations', () => {
    const next = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs }),
    );
    expect(next).toContain('posthog-cli sourcemap');
  });

  it('drops the source-maps glue item on react-native (JS but not browser-bundled)', () => {
    // react-native is in JS_INTEGRATIONS but NOT in SOURCE_MAP_INTEGRATIONS.
    // A future refactor that consolidates the two sets would silently start
    // emitting `posthog-cli sourcemap` advice for RN; this test pins it.
    const md = buildNextStepsMarkdown(
      ctx({
        frameworkName: 'React Native',
        integration: Integration.reactNative,
      }),
    );
    expect(md).not.toContain('posthog-cli sourcemap');
  });

  it('uses singular "placeholder" for one env var, plural for many, and a generic fallback for none', () => {
    // The placeholder/placeholders branch in `envCallout` is easy to flip
    // (off-by-one when refactoring `length === 1 ? '' : 's'`). The
    // length === 0 branch is dead-code unless someone wires a stack with
    // no env vars; assert all three so a regression surfaces immediately.
    const one = buildNextStepsMarkdown(ctx({ envVarNames: ['POSTHOG_KEY'] }));
    expect(one).toMatch(/`POSTHOG_KEY` placeholder\b/);
    expect(one).not.toMatch(/placeholders\b/);

    const many = buildNextStepsMarkdown(ctx({ envVarNames: ['A', 'B'] }));
    expect(many).toMatch(/`A` \/ `B` placeholders\b/);

    const none = buildNextStepsMarkdown(ctx({ envVarNames: [] }));
    expect(none).toContain('the env vars the wizard added');
    expect(none).not.toMatch(/placeholders?\b/);
  });
});

describe('buildCodingAgentPrompt', () => {
  it('returns a single-paragraph prompt naming both files', () => {
    const prompt = buildCodingAgentPrompt(ctx());
    expect(prompt).toContain('`posthog-setup-report.md`');
    expect(prompt).toContain('`posthog-next-steps.md`');
    // Single paragraph — no embedded newlines, so triple-click selection
    // works in any editor / terminal.
    expect(prompt).not.toMatch(/\n/);
  });

  it('respects an alternate reportFile name', () => {
    const prompt = buildCodingAgentPrompt(
      ctx({ reportFile: 'posthog-revenue-report.md' }),
    );
    expect(prompt).toContain('`posthog-revenue-report.md`');
    expect(prompt).not.toContain('`posthog-setup-report.md`');
  });
});

describe('handoff doc does NOT embed the agent prompt', () => {
  it('omits the "Hand this to your coding agent" section entirely', () => {
    // Embedding the prompt inside the file it instructs an agent to read
    // is a circular reference: the agent re-tokenizes the same prompt
    // every time it re-reads the file. The prompt lives in the wizard's
    // terminal output instead.
    const md = buildNextStepsMarkdown(ctx());
    expect(md).not.toContain('## Hand this to your coding agent');
    expect(md).not.toContain(
      'Read `posthog-setup-report.md` and `posthog-next-steps.md`',
    );
    // Sanity: the prompt builder still works — it's just sourced from the
    // wizard's CLI, not from a doc-embedded copy.
    expect(buildCodingAgentPrompt(ctx())).toContain(
      'Read `posthog-setup-report.md` and `posthog-next-steps.md`',
    );
  });
});

describe('buildCopyPasteBlock', () => {
  it('frames the prompt with rules for terminal-scrollback visibility', () => {
    const block = buildCopyPasteBlock('PROMPT BODY');
    const lines = block.split('\n');
    // First and last lines are horizontal rules.
    expect(lines[0]).toMatch(/^─+$/);
    expect(lines[lines.length - 1]).toMatch(/^─+$/);
    // Header line names the action.
    expect(block).toContain('Copy this into your coding agent');
    // Body is on its own line, surrounded by blanks so triple-click on
    // the prompt line selects just the prompt.
    expect(block).toContain('\n\nPROMPT BODY\n\n');
  });
});

describe('buildHandoffBullet', () => {
  it('renders a "Wrote ..." line for ok:true', () => {
    const bullet = buildHandoffBullet({ ok: true, path: '/tmp/x.md' });
    expect(bullet).toBe(
      `Wrote ${NEXT_STEPS_FILE} with verification + handoff steps`,
    );
  });

  it('renders a "Could NOT write ..." line for ok:false, embedding the error', () => {
    const bullet = buildHandoffBullet({ ok: false, error: 'EACCES' });
    expect(bullet).toBe(
      `Could NOT write ${NEXT_STEPS_FILE} (EACCES) — handoff steps are missing`,
    );
  });

  it('renders an empty string for undefined so .filter(Boolean) drops it cleanly', () => {
    expect(buildHandoffBullet(undefined)).toBe('');
  });
});

describe('handoff status accessors', () => {
  function fakeSession() {
    // buildSession asks for the bare minimum — installDir is the only field
    // it requires us to pass through, but we don't touch the filesystem.
    return buildSession({ installDir: os.tmpdir() });
  }

  it('round-trips set + get on the same session', () => {
    const session = fakeSession();
    const status: NextStepsHandoffStatus = { ok: true, path: '/tmp/x.md' };
    setNextStepsHandoff(session, status);
    expect(getNextStepsHandoff(session)).toEqual(status);
  });

  it('returns undefined when nothing has been stashed', () => {
    expect(getNextStepsHandoff(fakeSession())).toBeUndefined();
  });

  it('returns undefined when frameworkContext holds a value with the wrong shape', () => {
    // Defense-in-depth: if any other code overwrites the key with a
    // differently-shaped value (string, mismatched discriminant, missing
    // required field), `getNextStepsHandoff` rejects rather than passing
    // garbage to `buildHandoffBullet`.
    const cases: unknown[] = [
      'a string',
      42,
      null,
      { ok: 'yes' }, // wrong discriminant type
      { ok: true }, // missing path
      { ok: false }, // missing error
      { ok: true, path: 123 }, // wrong path type
    ];
    for (const bogus of cases) {
      const session = fakeSession();
      session.frameworkContext[NEXT_STEPS_HANDOFF_KEY] = bogus;
      expect(getNextStepsHandoff(session)).toBeUndefined();
    }
  });
});

describe('writeNextStepsFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-handoff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the file at <installDir>/posthog-next-steps.md and returns the path', () => {
    const result = writeNextStepsFile(tmpDir, ctx());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true result');
    expect(result.path).toBe(path.join(tmpDir, NEXT_STEPS_FILE));

    const written = fs.readFileSync(result.path, 'utf8');
    expect(written).toMatch(/^# PostHog setup: next steps/);
  });

  it('returns ok:false rather than throwing when the destination directory is missing', () => {
    // Use a tmpDir-relative missing intermediate path so the failure is
    // deterministic and self-contained — no reliance on host filesystem.
    const target = path.join(tmpDir, 'does', 'not', 'exist');
    const result = writeNextStepsFile(target, ctx());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false result');
    expect(result.error).toBeTruthy();
  });
});
