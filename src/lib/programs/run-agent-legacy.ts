/**
 * The session-driven agent runner every existing caller uses.
 *
 * `runAgent(programConfig, session)` rebuilds today's behavior on top of the
 * functional `runAgent(config, input, options)` in `@lib/agent/runner`: it
 * runs the gates the TUI owns (health, settings, AI opt-in, post-auth steps),
 * authenticates, resolves the program's binding, builds the agent's inputs
 * from the session, maps every progress event back onto `getUI()` one call
 * per event, answers the agent's questions through `getUI()`, and applies the
 * result — `wizardAbort` for a decided failure, nothing more for success.
 *
 * This is the only file that knows about `getUI()`, the session and
 * `wizardAbort` on the agent's behalf. Programs replace it in Release B.
 */

import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { getUI, type WizardUI } from '@ui';
import type { SpinnerHandle } from '@lib/agent/progress';
import type { AgentInteraction, AgentProgress } from '@lib/agent/progress';
import {
  runAgent as runAgentFunctional,
  resolveBinding,
  type RunConfig,
  type RunInput,
  type SwitchboardCtx,
} from '@lib/agent/runner';
import type { ProgramBinding } from '@lib/agent/runner/switchboard';
import { buildRunTags } from '@lib/agent/agent-interface';
import {
  backupAndFixClaudeSettings,
  checkAllSettingsConflicts,
  classifySettingsConflicts,
  restoreClaudeSettings,
} from '@lib/agent/claude-settings';
import { flushScanReport } from '@lib/yara-hooks';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@lib/health-checks/readiness';
import { enableDebugLogs, logToFile, initLogFile } from '@utils/debug';
import { registerCleanup, wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';
import { isNonInteractiveEnvironment } from '@utils/environment';
import {
  getSkillsBaseUrl,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  type Integration,
} from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { postAuthGateSteps, type ProgramConfig } from './program-step';
import type { ProgramRun } from './program-run';
import { authenticate, refreshAccessTokenIfNeeded } from './authenticate';
import { maybeStampAiSdkDetected } from './posthog-integration/detect';
import { startAuditLedgerWatcher } from './audit/ledger-watcher';
import { bindingFor } from './bindings';

/**
 * Resolve a ProgramConfig's agent run definition and execute the pipeline.
 * Entry point for the runners and for composed run steps.
 */
export async function runAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
  options: { composed?: boolean } = {},
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

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

    await runProgram(session, runDef, programConfig, options.composed ?? false);
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
  await refreshAccessTokenIfNeeded(session);

  // Credentials (incl. the resolved host family and its MCP url) live on
  // `session.credentials`; narrow once at this boundary — `authenticate` above
  // set them — so downstream readers get a non-null type without asserting.
  const credentials = session.credentials!;

  // Resolve which sequence and harness will run a program (CLI → PostHog flag →
  // per-program binding → default), tag both axes onto analytics, and hand the
  // binding to the agent for dispatch.
  const switchboard: SwitchboardCtx = {
    program: programConfig.id,
    composed,
    flags: wizardFlags,
    flagPayloads: wizardFlagPayloads,
    cliHarness: session.harness,
    cliSequence: session.sequence,
    cliModel: session.model,
    binding: bindingFor(programConfig.id),
  };
  const binding = resolveBinding(switchboard);
  analytics.setTag('sequence', binding.sequence);
  analytics.setTag('harness', binding.harness);
  wizardMetadata.SEQUENCE = binding.sequence;
  wizardMetadata.HARNESS = binding.harness;
  captureSwitchboardDecision(switchboard, binding);

  const ui = getUI();

  // Cleanup coverage for the abort/cancel path: `wizardAbort` runs the
  // registered cleanups, and the agent's own `finally` covers completion.
  // flushScanReport is idempotent, so the overlap is a harmless no-op.
  registerCleanup(() =>
    flushScanReport({ yaraReport: session.yaraReport }, (message) =>
      ui.log.info(message),
    ),
  );

  // Linear settings restoration fires on entry to the outro screen, so it
  // is registered before the run can reach that screen. Same owner, same
  // timing as before; the abort path still restores through the cleanup
  // `backupAndFixClaudeSettings` registered.
  if (binding.sequence === Sequence.linear) {
    ui.onEnterScreen('outro', () => restoreClaudeSettings(session.installDir));
  }

  const framework = session.integration ?? session.skillId ?? undefined;
  const config: RunConfig = {
    programId: programConfig.id,
    run,
    composed,
    binding,
    switchboard,
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

  const result = await runAgentFunctional(config, input, {
    onProgress: createUiReducer(ui),
    interaction: uiInteraction(ui),
  });

  // Success already rendered through the reducer (outro data, outro line) and
  // shut analytics down. A decided failure exits exactly as it always has. An
  // error the agent did not decide used to propagate out of this call, and the
  // runners handle it (mint-failure screen, classifyRunFailure): keep throwing
  // the original error for them.
  if (result.outcome === 'crashed') {
    throw result.failure?.error ?? new Error(result.failure?.message);
  }
  if (result.outcome !== 'success') {
    await wizardAbort(result.failure);
  }
}

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

// ── Switchboard telemetry ─────────────────────────────────────────────

/**
 * One event + one log line per run: what entered the switchboard, which
 * precedence rung decided each axis, and the final pick.
 */
function captureSwitchboardDecision(
  ctx: SwitchboardCtx,
  binding: ProgramBinding,
): void {
  const trace = ctx.trace ?? {};
  // Unpinned orchestrator runs choose a model per task from the context-mill agent prompts; the orchestrator logs that map once the prompts load.
  const perTaskModel =
    binding.sequence === Sequence.orchestrator && trace.model === 'binding';
  const model = perTaskModel ? 'chosen-per-task' : binding.model;
  const modelSource = perTaskModel ? 'agent-prompts' : trace.model;
  analytics.wizardCapture('switchboard resolved', {
    program: ctx.program,
    flag_self_driving_use_pi_harness:
      ctx.flags[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY],
    flag_self_driving_pi_payload: JSON.stringify(
      ctx.flagPayloads?.[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY] ?? null,
    ),
    flag_orchestrator: ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY],
    cli_harness: ctx.cliHarness,
    cli_sequence: ctx.cliSequence,
    cli_model: ctx.cliModel,
    harness_source: trace.harness,
    model_source: modelSource,
    sequence_source: trace.sequence,
    harness: binding.harness,
    model,
    thinking_level: binding.thinkingLevel,
    sequence: binding.sequence,
  });
  logToFile(
    `[switchboard] decision: program=${ctx.program}` +
      ` in(orchestrator=${ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY] ?? '-'},` +
      ` cli=${ctx.cliHarness ?? '-'}/${ctx.cliSequence ?? '-'}/${
        ctx.cliModel ?? '-'
      })` +
      ` → harness=${binding.harness} (${trace.harness ?? '?'})` +
      ` model=${model} (${modelSource ?? '?'})` +
      ` sequence=${binding.sequence} (${trace.sequence ?? '?'})`,
  );
}

