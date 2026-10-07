/** Run a registered program on a session store the caller owns. It never exits the process. */
import path from 'path';
import { randomUUID } from 'crypto';
import { DEFAULT_BINDING, runAgent, RunOutcome } from '@agent';
import type {
  AgentProgress,
  AgentRunDefinition,
  RunHooks,
  RunInput,
  RunResult,
} from '@agent/types';
import { getSkillsBaseUrl, type Integration } from '@shared/constants';
import { classifyRunFailure, ErrorCodes, type ErrorCode } from '@shared/errors';
import {
  backupAndFixClaudeSettings,
  checkAllSettingsConflicts,
  classifySettingsConflicts,
  restoreClaudeSettings,
} from '@shared/claude-settings';
import {
  evaluateWizardReadiness,
  getBlockingServiceKeys,
  SERVICE_LABELS,
  SIGNUP_WIZARD_READINESS_CONFIG,
  WizardReadiness,
} from '@shared/health-checks/readiness';
import { OutroKind } from '@shared/outro';
import { mayReportScanResults, RunPhase } from '@shared/run-state';
import {
  configureOAuthSession,
  currentCredentials,
} from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { removeAuditLedger, startAuditLedgerWatcher } from '@programs/audit';
import { FRAMEWORK_REGISTRY } from './frameworks/registry';
import { findProgramConfig, getProgramConfig } from './program-registry';
import { ProgramAbort } from './program-abort';
import { detectionFailure, detectProgram } from './detect-program';
import {
  rotateCredentials,
  type ResolvedProgramCredentials,
} from './credentials';
import { stampAiSdkDetected } from './detection/ai-sdk-stamp';
import { logIn } from './login';
import { getDetectedWarehouseSources } from './warehouse-sources/detect';
import { applyAgentProgress, type SessionStore } from './session/session-store';
import type { WizardSession } from './session/wizard-session';
import type { ProgramConfig, ProgramRunStep } from './program-step';
import type { ProgramRun } from './program-run';
import type { ProgramSession } from './program-session';
import type { CiRunnerContext, RunnerContext } from './runner-context';
import type {
  ProgramDiagnostic,
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramRunOutcome,
  ProgramStep,
  WizardFlagSnapshot,
} from './program-input';

/** The session's frameworkContext slot holding an orchestrated run's final task outcomes. */
export const TASK_OUTCOMES_KEY = 'orchestrator-task-outcomes';

/** Handed to the caller's capabilities when it supplied no signal. */
const NEVER_ABORTED = new AbortController().signal;

const MAX_DIAGNOSTICS = 10;

type Failure = NonNullable<RunResult['failure']>;

/** Fields that carry functions, class instances or the caller's store; everything else is data. */
const KEPT_BY_REFERENCE = [
  'store',
  'config',
  'credentials',
] as const satisfies readonly (keyof ProgramInput)[];

/** Copy the caller's input, so a later caller write cannot reach the run or its hooks. */
function snapshotProgramInput(input: ProgramInput): ProgramInput {
  const data: Partial<ProgramInput> = { ...input };
  for (const key of KEPT_BY_REFERENCE) delete data[key];
  return { ...input, ...structuredClone(data) };
}

/** One agent run of the invocation: a composed sub-run from `runSteps`, or the program's own. */
type PlannedRun = {
  stepId: string; // the host's step: a `runSteps` key, or `run`
  config: ProgramConfig; // the program whose agent runs
  runStep?: ProgramRunStep; // the run's directory and prep
  own: boolean; // the program's own run, not a composed one
};

/**
 * Run a registered program: detection, readiness, login, the host's gates,
 * then each agent run in order. Every write lands in `input.store`, and the
 * store ends settled even when the call rejects.
 */
export async function runProgram(
  programId: string,
  callerInput: ProgramInput,
  options: ProgramOptions = {},
): Promise<ProgramRunOutcome> {
  try {
    return await invokeProgram(programId, callerInput, options);
  } catch (error) {
    recordThrown(callerInput.store, error);
    throw error;
  }
}

