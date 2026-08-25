import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUI, setUI } from '@ui';
import type { WizardUI } from '@ui/wizard-ui';
import { MAX_HANDOFF_TEXT_CHARS, publishHandoff } from '../handoff';

describe('publishHandoff', () => {
  const captured: string[] = [];
  let previousUI: WizardUI;
  let temporaryDirectory: string;

  beforeEach(() => {
    captured.length = 0;
    previousUI = getUI();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'wizard-handoff-'));
    delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    setUI({
      ...previousUI,
      setHandoffText: (text: string) => {
        captured.push(text);
      },
    } as WizardUI);
  });

  afterEach(() => {
    setUI(previousUI);
    rmSync(temporaryDirectory, { recursive: true, force: true });
    delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
  });

  it('publishes the content through the UI seam', () => {
    const result = publishHandoff('# Setup report\n\nAll done.');
    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
  });

  it('rejects blank content instead of publishing', () => {
    for (const bad of ['', '   \n']) {
      const result = publishHandoff(bad);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('complete report markdown');
    }
    expect(captured).toEqual([]);
  });

  it('truncates oversized content to the backend cap and says so', () => {
    const outputPath = join(temporaryDirectory, 'handoff.md');
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;
    const oversized = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 10);
    const result = publishHandoff(oversized);

    expect(result.ok).toBe(true);
    expect(captured[0]).toHaveLength(MAX_HANDOFF_TEXT_CHARS);
    expect(readFileSync(outputPath, 'utf8')).toHaveLength(
      MAX_HANDOFF_TEXT_CHARS,
    );
    expect(result.message).toContain('truncated');
  });

  it('mirrors the published handoff to the host-provided output path', () => {
    const outputPath = join(temporaryDirectory, 'handoff.md');
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

    const result = publishHandoff('# Setup report\n\nAll done.');

    expect(result.ok).toBe(true);
    expect(readFileSync(outputPath, 'utf8')).toBe(
      '# Setup report\n\nAll done.',
    );
  });

  it('continues publishing when the host-provided output path cannot be written', () => {
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = temporaryDirectory;

    const result = publishHandoff('# Setup report\n\nAll done.');

    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
  });
});
