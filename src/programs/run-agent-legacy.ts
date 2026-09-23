/**
 * The session-driven agent runner every existing caller uses.
 *
 * `runProgramAgent(programConfig, session)` rebuilds today's behavior on top of the
 * functional `runAgent(config, input, options)` in `@lib/agent/runner`: it
 * runs the gates the TUI owns (health, settings, AI opt-in, post-auth steps),
 * authenticates, resolves the program's binding, builds the agent's inputs
 * from the session, maps every progress event back onto `getUI()` one call
 * per event, answers the agent's questions through `getUI()`, and applies the
 * result — `wizardAbort` with the outcome's terminal status for a decided
 * failure, the terminal analytics event for a finished top-level run.
 *
 * This is the only file that knows about `getUI()`, the session and
 * `wizardAbort` on the agent's behalf. Programs replace it in Release B.
 */

import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import { createUiReducer, uiInteraction } from '@ui/agent-progress';
import { RunOutcome } from '@agent';
import type { InferenceAuthProvider, RunConfig, RunInput } from '@agent/types';
import { runProgram } from './run-program';
import { createPosthogInferenceAuthProvider } from './credentials';
import { resolveProgramBinding, type ProgramSwitchboardCtx } from './binding';
import { getProgramCommandments } from './commandments';
import { captureSwitchboardDecision } from './binding-telemetry';
import { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
import type { ProgramRun } from './program-run';
import { restoreClaudeSettings } from '@shared/claude-settings';
import { preflight, type ProgramPreflightHost } from './preflight';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { registerCleanup, wizardAbort } from '@utils/wizard-abort';
import { isNonInteractiveEnvironment } from '@utils/environment';
import {
  getSkillsBaseUrl,
  Sequence,
  type Integration,
} from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/registry';
import { postAuthGateSteps, type ProgramConfig } from './program-step';
import { authenticate, refreshAccessTokenIfNeeded } from './authenticate';
import { maybeStampAiSdkDetected } from './posthog-integration/detect';
import { getDetectedWarehouseSources } from './warehouse-source/detect';
import { mayReportScanResults } from '@shared/scan-consent';
import { startAuditLedgerWatcher } from './audit/ledger-watcher';
import {
  commitRegisteredRunSkillCleanups,
  registerRunSkillCleanup,
} from '@shared/skill-run-cleanup';

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

  // wizardAbort and TUI signal handlers drain this registry on interruption.
  const cleanupInstalledSkills = registerRunSkillCleanup(session.installDir);

  // Before `run()` resolves: an audit seeds the ledger from inside its recipe,
  // and a watcher started later would ignore that write as pre-existing.
  const ledger = programConfig.auditLedgerFile
    ? startAuditLedgerWatcher(session.installDir, programConfig.auditLedgerFile)
    : null;
  if (ledger) registerCleanup(() => ledger.stop());

  try {
    const runDef =
      typeof programConfig.run === 'function'
        ? await programConfig.run(session)
        : programConfig.run;

    const succeeded = await runLegacyStep(
      session,
      runDef,
      programConfig,
      options.composed ?? false,
      options.inferenceAuth,
    );
    if (succeeded && !options.deferSkillCleanupCommit) {
      commitRegisteredRunSkillCleanups();
    }
  } catch (error) {
    try {
      cleanupInstalledSkills();
    } catch (cleanupError) {
      logToFile('[agent-runner] failed-run skill cleanup error:', cleanupError);
    }
    throw error;
  } finally {
    ledger?.stop();
  }
}

/**
 * Gates → authenticate → flags → binding → the functional run → apply result.
 * Every step happens in the order it did inside the agent's bootstrap.
 */
