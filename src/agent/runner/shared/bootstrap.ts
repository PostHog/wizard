/**
 * Shared bootstrap for the runner pipeline.
 *
 * Runs before the fork into the linear or orchestrator arm: logging, health
 * check, settings conflicts, OAuth and credentials, feature flags, variant
 * metadata, and MCP url. Sets `session.credentials`, role, and user as side
 * effects. Returns the values the arms still need.
 */

import type { WizardSession } from '@store/session/wizard-session';
import { analytics } from '@store/shared/analytics';
import { getUI } from '@store/ui';
import { authenticate, refreshAccessTokenIfNeeded } from './authenticate.js';
import { maybeStampAiSdkDetected } from '@store/programs/posthog-integration/detect';
import { createTriageLLMProvider } from '../../triage-provider.js';
import { gatewayAuth } from '../../gateway/gateway-session.js';
import { resolveHarness } from '../switchboard/index.js';
import { buildRunTags } from '../../agent-interface.js';
import {
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  classifySettingsConflicts,
} from '@store/services/claude-settings';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@store/health-checks/readiness';
import { enableDebugLogs, logToFile, initLogFile } from '@store/shared/debug';
import { wizardAbort } from '@store/shared/wizard-abort';
import { ErrorCodes } from '@store/shared/errors';
import { isNonInteractiveEnvironment } from '@store/shared/environment';
import { CallType, getSkillsBaseUrl, IS_DEV } from '@store/shared/constants';
import { VERSION } from '@store/shared/version';
import { mcpUrlFor } from '@store/host-resolution';
import type { WizardRunOptions } from '@store/shared/types';
import type { ProgramRunConfig } from '@store/agent-protocol/program-run';
import { shouldDisableAsk } from '@store/session/ask-policy';

export { shouldDisableAsk };
import type { ProgramRun, BootstrapResult } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────

export function sessionToOptions(session: WizardSession): WizardRunOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    signup: session.signup,
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
  programConfig: ProgramRunConfig,
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

  const skillsBaseUrl = getSkillsBaseUrl();

  // Where this run actually points. The three services switch independently,
  // so otherwise "why did it use prod skills?" means reading three call sites.
  logToFile(
    `[agent-runner] targets build=${VERSION}${IS_DEV ? '/dev' : ''} ` +
      `skills=${skillsBaseUrl} ` +
      `mcp=${mcpUrlFor(session.localMcp)} ` +
      `posthog=${session.baseUrl ?? 'region-resolved'}`,
  );

  // 2. Health check (guarded — skip if TUI already ran it). Only
  // programs that declare a health-check screen get pre-flight checks;
  // for everything else the checks never fire and never block.
  const hasHealthCheckScreen = programConfig.healthCheckDeclared ?? false;
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
          code: ErrorCodes.EnvServiceOutage,
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

    const { autoFix, failClosed, warnOnly } =
      classifySettingsConflicts(settingsConflicts);

    // User-global and project-local files are already neutralized — the agent
    // runs with settingSources:['project'], so the SDK never reads them. Record
    // it and move on; don't make the user act on a setting that can't bite.
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

    // Writable project settings.json — the SDK *does* read it, but we can back
    // it up and remove it (restored at outro). Neutralize without prompting.
    let unfixable = failClosed;
    if (autoFix.length > 0) {
      const fixed = backupAndFixClaudeSettings(session.installDir);
      if (fixed) {
        logToFile('[agent-runner] auto-neutralized writable settings conflict');
        analytics.wizardCapture('settings conflict auto-neutralized', {
          keys: autoFix.flatMap((c) => c.keys),
        });
      } else {
        // Couldn't remove it — don't run into the redirect; fail closed instead.
        logToFile(
          '[agent-runner] could not back up writable settings conflict — failing closed',
        );
        unfixable = [...failClosed, ...autoFix];
      }
    }

    // What we cannot neutralize (org-managed, always read by the SDK; or a
    // writable file we failed to back up) must be fixed by the user. Fail
    // closed: the screen names the file + keys and exits.
    if (unfixable.length > 0) {
      if (isNonInteractiveEnvironment()) {
        await wizardAbort({
          code: ErrorCodes.SettingsUnfixableConflict,
          message:
            'Cannot start — a Claude settings file redirects the agent away ' +
            'from the PostHog gateway and cannot be neutralized automatically:\n' +
            unfixable
              .map((c) => `  - ${c.source} (${c.path}): ${c.keys.join(', ')}`)
              .join('\n') +
            '\n\nRemove the conflicting keys and re-run the wizard.',
        });
      }
      await getUI().showSettingsOverride(unfixable, () =>
        backupAndFixClaudeSettings(session.installDir),
      );
      logToFile('[agent-runner] settings override resolved');
    }
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
  maybeStampAiSdkDetected(session);
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
  // the run prompt reads. The flow layer names them in `postAuthGateIds`.
  for (const id of programConfig.postAuthGateIds ?? []) {
    logToFile(`[agent-runner] awaiting post-auth gate: ${id}`);
    await getUI().waitForGate(id);
    logToFile(`[agent-runner] post-auth gate cleared: ${id}`);
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

  // The agent can't swap tokens mid-run, so freshness is measured after every park above, right before the mint.
  await refreshAccessTokenIfNeeded(session);

  // Credentials (incl. the resolved host family and its MCP url) live on
  // `session.credentials`; narrow once at this boundary — `authenticate` above
  // set them — so downstream readers get a non-null type without asserting.
  const credentials = session.credentials!;

  // Mint now so a refusal fails the boot before any agent starts. Later
  // readers re-resolve through the cache, which re-mints past the refresh
  // point.
  const currentGatewayAuth = () =>
    gatewayAuth(credentials.host, credentials.accessToken, programConfig.id);
  await currentGatewayAuth();

  return {
    skillsBaseUrl,
    credentials,
    // Carried so per-task sessions re-resolve against the same program the boot
    // minted for, rather than digging it back out of the metadata bag.
    programId: programConfig.id,
    wizardFlags,
    wizardFlagPayloads,
    wizardMetadata,
    project,
    // Resolved once, here: the only place holding both the switchboard inputs
    // and the gateway auth. Every skill install downstream reads it off boot.
    triageProvider: createTriageLLMProvider(
      async () => {
        const auth = await currentGatewayAuth();
        return {
          baseURL: auth.gatewayUrl,
          authToken: auth.token,
          teamId: auth.teamId,
          // `call_type` splits scan spend out of the program's agent cost,
          // the same tag the in-run triage provider carries.
          wizardMetadata: { ...wizardMetadata, call_type: CallType.yaraTriage },
          wizardFlags,
        };
      },
      resolveHarness({
        program: programConfig.id,
        flags: wizardFlags,
        flagPayloads: wizardFlagPayloads,
        cliHarness: session.harness,
        cliModel: session.model,
      }).harness,
    ),
  };
}
