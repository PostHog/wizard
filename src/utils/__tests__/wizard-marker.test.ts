import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readWizardMarker,
  writeWizardMarker,
  classifyRerunReason,
} from '../wizard-marker';
import type { WizardMarker } from '../wizard-marker';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'wizard-marker-'),
  );
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readWizardMarker
// ---------------------------------------------------------------------------

describe('readWizardMarker', () => {
  it('returns null when no marker file exists', async () => {
    const result = await readWizardMarker(tmpDir);
    expect(result).toBeNull();
  });

  it('reads a valid marker file', async () => {
    const marker = {
      _comment: 'test',
      status: 'success',
      integration: 'next-js',
      completedAt: '2026-01-01T00:00:00.000Z',
      wizardVersion: '1.32.0',
    };
    await fs.promises.writeFile(
      path.join(tmpDir, '.posthog-wizard.json'),
      JSON.stringify(marker),
      'utf-8',
    );

    const result = await readWizardMarker(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
    expect(result!.integration).toBe('next-js');
  });

  it('returns null for malformed JSON', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, '.posthog-wizard.json'),
      'not json',
      'utf-8',
    );

    const result = await readWizardMarker(tmpDir);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeWizardMarker
// ---------------------------------------------------------------------------

describe('writeWizardMarker', () => {
  it('writes a marker file with correct fields', async () => {
    await writeWizardMarker(tmpDir, {
      status: 'success',
      integration: 'next-js',
    });

    const content = await fs.promises.readFile(
      path.join(tmpDir, '.posthog-wizard.json'),
      'utf-8',
    );
    const marker = JSON.parse(content);

    expect(marker._comment).toContain('Safe to delete');
    expect(marker.status).toBe('success');
    expect(marker.integration).toBe('next-js');
    expect(marker.completedAt).toBeDefined();
    expect(marker.wizardVersion).toBeDefined();
  });

  it('writes error status', async () => {
    await writeWizardMarker(tmpDir, {
      status: 'error',
      integration: 'django',
    });

    const content = await fs.promises.readFile(
      path.join(tmpDir, '.posthog-wizard.json'),
      'utf-8',
    );
    const marker = JSON.parse(content);

    expect(marker.status).toBe('error');
    expect(marker.integration).toBe('django');
  });

  it('overwrites existing marker', async () => {
    await writeWizardMarker(tmpDir, {
      status: 'error',
      integration: 'next-js',
    });
    await writeWizardMarker(tmpDir, {
      status: 'success',
      integration: 'next-js',
    });

    const content = await fs.promises.readFile(
      path.join(tmpDir, '.posthog-wizard.json'),
      'utf-8',
    );
    const marker = JSON.parse(content);

    expect(marker.status).toBe('success');
  });

  it('does not throw if directory is not writable', async () => {
    // Writing to a non-existent directory should fail silently
    await expect(
      writeWizardMarker('/non-existent-dir-12345', {
        status: 'success',
        integration: 'next-js',
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// classifyRerunReason
// ---------------------------------------------------------------------------

describe('classifyRerunReason', () => {
  const makeMarker = (status: 'success' | 'error'): WizardMarker => ({
    _comment: 'test',
    status,
    integration: 'next-js',
    completedAt: '2026-01-01T00:00:00.000Z',
    wizardVersion: '1.32.0',
  });

  it('returns fresh_install when no marker and no posthog', () => {
    expect(classifyRerunReason(null, false)).toBe('fresh_install');
  });

  it('returns manual_install when no marker but posthog installed', () => {
    expect(classifyRerunReason(null, true)).toBe('manual_install');
  });

  it('returns retry_after_error when marker has error status', () => {
    expect(classifyRerunReason(makeMarker('error'), true)).toBe(
      'retry_after_error',
    );
  });

  it('returns rerun_after_success when marker has success status', () => {
    expect(classifyRerunReason(makeMarker('success'), true)).toBe(
      'rerun_after_success',
    );
  });

  it('returns retry_after_error even if posthog not installed', () => {
    // Edge case: marker says error, but posthog deps were removed
    expect(classifyRerunReason(makeMarker('error'), false)).toBe(
      'retry_after_error',
    );
  });
});
