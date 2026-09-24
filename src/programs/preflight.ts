/** The health and settings checks every host runs before `runProgram`. */

import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import {
  backupAndFixClaudeSettings,
  checkAllSettingsConflicts,
  classifySettingsConflicts,
  restoreClaudeSettings,
  type SettingsConflict,
} from '@shared/claude-settings';
import { ErrorCodes, type ErrorCode } from '@shared/errors';
import {
  evaluateWizardReadiness,
  getBlockingServiceKeys,
  SERVICE_LABELS,
  SIGNUP_WIZARD_READINESS_CONFIG,
  WizardReadiness,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { getRuntimeProgramConfig } from './runtime-registry';

/** What a host supplies: its presentation and its interactive policy. */
export type ProgramPreflightHost = {
  installDir: string;
  signup: boolean;
  interactive: boolean;
  /** Readiness the host already computed (the TUI health-check screen); skips the check. */
  readiness: WizardReadinessResult | null;
  showOutage(readiness: WizardReadinessResult): Promise<void>;
  setReadinessWarnings(readiness: WizardReadinessResult): void;
  showSettingsOverride(
    conflicts: SettingsConflict[],
    fix: () => boolean,
  ): Promise<void>;
};

export type ProgramPreflightDecision =
  | { kind: 'proceed'; restoreSettings: () => void }
  | { kind: 'abort'; failure: { code: ErrorCode; message: string } };

type PreflightAbort = Extract<ProgramPreflightDecision, { kind: 'abort' }>;

/** Readiness first, then settings; the first abort wins. */
export async function preflight(
  programId: string,
  host: ProgramPreflightHost,
): Promise<ProgramPreflightDecision> {
  const outage = await checkReadiness(programId, host);
  if (outage) return outage;
  const conflict = await checkSettings(host);
  if (conflict) return conflict;
  return {
    kind: 'proceed',
    restoreSettings: () => restoreClaudeSettings(host.installDir),
  };
}

async function checkReadiness(
  programId: string,
  host: ProgramPreflightHost,
): Promise<PreflightAbort | null> {
  const config = getRuntimeProgramConfig(programId);
  if (!config || config.healthCheck === false || host.readiness) return null;

  logToFile('[agent-runner] evaluating wizard readiness');
  const readinessConfig = host.signup
    ? SIGNUP_WIZARD_READINESS_CONFIG
    : undefined;
  const readiness = await evaluateWizardReadiness(readinessConfig);
  logToFile(`[agent-runner] readiness=${readiness.decision}`);
  if (readiness.decision === WizardReadiness.No) {
    const blockingKeys = getBlockingServiceKeys(
      readiness.health,
      readinessConfig,
    );
    const blockingLabels = blockingKeys.map(
      (k) => `${SERVICE_LABELS[k]} (${readiness.health[k].status})`,
    );
    logToFile(`[agent-runner] blocked by: ${blockingLabels.join(', ')}`);

    await host.showOutage(readiness);

    // Non-interactive runs (CI) proceed past an outage; the report above is advisory.
    if (host.interactive) {
      return {
        kind: 'abort',
        failure: {
          code: ErrorCodes.EnvServiceOutage,
          message:
            'Cannot start — external services are down:\n' +
            blockingLabels.map((l) => `  - ${l}`).join('\n') +
            '\n\nPlease try again later.',
        },
      };
    }
  } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
    host.setReadinessWarnings(readiness);
  }
  return null;
}

async function checkSettings(
  host: ProgramPreflightHost,
): Promise<PreflightAbort | null> {
  const settingsConflicts = checkAllSettingsConflicts(host.installDir);
  logToFile(
    `[agent-runner] settings conflicts: ${
      settingsConflicts.length > 0
        ? settingsConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none'
    }`,
  );
  if (settingsConflicts.length === 0) return null;

  for (const conflict of settingsConflicts) {
    const level = conflict.source === 'managed' ? 'org' : conflict.source;
    analytics.wizardCapture('settings conflict detected', {
      level,
      keys: conflict.keys,
    });
  }

  const { autoFix, failClosed, warnOnly } =
    classifySettingsConflicts(settingsConflicts);

  // settingSources:['project'] already keeps the SDK from reading these files.
  for (const conflict of warnOnly) {
    logToFile(
      `[agent-runner] settings conflict in ${conflict.source} (${conflict.path}) ` +
        `neutralized by settingSources:['project'] — not blocking`,
    );
    analytics.wizardCapture('settings conflict neutralized', {
      level: conflict.source,
      keys: conflict.keys,
    });
  }

  // The SDK reads writable project settings, so back them up and remove them.
  let unfixable = failClosed;
  if (autoFix.length > 0) {
    const fixed = backupAndFixClaudeSettings(host.installDir);
    if (fixed) {
      logToFile('[agent-runner] auto-neutralized writable settings conflict');
      analytics.wizardCapture('settings conflict auto-neutralized', {
        keys: autoFix.flatMap((c) => c.keys),
      });
    } else {
      logToFile(
        '[agent-runner] could not back up writable settings conflict — failing closed',
      );
      unfixable = [...failClosed, ...autoFix];
    }
  }

  // Org-managed files and failed backups fail closed: only the user can fix them.
  if (unfixable.length > 0) {
    if (!host.interactive) {
      return {
        kind: 'abort',
        failure: {
          code: ErrorCodes.SettingsUnfixableConflict,
          message:
            'Cannot start — a Claude settings file redirects the agent away ' +
            'from the PostHog gateway and cannot be neutralized automatically:\n' +
            unfixable
              .map((c) => `  - ${c.source} (${c.path}): ${c.keys.join(', ')}`)
              .join('\n') +
            '\n\nRemove the conflicting keys and re-run the wizard.',
        },
      };
    }
    await host.showSettingsOverride(unfixable, () =>
      backupAndFixClaudeSettings(host.installDir),
    );
    logToFile('[agent-runner] settings override resolved');
  }
  return null;
}