async function runLegacyStep(
  session: WizardSession,
  run: ProgramRun,
  programConfig: ProgramConfig,
  composed: boolean,
  inferenceAuth?: InferenceAuthProvider,
): Promise<boolean> {
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

  analytics.wizardCapture('agent started', {
    integration: run.integrationLabel,
    program_id: programConfig.id,
    skill_id: run.skillId ?? null,
  });

  // 4. Authenticate — idempotent within a run (see authenticate()). A second
  // agent run in the same invocation (self-driving's integration phase) reuses
  // the first login; it does not launch another OAuth. authenticate() also
  // identifies the user and sets analytics groups.
  await authenticate(session, programConfig.id);
  maybeStampAiSdkDetected(session);

  // 4.5. AI opt-in enforcement. Parks here while AiOptInRequiredScreen is
  // up if the org hasn't approved third-party AI — BEFORE the skill
  // install and agent start, so no source leaves the machine. The screen
  // alone is cosmetic; this await is the actual gate. Resolves
  // immediately when the program declared requiresAi: false or in CI.
  logToFile('[agent-runner] checking AI opt-in gate');
  await getUI().waitForAiOptIn();
  logToFile('[agent-runner] AI opt-in gate cleared');

  // Park for any interactive step the user must complete AFTER authenticating
  // but BEFORE the agent runs — e.g. the source-maps project picker, which
  // needs credentials to scan and writes its choice to frameworkContext that
  // the run prompt reads. Generic: await every gated step between auth and run.
  for (const step of postAuthGateSteps(programConfig.steps)) {
    logToFile(`[agent-runner] awaiting post-auth gate: ${step.id}`);
    await getUI().waitForGate(step.id);
    logToFile(`[agent-runner] post-auth gate cleared: ${step.id}`);
  }

  // Feature flags. Both arms need these, and the routing decision reads them.
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardFlagPayloads = analytics.getWizardFlagPayloads();

  // The agent can't swap tokens mid-run, so freshness is measured after every
  // park above, right before the agent mints.
  await refreshAccessTokenIfNeeded(session);

  // Credentials (incl. the resolved host family and its MCP url) live on
  // `session.credentials`; narrow once at this boundary — `authenticate` above
  // set them — so downstream readers get a non-null type without asserting.
  const credentials = session.credentials!;
  const resolvedInferenceAuth =
    inferenceAuth ??
    session.inferenceAuth ??
    createPosthogInferenceAuthProvider(credentials, programConfig.id);

  // Resolve which sequence and harness will run a program (CLI → PostHog flag →
  // per-program binding → default), tag both axes onto analytics, and hand the
  // binding to the agent for dispatch.
  const switchboard: ProgramSwitchboardCtx = {
    program: programConfig.id,
    composed,
    flags: wizardFlags,
    flagPayloads: wizardFlagPayloads,
    cliHarness: session.harness,
    cliSequence: session.sequence,
    cliModel: session.model,
  };
  const binding = resolveProgramBinding(switchboard);
  analytics.setTag('sequence', binding.sequence);
  analytics.setTag('harness', binding.harness);
  captureSwitchboardDecision(switchboard, binding);

  const ui = getUI();

  // Linear settings restoration fires on entry to the outro screen, so it
  // is registered before the run can reach that screen. Same owner, same
  // timing as before; the abort path still restores through the cleanup
  // `backupAndFixClaudeSettings` registered.
  if (binding.sequence === Sequence.linear) {
    ui.onEnterScreen('outro', () => restoreClaudeSettings(session.installDir));
  }

  const framework = session.integration ?? session.skillId ?? undefined;
  // runProgram builds the gateway trace tags.
  const config: Omit<RunConfig, 'wizardMetadata'> = {
    programId: programConfig.id,
    run,
    composed,
    binding,
    programCommandments: getProgramCommandments(programConfig.id),
    stageOverrides: resolveStageOverrides(
      programConfig.id,
      wizardFlags,
      wizardFlagPayloads,
    ),
    seededTasksEnabled: areSeededTasksEnabled(wizardFlags),
    skillsBaseUrl: getSkillsBaseUrl(),
    wizardFlags,
    wizardFlagPayloads,
    allowedTools: programConfig.allowedTools,
    disallowedTools: programConfig.disallowedTools,
    agentFlow: programConfig.agentFlow,
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
  };
  const input: RunInput = {
    installDir: session.installDir,
    credentials,
    inferenceAuth: resolvedInferenceAuth,
    project: session.apiProject,
    apiUser: session.apiUser,
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
  };

  const reduceUi = createUiReducer(ui);
  const programResult = await runProgram(
    programConfig.id,
    {
      installDir: input.installDir,
      credentials: {
        posthog: input.credentials,
        inferenceAuth: input.inferenceAuth,
        project: input.project,
        apiUser: input.apiUser,
      },
      run: config.run,
      binding: config.binding,
      composed: config.composed,
      skillId: input.skillId,
      integration: input.integration,
      frameworkDocsUrl: input.frameworkDocsUrl,
      flags: input.flags,
      host: input.host,
      wizardFlags: config.wizardFlags,
      wizardFlagPayloads: config.wizardFlagPayloads,
      seedTasks: config.seedTasks,
      hooks: config.hooks,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      agentFlow: config.agentFlow,
      // The stamp already ran above, so runProgram finds it latched.
      aiSdkStampReported: session.aiSdkStampReported,
      discoveredFeatures: session.discoveredFeatures,
      warehouseSources: getDetectedWarehouseSources(session),
      mayReportScanResults: mayReportScanResults(session),
      // The TUI step flow has already required the GitHub connection before
      // reaching this run screen; tell the callable host that gate passed.
      composition:
        programConfig.id === 'self-driving'
          ? { githubConnected: true, handoffConfirmed: true }
          : undefined,
    },
    {
      onProgress: (progress) => {
        if (progress.kind === 'run') reduceUi(progress.event);
      },
      interaction: uiInteraction(ui),
      awaitAiApproval: async () => {
        await ui.waitForAiOptIn();
        return true;
      },
    },
  );

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
  return programResult.outcome === RunOutcome.Success;
}

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
