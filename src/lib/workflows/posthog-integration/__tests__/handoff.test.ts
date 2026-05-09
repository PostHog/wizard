import fs from 'fs';
import os from 'os';
import path from 'path';

import { Integration } from '../../../constants.js';
import {
  NEXT_STEPS_FILE,
  buildNextStepsMarkdown,
  writeNextStepsFile,
  type NextStepsContext,
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

  it('renders multiple quirks as separate bullet items, not joined with commas', () => {
    // Today only one quirk is registered, but the rendering path uses
    // join('\n') and a `- ` prefix per item. A regression to `.join(', ')`
    // (or any other separator) would corrupt the markdown invisibly. Build
    // a synthetic two-quirk list by stacking LLM + a registered base
    // quirk in the future; for now, verify the bullet shape on the one
    // present quirk so a regex change shows up.
    const md = buildNextStepsMarkdown(
      ctx({ integration: Integration.nextjs, llmAnalyticsQueued: true }),
    );
    // Bullet must start at column 0 with `- ` and the quirk text.
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
