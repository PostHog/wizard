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
import {
  getSkillsBaseUrl,
  WIZARD_VERSIONED_SDK_SKILLS_FLAG_KEY,
  type Integration,
} from '@shared/constants';
import { listSkillFolders, removeRunSkills } from '@shared/skill-install';
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
  WizardReadiness,
} from '@shared/health-checks/readiness';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import {
  configureOAuthSession,
  currentCredentials,
} from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { removeAuditLedger, startAuditLedgerWatcher } from '@programs/audit';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import {
  applyDetectionReport,
  buildProjectSelection,
  getProjects,
  getTraits,
  DETECTED_PROJECT_KEY,
  detectedProjectOf,
  getDiscovery,
  picksProject,
  askUserToSelectProject,
  shouldRankProjects,
  projectDiscoveryMode,
  projectFromWorkspaceRoot,
  projectPathOf,
  rediscoverAfterLogin,
  reportDiscovery,
  reportProjectsDiscovered,
  reportProjectsSelected,
  sdkFeatureGaps,
  settleProjects,
  toMatchKeys,
  toTraitKeys,
  type ProjectSelection,
  VERSIONED_SDK_SKILLS_ENABLED_KEY,
} from '@services/project-discovery';
import { detectIntegrationProjects } from '@services/detection';
import { findProgramConfig, getProgramConfig } from './program-registry';
import { ProgramAbort } from '@programs/program-contract';
import { detectionFailure, detectProgram } from './detect-program';
import {
  rotateCredentials,
  type ResolvedProgramCredentials,
} from './credentials';
import {
  DECISIONS_USE_KEY,
  decisionsUse,
  questionFacts,
  runDecisionsSource,
  type QuestionKey,
} from '@services/detection/decisions';
import { logIn } from './login';
import { applyAgentProgress, type SessionStore } from '@services/session';
import type { WizardSession } from '@services/session';
import type { ProgramConfig, ProgramRunStep } from '@programs/program-contract';
import type { ProgramRun } from '@programs/program-contract';
import type { ProgramSession } from '@programs/program-contract';
import type {
  CiRunnerContext,
  RunnerContext,
} from '@programs/program-contract';
import type {
  ProgramDiagnostic,
  ProgramInput,
  ProgramOptions,
  ProgramProgress,
  ProgramRunOutcome,
  ProgramStep,
} from './program-input';
import type { WizardFlagSnapshot } from '@shared/wizard-flags';

/** The session's frameworkContext slot holding an orchestrated run's final task outcomes. */
export const TASK_OUTCOMES_KEY = 'orchestrator-task-outcomes';

/** Handed to the caller's capabilities when it supplied no signal. */
const NEVER_ABORTED = new AbortController().signal;

const MAX_DIAGNOSTICS = 10;

