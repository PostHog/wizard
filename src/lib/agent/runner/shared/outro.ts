/**
 * Outro post-processing shared across runners.
 *
 * The setup report (`reportFile`) is written by the agent as an optional, soft
 * step — on runs where the agent never finishes (no `agent completed`), no skill
 * is installed, or the model just skips the "write a report" instruction, the
 * file is never created. Programs still set `reportFile` (and the coding-agent
 * `handoffPrompt` that tells the user to read it) unconditionally in their outro
 * data, so the outro screen and exit line end up promising a file that isn't on
 * disk. Gate the promise on reality: drop both fields when the file is missing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OutroData } from '@lib/wizard-session';

/**
 * Strip `reportFile`/`handoffPrompt` from outro data when the referenced report
 * does not exist under `installDir`. Mutates and returns the same object (or
 * passes `undefined` through). The handoff prompt only makes sense alongside the
 * report it points at, so the two are gated together.
 */
export function gateReportOnDisk<T extends OutroData | undefined>(
  outroData: T,
  installDir: string,
): T {
  if (
    outroData?.reportFile &&
    !existsSync(join(installDir, outroData.reportFile))
  ) {
    outroData.reportFile = undefined;
    outroData.handoffPrompt = undefined;
  }
  return outroData;
}
