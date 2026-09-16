import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutroKind } from '@lib/wizard-session';
import { gateReportOnDisk } from '../outro';

describe('gateReportOnDisk', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wizard-outro-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('strips reportFile and handoffPrompt when the report is missing', () => {
    const gated = gateReportOnDisk(
      {
        kind: OutroKind.Success,
        message: 'Successfully installed PostHog!',
        reportFile: 'posthog-setup-report.md',
        handoffPrompt: 'Read `posthog-setup-report.md` and work the checklist.',
      },
      dir,
    );

    expect(gated?.reportFile).toBeUndefined();
    expect(gated?.handoffPrompt).toBeUndefined();
    // Other fields are left untouched.
    expect(gated?.message).toBe('Successfully installed PostHog!');
  });

  it('keeps reportFile and handoffPrompt when the report exists on disk', () => {
    writeFileSync(join(dir, 'posthog-setup-report.md'), '# report');
    const prompt = 'Read `posthog-setup-report.md` and work the checklist.';

    const gated = gateReportOnDisk(
      {
        kind: OutroKind.Success,
        reportFile: 'posthog-setup-report.md',
        handoffPrompt: prompt,
      },
      dir,
    );

    expect(gated?.reportFile).toBe('posthog-setup-report.md');
    expect(gated?.handoffPrompt).toBe(prompt);
  });

  it('is a no-op when no reportFile is set', () => {
    const gated = gateReportOnDisk(
      { kind: OutroKind.Success, handoffPrompt: 'do the thing' },
      dir,
    );
    // Nothing to gate against, so the handoff prompt is preserved as-is.
    expect(gated?.handoffPrompt).toBe('do the thing');
  });

  it('passes undefined through untouched', () => {
    expect(gateReportOnDisk(undefined, dir)).toBeUndefined();
  });
});
