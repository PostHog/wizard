/**
 * The session-driven agent runner every existing caller uses.
 *
 * `runProgramAgent(programConfig, session)` runs the gates the TUI owns
 * (health, settings), then calls `runProgram` as its caller, backed by the
 * session and `getUI()`: credentials come from `authenticate`, the AI
 * opt-in and post-auth gates park on the UI, every progress event maps back
 * onto `getUI()`, and the invocation's data projects back onto the session.
 * It applies the result — `wizardAbort` with the outcome's terminal status for
 * a decided failure, the terminal analytics event for a finished top-level run.
 *
 * This is the only file that knows about `getUI()`, the session and
 * `wizardAbort` on the agent's behalf. Programs replace it in Release B.
 */

import { mayReportScanResults, type WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { getUI, type WizardUI } from '@ui';
import { createUiReducer, uiInteraction } from '@ui/agent-progress';
import { flushScanReport, RunOutcome, TASK_OUTCOMES_KEY } from '@agent';
import type { ProgramRun } from './program-run';
import {
  backupAndFixClaudeSettings,
  checkAllSettingsConflicts,
  classifySettingsConflicts,
  restoreClaudeSettings,
} from '@shared/claude-settings';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@shared/health-checks/readiness';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { registerCleanup, wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@shared/errors';
import { isNonInteractiveEnvironment } from '@utils/environment';
import { Sequence, type Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { postAuthGateSteps, type ProgramConfig } from './program-step';
import { authenticate } from './authenticate';
import {
  removeAuditLedger,
  startAuditLedgerWatcher,
} from './audit/ledger-watcher';
import { getDetectedWarehouseSources } from './warehouse-source/detect';
import { runProgram, type WizardFlagSnapshot } from './run-program';
import type { ProgramInvocationData } from './program-store';

/**
 * Resolve a ProgramConfig's agent run definition and execute the pipeline.
 * Entry point for the runners and for composed run steps.
 */
export async function runProgramAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
  options: { composed?: boolean } = {},
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  // Before `run()` resolves: an audit seeds the ledger from inside its recipe,
  // and a watcher started later would ignore that write as pre-existing.
  const ledgerFile = programConfig.auditLedgerFile;
  const ledger = ledgerFile
    ? startAuditLedgerWatcher(session.installDir, ledgerFile)
    : null;
  const releaseLedger = () => {
    // Read a last write the watch debounce hasn't picked up before stopping.
    ledger?.refresh();
    ledger?.stop();
    if (ledgerFile) removeAuditLedger(session.installDir, ledgerFile);
  };
  if (ledger) registerCleanup(releaseLedger);

  try {
    const runDef =
      typeof programConfig.run === 'function'
        ? await programConfig.run(session)
        : programConfig.run;

    await runSessionProgram(
      session,
      runDef,
      programConfig,
      options.composed ?? false,
    );
  } finally {
    releaseLedger();
  }
}

/** Gates → runProgram on the session's behalf → apply result. */
async function runSessionProgram(
  session: WizardSession,
  run: ProgramRun,
  programConfig: ProgramConfig,
  composed: boolean,
): Promise<void> {
  // 1. Init logging + debug
  initLogFile();
  session.skillId = run.skillId ?? run.integrationLabel;
  logToFile(
    `[agent-runner] START ${run.integrationLabel} build=${analytics.build}` +
      `${session.ci ? ' (non-interactive)' : ''}`,
  );
  if (session.debug) {
    enableDebugLogs();
  }

  // 2. Health check (guarded — skip if TUI already ran it). Only
  // programs that declare a health-check screen get pre-flight checks;
  // for everything else the checks never fire and never block.
  await runHealthGate(session, programConfig);

  // 3. Settings conflicts
  await runSettingsGate(session);

  const ui = getUI();
  const reduceUi = createUiReducer(ui);
  const projectData = projectProgramData(ui, session);

  // runProgram turns a throwing capability into a failed run; the CLI roots expect the throw.
  let capabilityFailure: { error: unknown } | undefined;
  const keepFailure = <T>(work: Promise<T>): Promise<T> =>
    work.catch((error: unknown) => {
      capabilityFailure ??= { error };
      throw error;
    });

  const framework = session.integration ?? session.skillId ?? undefined;
  const result = await runProgram(
    programConfig.id,
    {
      installDir: session.installDir,
      run,
      composed,
      overrides: {
        harness: session.harness,
        sequence: session.sequence,
        model: session.model,
      },
      skillId: session.skillId ?? undefined,
      integration: session.integration,
      frameworkDocsUrl: framework
        ? FRAMEWORK_REGISTRY[framework as Integration]?.metadata.docsUrl
        : undefined,
      flags: {
        ci: session.ci,
        signup: session.signup,
        debug: session.debug,
        e2eAsk: session.e2eAsk,
        localMcp: session.localMcp,
        captureAio: session.captureAio,
        benchmark: session.benchmark,
        yaraReport: session.yaraReport,
      },
      host: {
        baseUrl: session.baseUrl,
        region: session.region,
        email: session.email,
        projectId: session.projectId,
        apiKey: session.apiKey,
      },
      seedTasks: programConfig.seedTasks
        ? () => programConfig.seedTasks!(session)
        : undefined,
      hooks: {
        postRun: run.postRun
          ? (creds) => run.postRun!(session, creds)
          : undefined,
        buildOutroData: run.buildOutroData
          ? (creds) => run.buildOutroData!(session, creds) ?? undefined
          : undefined,
        buildOutroNextSteps: run.buildOutroNextSteps
          ? (creds, completed) =>
              run.buildOutroNextSteps!(session, creds, completed)
          : undefined,
        recordTaskOutcomes: (outcomes) => {
          session.frameworkContext[TASK_OUTCOMES_KEY] = outcomes;
        },
      },
      program: {
        requiresAi: programConfig.requiresAi,
        agentFlow: programConfig.agentFlow,
        allowedTools: programConfig.allowedTools,
        disallowedTools: programConfig.disallowedTools,
        excludedTaskTypes: programConfig.excludedTaskTypes,
        postAuthGates: postAuthGateSteps(programConfig.steps).map(
          (step) => step.id,
        ),
      },
      aiSdkStampReported: session.aiSdkStampReported,
      discoveredFeatures: session.discoveredFeatures,
      warehouseSources: getDetectedWarehouseSources(session),
      mayReportScanResults: mayReportScanResults(session),
    },
    {
      credentials: {
        // Idempotent within a run: a second agent run in the same invocation
        // (self-driving's integration phase) reuses the first login.
        resolve: () =>
          keepFailure(
            authenticate(session, programConfig.id).then(() => ({
              posthog: session.credentials!,
              project: session.apiProject,
              apiUser: session.apiUser,
            })),
          ),
      },
      // The actual AI opt-in gate: it parks while AiOptInRequiredScreen is up,
      // before the skill install and agent start, so no source leaves the machine.
      awaitAiApproval: async () => {
        logToFile('[agent-runner] checking AI opt-in gate');
        await ui.waitForAiOptIn();
        logToFile('[agent-runner] AI opt-in gate cleared');
        return true;
      },
      // Each step the user settles between auth and run, such as the source-maps
      // project picker, which writes its choice to frameworkContext for the prompt.
      awaitPostAuthGates: async ({ gates }) => {
        for (const gate of gates) {
          logToFile(`[agent-runner] awaiting post-auth gate: ${gate}`);
          await ui.waitForGate(gate);
          logToFile(`[agent-runner] post-auth gate cleared: ${gate}`);
        }
      },
      featureFlags: () => keepFailure(loadWizardFlags()),
      onProgress: (progress) => {
        if (progress.kind === 'run') reduceUi(progress.event);
        else projectData(progress.data);
      },
      interaction: uiInteraction(ui),
    },
  );
  if (capabilityFailure) throw capabilityFailure.error;

  // The host owns process exits, terminal analytics and rethrowing crashes.
  if (result.outcome === RunOutcome.Crashed) {
    throw result.failure?.error;
  }
  if (result.outcome !== RunOutcome.Success) {
    if (result.failure?.authErrorDetail) {
      ui.showAuthError(result.failure.authErrorDetail);
    }
    // The terminal status follows how the run ended, not whether an Error came back.
    await wizardAbort({
      ...result.failure,
      status: result.outcome === RunOutcome.Aborted ? 'cancelled' : 'error',
    });
  } else if (!composed) {
    // A composed sub-run leaves the terminal event to its host program's run.
    // The run already succeeded: a failed flush is logged, never the outcome.
    try {
      await analytics.shutdown('success');
    } catch (error) {
      logToFile('[agent-runner] analytics shutdown failed:', error);
    }
  }
}

/** Mirror the invocation's data onto the session and the UI the TUI reads. */
function projectProgramData(
  ui: WizardUI,
  session: WizardSession,
): (data: ProgramInvocationData) => void {
  let bindingSeen = false;
  return (data) => {
    const current = session.credentials;
    if (
      current &&
      data.credentials &&
      data.credentials.accessToken !== current.accessToken
    ) {
      // A refresh replaces only the token fields; the login keeps its host.
      session.credentials = {
        ...current,
        accessToken: data.credentials.accessToken,
        refreshToken: data.credentials.refreshToken,
        expiresAt: data.credentials.expiresAt,
      };
      ui.setAccessToken(session.credentials);
    }
    if (data.aiSdkStampReported) session.aiSdkStampReported = true;
    if (!data.binding || bindingSeen) return;
    bindingSeen = true;

    // Cleanup coverage for the abort/cancel path: `wizardAbort` runs the
    // registered cleanups, and the agent's own `finally` covers completion.
    // flushScanReport is idempotent, so the overlap is a harmless no-op.
    registerCleanup(() => {
      const report = flushScanReport({ yaraReport: session.yaraReport });
      if (report) ui.log.info(report);
    });

    // Linear settings restoration fires on entry to the outro screen, so it
    // is registered before the run can reach that screen. The abort path
    // still restores through the cleanup `backupAndFixClaudeSettings`
    // registered.
    if (data.binding.sequence === Sequence.linear) {
      ui.onEnterScreen('outro', () =>
        restoreClaudeSettings(session.installDir),
      );
    }
  };
}

const loadWizardFlags = async (): Promise<WizardFlagSnapshot> => ({
  flags: await analytics.getAllFlagsForWizard(),
  payloads: analytics.getWizardFlagPayloads(),
});

// ── Gates ─────────────────────────────────────────────────────────────

async function runHealthGate(
  session: WizardSession,
  programConfig: ProgramConfig,
): Promise<void> {
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
  if (!hasHealthCheckScreen || session.readinessResult) return;

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

async function runSettingsGate(session: WizardSession): Promise<void> {
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
  if (settingsConflicts.length === 0) return;

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
