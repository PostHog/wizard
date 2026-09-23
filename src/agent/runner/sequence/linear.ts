/**
 * The linear pipeline. Single execution path for all non-orchestrator programs,
 * both skill-based (revenue analytics) and framework-based (core integration).
 * The `AgentRunDefinition` controls what varies between them; `RunConfig`
 * carries the program-level static metadata (tool allow/disallow lists, etc.).
 *
 * Reports through `emit`, asks through `interaction`, and returns a decided
 * `RunResult`. Every former `getUI()` call is one progress event in the same
 * place; every former `wizardAbort` is a returned failure with the same
 * arguments, so the caller's exit sequence is unchanged.
 */

import { OutroKind, type OutroData } from '@agent/progress';
import { AgentErrorType } from '../../agent-interface';
import { logToFile } from '@utils/debug';
import { createBenchmarkPipeline } from '@agent/middleware/benchmark';
import { AGENT_ERROR_CODE, ErrorCodes } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { formatYaraAbortMessage } from '@agent/yara-hooks';
import { installSkillById } from '@agent/tools';
import { assemblePrompt } from '../../agent-prompt';
import type { SequenceResult, SequenceContext } from '../shared/types';
import { failed, installFailure } from '../shared/errors';
import { RunOutcome } from '../shared/types';
import { shouldDisableAsk, runOptions } from '../shared/bootstrap';
import { createEmitSpinner } from '../shared/progress-collector';
import { createAskBridge } from '../shared/ask';
import { getHarness } from '../switchboard';

export async function runLinearProgram(
  context: SequenceContext,
): Promise<SequenceResult> {
  // Aborts on the host's signal or when the run ends, so no ask outlives it.
  const controller = new AbortController();
  const abortFromHost = () => controller.abort();
  context.signal?.addEventListener('abort', abortFromHost, { once: true });
  if (context.signal?.aborted) abortFromHost();
  try {
    return await executeLinear(context, controller.signal);
  } finally {
    context.signal?.removeEventListener('abort', abortFromHost);
    controller.abort();
  }
}