async function invokeProgram(
  programId: string,
  callerInput: ProgramInput,
  options: ProgramOptions,
): Promise<ProgramRunOutcome> {
  const input = snapshotProgramInput(callerInput);
  const { store } = input;
  // An unregistered id runs on input.config alone.
  const config = {
    ...findProgramConfig(programId),
    ...input.config,
    id: programId,
  } as ProgramConfig;
  const signal = options.signal ?? NEVER_ABORTED;
  const runId = input.runId ?? randomUUID();
  const progress = createProgress(options.onProgress);
  const runResults: RunResult[] = [];
  const artifacts: ProgramRunOutcome['artifacts'] = {};

  const settle = (
    outcome: RunOutcome,
    failure?: Failure,
  ): ProgramRunOutcome => {
    // A caller cancel through the signal is not a run failure, so no host shows a failure screen for it.
    if (failure && signal.aborted) recordCancel(store, failure);
    else if (failure) recordFailure(store, failure);
    else recordSuccess(store);
    // A throwing progress handler is kept as a diagnostic, so log it.
    const diagnostics = progress.diagnostics();
    for (const diagnostic of diagnostics) {
      logToFile(
        `[agent-runner] progress diagnostic (${diagnostic.eventKind} run=${diagnostic.runId}): ${diagnostic.message}`,
      );
    }
    return {
      programId,
      outcome,
      runResults,
      artifacts,
      diagnostics,
      ...(failure && { failure }),
    };
  };
  const fail = (
    message: string,
    code: ErrorCode = ErrorCodes.InternalUnhandled,
  ) => settle(RunOutcome.Failed, { code, message });
  const abort = (message: string) =>
    settle(RunOutcome.Aborted, { code: ErrorCodes.AgentAbort, message });
  const cancelled = () => abort('Run cancelled by the caller.');

  if (signal.aborted) return cancelled();
  if (!config.run)
    return fail(`Program "${programId}" has no run configuration.`);

  /** Await a caller capability; a caller abort wins over its answer. */
  const park = <T>(work: Promise<T>): Promise<T> => parkOn(signal, work);
  // Log lines and the spinner from program code arrive as the program's own run's progress.
  const emit = (event: AgentProgress) => progress.deliver(runId, event);
  const runner = storeRunner(store, emit);
  const login = () =>
    park(
      logIn(programId, store, {
        credentials: input.credentials,
        provider: options.credentials,
        signal,
      }),
    );

  try {
    if (!store.session.detectionComplete) {
      await detectProgram(config, store, {
        log: runner.log,
        authenticate: async () => {
          await login();
        },
        onProgress: emit,
      } satisfies CiRunnerContext);
    }
  } catch (error) {
    // A decided stop ends the run cancelled, as main's wizardAbort({ code, message }) did.
    if (error instanceof ProgramAbort) {
      return settle(RunOutcome.Aborted, {
        code: error.code,
        message: error.message,
      });
    }
    if (signal.aborted) return cancelled();
    // A crash keeps its error, so the host reports its stack.
    const { code, message } = classifyRunFailure(error);
    return settle(RunOutcome.Crashed, {
      code,
      message,
      error: error instanceof Error ? error : new Error(message),
    });
  }
  const blocked = detectionFailure(config, store.session);
  if (blocked) return settle(RunOutcome.Failed, blocked);

  // Started before the run resolves: an audit seeds the ledger from inside its recipe.
  const installDir = store.session.installDir;
  const ledgerFile = config.auditLedgerFile;
  const ledger = ledgerFile
    ? startAuditLedgerWatcher(installDir, ledgerFile, runner)
    : null;
  let ledgerReleased = false;
  const releaseLedger = () => {
    if (ledgerReleased || !ledgerFile) return;
    ledgerReleased = true;
    // Read a last write the watch debounce hasn't picked up before stopping.
    ledger?.refresh();
    ledger?.stop();
    removeAuditLedger(installDir, ledgerFile);
  };
  const unregisterLedger = ledger ? registerCleanup(releaseLedger) : undefined;
  let plainSettings: { backedUp: boolean } | undefined;
  try {
    let run: AgentRunDefinition;
    try {
      run = await resolveRun(config, store, runner);
    } catch (error) {
      if (error instanceof ProgramAbort) return fail(error.message, error.code);
      throw error;
    }
    store.setSkillId(run.skillId ?? run.integrationLabel);

    const plannedRuns = planRuns(config, options);
    const outage = await checkReadiness(programId, config, store, {
      workflow: options.workflow,
      park,
      signal,
      emit,
    });
    if (outage) return settle(RunOutcome.Failed, outage);

    analytics.wizardCapture('agent started', {
      integration: run.integrationLabel,
      program_id: programId,
      skill_id: run.skillId ?? null,
    });

    // Everything before the first agent run: a rejection fails the run, unless the caller aborted.
    let credentials: ResolvedProgramCredentials;
    let flags: WizardFlagSnapshot = {
      flags: { ...input.wizardFlags },
      payloads: { ...input.wizardFlagPayloads },
    };
    try {
      // A plain run's directory is known now, so its settings are checked before login. A scoped or composed run checks its own after its prep.
      if (plannedRuns.some((planned) => !planned.runStep)) {
        const settings = await checkSettingsConflicts(programId, installDir, {
          workflow: options.workflow,
          park,
          signal,
        });
        if ('failure' in settings) {
          return settle(RunOutcome.Failed, settings.failure);
        }
        plainSettings = settings;
      }
      credentials = await login();
      if (!store.session.aiSdkStampReported) {
        store.setAiSdkStampReported();
        stampAiSdkDetected({
          apiUser: credentials.apiUser,
          discoveredFeatures: store.session.discoveredFeatures,
          warehouseSources: getDetectedWarehouseSources(store.session),
          mayReportScanResults: mayReportScanResults(store.session),
        });
      }
      if (needsAiApproval(store.session, credentials)) {
        if (!options.workflow) {
          return fail(
            'AI processing approval is required before this program can run.',
          );
        }
        const approved = await park(
          options.workflow.confirmStep(
            { kind: 'ai-approval', programId, installDir },
            { signal },
          ),
        );
        if (!approved) return abort('AI processing approval declined.');
      }
      if (!input.wizardFlags && options.featureFlags) {
        flags = await park(options.featureFlags());
      }
    } catch (error) {
      if (signal.aborted) return cancelled();
      if (error instanceof ProgramAbort) return fail(error.message, error.code);
      return fail(error instanceof Error ? error.message : String(error));
    }

    // Every rotation of this login, before or during a run, lands in the store.
    configureOAuthSession(credentials.posthog, {
      rotate: (held) => rotateCredentials(held, store.session.baseUrl),
      onRefreshed: (refreshed) => {
        const current = store.session.credentials;
        // A refresh replaces only the token fields; the login keeps its host.
        store.setAccessToken(
          current
            ? {
                ...current,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: refreshed.expiresAt,
              }
            : refreshed,
        );
      },
    });

    /** One agent run in its own directory; a settled outcome when it can't start. */
    const runOne = async (
      planned: PlannedRun,
      ownRun: AgentRunDefinition | undefined,
      checked: { backedUp: boolean } | undefined,
    ): Promise<RunResult | ProgramRunOutcome> => {
      // A scoped run works on its own copy of the session; its writes don't leak into later runs.
      const scoped = planned.runStep
        ? await scopeSession(planned.runStep, store.session, runner)
        : null;
      if (
        scoped?.detectedFrameworkLabel &&
        scoped.detectedFrameworkLabel !== store.session.detectedFrameworkLabel
      ) {
        store.setDetectedFramework(scoped.detectedFrameworkLabel);
      }
      const session = (): WizardSession => scoped ?? store.session;
      const runDir = session().installDir;
      const agentRun =
        ownRun ?? (await resolveRun(planned.config, store, runner, scoped));
      if (!ownRun) {
        analytics.wizardCapture('agent started', {
          integration: agentRun.integrationLabel,
          program_id: planned.config.id,
          skill_id: agentRun.skillId ?? null,
        });
      }

      const settings =
        checked ??
        (await checkSettingsConflicts(programId, runDir, {
          workflow: options.workflow,
          park,
          signal,
        }));
      if ('failure' in settings) {
        return settle(RunOutcome.Failed, settings.failure);
      }
      try {
        // Not parked: a rotation spends the old refresh token, so the new one is kept before a cancel returns.
        const posthog = await currentCredentials(credentials.posthog);
        if (signal.aborted) return cancelled();

        if (planned.own) {
          artifacts.reportFile = path.resolve(runDir, agentRun.reportFile);
        }
        const agentRunId = planned.own ? runId : randomUUID();
        const observer = progress.beginRun(
          agentRunId,
          planned.own ? undefined : planned.stepId,
        );
        const current = session();
        const result = await runAgent(
          {
            programId: planned.config.id,
            run: agentRun,
            composed: planned.own ? input.composed ?? false : true,
            // The agent resolves CLI, then flag, then this binding, and reports the pick.
            routing: {
              binding: planned.config.binding ?? DEFAULT_BINDING,
              overrides: {
                harness: current.harness,
                sequence: current.sequence,
                model: current.model,
              },
            },
            skillsBaseUrl: getSkillsBaseUrl(),
            wizardFlags: { ...flags.flags },
            wizardFlagPayloads: { ...flags.payloads },
            allowedTools: planned.config.allowedTools,
            disallowedTools: planned.config.disallowedTools,
            agentFlow: planned.config.agentFlow,
            excludedTaskTypes: planned.config.excludedTaskTypes,
            seedTasks: planned.config.seedTasks
              ? () => planned.config.seedTasks!(session())
              : undefined,
            hooks: sessionHooks(agentRun, session, (outcomes) => {
              if (scoped) scoped.frameworkContext[TASK_OUTCOMES_KEY] = outcomes;
              else store.setFrameworkContext(TASK_OUTCOMES_KEY, outcomes);
            }),
          },
          {
            installDir: runDir,
            credentials: posthog,
            project: credentials.project,
            apiUser: credentials.apiUser,
            skillId: agentRun.skillId ?? agentRun.integrationLabel,
            integration: current.integration,
            frameworkDocsUrl: frameworkDocsUrl(current),
            flags: runFlags(current),
            host: {
              projectId: current.projectId,
              apiKey: current.apiKey,
              baseUrl: current.baseUrl,
              region: current.region,
              email: current.email,
            },
          },
          {
            interaction: options.interaction,
            onProgress: (event) =>
              observer.onEvent(event, () => applyAgentProgress(store, event)),
            signal: options.signal,
          },
        );
        observer.finish();
        return result;
      } finally {
        // The run neutralized its directory's settings; put them back whatever happened.
        if (settings.backedUp) restoreClaudeSettings(runDir);
      }
    };

    for (const planned of plannedRuns) {
      const step: Extract<ProgramStep, { kind: 'run' }> = {
        kind: 'run',
        stepId: planned.stepId,
        programId: planned.config.id,
      };
      let result: RunResult | ProgramRunOutcome;
      try {
        if (options.workflow) {
          const go = await park(options.workflow.confirmStep(step, { signal }));
          if (!go) continue;
        }
        result = await runOne(
          planned,
          planned.own ? run : undefined,
          planned.runStep ? undefined : plainSettings,
        );
      } catch (error) {
        if (signal.aborted) return cancelled();
        if (error instanceof ProgramAbort)
          return fail(error.message, error.code);
        throw error;
      }
      if ('programId' in result) return result;
      runResults.push(result);
      options.workflow?.finishStep?.(step, result);
      if (result.outcome !== RunOutcome.Success) {
        return settle(result.outcome, result.failure);
      }
    }
    return settle(RunOutcome.Success);
  } finally {
    // A plain run's settings were neutralized before login; put them back if the run never started.
    if (plainSettings?.backedUp) restoreClaudeSettings(installDir);
    releaseLedger();
    unregisterLedger?.();
  }
}

