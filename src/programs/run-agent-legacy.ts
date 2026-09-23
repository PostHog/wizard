/**
 * The session-driven agent runner every existing caller uses.
 *
 * `runProgramAgent(programConfig, session)` runs the program through the
 * callable `runProgram(programId, input, options)` and keeps only the host's
 * part: it runs preflight through `getUI()`, builds `ProgramInput` from the
 * session, and supplies the session's login as the credentials provider, the
 * TUI's AI opt-in and post-auth gates as awaited capabilities, the feature-flag
 * loader, and `getUI()` as the answerer. It maps every progress event back
 * onto `getUI()` one call per event and mirrors program data, including the
 * event plan and audit checks runProgram watches, onto the session and the UI,
 * then applies the result — `wizardAbort` with the outcome's terminal status
 * for a decided failure, the terminal analytics event for a finished top-level
 * run.
 *
 * This is the only file that knows about `getUI()`, the session and
 * `wizardAbort` on the agent's behalf. The TUI and headless hosts replace it
 * in Release C.
 */

import { isDeepStrictEqual } from 'node:util';
import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { getUI, type WizardUI } from '@ui';
import { createUiReducer, uiInteraction } from '@ui/agent-progress';
import { RunOutcome } from '@agent';
import type { InferenceAuthProvider } from '@agent/types';
import {
  runProgram,
  type ProgramWorkflowConnector,
  type WizardFlagSnapshot,
} from './run-program';
import type { CredentialsProvider } from './credentials';
import type { ProgramInvocationData } from './program-store';
import type { ProgramRun } from './program-run';
import { restoreClaudeSettings } from '@shared/claude-settings';
import { preflight, type ProgramPreflightHost } from './preflight';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';
import { isNonInteractiveEnvironment } from '@utils/environment';
import { Sequence, type Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import type { ProgramConfig } from './program-step';
import { authenticate } from './authenticate';
import { getDetectedWarehouseSources } from './warehouse-source/detect';
import { mayReportScanResults } from '@shared/scan-consent';
import { AUDIT_CHECKS_KEY } from './audit/types';

/**
 * Resolve a ProgramConfig's agent run definition and execute the pipeline.
 * Entry point for the runners and for composed run steps.
 */
export async function runProgramAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
  options: {
    composed?: boolean;
    inferenceAuth?: InferenceAuthProvider;
    deferSkillCleanupCommit?: boolean;
  } = {},
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  const runDef =
    typeof programConfig.run === 'function'
      ? await programConfig.run(session)
      : programConfig.run;

  await runLegacyStep(
    session,
    runDef,
    programConfig,
    options.composed ?? false,
    options.inferenceAuth,
    options.deferSkillCleanupCommit,
  );
}

/**
 * Preflight → runProgram with the session's capabilities → apply the result.
 * runProgram authenticates, stamps, parks, routes, refreshes and runs, in the
 * order the agent's bootstrap did.
 */
