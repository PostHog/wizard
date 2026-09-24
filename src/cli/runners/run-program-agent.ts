/** Runs a ProgramConfig through runProgram with the session, `getUI()` and `wizardAbort` as its host, until Release C replaces it. */

import { isDeepStrictEqual } from 'node:util';
import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { createUiReducer, getUI, uiInteraction, type WizardUI } from '@ui';
import { RunOutcome, TASK_OUTCOMES_KEY } from '@agent';
import { runProgram, preflight } from '@programs';
import type {
  ProgramCompletionContext,
  ProgramConfig,
  ProgramInvocationData,
  ProgramPreflightHost,
  ProgramRunHost,
  ProgramWorkflowConnector,
  WizardFlagSnapshot,
} from '@programs/types';
import { restoreClaudeSettings } from '@shared/claude-settings';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';
import { isNonInteractiveEnvironment } from '@utils/environment';
import { Sequence, type Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { authenticate } from '@programs/authenticate';
import { getDetectedWarehouseSources } from '@programs/warehouse-source/detect';
import { mayReportScanResults } from '@shared/scan-consent';
import { AUDIT_CHECKS_KEY } from '@programs/audit/types';

/** Resolve the program's run from the session, preflight, run it through runProgram and apply the result. */
export async function runProgramAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
  options: { composed?: boolean } = {},
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  const ui = getUI();
  const runHost: ProgramRunHost = {
    getFrameworkContext: (key) => ui.getFrameworkContext(key),
    setFrameworkContext: (key, value) => ui.setFrameworkContext(key, value),
    info: (message) => ui.log.info(message),
    warn: (message) => ui.log.warn(message),
    spinner: () => ui.spinner(),
  };
  const run =
    typeof programConfig.run === 'function'
      ? await programConfig.run(session, runHost)
      : programConfig.run;
  const composed = options.composed ?? false;

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

  const reduceUi = createUiReducer(ui);
  const projectData = projectProgramData(ui, session, () =>
    restoreClaudeSettings(session.installDir),
  );

  // runProgram turns a throwing host capability into a failed run; the CLI roots expect the throw.
  let hostFailure: { error: unknown } | undefined;
  const keepFailure = <T>(work: Promise<T>): Promise<T> =>
    work.catch((error: unknown) => {
      hostFailure ??= { error };
      throw error;
    });

  const framework = session.integration ?? session.skillId ?? undefined;
  // Each hook reads the session when it runs, so URLs the run emitted reach it.
  const completionContext = (): ProgramCompletionContext => ({
    signup: session.signup,
    dashboardUrl: session.dashboardUrl,
    notebookUrl: session.notebookUrl,
  });
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
          ? (creds) => run.postRun!(completionContext(), creds)
          : undefined,
        buildOutroData: run.buildOutroData
          ? (creds) =>
              run.buildOutroData!(completionContext(), creds) ?? undefined
          : undefined,
        buildOutroNextSteps: run.buildOutroNextSteps
          ? (creds, completed) =>
              run.buildOutroNextSteps!(completionContext(), creds, completed)
          : undefined,
        recordTaskOutcomes: (outcomes) => {
          session.frameworkContext[TASK_OUTCOMES_KEY] = outcomes;
        },
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
        // authenticate() is idempotent, so a later run in the same invocation reuses the login.
        resolve: (programId) =>
          keepFailure(
            authenticate(session, programId, ui).then(() => ({
              posthog: session.credentials!,
              inferenceAuth: session.inferenceAuth,
              project: session.apiProject,
              apiUser: session.apiUser,
            })),
          ),
      },
      featureFlags: () => keepFailure(loadWizardFlags()),
      workflow: legacyWorkflowConnector(ui, session),
      onProgress: (progress) => {
        if (progress.kind === 'run') reduceUi(progress.event);
        else projectData(progress.data);
      },
      interaction: uiInteraction(ui),
      // The CLI roots commit new skills at exit, so a later drain still removes them.
      deferSkillCommit: true,
      // The actual AI opt-in gate: it parks before the skill install and agent start.
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

// ── Host capabilities ─────────────────────────────────────────────────

/** Answers runProgram's pauses from the TUI, which walks composed steps and gates handoff and GitHub itself. */
function legacyWorkflowConnector(
  ui: WizardUI,
  session: WizardSession,
): ProgramWorkflowConnector {
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
          // Answer with the actual TUI gate state: a non-TUI caller of this
          // adapter must not be treated as connected.
          return {
            kind: 'confirm',
            confirmed:
              request.id === 'self-driving-github'
                ? session.githubConnected === true
                : true,
          };
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
    // Registered before the run can reach the outro; the abort path restores through its own cleanup.
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
