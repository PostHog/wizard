import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type BaseHealthResult,
  type HealthCheckKey,
} from './types';
import { checkSkillsOriginHealth } from './endpoints';
import { logToFile } from '@utils/debug';

// ---------------------------------------------------------------------------
// Service labels (used in human-readable reason strings)
// ---------------------------------------------------------------------------

export const SERVICE_LABELS: Record<HealthCheckKey, string> = {
  skillsOrigin: 'Skills download',
};

// ---------------------------------------------------------------------------
// Readiness config
// ---------------------------------------------------------------------------

export interface WizardReadinessConfig {
  /** Services where status=Down blocks the run (readiness=No). */
  downBlocksRun: HealthCheckKey[];
  /** Services where status=Degraded (or worse) blocks the run (readiness=No). */
  degradedBlocksRun?: HealthCheckKey[];
}

// Skills gate startup; gateway readiness is checked against the minted URL.
export const DEFAULT_WIZARD_READINESS_CONFIG: WizardReadinessConfig = {
  downBlocksRun: ['skillsOrigin'],
};

export const SIGNUP_WIZARD_READINESS_CONFIG = DEFAULT_WIZARD_READINESS_CONFIG;

// ---------------------------------------------------------------------------
// Aggregate check
// ---------------------------------------------------------------------------

export async function checkAllExternalServices(): Promise<AllServicesHealth> {
  return { skillsOrigin: await checkSkillsOriginHealth() };
}

// ---------------------------------------------------------------------------
// Wizard readiness evaluation
// ---------------------------------------------------------------------------

export enum WizardReadiness {
  Yes = 'yes',
  No = 'no',
  YesWithWarnings = 'yes_with_warnings',
}

export interface WizardReadinessResult {
  decision: WizardReadiness;
  health: AllServicesHealth;
  reasons: string[];
}

function describeResult(label: string, h: BaseHealthResult): string {
  const parts = [`${label}: ${h.status}`];
  if (h.rawIndicator) parts.push(`indicator=${h.rawIndicator}`);
  if (h.error) parts.push(h.error);
  return parts.join(' — ');
}

// Each probe can take up to one base timeout + two retries with the
// 500ms / 2000ms backoffs in endpoints.ts (worst case ~17.5s for a
// network failure that exhausts retries). Probes run in parallel so
// the aggregate ceiling is one probe, not the sum.
const READINESS_TIMEOUT_MS = 20_000;

export async function evaluateWizardReadiness(
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): Promise<WizardReadinessResult> {
  try {
    const health = await Promise.race([
      checkAllExternalServices(),
      new Promise<AllServicesHealth>((resolve) =>
        setTimeout(
          () => resolve(allUnknown('Health check timed out')),
          READINESS_TIMEOUT_MS,
        ),
      ),
    ]);

    const blockingKeys = getBlockingServiceKeys(health, config);
    const reasons = blockingKeys.map((key) =>
      describeResult(SERVICE_LABELS[key], health[key]),
    );
    if (blockingKeys.length > 0) {
      const blockingDetails = blockingKeys.map((key) => {
        const h = health[key];
        return `${key} (${h.status}${h.error ? ` — ${h.error}` : ''})`;
      });
      logToFile(`[health-checks] blocked by: ${blockingDetails.join(', ')}`);
      return { decision: WizardReadiness.No, health, reasons };
    }

    return { decision: WizardReadiness.Yes, health, reasons };
  } catch (err) {
    logToFile(
      `[health-checks] error: ${err instanceof Error ? err.message : err}`,
    );
    // Health checks must never block the wizard run
    return {
      decision: WizardReadiness.Yes,
      health: allUnknown('Unexpected error'),
      reasons: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Blocking service detection
// ---------------------------------------------------------------------------

// Report only dependencies that prevent this run from starting.
export function getBlockingServiceKeys(
  health: AllServicesHealth,
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): HealthCheckKey[] {
  return (Object.keys(health) as HealthCheckKey[]).filter((key) => {
    const result = health[key];
    if (
      config.downBlocksRun.includes(key) &&
      (result.status === ServiceHealthStatus.Down ||
        result.status === ServiceHealthStatus.NoConnection)
    ) {
      return true;
    }
    if (
      (config.degradedBlocksRun ?? []).includes(key) &&
      result.status !== ServiceHealthStatus.Healthy
    ) {
      return true;
    }
    return false;
  });
}

/** Build an AllServicesHealth where every service is Degraded with the given error. */
function allUnknown(error: string): AllServicesHealth {
  const base: BaseHealthResult = {
    status: ServiceHealthStatus.Degraded,
    error,
  };
  return { skillsOrigin: base };
}
