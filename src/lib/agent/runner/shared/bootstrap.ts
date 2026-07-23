/**
 * Shared bootstrap for the runner pipeline.
 *
 * Runs before the fork into the linear or orchestrator arm: logging, health
 * check, settings conflicts, OAuth and credentials, feature flags, variant
 * metadata, and MCP url. Sets `session.credentials`, role, and user as side
 * effects. Returns the values the arms still need.
 */

import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import { authenticate } from './authenticate';
import { buildRunTags } from '@lib/agent/agent-interface';
import {
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
} from '@lib/agent/claude-settings';
import {
  planSettingsConflictActions,
  planAutoFixOutcome,
  type PlannerAction,
} from '@lib/agent/settings-conflict-planner';
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

/**
 * Run a {@link PlannerAction} produced by the settings-conflict planner.
 * Kept tiny on purpose: the planner owns the decisions, this owns the side
 * effects (logToFile + analytics.wizardCapture).
 */
function runPlannerAction(action: PlannerAction): void {
  if (action.kind === 'log') {
    logToFile(action.message);
  } else {
    analytics.wizardCapture(action.event, action.props);
  }
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
  logToFile(
    `[agent-runner] START ${config.integrationLabel} build=${analytics.build}` +
      `${session.ci ? ' (non-interactive)' : ''}`,
  );

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

  // 3. Settings conflicts — pure planner decides log/analytics/fail-closed;
  // this loop is the imperative shell that performs side effects against the
  // plan. See settings-conflict-planner.ts and issue #756.
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  const plan = planSettingsConflictActions(settingsConflicts);
  for (const action of plan.pre) runPlannerAction(action);

  let unfixable = plan.failClosed;
  if (plan.autoFix !== null) {
    // Writable project settings.json — the SDK *does* read it, but we can back
    // it up and remove it (restored at outro). Neutralize without prompting.
    const fixed = backupAndFixClaudeSettings(session.installDir);
    const outcome = planAutoFixOutcome(plan, fixed);
    for (const action of outcome.actions) runPlannerAction(action);
    unfixable = outcome.unfixable;
  }

  // What we cannot neutralize (org-managed, always read by the SDK; or a
  // writable file we failed to back up) must be fixed by the user. Fail
  // closed: the screen names the file + keys and exits.
  if (unfixable.length > 0) {
    await getUI().showSettingsOverride(unfixable, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
    logToFile('[agent-runner] settings override resolved');
  }

  analytics.wizardCapture('agent started', {
    integration: config.integrationLabel,
    program_id: programConfig.id,
    skill_id: config.skillId ?? null,
  });

  // 4. Authenticate — idempotent within a run (see authenticate()). A second
  // agent run in the same invocation (self-driving's integration phase) reuses
  // the first login; it does not launch another OAuth. authenticate() also
  // identifies the user and sets analytics groups.
  await authenticate(session, programConfig.id);
  const project = session.apiProject;

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

  // Feature flags. Both arms need these, and the fork decision reads the flags.
  // This map is PostHog-side only — CLI `--harness` / `--sequence` precedence
  // lives at the resolution sites (`runner/index.ts` for sequence,
  // `resolveHarness` for harness), not here.
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardFlagPayloads = analytics.getWizardFlagPayloads();

  // Gateway trace tags for this run. The runner stamps its variant onto this
  // after the fork (see runProgram), so the value reflects which arm ran.
  const wizardMetadata = buildRunTags({
    programId: programConfig.id,
    integration: config.integrationLabel,
    runId: analytics.runId,
    build: analytics.build,
    skillId: config.skillId,
  });

  // Credentials (incl. the resolved host family and its MCP url) live on
  // `session.credentials`; narrow once at this boundary — `authenticate` above
  // set them — so downstream readers get a non-null type without asserting.
  return {
    skillsBaseUrl,
    credentials: session.credentials!,
    wizardFlags,
    wizardFlagPayloads,
    wizardMetadata,
    project,
  };
}