/** The program's own run, and before it every composed sub-run a host workflow can confirm. */
function planRuns(
  config: ProgramConfig,
  options: ProgramOptions,
): PlannedRun[] {
  const own: PlannedRun = { stepId: 'run', config, own: true };
  // Run steps are the host's flow: with no workflow to confirm them, only the program's own run runs.
  if (!options.workflow) return [own];
  const composed: PlannedRun[] = [];
  for (const [stepId, runStep] of Object.entries(config.runSteps ?? {})) {
    if (runStep.runProgramId) {
      composed.push({
        stepId,
        config: getProgramConfig(runStep.runProgramId),
        runStep,
        own: false,
      });
    } else {
      own.stepId = stepId;
      own.runStep = runStep;
    }
  }
  return [...composed, own];
}

/** A program's run definition. A `run` function writes to the session copy it is handed. */
async function resolveRun(
  config: ProgramConfig,
  store: SessionStore,
  runner: RunnerContext,
  scoped?: WizardSession | null,
): Promise<AgentRunDefinition> {
  const run = config.run;
  if (!run) {
    throw new ProgramAbort({
      code: ErrorCodes.InternalUnhandled,
      message: `Program "${config.id}" has no run configuration.`,
    });
  }
  if (typeof run !== 'function') return run;
  if (scoped) return run(scoped, runner);
  return store.edit((draft) => run(draft, runner));
}

