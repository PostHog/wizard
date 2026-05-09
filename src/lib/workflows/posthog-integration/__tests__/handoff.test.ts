import fs from 'fs';
import os from 'os';
import path from 'path';

import { Integration } from '../../../constants.js';
import { buildSession } from '../../../wizard-session.js';
import {
  NEXT_STEPS_FILE,
  NEXT_STEPS_HANDOFF_KEY,
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
  it('renders the headline, the manifest pointer, and the four required sections', () => {
    const md = buildNextStepsMarkdown(ctx());

    expect(md).toMatch(/^# PostHog setup: next steps/);
    expect(md).toContain('Next.js project');
    expect(md).toContain('## Verify before merging');
    expect(md).toContain('## Known SDK quirks');
    expect(md).toContain('## Project glue we did NOT touch');
    expect(md).toContain('## Hand this to your coding agent');
  });

  it('embeds both filenames in the agent-handoff block on a single line', () => {
    // The agent-handoff block is the load-bearing part of the file: a
    // regression that drops it would silently defeat the whole purpose.
    // Asserting both filenames appear on the same line catches a regression
    // that just keeps the manifest pointer at the top of the file.
    const md = buildNextStepsMarkdown(ctx());
    expect(md).toMatch(
      /Read `posthog-setup-report\.md` and `posthog-next-steps\.md`/,
    );
  });

  it('lists the configured env var names verbatim in the project glue section', () => {
    const md = buildNextStepsMarkdown(
      ctx({ envVarNames: ['POSTHOG_API_KEY', 'POSTHOG_HOST'] }),
    );
    expect(md).toContain('`POSTHOG_API_KEY`');
    expect(md).toContain('`POSTHOG_HOST`');
    expect(md).not.toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
  });

  it('omits LLM smoke-test items when llmAnalyticsQueued is false', () => {
    const md = buildNextStepsMarkdown(ctx({ llmAnalyticsQueued: false }));
    expect(md).not.toContain('$ai_generation');
    expect(md).not.toContain('@anthropic-ai/sdk');
    expect(md).not.toContain('messages.stream');
  });

  it('includes LLM smoke-test items when llmAnalyticsQueued is true on a JS integration', () => {
    const md = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    expect(md).toContain('$ai_generation');
    expect(md).toMatch(/Search for any remaining direct LLM SDK constructors/);
  });

  it('skips the JS-only Anthropic-grep step on non-JS integrations even when LLM is queued', () => {
    const md = buildNextStepsMarkdown(
      ctx({
        frameworkName: 'Django',
        integration: Integration.django,
        llmAnalyticsQueued: true,
      }),
    );
    // Generic LLM smoke-test stays.
    expect(md).toContain('$ai_generation');
    // JS-specific grep is dropped — Django users don't import @anthropic-ai/sdk.
    expect(md).not.toContain('@anthropic-ai/sdk');
    expect(md).not.toContain('new Anthropic()');
  });

  it('emits the LLM streaming quirk only on JS integrations with LLM queued', () => {
    const jsLlm = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    expect(jsLlm).toMatch(/\n- `@posthog\/ai`'s `PostHogAnthropic`/);

    const jsNoLlm = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: false }),
    );
    expect(jsNoLlm).not.toContain('PostHogAnthropic');

    const nonJsLlm = buildNextStepsMarkdown(
      ctx({
        frameworkName: 'Django',
        integration: Integration.django,
        llmAnalyticsQueued: true,
      }),
    );
    expect(nonJsLlm).not.toContain('PostHogAnthropic');
  });

  it('falls back to a "no quirks recorded" stub linking the issue tracker when the merged quirk list is empty', () => {
    const md = buildNextStepsMarkdown(
      ctx({ integration: Integration.swift, llmAnalyticsQueued: false }),
    );
    expect(md).toContain('No additional quirks recorded for this integration');
    expect(md).toContain('https://github.com/PostHog/wizard/issues');
  });

  it('renders quirks with a leading hyphen-bullet (regression catch for .join changes)', () => {
    // Today the registry has one quirk renderable in one path (LLM-on-JS).
    // Verify the rendered shape — a regression to `.join(', ')` or any
    // other separator would corrupt the bullet list invisibly.
    const md = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    expect(md).toMatch(/\n- `@posthog\/ai`/);
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
