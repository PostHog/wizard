import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUI, setUI } from '@ui';
import type { WizardUI } from '@ui/wizard-ui';
import { MAX_HANDOFF_TEXT_CHARS, publishHandoff } from '../handoff';

describe('publishHandoff', () => {
  const captured: string[] = [];
  let previousUI: WizardUI;
  let temporaryDirectory: string;
  let ambientOutputPath: string | undefined;

  beforeEach(() => {
    captured.length = 0;
    previousUI = getUI();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'wizard-handoff-'));
    // Save the ambient value so a developer running these tests with the var
    // exported doesn't have their environment silently clobbered.
    ambientOutputPath = process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
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
    if (ambientOutputPath === undefined) {
      delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    } else {
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = ambientOutputPath;
    }
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
    expect(result.message).toContain('host output write failed');
  });

  describe('host output write hardening', () => {
    it('creates the file with 0o600 permissions', () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      publishHandoff('# Setup report\n\nAll done.');

      expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    });

    it('tightens a pre-existing world-readable file to 0o600', () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      writeFileSync(outputPath, 'stale report', { mode: 0o644 });
      chmodSync(outputPath, 0o644); // umask may already restrict; be explicit
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      publishHandoff('# Setup report\n\nAll done.');

      expect(readFileSync(outputPath, 'utf8')).toBe(
        '# Setup report\n\nAll done.',
      );
      expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    });

    it('refuses to follow a symlink planted at the output path', () => {
      const victim = join(temporaryDirectory, 'victim.md');
      writeFileSync(victim, 'VICTIM CONTENT', 'utf8');
      const outputPath = join(temporaryDirectory, 'handoff.md');
      symlinkSync(victim, outputPath);
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      const result = publishHandoff('# Malicious report');

      // The user-facing handoff still succeeds (fail-open)…
      expect(result.ok).toBe(true);
      expect(captured).toEqual(['# Malicious report']);
      // …but the write is refused: the victim is untouched, the symlink is
      // still a symlink, the failure is surfaced, and no temp litter remains.
      expect(readFileSync(victim, 'utf8')).toBe('VICTIM CONTENT');
      expect(lstatSync(outputPath).isSymbolicLink()).toBe(true);
      expect(result.message).toContain('host output write failed');
      expect(result.message).toContain('not a regular file');
      expect(
        readdirSync(temporaryDirectory).filter((f) => f.includes('.tmp-')),
      ).toEqual([]);
    });

    it('refuses a relative output path and stays fail-open', () => {
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = 'handoff.md';

      const result = publishHandoff('# Setup report\n\nAll done.');

      expect(result.ok).toBe(true);
      expect(captured).toEqual(['# Setup report\n\nAll done.']);
      expect(result.message).toContain('not an absolute path');
    });

    it('leaves no temp files behind after a successful write', () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      publishHandoff('# Setup report\n\nAll done.');

      expect(readdirSync(temporaryDirectory)).toEqual(['handoff.md']);
    });

    it('overwrites a stale report from a previous run atomically', () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      writeFileSync(outputPath, '# Previous run\n\nStale content.', 'utf8');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      publishHandoff('# Current run\n\nFresh content.');

      expect(readFileSync(outputPath, 'utf8')).toBe(
        '# Current run\n\nFresh content.',
      );
      // Only the final file remains — the temp sibling was consumed by rename.
      expect(readdirSync(temporaryDirectory)).toEqual(['handoff.md']);
    });
  });
});