/** The session a scoped run works on: the step's directory and its own framework context, after any prep. */
async function scopeSession(
  runStep: ProgramRunStep,
  live: WizardSession,
  runner: RunnerContext,
): Promise<WizardSession | null> {
  if (!runStep.targetDir && !runStep.onRunPrep) return null;
  const session: WizardSession = {
    ...live,
    installDir: runStep.targetDir ? runStep.targetDir(live) : live.installDir,
    frameworkContext: { ...live.frameworkContext },
  };
  if (runStep.onRunPrep) await runStep.onRunPrep(session, runner.log);
  return session;
}

function needsAiApproval(
  session: WizardSession,
  credentials: ResolvedProgramCredentials,
): boolean {
  return (
    !session.ci &&
    !session.signup &&
    credentials.apiUser?.organization?.is_ai_data_processing_approved !== true
  );
}

/** Await `work`; an abort rejects at once, and wins over an answer that lands after it. */
function parkOn<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortReason(signal));
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Run cancelled by the caller.');
}

/** The program's run effects, through the store and the invocation's progress. */
function storeRunner(
  store: SessionStore,
  emit: (event: AgentProgress) => void,
): RunnerContext {
  return {
    getFrameworkContext: (key) => store.getFrameworkContext(key),
    setFrameworkContext: (key, value) => store.setFrameworkContext(key, value),
    log: {
      info: (message) => emit({ kind: 'log', level: 'info', message }),
      warn: (message) => emit({ kind: 'log', level: 'warn', message }),
    },
    spinner: () => ({
      start: (message) => emit({ kind: 'spinner', action: 'start', message }),
      stop: (message) => emit({ kind: 'spinner', action: 'stop', message }),
      message: (message) =>
        emit({ kind: 'spinner', action: 'message', message }),
    }),
  };
}