/** How long a run that has ended waits for a Decisions comparison call that is still in flight. */
const COMPARISON_GRACE_MS = 3_000;

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
  analytics.setProgramTags();
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
        completionScopeOptional: config.completionScopeOptional,
      }),
    );

  /** Discovery changed mode after the program's detection ran. */
  let redetect = false;
  /**
   * Discovery under the mode the run now knows. Discovery first runs before
   * login, as an anonymous user. A mode or a flag snapshot the caller gave the
   * run says the mode at once, and otherwise the flag is read again once
   * someone is logged in. A no-op when the mode did not change.
   */
  const settleDiscoveryMode = async (): Promise<void> => {
    const known =
      input.discoveryMode ??
      (input.wizardFlags && projectDiscoveryMode(input.wizardFlags));
    if (known === undefined && !store.session.credentials) return;
    const before = getDiscovery(store.session)?.mode;
    await park(rediscoverAfterLogin(config, store.readyContext(), known));
    // What detection read under the old mode is read again before any agent runs.
    if (getDiscovery(store.session)?.mode !== before) redetect = true;
  };
  /**
   * The picker can still move the run: no caller named a project, and the
   * selection has an eligible one other than the project the run started in.
   * What stops the run in that first project then waits for the pick, so a
   * workspace root with no framework of its own still reaches the picker.
   */
  const mayMove = async (): Promise<boolean> => {
    if (!config.appliesTo || input.project !== undefined) return false;
    await settleDiscoveryMode();
    return (
      picksProject(store.session, config) &&
      buildProjectSelection(store.session, config).projects.some(
        (project) =>
          project.eligible && project.path !== store.session.runProject,
      )
    );
  };
  /** What stopped the run in the project it started in, kept while the picker can move it. */
  let stopped: (() => ProgramRunOutcome) | null = null;

  try {
    // A pair's project the store is not scoped to yet needs its own detection.
    if (
      !store.session.detectionComplete ||
      (input.project !== undefined &&
        projectFromWorkspaceRoot(store.session, input.project) !==
          store.session.runProject)
    ) {
      await detectProgram(
        config,
        store,
        {
          log: runner.log,
          authenticate: async () => {
            await login();
          },
          onProgress: emit,
        } satisfies CiRunnerContext,
        input.project,
      );
    }
  } catch (error) {
    // A decided stop ends the run cancelled, as main's wizardAbort({ code, message }) did.
    if (error instanceof ProgramAbort) {
      const stop = () =>
        settle(RunOutcome.Aborted, {
          code: error.code,
          message: error.message,
        });
      if (!(await mayMove())) return stop();
      stopped = stop;
    } else if (signal.aborted) return cancelled();
    else {
      // A crash keeps its error, so the host reports its stack.
      const { code, message } = classifyRunFailure(error);
      return settle(RunOutcome.Crashed, {
        code,
        message,
        error: error instanceof Error ? error : new Error(message),
      });
    }
  }
  const blocked = stopped ? null : detectionFailure(config, store.session);
  if (blocked) {
    const stop = () => settle(RunOutcome.Failed, blocked);
    if (!(await mayMove())) return stop();
    stopped = stop;
  }
  // The run is one (program, project) pair: its skills resolve for its own project.
  const pair = {
    program: programId,
    project: { path: store.session.runProject },
  };
  logToFile(
    `[agent-runner] pair program=${pair.program} project=${
      pair.project.path
    } applies=${String(
      config.appliesTo?.(getTraits(store.session, pair.project.path)) ?? true,
    )}`,
  );

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
  /** A Decisions call that runs beside the agent run, for comparison only. */
  let comparing: Promise<unknown> | undefined;
  try {
    let run: ProgramRun | undefined;
    /** The run is resolved: tag the analytics, name the skill and report the start, once. */
    const started = (resolved: ProgramRun, report: boolean): void => {
      analytics.setProgramTags(resolved.analyticsTags);
      store.setSkillId(resolved.skillId ?? resolved.integrationLabel);
      if (!report) return;
      analytics.wizardCapture('agent started', {
        integration: resolved.integrationLabel,
        program_id: programId,
        skill_id: resolved.skillId ?? null,
      });
    };
    if (!stopped) {
      try {
        run = await resolveRun(config, store, runner);
      } catch (error) {
        if (!(error instanceof ProgramAbort)) throw error;
        const stop = () => fail(error.message, error.code);
        if (!(await mayMove())) return stop();
        stopped = stop;
      }
    }

    const plannedRuns = planRuns(config, options);
    const outage = await checkReadiness(programId, config, store, {
      workflow: options.workflow,
      park,
      signal,
      emit,
    });
    if (outage) return settle(RunOutcome.Failed, outage);

    // A run whose start waits for the pick reports it once the pick resolves it.
    const reportedStart = run !== undefined;
    if (run) started(run, true);

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
      // Discovery ran before login; the flag can answer differently for the person.
      await settleDiscoveryMode();
      reportDiscovery(store);
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
      const gate = config.rolloutGate;
      if (gate && flags.flags[gate.flagKey] !== 'true') {
        return fail(gate.unavailableMessage, ErrorCodes.CliFlagUnavailable);
      }
    } catch (error) {
      if (signal.aborted) return cancelled();
      if (error instanceof ProgramAbort) return fail(error.message, error.code);
      return fail(error instanceof Error ? error.message : String(error));
    }

    // Logged in, AI approved and flags known: Decisions answers for a program that ranks with it, when its flag allows.
    const use = config.rankWith?.includes('decisions')
      ? decisionsUse(flags.flags)
      : 'off';
    // Every Decisions request reads this, so `off` stops them all.
    store.setFrameworkContext(DECISIONS_USE_KEY, use);
    const versionedSdkSkills =
      flags.flags[WIZARD_VERSIONED_SDK_SKILLS_FLAG_KEY] === 'true';
    store.setFrameworkContext(
      VERSIONED_SDK_SKILLS_ENABLED_KEY,
      versionedSdkSkills,
    );
    if (versionedSdkSkills) settleProjects(store.readyContext());
    // The answers become traits only when the flag says so and project discovery is on.
    const decisionsAsTraits =
      use === 'traits' &&
      (getDiscovery(store.session)?.mode ?? 'off') !== 'off';
    /** One Decisions call about the project the run works in now. */
    const askDecisions = (rankProjects: boolean) =>
      runDecisionsSource(decisionKeys(config, plannedRuns), {
        session: store.session,
        setFrameworkContext: (key, value) =>
          store.setFrameworkContext(key, value),
        programId,
        ...(decisionsAsTraits && { sink: store.readyContext() }),
        rankProjects,
      });
    // A comparison waits for the pick, so it describes the project the run works in.
    const compareAfterPick =
      use !== 'off' &&
      !decisionsAsTraits &&
      picksProject(store.session, config);
    if (use !== 'off' && !compareAfterPick) {
      // Only a program that picks its project reads a ranking of them.
      const asking = askDecisions(picksProject(store.session, config));
      if (decisionsAsTraits) {
        // The run waits for the answers it will read as traits.
        try {
          await park(asking);
        } catch (error) {
          if (signal.aborted) return cancelled();
          logToFile(`[decisions] skipped: ${String(error)}`);
        }
      } else {
        // Otherwise the call runs beside the agent run, and its answers reach only the log.
        comparing = asking;
      }
    }

    // One project per run: with discovery on, the host picks among the projects the program is offered.
    const picks = picksProject(store.session, config);
    if (picks || redetect) {
      const ciRunner = {
        log: runner.log,
        authenticate: async () => {
          await login();
        },
        onProgress: emit,
      } satisfies CiRunnerContext;
      try {
        let target: string | null = store.session.runProject;
        if (picks) {
          target = await park(
            pickProject(config, store, {
              requestedProjectPath:
                input.project === undefined
                  ? undefined
                  : projectFromWorkspaceRoot(store.session, input.project),
              workflow: options.workflow,
              emit,
              signal,
            }),
          );
          if (target === null) return abort('Project selection cancelled.');
        }
        const moves = target !== store.session.runProject;
        // A pick elsewhere moves the run. A mode that changed reads the same project again under the new one.
        if (moves || redetect) {
          redetect = false;
          const detectedIn = store.session.installDir;
          const resetSettings = (): void => {
            // The settings were checked for the directory the run started in.
            if (plainSettings?.backedUp) restoreClaudeSettings(installDir);
            plainSettings = undefined;
          };
          if (moves) resetSettings();
          // What stopped the run where it was first detected no longer applies.
          stopped = null;
          // Only a pick names a project; without one the run stays in the project it started in.
          await detectProgram(
            config,
            store,
            ciRunner,
            moves ? target : undefined,
          );
          // A run that started below its project moves up to it without a pick.
          if (!moves && store.session.installDir !== detectedIn) {
            resetSettings();
          }
          const unmet = detectionFailure(config, store.session);
          if (unmet) return settle(RunOutcome.Failed, unmet);
          run = await resolveRun(config, store, runner);
          started(run, !reportedStart);
          pair.project.path = target;
          // The questions were asked of the project the run started in; the pair's project gets its own answers.
          if (decisionsAsTraits) await park(askDecisions(false));
        }
      } catch (error) {
        if (signal.aborted) return cancelled();
        if (error instanceof ProgramAbort)
          return fail(error.message, error.code);
        throw error;
      }
    }

    // The run stayed in the project it started in, so what stopped it there stands.
    if (stopped) return stopped();
    if (!run) return fail(`Program "${programId}" resolved no run.`);
    const ownRunDefinition = run;
    // The pick is settled, so the comparison runs beside the agent run for the project it works in.
    if (compareAfterPick) comparing = askDecisions(false);

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
      const sdkGap = planned.config.sdkFeature
        ? sdkFeatureGaps(session(), [planned.config.sdkFeature])[0]
        : undefined;
      if (sdkGap) {
        return settle(RunOutcome.Failed, {
          code: ErrorCodes.DetectSdkTooOld,
          message: sdkGap.message,
        });
      }
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
      // The skills a run installs are for its agent only; remove them when it ends, however it ends.
      const skillsBefore = listSkillFolders(runDir);
      const removeSkills = () => removeRunSkills(runDir, skillsBefore);
      const unregisterSkills = registerCleanup(removeSkills);
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
            posthogTools: planned.config.posthogTools,
            handoffNotebook:
              agentRun.handoffNotebook ?? planned.config.handoffNotebook,
            agentFlow: planned.config.agentFlow,
            accountOwnerContext: planned.config.accountOwnerContext,
            agentPrompts: planned.config.agentPrompts,
            excludedTaskTypes: planned.config.excludedTaskTypes
              ? (runFlags) =>
                  planned.config.excludedTaskTypes!(runFlags, session())
              : undefined,
            seedTasks: planned.config.seedTasks
              ? () => planned.config.seedTasks!(session())
              : undefined,
            // The session's own run project: a step scoped to a sub-folder reads that folder's traits.
            matchKeys: () => toMatchKeys(getTraits(session())),
            traitKeys: () => toTraitKeys(getTraits(session())),
            projectFacts:
              planned.config.decisions || planned.config.detectedFacts
                ? () => [
                    ...(planned.config.decisions
                      ? questionFacts(session(), planned.config.decisions)
                      : []),
                    ...(planned.config.detectedFacts?.(
                      flags.flags,
                      session(),
                    ) ?? []),
                  ]
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
        unregisterSkills();
        removeSkills();
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
          planned.own ? ownRunDefinition : undefined,
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
    // A run that ends before the comparison call does gives it a moment to log.
    if (comparing) {
      await Promise.race([
        comparing,
        new Promise((resolve) =>
          setTimeout(resolve, COMPARISON_GRACE_MS).unref(),
        ),
      ]);
    }
    // A plain run's settings were neutralized before login; put them back if the run never started.
    if (plainSettings?.backedUp) restoreClaudeSettings(installDir);
    releaseLedger();
    unregisterLedger?.();
  }
}

