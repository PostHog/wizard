/**
 * Shared error helpers for the runner pipeline.
 */

import { describeInstallFailure } from '@lib/wizard-tools';
import type { InstallSkillResult } from '@lib/wizard-tools';
import { wizardAbort, WizardError } from '@utils/wizard-abort';

export async function abortOnInstallFailure(
  integrationLabel: string,
  result: InstallSkillResult,
): Promise<void> {
  if (result.kind === 'ok') return;

  await wizardAbort({
    message: describeInstallFailure(result),
    error: new WizardError(`Skill install failed: ${result.kind}`, {
      integration: integrationLabel,
      error_type: result.kind,
      platform: process.platform,
      // The kind can't separate missing-tool from network failures.
      ...(result.kind === 'download-failed'
        ? { error_detail: result.message.slice(0, 500) }
        : {}),
    }),
  });
}
