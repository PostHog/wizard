/**
 * The session-driven host adapter for legacy TUI and CI runs.
 *
 * `runProgramAgent(programConfig, session)` bridges the host to the callable
 * program: it
 * runs the gates the TUI owns (health, settings, AI opt-in, post-auth steps),
 * authenticates, resolves the program's binding, builds the agent's inputs
 * from the session, maps every progress event back onto `getUI()` one call
 * per event, answers the agent's questions through `getUI()`, and applies the
 * result — `wizardAbort` for a decided failure, nothing more for success.
 *
 * The host owns `getUI()`, the legacy session, and `wizardAbort`; the callable
 * program receives explicit input and effects.
 */

import { analytics } from '@utils/analytics';
import { buildRunTags, flushScanReport, RunOutcome } from '@agent';
import type { InferenceAuthProvider, RunConfig, RunInput } from '@agent/types';
import {
  runProgram as runCallableProgram,
  createPosthogInferenceAuthProvider,
  resolveProgramBinding,
  getProgramCommandments,
  captureSwitchboardDecision,
  areSeededTasksEnabled,
  resolveStageOverrides,
  type ProgramSwitchboardCtx,
  FRAMEWORK_REGISTRY,
  authenticate,
  refreshAccessTokenIfNeeded,
  maybeStampAiSdkDetected,
  startAuditLedgerWatcher,
  AUDIT_CHECKS_KEY,
  createUiReducer,
  uiInteraction,
} from '@programs';
import type {
  HostFailure,
  ProgramCompletionContext,
  ProgramRunHost,
  ProgramRun,
} from '@programs/types';
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
import { ErrorCodes } from '@shared/errors';
import { isNonInteractiveEnvironment } from '@utils/environment';
import {
  getSkillsBaseUrl,
  Sequence,
  type Integration,
} from '@shared/constants';
import type { ProgramConfig } from '@programs/types';
import { captureRunSkillCleanup } from '@shared/skill-run-cleanup';
import { cliAuthHost } from './auth-host';
import type { WizardSession } from '@tui/types';
import { getUI } from '../ui';
import { registerCleanup } from '@utils/cleanup-registry';
import { wizardAbort } from '../wizard-abort';