/** The program's completion hooks, reading the run's session when they fire. */
function sessionHooks(
  run: ProgramRun,
  session: () => ProgramSession,
  recordTaskOutcomes: NonNullable<RunHooks['recordTaskOutcomes']>,
): RunHooks {
  return {
    postRun: run.postRun
      ? (creds) => run.postRun!(session(), creds)
      : undefined,
    buildOutroData: run.buildOutroData
      ? (creds) => run.buildOutroData!(session(), creds) ?? undefined
      : undefined,
    buildOutroNextSteps: run.buildOutroNextSteps
      ? (creds, completed) =>
          run.buildOutroNextSteps!(session(), creds, completed)
      : undefined,
    recordTaskOutcomes,
  };
}

function runFlags(session: WizardSession): RunInput['flags'] {
  return {
    ci: session.ci,
    signup: session.signup,
    debug: session.debug,
    e2eAsk: session.e2eAsk,
    localMcp: session.localMcp,
    captureAio: session.captureAio,
    benchmark: session.benchmark,
    yaraReport: session.yaraReport,
  };
}

function frameworkDocsUrl(session: ProgramSession): string | undefined {
  const framework = session.integration ?? session.skillId;
  return framework
    ? FRAMEWORK_REGISTRY[framework as Integration]?.metadata.docsUrl
    : undefined;
}

