/**
 * Host-side cleanup of the bookkeeping files a program's agent run leaves
 * behind (declared as `ProgramConfig.cleanupArtifacts`).
 *
 * The agent can't do this itself: `rm` is fence-blocked on the pi harness and
 * skills' "delete the plan file" steps burned turns on delete-vs-empty
 * workarounds. The runner owns removal instead — this runs at the
 * `runProgram` seam on every termination path, for every harness, and a
 * commandment tells the agent to skip skill cleanup steps entirely.
 *
 * Infrastructure only: the file names are program knowledge and stay in each
 * program's config. Removal is idempotent (missing files are a no-op) so the
 * abort-path and finally-path overlap is harmless.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logToFile } from '@utils/debug';
import type { WizardSession } from '@lib/wizard-session';
import type { ProgramConfig } from '@lib/programs/program-step';

export function removeProgramArtifacts(
  session: WizardSession,
  programConfig: ProgramConfig,
): void {
  const artifacts = programConfig.cleanupArtifacts ?? [];
  if (artifacts.length === 0) return;

  const root = path.resolve(session.installDir);
  for (const relPath of artifacts) {
    const target = path.resolve(root, relPath);
    // Declared paths are config, not user input, but keep removal strictly
    // inside the install dir so a bad config entry can never reach out of the
    // project (or delete the project root itself).
    if (!target.startsWith(root + path.sep)) {
      logToFile(
        `[agent-runner] artifact cleanup refused (outside install dir): ${relPath}`,
      );
      continue;
    }
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        logToFile(`[agent-runner] removed run artifact: ${relPath}`);
      }
    } catch (err) {
      logToFile(
        `[agent-runner] artifact cleanup skipped for ${relPath}: ${String(
          err,
        )}`,
      );
    }
  }
}