/** Ends a run with a decided failure. */
type HostAbort = (failure?: HostFailure) => Promise<never>;

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
    /** How a decided failure ends the run; a controlled run fails its request instead of exiting. */
    abort?: HostAbort;
  } = {},
): Promise<void> {
  const abort = options.abort ?? ((failure) => wizardAbort(failure));
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  // wizardAbort and TUI signal handlers drain this registry on interruption.
  const cleanupInstalledSkills = captureRunSkillCleanup(session.installDir);
  registerCleanup(cleanupInstalledSkills);

  // Before `run()` resolves: an audit seeds the ledger from inside its recipe,
  // and a watcher started later would ignore that write as pre-existing.
  const ledger = programConfig.auditLedgerFile
    ? startAuditLedgerWatcher(
        session.installDir,
        programConfig.auditLedgerFile,
        (checks) => getUI().setFrameworkContext(AUDIT_CHECKS_KEY, checks),
      )
    : null;
  if (ledger) registerCleanup(() => ledger.stop());

  try {
    const ui = getUI();
    const runHost: ProgramRunHost = {
      getFrameworkContext: (key) => ui.getFrameworkContext(key),
      setFrameworkContext: (key, value) => ui.setFrameworkContext(key, value),
      info: (message) => ui.log.info(message),
      warn: (message) => ui.log.warn(message),
      spinner: () => ui.spinner(),
    };
    const runDef =
      typeof programConfig.run === 'function'
        ? await programConfig.run(session, runHost)
        : programConfig.run;

    await runProgram(
      session,
      runDef,
      programConfig,
      options.composed ?? false,
      options.inferenceAuth,
      abort,
    );
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
async function runProgram(
  session: WizardSession,
  run: ProgramRun,
  programConfig: ProgramConfig,
  composed: boolean,
  inferenceAuth: InferenceAuthProvider | undefined,
  abort: HostAbort,
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
  await runHealthGate(session, programConfig, abort);

  // 3. Settings conflicts
  await runSettingsGate(session, abort);

  analytics.wizardCapture('agent started', {
    integration: run.integrationLabel,
    program_id: programConfig.id,
    skill_id: run.skillId ?? null,
  });

  // 4. Authenticate — idempotent within a run (see authenticate()). A second
  // agent run in the same invocation (self-driving's integration phase) reuses
  // the first login; it does not launch another OAuth. authenticate() also
  // identifies the user and sets analytics groups.
  await authenticate(session, programConfig.id, cliAuthHost(abort));
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
  // The program's TUI flow names its post-auth gates; loaded here, not at startup.
  const { postAuthGateSteps } = await import('@tui');
  const { rawProgramFlow } = await import('@tui');
  for (const step of postAuthGateSteps(rawProgramFlow(programConfig.id))) {
    logToFile(`[agent-runner] awaiting post-auth gate: ${step.id}`);
    await getUI().waitForGate(step.id);
    logToFile(`[agent-runner] post-auth gate cleared: ${step.id}`);
  }

  // Feature flags. Both arms need these, and the routing decision reads them.
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardFlagPayloads = analytics.getWizardFlagPayloads();

  // Gateway trace tags for this run; the binding below stamps its axes on.
  const wizardMetadata = buildRunTags({
    programId: programConfig.id,
    integration: run.integrationLabel,
    runId: analytics.runId,
    build: analytics.build,
    skillId: run.skillId,
  });

  // The agent can't swap tokens mid-run, so freshness is measured after every
  // park above, right before the agent mints.
  await refreshAccessTokenIfNeeded(session, getUI());

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
  wizardMetadata.SEQUENCE = binding.sequence;
  wizardMetadata.HARNESS = binding.harness;
  captureSwitchboardDecision(switchboard, binding);

  const ui = getUI();

  // Cleanup coverage for the abort/cancel path: `wizardAbort` runs the
  // registered cleanups, and the agent's own `finally` covers completion.
  // flushScanReport is idempotent, so the overlap is a harmless no-op.
  registerCleanup(() => {
    const report = flushScanReport({ yaraReport: session.yaraReport });
    if (report) ui.log.info(report);
  });

  // Linear settings restoration fires on entry to the outro screen, so it
  // is registered before the run can reach that screen. Same owner, same
  // timing as before; the abort path still restores through the cleanup
  // `backupAndFixClaudeSettings` registered.
  if (binding.sequence === Sequence.linear) {
    ui.onEnterScreen('outro', () => restoreClaudeSettings(session.installDir));
  }

  const framework = session.integration ?? session.skillId ?? undefined;
  const completionContext = (): ProgramCompletionContext => ({
    signup: session.signup,
    dashboardUrl: session.dashboardUrl,
    notebookUrl: session.notebookUrl,
  });
  const config: RunConfig = {
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
    wizardMetadata,
    allowedTools: programConfig.allowedTools,
    disallowedTools: programConfig.disallowedTools,
    agentFlow: programConfig.agentFlow,
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
  const programResult = await runCallableProgram(
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
      wizardMetadata: config.wizardMetadata,
      seedTasks: config.seedTasks,
      hooks: config.hooks,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      agentFlow: config.agentFlow,
      // Carry the actual TUI gate state into the callable host. A non-TUI
      // caller of this legacy adapter must not be treated as connected.
      composition:
        programConfig.id === 'self-driving'
          ? {
              githubConnected: session.githubConnected === true,
              handoffConfirmed: session.selfDrivingHandoffConfirmed,
            }
          : undefined,
    },
    {
      onProgress: ({ event }) => reduceUi(event),
      interaction: uiInteraction(ui),
      awaitAiApproval: async () => {
        await ui.waitForAiOptIn();
        return true;
      },
    },
  );

  // The host owns process exits and rethrowing crashes.
  if (programResult.outcome === RunOutcome.Crashed) {
    throw (
      programResult.failure?.error ??
      new Error(programResult.failure?.message ?? 'Program run crashed')
    );
  }
  if (programResult.outcome !== RunOutcome.Success) {
    await abort(programResult.failure ?? {});
  }
}

// ── Gates ─────────────────────────────────────────────────────────────

async function runHealthGate(
  session: WizardSession,
  programConfig: ProgramConfig,
  abort: HostAbort,
): Promise<void> {
  const { rawProgramFlow } = await import('@tui');
  const hasHealthCheckScreen = rawProgramFlow(programConfig.id).some(
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
      await abort({
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

async function runSettingsGate(
  session: WizardSession,
  abort: HostAbort,
): Promise<void> {
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
      await abort({
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