/** A settled success: a run the agent started ends completed; its outro came from the agent or is its caller's. */
function recordSuccess(store: SessionStore): void {
  if (store.session.runPhase === RunPhase.Running) {
    store.setRunPhase(RunPhase.Completed);
  }
}

/** A rejection, recorded as its error outro before it reaches the caller; never masks the error. */
function recordThrown(store: SessionStore, error: unknown): void {
  try {
    const { code, message } = classifyRunFailure(error);
    recordFailure(store, { code, message });
  } catch (recordError) {
    logToFile('[run-program] could not record the rejection:', recordError);
  }
}

/** A settled failure, recorded in the store: the error outro and the phase. */
function recordFailure(store: SessionStore, failure: Failure): void {
  store.batch(() => {
    store.setOutroData(
      failure.outroData ?? {
        kind: OutroKind.Error,
        message: failure.message,
        errorCode: failure.code,
        ...(failure.detail && { errorDetail: failure.detail }),
      },
    );
    store.setRunPhase(RunPhase.Error);
  });
}

/** A settled caller cancel, recorded in the store: the cancel outro and the phase. */
function recordCancel(store: SessionStore, failure: Failure): void {
  store.batch(() => {
    store.setOutroData({ kind: OutroKind.Cancel, message: failure.message });
    store.setRunPhase(RunPhase.Error);
  });
}

type StepContext = {
  workflow: ProgramOptions['workflow'];
  park: <T>(work: Promise<T>) => Promise<T>;
  signal: AbortSignal;
};

/** Service health, once per invocation, unless the host already checked it. A failure stops the run. */
async function checkReadiness(
  programId: string,
  config: ProgramConfig,
  store: SessionStore,
  context: StepContext & { emit: (event: AgentProgress) => void },
): Promise<Failure | null> {
  const known = store.session.readinessResult;
  if (known) {
    logToFile(
      `[agent-runner] readiness pre-computed by the host: decision=${known.decision} — skipping re-check`,
    );
    return null;
  }
  if (config.healthCheck === false) return null;
  logToFile('[agent-runner] evaluating wizard readiness');
  const readinessConfig = store.session.signup
    ? SIGNUP_WIZARD_READINESS_CONFIG
    : undefined;
  const readiness = await evaluateWizardReadiness(readinessConfig);
  logToFile(`[agent-runner] readiness=${readiness.decision}`);
  store.setReadinessResult(readiness);
  const warn = (message: string) =>
    context.emit({ kind: 'log', level: 'warn', message });
  if (readiness.decision === WizardReadiness.No) {
    const blockingLabels = getBlockingServiceKeys(
      readiness.health,
      readinessConfig,
    ).map((k) => `${SERVICE_LABELS[k]} (${readiness.health[k].status})`);
    logToFile(`[agent-runner] blocked by: ${blockingLabels.join(', ')}`);
    const go = context.workflow
      ? await context.park(
          context.workflow.confirmStep(
            {
              kind: 'service-outage',
              programId,
              installDir: store.session.installDir,
              readiness,
            },
            { signal: context.signal },
          ),
        )
      : true;
    if (!go) {
      return {
        code: ErrorCodes.EnvServiceOutage,
        message:
          'Cannot start — external services are down:\n' +
          blockingLabels.map((l) => `  - ${l}`).join('\n') +
          '\n\nPlease try again later.',
      };
    }
    if (!context.workflow) {
      warn('Service health issues detected.');
      const blockingKeys = getBlockingServiceKeys(readiness.health);
      if (blockingKeys.length > 0) {
        warn('Blocking services:');
        for (const key of blockingKeys) {
          const { status, error } = readiness.health[key];
          warn(
            `✖ ${SERVICE_LABELS[key]}: ${status}${error ? ` — ${error}` : ''}`,
          );
        }
      }
      for (const reason of readiness.reasons) warn(reason);
      warn(
        'Continuing anyway — health checks are advisory in non-interactive runs.',
      );
    }
  } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
    warn('Service health warnings detected.');
    for (const reason of readiness.reasons) warn(reason);
  }
  return null;
}

