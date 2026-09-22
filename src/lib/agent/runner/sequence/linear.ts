/**
 * The linear pipeline. Single execution path for all non-orchestrator programs,
 * both skill-based (revenue analytics) and framework-based (core integration).
 * The `ProgramRun` controls what varies between them; `RunConfig`
 * carries the program-level static metadata (tool allow/disallow lists, etc.).
 *
 * Reports through `emit`, asks through `interaction`, and returns a decided
 * `RunResult`. Every former `getUI()` call is one progress event in the same
 * place; every former `wizardAbort` is a returned failure with the same
 * arguments, so the caller's exit sequence is unchanged.
 */

import { OutroKind, type OutroData } from '@lib/agent/progress';
import { AgentErrorType, AgentSignals } from '../../agent-interface';
import { logToFile } from '../../../../utils/debug';
import { createBenchmarkPipeline } from '../../../middleware/benchmark';
import { AGENT_ERROR_CODE, ErrorCodes, WizardError } from '@lib/errors';
import { analytics } from '../../../../utils/analytics';
import { formatYaraAbortMessage } from '../../../yara-hooks';
import { installSkillById } from '../../../wizard-tools';
import { assemblePrompt } from '../../agent-prompt';
import type { SequenceResult, SequenceContext } from '../shared/types';
import { failed, installFailure } from '../shared/errors';
import { RunOutcome } from '../shared/types';
import { shouldDisableAsk, runOptions } from '../shared/bootstrap';
import { createEmitSpinner } from '../shared/progress-collector';
import { createAskBridge } from '../shared/ask';
import { getHarness } from '../switchboard';

export async function runLinearProgram({
  config,
  input,
  boot,
  emit,
  interaction,
}: SequenceContext): Promise<SequenceResult> {
  const { run, composed } = config;
  const { skillsBaseUrl, credentials, project } = boot;
  const { projectApiKey, host, projectId } = credentials;

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
      });

  const middleware = input.flags.benchmark
    ? createBenchmarkPipeline(spinner, runOptions(input))
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
  });

  // 9. Error handling (full set from both harnesses)
  if (agentResult.failure) {
    return failed(agentResult.failure);
  }

  if (agentResult.error === AgentErrorType.ABORT) {
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
      outcome: RunOutcome.Aborted,
      failure: {
        outroData,
        code: abortCode,
        error: new WizardError(
          `Agent aborted: ${reason}`,
          {
            integration: run.integrationLabel,
            error_type: AgentErrorType.ABORT,
            reason,
          },
          abortCode,
        ),
      },
    };
  }

  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.MCP_MISSING],
      message:
        'Could not access the PostHog MCP server\n\n' +
        'The wizard was unable to connect to the PostHog MCP server.\n' +
        'This could be due to a network issue or a configuration problem.\n\n' +
        `Please try again, or check the documentation:\n${run.docsUrl}`,
      error: new WizardError(
        'Agent could not access PostHog MCP server',
        {
          integration: run.integrationLabel,
          error_type: AgentErrorType.MCP_MISSING,
          signal: AgentSignals.ERROR_MCP_MISSING,
        },
        AGENT_ERROR_CODE[AgentErrorType.MCP_MISSING],
      ),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.RESOURCE_MISSING],
      message:
        'Could not access the setup resource\n\n' +
        'This may indicate a version mismatch or a temporary service issue.\n\n' +
        `Please try again, or check the documentation:\n${run.docsUrl}`,
      error: new WizardError(
        'Agent could not access setup resource',
        {
          integration: run.integrationLabel,
          error_type: AgentErrorType.RESOURCE_MISSING,
          signal: AgentSignals.ERROR_RESOURCE_MISSING,
        },
        AGENT_ERROR_CODE[AgentErrorType.RESOURCE_MISSING],
      ),
    });
  }

  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.YARA_VIOLATION],
      message: formatYaraAbortMessage(),
      error: new WizardError(
        'YARA scanner terminated session',
        {
          integration: run.integrationLabel,
          error_type: AgentErrorType.YARA_VIOLATION,
        },
        AGENT_ERROR_CODE[AgentErrorType.YARA_VIOLATION],
      ),
    });
  }

  if (agentResult.error === AgentErrorType.NO_PROGRESS) {
    analytics.wizardCapture('agent no progress', {
      integration: run.integrationLabel,
      error_type: AgentErrorType.NO_PROGRESS,
    });
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.NO_PROGRESS],
      message:
        'The Wizard exited without changing your project. Please contact the ' +
        'PostHog team with wizard@posthog.com about this error.',
      error: new WizardError(
        'Agent made no progress',
        {
          integration: run.integrationLabel,
          error_type: AgentErrorType.NO_PROGRESS,
        },
        AGENT_ERROR_CODE[AgentErrorType.NO_PROGRESS],
      ),
    });
  }

  if (agentResult.error === AgentErrorType.INCOMPLETE_TASKS) {
    analytics.wizardCapture('agent incomplete tasks', {
      integration: run.integrationLabel,
      error_type: AgentErrorType.INCOMPLETE_TASKS,
    });
    return failed({
      code: AGENT_ERROR_CODE[AgentErrorType.INCOMPLETE_TASKS],
      message:
        'The Wizard exited without completing its planned tasks. Please contact ' +
        'the PostHog team with wizard@posthog.com about this error.',
      error: new WizardError(
        'Agent left planned tasks incomplete',
        {
          integration: run.integrationLabel,
          error_type: AgentErrorType.INCOMPLETE_TASKS,
        },
        AGENT_ERROR_CODE[AgentErrorType.INCOMPLETE_TASKS],
      ),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: run.integrationLabel,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    return failed({
      code: AGENT_ERROR_CODE[agentResult.error],
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this to: wizard@posthog.com`,
      error: new WizardError(
        `API error: ${agentResult.message}`,
        {
          integration: run.integrationLabel,
          error_type: agentResult.error,
        },
        AGENT_ERROR_CODE[agentResult.error],
      ),
    });
  }

  // 10. Post-run hooks
  if (config.hooks?.postRun) {
    await config.hooks.postRun(credentials);
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

  await analytics.shutdown('success');
  return { outcome: RunOutcome.Success, outro: outroData };
}
