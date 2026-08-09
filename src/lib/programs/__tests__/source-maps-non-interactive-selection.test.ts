import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWizardAbort } = vi.hoisted(() => ({
  mockWizardAbort: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/wizard-abort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@utils/wizard-abort')>();
  return { ...actual, wizardAbort: mockWizardAbort };
});

import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { buildSession, type WizardSession } from '@lib/wizard-session';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@lib/programs/error-tracking-upload-source-maps/detect';
import { seedNonInteractiveSelection } from '@lib/programs/error-tracking-upload-source-maps/non-interactive-selection';

describe('seedNonInteractiveSelection', () => {
  let installDir: string;
  let session: WizardSession;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcemaps-select-'));
    fs.mkdirSync(path.join(installDir, 'apps', 'web'), { recursive: true });
    session = buildSession({ installDir, ci: true });
    setUI(new LoggingUI());
    mockWizardAbort.mockClear();
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it.each([
    { selectedPath: '.', label: 'the repo root' },
    { selectedPath: 'apps/web', label: 'a monorepo subproject' },
  ])('seeds the selection for $label', async ({ selectedPath }) => {
    await seedNonInteractiveSelection(session, {
      selectedPath,
      selectedVariant: 'nextjs',
    });

    expect(mockWizardAbort).not.toHaveBeenCalled();
    const ui = getUI();
    expect(
      ui.getFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedVariant),
    ).toBe('nextjs');
    expect(ui.getFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath)).toBe(
      selectedPath,
    );
    expect(
      ui.getFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName),
    ).toBe('Next.js');
  });

  it.each([
    {
      name: 'both flags missing',
      options: {},
      messagePart: '--selected-path',
    },
    {
      name: 'variant missing',
      options: { selectedPath: '.' },
      messagePart: '--selected-variant',
    },
    {
      name: 'unknown variant',
      options: { selectedPath: '.', selectedVariant: 'cobol' },
      messagePart: 'Unknown --selected-variant "cobol"',
    },
    {
      name: 'path not in the repository',
      options: { selectedPath: 'apps/missing', selectedVariant: 'nextjs' },
      messagePart: 'run a new scan',
    },
    {
      name: 'path escaping the install dir',
      options: { selectedPath: '../outside', selectedVariant: 'nextjs' },
      messagePart: 'outside the install directory',
    },
  ])('aborts on $name without seeding', async ({ options, messagePart }) => {
    await seedNonInteractiveSelection(session, options);

    expect(mockWizardAbort).toHaveBeenCalledTimes(1);
    expect(mockWizardAbort.mock.calls[0][0].message).toContain(messagePart);
    expect(
      getUI().getFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedVariant),
    ).toBeUndefined();
  });
});
