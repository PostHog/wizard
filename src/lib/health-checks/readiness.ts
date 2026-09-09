import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type BaseHealthResult,
  type HealthCheckKey,
} from './types';
import {
  checkAnthropicHealth,
  checkGithubHealth,
  checkNpmOverallHealth,
  checkNpmComponentHealth,
  checkCloudflareOverallHealth,
  checkCloudflareComponentHealth,
} from './statuspage';
import {
  checkPosthogOverallHealth,
  checkPosthogComponentHealth,
} from './incidentio';
import { checkMcpHealth, checkSkillsOriginHealth } from './endpoints';
import { logToFile } from '@utils/debug';

// ---------------------------------------------------------------------------
// Service labels (used in human-readable reason strings)
// ---------------------------------------------------------------------------

export const SERVICE_LABELS: Record<HealthCheckKey, string> = {
  anthropic: 'Anthropic',
  posthogOverall: 'PostHog',
  posthogComponents: 'PostHog (components)',
  github: 'GitHub',
  npmOverall: 'npm',
  npmComponents: 'npm (components)',
  cloudflareOverall: 'Cloudflare',
  cloudflareComponents: 'Cloudflare (components)',
  mcp: 'MCP',
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
  const [
    anthropic,
    posthogOverall,
    posthogComponents,
    github,
    npmOverall,
    npmComponents,
    cloudflareOverall,
    cloudflareComponents,
    mcp,
    skillsOrigin,
  ] = await Promise.all([
    checkAnthropicHealth(),
    checkPosthogOverallHealth(),
    checkPosthogComponentHealth(),
    checkGithubHealth(),
    checkNpmOverallHealth(),
    checkNpmComponentHealth(),
    checkCloudflareOverallHealth(),
    checkCloudflareComponentHealth(),
    checkMcpHealth(),
    checkSkillsOriginHealth(),
  ]);

  const health: AllServicesHealth = {
    anthropic,
    posthogOverall,
    posthogComponents,
    github,
    npmOverall,
    npmComponents,
    cloudflareOverall,
    cloudflareComponents,
    mcp,
    skillsOrigin,
  };
  return reconcilePosthogReachability(health);
}

/**
 * When a PostHog-owned endpoint probe returns `NoConnection`, decide
 * whether it's a real outage or a likely-local issue by checking the
 * official status page (`posthogstatus.com`):
 *
 *   - Status page says PostHog is `Down` / `Degraded` → upgrade
 *     mcp to `Down`. The status page corroborates.
 *   - Status page is `Healthy` → keep `NoConnection`. The status page
 *     contradicts; this is probably the user's network.
 *   - Status page is also `NoConnection` → keep `NoConnection`. User
 *     can't reach two independent PostHog properties; almost
 *     certainly their network. (This case relies on incidentio.ts
 *     correctly emitting `NoConnection` for fetch failures rather
 *     than the previous `Degraded`, which used to silently flip the
 *     reconciliation into a false positive.)
 *
 * Why `Degraded` corroborates: a `Degraded` reading here only fires
 * when incident.io's API parsed successfully and reported a real
 * `partial_outage` or `degraded_performance` for some component. That's
 * PostHog acknowledging an issue, even if narrower than a full outage.
 * If our MCP probe is also failing, those two signals together
 * justify pointing at PostHog rather than the user.
 *
 * A narrower variant — only corroborate when the affected component is
 * MCP-related (US/EU Cloud, app) — would be more precise. We
 * have the data in `posthogComponents` but don't use it here. If the
 * analytics show false positives concentrated in this case, it's a
 * cheap follow-up.
 *
 * Mutates a copy of `health` and returns it.
 */
export function reconcilePosthogReachability(
  health: AllServicesHealth,
): AllServicesHealth {
  const posthogStatus = health.posthogOverall.status;
  const corroboratesOutage =
    posthogStatus === ServiceHealthStatus.Down ||
    posthogStatus === ServiceHealthStatus.Degraded;

  if (!corroboratesOutage) return health;

  const upgrade = (r: BaseHealthResult): BaseHealthResult =>
    r.status === ServiceHealthStatus.NoConnection
      ? {
          ...r,
          status: ServiceHealthStatus.Down,
          error: r.error
            ? `${r.error} (corroborated by status page)`
            : 'corroborated by status page',
        }
      : r;

  return {
    ...health,
    mcp: upgrade(health.mcp),
  };
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

/** Keys that are component-level detail, not top-level services. */
const COMPONENT_KEYS: HealthCheckKey[] = [
  'posthogComponents',
  'npmComponents',
  'cloudflareComponents',
];

/**
 * Get the keys of services that would block a wizard run per the given config.
 *
 * `NoConnection` blocks the same services as `Down` — the wizard genuinely
 * can't continue if it can't reach the gateway. The screen shows softer
 * framing in that case (HealthCheckScreen) so we don't falsely accuse
 * PostHog of an outage when the user's network is the likely cause.
 */
export function getBlockingServiceKeys(
  health: AllServicesHealth,
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): HealthCheckKey[] {
  return (Object.keys(health) as HealthCheckKey[]).filter((key) => {
    if (COMPONENT_KEYS.includes(key)) return false;
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
  return {
    anthropic: base,
    posthogOverall: base,
    posthogComponents: { ...base },
    github: base,
    npmOverall: base,
    npmComponents: { ...base },
    cloudflareOverall: base,
    cloudflareComponents: { ...base },
    mcp: base,
    skillsOrigin: base,
  };
}