/**
 * The project the run works in. Asks the host when there is a choice, with
 * the program's model sources ranking the projects. A run with no host to ask
 * takes the ranking's pick. Reports the list and the pick. Null when the host
 * declined.
 */
async function pickProject(
  config: ProgramConfig,
  store: SessionStore,
  context: {
    requestedProjectPath?: string;
    workflow?: ProgramOptions['workflow'];
    emit: (event: AgentProgress) => void;
    signal: AbortSignal;
  },
): Promise<string | null> {
  const { requestedProjectPath, workflow, emit, signal } = context;
  const buildSelection = (): ProjectSelection =>
    buildProjectSelection(store.session, config, requestedProjectPath);
  // Agentic detection ranks only where there is a choice to make, and only once.
  const ranked = getProjects(store.session).some((project) =>
    Object.values(project.claims ?? {}).some((claims) =>
      claims.some((claim) => claim.source === 'agentic'),
    ),
  );
  const rankProjects =
    config.rankWith?.includes('agentic') && !ranked
      ? async (): Promise<ProjectSelection> => {
          try {
            const report = await detectIntegrationProjects(store.session, {
              programId: config.id,
              recommend: true,
              onEvent: (line) => logToFile('[agentic detect]', line),
              onProgress: emit,
            });
            // A reply that lands after a cancel is dropped, so the session stays as the run left it.
            if (signal.aborted) return buildSelection();
            applyDetectionReport(store.readyContext(), report, 'agentic');
          } catch (error) {
            // No answer: the selection opens on static detection alone.
            logToFile(
              `[agent-runner] project ranking failed: ${String(error)}`,
            );
          }
          return buildSelection();
        }
      : undefined;

  let projectSelection = buildSelection();
  let picked = projectSelection.selectedProjectPath;
  let pickedBy: 'person' | 'caller' | 'default' =
    requestedProjectPath === undefined ? 'default' : 'caller';
  const asks =
    workflow !== undefined &&
    askUserToSelectProject(
      store.session,
      config,
      projectSelection,
      requestedProjectPath,
    );
  if (asks) {
    const go = await workflow.confirmStep(
      {
        kind: 'project-selection',
        programId: config.id,
        installDir: store.session.installDir,
        projectSelection,
        rankProjects,
        selectProject: (projectPath) => {
          picked = projectPath;
          pickedBy = 'person';
        },
      },
      { signal },
    );
    if (!go) return null;
    projectSelection = buildSelection();
  } else if (
    requestedProjectPath === undefined &&
    rankProjects &&
    shouldRankProjects(store.session, projectSelection)
  ) {
    // Nobody to ask: the ranking picks, as a person reading it would.
    projectSelection = await rankProjects();
    // A run cancelled during the ranking reports no pick.
    if (signal.aborted) return null;
    picked = projectSelection.selectedProjectPath;
  }
  reportProjectsDiscovered(store.session, projectSelection, config.id);
  reportProjectsSelected(
    store.session,
    projectSelection,
    picked,
    config.id,
    pickedBy,
  );
  return picked;
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

/** The question keys of the program, the programs it requires, and its composed runs. */
export function decisionKeys(
  config: ProgramConfig,
  plannedRuns: readonly PlannedRun[],
): QuestionKey[] {
  const seen = new Set<string>();
  const keys = new Set<QuestionKey>();
  const visit = (program: ProgramConfig | undefined) => {
    if (!program || seen.has(program.id)) return;
    seen.add(program.id);
    for (const key of program.decisions ?? []) keys.add(key);
    for (const id of program.requires ?? []) visit(findProgramConfig(id));
  };
  visit(config);
  for (const planned of plannedRuns) visit(planned.config);
  return [...keys];
}

/** A program's run definition. A `run` function writes to the session copy it is handed. */
async function resolveRun(
  config: ProgramConfig,
  store: SessionStore,
  runner: RunnerContext,
  scoped?: WizardSession | null,
): Promise<ProgramRun> {
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
  const installDir = runStep.targetDir
    ? runStep.targetDir(live)
    : live.installDir;
  const runProject = projectPathOf(live, installDir) ?? live.runProject;
  const session: WizardSession = {
    ...live,
    installDir,
    // The step's directory is its run project, so its traits are that directory's.
    runProject,
    frameworkContext: {
      ...live.frameworkContext,
      // The detection fields copied here still describe the project they were read in.
      ...(runProject !== live.runProject && {
        [DETECTED_PROJECT_KEY]: detectedProjectOf(live),
      }),
    },
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
  const readiness = await evaluateWizardReadiness();
  logToFile(`[agent-runner] readiness=${readiness.decision}`);
  store.setReadinessResult(readiness);
  const warn = (message: string) =>
    context.emit({ kind: 'log', level: 'warn', message });
  if (readiness.decision === WizardReadiness.No) {
    const blockingLabels = getBlockingServiceKeys(readiness.health).map(
      (k) => `${SERVICE_LABELS[k]} (${readiness.health[k].status})`,
    );
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
