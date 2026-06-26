/**
 * Shared bootstrap for the runner pipeline.
 *
 * Runs before the fork into the linear or orchestrator arm: logging, health
 * check, settings conflicts, OAuth and credentials, feature flags, variant
 * metadata, and MCP url. Sets `session.credentials`, role, and user as side
 * effects. Returns the values the arms still need.
 */

import type { WizardSession } from '@lib/wizard-session';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { analytics, groupsFromUser } from '@utils/analytics';
import { getUI } from '@ui';
import { buildRunTags } from '@lib/agent/agent-interface';
import {
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
} from '@lib/agent/claude-settings';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@lib/health-checks/readiness';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';
import { isNonInteractiveEnvironment } from '@utils/environment';
import { getSkillsBaseUrl } from '@lib/constants';
import { runtimeEnv } from '@env';
import type { WizardRunOptions } from '@utils/types';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun, BootstrapResult } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Decide whether the `wizard_ask` overlay should be wired for this run.
 * Disabled in non-interactive modes (CI, signup) — there's no human to
 * answer. Per-program disabling is done by adding WIZARD_ASK_TOOL_NAME to
 * the program's `disallowedTools` so the SDK rejects calls outright.
 * Extracted so the policy can be unit-tested directly.
 */
export function shouldDisableAsk(
  session: Pick<WizardSession, 'ci' | 'signup'>,
): boolean {
  return session.ci || session.signup;
}

export function sessionToOptions(session: WizardSession): WizardRunOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    benchmark: session.benchmark,
    projectId: session.projectId,
    apiKey: session.apiKey,
    yaraReport: session.yaraReport,
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────

/**
 * Shared setup for both arms: logging, health check, settings conflicts, OAuth
 * and credentials, then the feature flags, variant metadata, and MCP url. Sets
 * `session.credentials`, role, and user as a side effect. Returns the values the
 * arms still need.
 */
export async function bootstrapProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
): Promise<BootstrapResult> {
  // 1. Init logging + debug
  initLogFile();
  session.skillId = config.skillId ?? config.integrationLabel;
  logToFile(`[agent-runner] START ${config.integrationLabel}`);

  if (session.debug) {
    enableDebugLogs();
  }

  const skillsBaseUrl = getSkillsBaseUrl(session.localMcp);

  // 2. Health check (guarded — skip if TUI already ran it). Only
  // programs that declare a health-check screen get pre-flight checks;
  // for everything else the checks never fire and never block.
  const hasHealthCheckScreen = programConfig.steps.some(
    (s) => s.screenId === 'health-check',
  );
  if (session.readinessResult) {
    logToFile(
      `[agent-runner] readiness pre-computed by TUI: decision=${session.readinessResult.decision}` +
        `${
          session.outageDismissed ? ' (outage dismissed by user)' : ''
        } — skipping re-check`,
    );
  }
  if (hasHealthCheckScreen && !session.readinessResult) {
    logToFile('[agent-runner] evaluating wizard readiness');
    const readinessConfig = session.signup
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

      await getUI().showBlockingOutage(readiness);

      // The TUI lets the user continue past an outage; non-interactive runs
      // (CI) do the same automatically — the degraded services are reported
      // above, but we proceed rather than aborting on a transient upstream blip.
      if (!isNonInteractiveEnvironment()) {
        await wizardAbort({
          message:
            'Cannot start — external services are down:\n' +
            blockingLabels.map((l) => `  - ${l}`).join('\n') +
            '\n\nPlease try again later.',
        });
      }
    } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
      getUI().setReadinessWarnings(readiness);
    }
  }

  // 3. Settings conflicts
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  logToFile(
    `[agent-runner] settings conflicts: ${
      settingsConflicts.length > 0
        ? settingsConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none'
    }`,
  );

  if (settingsConflicts.length > 0) {
    for (const conflict of settingsConflicts) {
      const level = conflict.source === 'managed' ? 'org' : conflict.source;
      analytics.wizardCapture('settings conflict detected', {
        level,
        keys: conflict.keys,
      });
    }
    await getUI().showSettingsOverride(settingsConflicts, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
    logToFile('[agent-runner] settings override resolved');
  }

  analytics.wizardCapture('agent started', {
    integration: config.integrationLabel,
    program_id: programConfig.id,
    skill_id: config.skillId ?? null,
  });

  // 4. OAuth
  logToFile('[agent-runner] starting OAuth');
  const {
    projectApiKey,
    host,
    accessToken,
    projectId,
    cloudRegion,
    roleAtOrganization,
    user,
    project,
  } = await getOrAskForProjectData({
    signup: session.signup,
    ci: session.ci,
    apiKey: session.apiKey,
    projectId: session.projectId,
    email: session.email,
    region: session.region,
    baseUrl: session.baseUrl,
    programId: programConfig.id,
  });

  session.credentials = { accessToken, projectApiKey, host, projectId };
  session.roleAtOrganization = roleAtOrganization;
  session.apiUser = user;
  getUI().setCredentials(session.credentials);
  getUI().setRoleAtOrganization(roleAtOrganization);
  getUI().setApiUser(user);

  // Identify the user (email, name) before evaluating flags, so flags can target
  // the individual user and not just $app_name.
  if (user) analytics.identifyUser(user);
  analytics.setGroups(groupsFromUser(user, host));

  // 4.5. AI opt-in enforcement. Parks here while AiOptInRequiredScreen is
  // up if the org hasn't approved third-party AI — BEFORE the skill
  // install and agent start, so no source leaves the machine. The screen
  // alone is cosmetic; this await is the actual gate. Resolves
  // immediately when the program declared requiresAi: false or in CI.
  // In bootstrapProgram so both the linear and orchestrator arms gate.
  logToFile('[agent-runner] checking AI opt-in gate');
  await getUI().waitForAiOptIn();
  logToFile('[agent-runner] AI opt-in gate cleared');

  // Park for any interactive step the user must complete AFTER authenticating
  // but BEFORE the agent runs — e.g. the source-maps project picker, which
  // needs credentials to scan and writes its choice to frameworkContext that
  // the run prompt reads. Generic: await every gated step between auth and run.
  const authIndex = programConfig.steps.findIndex((s) => s.screenId === 'auth');
  const runIndex = programConfig.steps.findIndex((s) => s.screenId === 'run');
  if (authIndex !== -1 && runIndex > authIndex) {
    for (const step of programConfig.steps.slice(authIndex + 1, runIndex)) {
      if (step.gate) {
        logToFile(`[agent-runner] awaiting post-auth gate: ${step.id}`);
        await getUI().waitForGate(step.id);
        logToFile(`[agent-runner] post-auth gate cleared: ${step.id}`);
      }
    }
  }

  // Feature flags and MCP url. Both arms need these, and the fork decision reads
  // the flags.
  const wizardFlags = await analytics.getAllFlagsForWizard();
  // Gateway trace tags for this run. The runner stamps its variant onto this
  // after the fork (see runProgram), so the value reflects which arm ran.
  const wizardMetadata = buildRunTags({
    programId: programConfig.id,
    integration: config.integrationLabel,
    runId: analytics.runId,
    build: analytics.build,
    skillId: config.skillId,
  });

  // One MCP url for every region: the server resolves the user's region from
  // the bearer token, so the EU subdomain (a Claude Code OAuth workaround) is
  // not needed here.
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : runtimeEnv('MCP_URL') || 'https://mcp.posthog.com/mcp';

  return {
    skillsBaseUrl,
    projectApiKey,
    host,
    accessToken,
    projectId,
    cloudRegion,
    mcpUrl,
    wizardFlags,
    wizardMetadata,
    project,
  };
}