// ── Progress → WizardUI, one call per event ───────────────────────────

/**
 * The inverse of the agent's former `getUI()` calls: one event, one
 * `WizardUI` method, synchronous, in emission order. Because each case maps
 * back to exactly the call the agent used to make, the frame and flow goldens
 * hold without regeneration.
 */
export function createUiReducer(ui: WizardUI): (event: AgentProgress) => void {
  let spinner: SpinnerHandle | undefined;
  return (event) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'started') ui.startRun();
        else ui.outro(event.message);
        break;
      case 'spinner': {
        const handle = (spinner ??= ui.spinner());
        handle[event.action](event.message);
        break;
      }
      case 'log':
        ui.log[event.level](event.message);
        break;
      case 'status':
        ui.pushStatus(event.message);
        break;
      case 'tasks':
        ui.syncTodos(event.tasks);
        break;
      case 'stage':
        ui.setStage(event.stage);
        break;
      case 'url':
        if (event.which === 'dashboard') ui.setDashboardUrl(event.url);
        else ui.setNotebookUrl(event.url);
        break;
      case 'usage':
        ui.addTokenUsage(event.delta);
        break;
      case 'finalCost':
        ui.setFinalTokenCostUsd(event.usd);
        break;
      case 'handoff':
        ui.setHandoffText(event.text);
        break;
      case 'authError':
        ui.showAuthError(event.detail);
        break;
      case 'completion':
        ui.setOutroData(event.outro);
        break;
    }
  };
}

/** The agent's questions, answered wherever `getUI()` answers them today. */
export function uiInteraction(ui: WizardUI): AgentInteraction {
  return {
    ask: (question) => ui.requestQuestion(question),
    cancelAsk: () => ui.cancelPendingQuestion(),
    taskNotice: (notice) => ui.showTaskNotice(notice),
    cancelTaskNotice: () => ui.cancelTaskNotice(),
  };
}