async function runLegacyStep(
  session: WizardSession,
  run: ProgramRun,
  programConfig: ProgramConfig,
  composed: boolean,
  inferenceAuth?: InferenceAuthProvider,
  deferSkillCommit?: boolean,
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

  // 2–3. Health check (skipped when the TUI already ran it), then settings conflicts.
  const pre = await preflight(programConfig.id, legacyPreflightHost(session));
  if (pre.kind === 'abort') await wizardAbort(pre.failure);

  const ui = getUI();
  const reduceUi = createUiReducer(ui);
  const projectData = projectProgramData(ui, session, () =>
    restoreClaudeSettings(session.installDir),
  );

  // runProgram turns a host capability that throws into a failed run; the CLI
  // roots expect the throw, so keep the error and rethrow it below.
  let hostFailure: { error: unknown } | undefined;
  const keepFailure = <T>(work: Promise<T>): Promise<T> =>
    work.catch((error: unknown) => {
      hostFailure ??= { error };
      throw error;
    });
  const provider = sessionCredentialsProvider(session, inferenceAuth);

  const framework = session.integration ?? session.skillId ?? undefined;
  const programResult = await runProgram(
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
      },
      allowedTools: programConfig.allowedTools,
      disallowedTools: programConfig.disallowedTools,
      agentFlow: programConfig.agentFlow,
      auditLedgerFile: programConfig.auditLedgerFile,
      aiSdkStampReported: session.aiSdkStampReported,
      discoveredFeatures: session.discoveredFeatures,
      warehouseSources: getDetectedWarehouseSources(session),
      mayReportScanResults: mayReportScanResults(session),
    },
    {
      credentials: {
        resolve: (programId, context) =>
          keepFailure(provider.resolve(programId, context)),
      },
      featureFlags: () => keepFailure(loadWizardFlags()),
      workflow: legacyWorkflowConnector(ui),
      onProgress: (progress) => {
        if (progress.kind === 'run') reduceUi(progress.event);
        else projectData(progress.data);
      },
      interaction: uiInteraction(ui),
      deferSkillCommit,
      // AI opt-in enforcement. Parks while AiOptInRequiredScreen is up if the
      // org hasn't approved third-party AI — before the skill install and agent
      // start, so no source leaves the machine. The screen alone is cosmetic;
      // this await is the actual gate.
      awaitAiApproval: async () => {
        logToFile('[agent-runner] checking AI opt-in gate');
        await ui.waitForAiOptIn();
        logToFile('[agent-runner] AI opt-in gate cleared');
        return true;
      },
    },
  );
  if (hostFailure) throw hostFailure.error;

  // The host owns process exits, terminal analytics and rethrowing crashes.
  if (programResult.outcome === RunOutcome.Crashed) {
    throw (
      programResult.failure?.error ??
      new Error(programResult.failure?.message ?? 'Program run crashed')
    );
  }
  if (programResult.outcome !== RunOutcome.Success) {
    if (programResult.failure?.authErrorDetail) {
      ui.showAuthError(programResult.failure.authErrorDetail);
    }
    // The terminal status follows how the run ended, not whether an Error came back.
    await wizardAbort({
      ...programResult.failure,
      status:
        programResult.outcome === RunOutcome.Aborted ? 'cancelled' : 'error',
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

// ── Host capabilities ─────────────────────────────────────────────────

/**
 * The session's login as a credentials provider. authenticate() is idempotent
 * within a run: a second agent run in the same invocation (self-driving's
 * integration phase) reuses the first login instead of another OAuth.
 */
function sessionCredentialsProvider(
  session: WizardSession,
  inferenceAuth?: InferenceAuthProvider,
): CredentialsProvider {
  return {
    resolve: async (programId) => {
      await authenticate(session, programId);
      return {
        posthog: session.credentials!,
        inferenceAuth: inferenceAuth ?? session.inferenceAuth,
        project: session.apiProject,
        apiUser: session.apiUser,
      };
    },
  };
}

/**
 * Answers runProgram's pauses from the TUI. Post-auth parks on each gated step
 * the user completes after login, such as the source-maps project picker; the
 * legacy run reads that pick live when it builds its prompt. The TUI walks
 * composed steps itself (advanceStep) and gated the handoff and GitHub steps
 * before this run screen.
 */
function legacyWorkflowConnector(ui: WizardUI): ProgramWorkflowConnector {
  return {
    async step(request) {
      switch (request.kind) {
        case 'post-auth':
          for (const gate of request.gates) {
            logToFile(`[agent-runner] awaiting post-auth gate: ${gate.id}`);
            await ui.waitForGate(gate.id);
            logToFile(`[agent-runner] post-auth gate cleared: ${gate.id}`);
          }
          return { kind: 'post-auth' };
        case 'child-run':
          return { kind: 'child-run', input: null };
        case 'confirm':
          return { kind: 'confirm', confirmed: true };
      }
    },
  };
}

/** Mirror the invocation's data onto the session and the UI the TUI reads. */
function projectProgramData(
  ui: WizardUI,
  session: WizardSession,
  restoreSettings: () => void,
): (data: ProgramInvocationData) => void {
  let outroRestoreRegistered = false;
  // Snapshots are copies, so forward by value; the store starts with no plan.
  let eventPlan: ProgramInvocationData['eventPlan'] = [];
  let auditChecks: unknown;
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
    // Linear settings restoration fires on entry to the outro screen, so it is
    // registered before the run can reach that screen; the abort path still
    // restores through the cleanup backupAndFixClaudeSettings registered.
    if (data.binding?.sequence === Sequence.linear && !outroRestoreRegistered) {
      outroRestoreRegistered = true;
      ui.onEnterScreen('outro', restoreSettings);
    }
    if (!isDeepStrictEqual(data.eventPlan, eventPlan)) {
      eventPlan = data.eventPlan;
      ui.setEventPlan(eventPlan);
    }
    const checks = data.detection.frameworkContext[AUDIT_CHECKS_KEY];
    if (checks !== undefined && !isDeepStrictEqual(checks, auditChecks)) {
      auditChecks = checks;
      ui.setFrameworkContext(AUDIT_CHECKS_KEY, checks);
    }
  };
}

const loadWizardFlags = async (): Promise<WizardFlagSnapshot> => ({
  flags: await analytics.getAllFlagsForWizard(),
  payloads: analytics.getWizardFlagPayloads(),
});

// ── Gates ─────────────────────────────────────────────────────────────

/** Map the preflight port onto the session and `getUI()`. */
function legacyPreflightHost(session: WizardSession): ProgramPreflightHost {
  if (session.readinessResult) {
    logToFile(
      `[agent-runner] readiness pre-computed by TUI: decision=${session.readinessResult.decision}` +
        `${
          session.outageDismissed ? ' (outage dismissed by user)' : ''
        } — skipping re-check`,
    );
  }
  return {
    installDir: session.installDir,
    signup: session.signup,
    interactive: !isNonInteractiveEnvironment(),
    readiness: session.readinessResult,
    showOutage: (readiness) => getUI().showBlockingOutage(readiness),
    setReadinessWarnings: (readiness) =>
      getUI().setReadinessWarnings(readiness),
    showSettingsOverride: (conflicts, fix) =>
      getUI().showSettingsOverride(conflicts, fix),
  };
}