/** Claude settings in the run's directory; `backedUp` when the run must restore them. */
async function checkSettingsConflicts(
  programId: string,
  installDir: string,
  context: StepContext,
): Promise<{ backedUp: boolean } | { failure: Failure }> {
  const settingsConflicts = checkAllSettingsConflicts(installDir);
  logToFile(
    `[agent-runner] settings conflicts: ${
      settingsConflicts.length > 0
        ? settingsConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none'
    }`,
  );
  if (settingsConflicts.length === 0) return { backedUp: false };

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

  // Writable project settings.json — the SDK *does* read it, but it can be
  // backed up and removed for the run. Neutralize without prompting.
  let backedUp = false;
  let unfixable = failClosed;
  if (autoFix.length > 0) {
    backedUp = backupAndFixClaudeSettings(installDir);
    if (backedUp) {
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
  if (unfixable.length === 0) return { backedUp };

  // What can't be neutralized (org-managed, or a writable file that failed to
  // back up) must be fixed by the user, through the host, or the run stops.
  const failure: Failure = {
    code: ErrorCodes.SettingsUnfixableConflict,
    message:
      'Cannot start — a Claude settings file redirects the agent away ' +
      'from the PostHog gateway and cannot be neutralized automatically:\n' +
      unfixable
        .map((c) => `  - ${c.source} (${c.path}): ${c.keys.join(', ')}`)
        .join('\n') +
      '\n\nRemove the conflicting keys and re-run the wizard.',
  };
  if (!context.workflow) return { failure };
  const resolved = await context.park(
    context.workflow.confirmStep(
      {
        kind: 'settings-conflict',
        programId,
        installDir,
        conflicts: unfixable,
        fix: () => {
          const fixed = backupAndFixClaudeSettings(installDir);
          backedUp ||= fixed;
          return fixed;
        },
      },
      { signal: context.signal },
    ),
  );
  if (!resolved) return { failure };
  logToFile('[agent-runner] settings override resolved');
  return { backedUp };
}

/** Progress to the caller's observer: copied, never awaited, and a throw kept as a diagnostic. */
function createProgress(observer: ProgramOptions['onProgress']) {
  const diagnostics: ProgramDiagnostic[] = [];
  const record = (
    runId: string,
    eventKind: AgentProgress['kind'],
    error: unknown,
  ) => {
    diagnostics.push({
      runId,
      eventKind,
      message: error instanceof Error ? error.message : String(error),
    });
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();
  };
  const deliver = (runId: string, event: AgentProgress, stepId?: string) => {
    if (!observer) return;
    const progress: ProgramProgress = {
      runId,
      ...(stepId !== undefined && { stepId }),
      event: structuredClone(event),
    };
    try {
      const delivery: unknown = observer(progress);
      if (
        delivery &&
        typeof (delivery as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(delivery).catch((error: unknown) =>
          record(runId, event.kind, error),
        );
      }
    } catch (error) {
      record(runId, event.kind, error);
    }
  };
  return {
    deliver: (runId: string, event: AgentProgress) => deliver(runId, event),
    /** One agent run's events: recorded as run state, then observed, until it finishes. */
    beginRun(runId: string, stepId?: string) {
      let finished = false;
      return {
        onEvent(event: AgentProgress, applyToStore: () => void) {
          if (finished) {
            record(runId, event.kind, 'progress after finish');
            return;
          }
          try {
            applyToStore();
          } catch (error) {
            record(runId, event.kind, error);
          }
          deliver(runId, event, stepId);
        },
        finish() {
          finished = true;
        },
      };
    },
    diagnostics: () => diagnostics.map((d) => ({ ...d })),
  };
}
