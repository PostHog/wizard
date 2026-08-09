/**
 * Project selection for non-interactive `upload-source-maps` runs.
 *
 * Interactive runs pick the project on the source-maps-detect screen, which
 * writes the selection into framework context. Non-interactive runs have no
 * screens, so the caller passes the selection explicitly — `--selected-path`
 * and `--selected-variant`, verbatim from a stored detection report row (the
 * project the user picked in the PostHog app after a `--detect-only` scan).
 * This ciPreRun validates the flags and seeds the same framework-context keys
 * the screen would have written, so the program's run config stays mode-blind.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getUI } from '@ui';
import type { WizardSession } from '@lib/wizard-session';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  type SkillVariant,
} from './detect.js';

function isSkillVariant(value: string): value is SkillVariant {
  return value in VARIANT_DISPLAY_NAME;
}

async function abortSelection(message: string, kind: string): Promise<void> {
  await wizardAbort({
    message,
    error: new WizardError('upload-source-maps selection invalid', {
      integration: 'error-tracking-upload-source-maps',
      selection_error_kind: kind,
    }),
  });
}

/**
 * `ciPreRun` for the source-maps program: resolve the project to instrument
 * from the selection flags instead of the interactive detect+pick screen.
 */
export async function seedNonInteractiveSelection(
  session: WizardSession,
  options: Record<string, unknown> = {},
): Promise<void> {
  const selectedPath =
    typeof options.selectedPath === 'string' && options.selectedPath !== ''
      ? options.selectedPath
      : undefined;
  const selectedVariant =
    typeof options.selectedVariant === 'string' &&
    options.selectedVariant !== ''
      ? options.selectedVariant
      : undefined;

  if (!selectedPath || !selectedVariant) {
    await abortSelection(
      'Non-interactive upload-source-maps runs need the project to instrument: ' +
        "pass --selected-path (project directory relative to the repo root, '.' for the root) " +
        'and --selected-variant, from a detection report.',
      'missing-flags',
    );
    return;
  }

  if (!isSkillVariant(selectedVariant)) {
    await abortSelection(
      `Unknown --selected-variant "${selectedVariant}". Known variants: ${Object.keys(
        VARIANT_DISPLAY_NAME,
      ).join(', ')}.`,
      'unknown-variant',
    );
    return;
  }

  // The path comes from a stored detection report; resolve it against the
  // install dir and refuse anything that escapes it or no longer exists
  // (the repository may have changed since the scan — rescanning is the fix).
  const installDir = path.resolve(session.installDir);
  const projectDir = path.resolve(installDir, selectedPath);
  if (
    projectDir !== installDir &&
    !projectDir.startsWith(installDir + path.sep)
  ) {
    await abortSelection(
      `--selected-path "${selectedPath}" points outside the install directory.`,
      'path-outside-install-dir',
    );
    return;
  }
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    await abortSelection(
      `--selected-path "${selectedPath}" does not exist in the repository. ` +
        'The repository may have changed since the detection scan — run a new scan and retry.',
      'path-not-found',
    );
    return;
  }

  const ui = getUI();
  ui.setFrameworkContext(
    SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
    selectedVariant,
  );
  ui.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, selectedPath);
  ui.setFrameworkContext(
    SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
    VARIANT_DISPLAY_NAME[selectedVariant],
  );
}