/** The host's `signal` decides the outcome; `runSignal` also ends with the run. */
async function executeLinear(
  { config, input, boot, emit, interaction, signal }: SequenceContext,
  runSignal: AbortSignal,
): Promise<SequenceResult> {
  const { run, composed } = config;
  const { skillsBaseUrl, credentials, project } = boot;
  const { projectApiKey, host, projectId } = credentials;
  const aborted = (): SequenceResult => ({
    outcome: RunOutcome.Aborted,
    failure: { code: ErrorCodes.AgentAbort, message: 'Agent run cancelled' },
  });
  if (signal?.aborted) return aborted();

  // 5. Skill install (if skillId provided)
  let skillPath: string | undefined;
  if (run.skillId) {
    logToFile(`[agent-runner] installing skill ${run.skillId}`);
    const installResult = await installSkillById(
      run.skillId,
      input.installDir,
      skillsBaseUrl,
      { triage: boot.triageProvider },
    );
    if (signal?.aborted) return aborted();
    if (installResult.kind !== 'ok') {
      return failed(installFailure(run.integrationLabel, installResult));
    }
    skillPath = installResult.path;
    logToFile(`[agent-runner] skill installed at ${skillPath}`);
  }

  // 6. Initialize agent
  const spinner = createEmitSpinner(emit);

  emit({ kind: 'lifecycle', phase: 'started' });

  // wizard_ask needs an answerer. A human answers at the keyboard; the e2e
  // snapshot/MCP host answers via its driver and sets WIZARD_ASK_AUTODRIVE.
  // CI/signup with neither has no answerer, so we omit the bridge and the tool
  // returns an actionable error rather than hanging on a never-resolving prompt.
  const askDisabled =
    shouldDisableAsk(input.flags) && process.env.WIZARD_ASK_AUTODRIVE !== '1';
  const ask = askDisabled
    ? undefined
    : createAskBridge(interaction, {
        getSource: () => input.skillId ?? run.integrationLabel,
        richLinks: run.richLinks ?? false,
        timeoutMs: run.askTimeoutMs,
        signal: runSignal,
      });

  const middleware = input.flags.benchmark
    ? createBenchmarkPipeline(emit, spinner, runOptions(input))
    : undefined;

  // 7. Build prompt
  const prompt = assemblePrompt(run, {
    projectId,
    projectApiKey,
    host,
    skillPath,
    orgAiDataProcessingApproved:
      input.apiUser?.organization?.is_ai_data_processing_approved ?? null,
    teamProductOptIns: project
      ? {
          sessionReplay: project.session_recording_opt_in ?? null,
          exceptionAutocapture: project.autocapture_exceptions_opt_in ?? null,
          surveys: project.surveys_opt_in ?? null,
        }
      : null,
  });
  logToFile(`[agent-runner] prompt assembled (${prompt.length} chars)`);
  if (signal?.aborted) return aborted();

  // 8. Run the agent through the run-level harness. The harness owns the agent
  // loop + model transport; everything around it (skill install, prompt, ask
  // bridge, error routing, outro) stays here so every harness shares it.
  const { harness, model, thinkingLevel } = config.binding;
  const agentResult = await getHarness(harness).run({
    config,
    input,
    boot,
    emit,
    prompt,
    skillPath,
    spinner,
    askBridge: ask,
    middleware,
    model,
    thinkingLevel,
    signal: runSignal,
  });
  if (signal?.aborted && agentResult.kind === 'success') return aborted();

  // 9. Error handling (full set from both harnesses)
  if (agentResult.kind === 'decided_failure') {
    return failed(agentResult.failure);
  }

  if (agentResult.kind === 'success') {
    // Success continues through the post-run hooks and outro below.
  } else if (agentResult.kind !== 'abort' && agentResult.kind !== 'failure') {
    const _exhaustive: never = agentResult;
    return _exhaustive;
  }

  if (agentResult.kind === 'abort') {
    const reason = agentResult.message ?? '';
    const matched = run.abortCases?.find((c) => c.match.test(reason));
    const abortCode = matched?.errorCode ?? ErrorCodes.AgentAbort;
    const outroData: OutroData = matched
      ? {
          kind: OutroKind.Error,
          message: matched.message,
          body: matched.body,
          docsUrl: matched.docsUrl,
          errorCode: abortCode,
          errorDetail: { reason },
        }
      : {
          kind: OutroKind.Error,
          message: `${run.integrationLabel} aborted`,
          body: reason || 'The agent aborted the program.',
          docsUrl: run.docsUrl,
          errorCode: abortCode,
          errorDetail: { reason },
        };
    analytics.wizardCapture('agent aborted', {
      integration: run.integrationLabel,
      reason,
      matched: matched?.message ?? null,
    });
    return {
      // An agent that stops itself failed the run; only the host's signal cancels it.
      outcome: signal?.aborted ? RunOutcome.Aborted : RunOutcome.Failed,
      failure: {
        message: matched?.message ?? `${run.integrationLabel} aborted`,
        outroData,
        code: abortCode,
        error: agentResult.error,
      },
    };
  }

  const classification =
    agentResult.kind === 'failure' ? agentResult.classification : undefined;
  const failureMessage =
    agentResult.kind === 'failure' ? agentResult.message : undefined;

  if (classification === AgentErrorType.MCP_MISSING) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.MCP_MISSING],
      message:
        'Could not access the PostHog MCP server\n\n' +
        'The wizard was unable to connect to the PostHog MCP server.\n' +
        'This could be due to a network issue or a configuration problem.\n\n' +
        `Please try again, or check the documentation:\n${run.docsUrl}`,
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (classification === AgentErrorType.RESOURCE_MISSING) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.RESOURCE_MISSING],
      message:
        'Could not access the setup resource\n\n' +
        'This may indicate a version mismatch or a temporary service issue.\n\n' +
        `Please try again, or check the documentation:\n${run.docsUrl}`,
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (classification === AgentErrorType.YARA_VIOLATION) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.YARA_VIOLATION],
      message: formatYaraAbortMessage(),
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (classification === AgentErrorType.NO_PROGRESS) {
    analytics.wizardCapture('agent no progress', {
      integration: run.integrationLabel,
      error_type: AgentErrorType.NO_PROGRESS,
    });
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.NO_PROGRESS],
      message:
        'The Wizard exited without changing your project. Please contact the ' +
        'PostHog team with wizard@posthog.com about this error.',
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (classification === AgentErrorType.INCOMPLETE_TASKS) {
    analytics.wizardCapture('agent incomplete tasks', {
      integration: run.integrationLabel,
      error_type: AgentErrorType.INCOMPLETE_TASKS,
    });
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.INCOMPLETE_TASKS],
      message:
        'The Wizard exited without completing its planned tasks. Please contact ' +
        'the PostHog team with wizard@posthog.com about this error.',
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (
    classification === AgentErrorType.RATE_LIMIT ||
    classification === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: run.integrationLabel,
      error_type: classification,
      error_message: failureMessage,
    });

    return failed({
      code: AGENT_ERROR_CODE[classification],
      message: `API Error\n\n${
        failureMessage || 'Unknown error'
      }\n\nPlease report this to: wizard@posthog.com`,
      error: agentResult.kind === 'failure' ? agentResult.error : undefined,
    });
  }

  if (agentResult.kind === 'failure') {
    return failed({
      code: AGENT_ERROR_CODE[agentResult.classification],
      message: agentResult.message ?? 'Agent failed',
      error: agentResult.error,
    });
  }

  // 10. Post-run hooks
  if (config.hooks?.postRun) {
    await config.hooks.postRun(credentials);
    if (signal?.aborted) return aborted();
  }

  // A composed sub-run leaves the terminal outro to its host.
  if (composed) {
    return { outcome: RunOutcome.Success };
  }

  // 11. Outro
  const outroData: OutroData | undefined = config.hooks?.buildOutroData
    ? config.hooks.buildOutroData(credentials)
    : {
        kind: OutroKind.Success,
        message: run.successMessage,
        reportFile: run.reportFile,
        docsUrl: run.docsUrl,
        continueUrl: input.flags.signup
          ? `${host.appHost}/products?source=wizard`
          : undefined,
      };
  if (outroData) {
    emit({ kind: 'completion', outro: outroData });
  }

  emit({ kind: 'lifecycle', phase: 'completed', message: run.successMessage });

  return { outcome: RunOutcome.Success, outro: outroData };
}
