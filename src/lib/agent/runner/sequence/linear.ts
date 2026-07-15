/**
 * The linear pipeline. Single execution path for all non-orchestrator programs,
 * both skill-based (revenue analytics) and framework-based (core integration).
 * The `ProgramRun` controls what varies between them; `programConfig` carries the
 * program-level static metadata (tool allow/disallow lists, etc.).
 */

import type { WizardSession } from '../../../wizard-session';
import { OutroKind } from '../../../wizard-session';
import { getUI } from '../../../../ui';
import { AgentErrorType, AgentSignals } from '../../agent-interface';
import { restoreClaudeSettings } from '../../claude-settings';
import { logToFile } from '../../../../utils/debug';
import { createBenchmarkPipeline } from '../../../middleware/benchmark';
import {
  wizardAbort,
  WizardError,
  registerCleanup,
} from '../../../../utils/wizard-abort';
import { analytics } from '../../../../utils/analytics';
import {
  formatScanReport,
  formatYaraAbortMessage,
  writeScanReport,
} from '../../../yara-hooks';
import { installSkillById } from '../../../wizard-tools';
import { createWizardAskBridge } from '../../../wizard-ask-bridge';
import type { ProgramConfig } from '../../../programs/program-step';
import { assemblePrompt } from '../../agent-prompt';
import type { ProgramRun, BootstrapResult } from '../shared/types';
import { abortOnInstallFailure } from '../shared/errors';
import { shouldDisableAsk, sessionToOptions } from '../shared/bootstrap';
import { resolveHarness, getHarness } from '../switchboard';

export async function runLinearProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
  composed = false,
): Promise<void> {
  const { skillsBaseUrl, credentials, wizardFlags, project } = boot;
  const { projectApiKey, host, projectId } = credentials;

  // 5. Skill install (if skillId provided)
  let skillPath: string | undefined;
  if (config.skillId) {
    logToFile(`[agent-runner] installing skill ${config.skillId}`);
    const installResult = await installSkillById(
      config.skillId,
      session.installDir,
      skillsBaseUrl,
    );
    if (installResult.kind !== 'ok') {
      await abortOnInstallFailure(config.integrationLabel, installResult);
      return;
    }
    skillPath = installResult.path;
    logToFile(`[agent-runner] skill installed at ${skillPath}`);
  }

  // 6. Initialize agent
  const spinner = getUI().spinner();

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);

  if (session.yaraReport) {
    registerCleanup(() => {
      const reportPath = writeScanReport();
      if (reportPath) {
        const summary = formatScanReport();
        getUI().log.info(`YARA scan report: ${reportPath}${summary ?? ''}`);
      }
    });
  }

  getUI().startRun();

  // wizard_ask is only available in interactive mode. CI/signup users have
  // no way to answer; we omit the bridge so the tool returns an actionable
  // error rather than hanging on a never-resolving prompt.
  const askDisabled = shouldDisableAsk(session);
  const askBridge = askDisabled
    ? undefined
    : createWizardAskBridge({
        getSource: () => session.skillId ?? config.integrationLabel,
        showQuestion: (q) => getUI().requestQuestion(q),
        cancelQuestion: () => getUI().cancelPendingQuestion(),
        richLinks: config.richLinks ?? false,
        timeoutMs: config.askTimeoutMs,
      });

  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : undefined;

  // 7. Build prompt
  const prompt = assemblePrompt(config, {
    projectId,
    projectApiKey,
    host,
    skillPath,
    orgAiDataProcessingApproved:
      session.apiUser?.organization?.is_ai_data_processing_approved ?? null,
    teamProductOptIns: project
      ? {
          sessionReplay: project.session_recording_opt_in ?? null,
          exceptionAutocapture: project.autocapture_exceptions_opt_in ?? null,
          surveys: project.surveys_opt_in ?? null,
        }
      : null,
  });
  logToFile(`[agent-runner] prompt assembled (${prompt.length} chars)`);

  // 8. Resolve the (runner, model) pair from the central plan and run the agent
  // through the selected runner. The runner owns the agent loop + model
  // transport; everything around it (skill install, prompt, ask bridge, error
  // routing, outro) stays here so every runner shares it.
  const pick = resolveHarness({
    program: programConfig.id,
    flags: wizardFlags,
    cliHarness: session.harness,
    cliModel: session.model,
  });
  const agentResult = await getHarness(pick.harness).run({
    session,
    config,
    programConfig,
    boot,
    prompt,
    skillPath,
    spinner,
    askBridge,
    middleware,
    model: pick.model,
  });

  // 9. Error handling (full set from both runners)
  if (
    agentResult.error &&
    agentResult.error !== AgentErrorType.YARA_VIOLATION &&
    config.bestEffort
  ) {
    analytics.wizardCapture('agent best-effort failure', {
      integration: config.integrationLabel,
      error_type: agentResult.error,
      error_message: agentResult.message ?? null,
    });
    return;
  }

  if (agentResult.error === AgentErrorType.ABORT) {
    const reason = agentResult.message ?? '';
    const matched = config.abortCases?.find((c) => c.match.test(reason));
    const outroData: WizardSession['outroData'] = matched
      ? {
          kind: OutroKind.Error,
          message: matched.message,
          body: matched.body,
          docsUrl: matched.docsUrl,
        }
      : {
          kind: OutroKind.Error,
          message: `${config.integrationLabel} aborted`,
          body: reason || 'The agent aborted the program.',
          docsUrl: config.docsUrl,
        };
    analytics.wizardCapture('agent aborted', {
      integration: config.integrationLabel,
      reason,
      matched: matched?.message ?? null,
    });
    await wizardAbort({
      outroData,
      error: new WizardError(`Agent aborted: ${reason}`, {
        integration: config.integrationLabel,
        error_type: AgentErrorType.ABORT,
        reason,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message:
        'Could not access the PostHog MCP server\n\n' +
        'The wizard was unable to connect to the PostHog MCP server.\n' +
        'This could be due to a network issue or a configuration problem.\n\n' +
        `Please try again, or check the documentation:\n${config.docsUrl}`,
      error: new WizardError('Agent could not access PostHog MCP server', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message:
        'Could not access the setup resource\n\n' +
        'This may indicate a version mismatch or a temporary service issue.\n\n' +
        `Please try again, or check the documentation:\n${config.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    await wizardAbort({
      message: formatYaraAbortMessage(),
      error: new WizardError('YARA scanner terminated session', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.YARA_VIOLATION,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.NO_PROGRESS) {
    analytics.wizardCapture('agent no progress', {
      integration: config.integrationLabel,
      error_type: AgentErrorType.NO_PROGRESS,
    });
    await wizardAbort({
      message:
        'The Wizard exited without changing your project. Please contact the ' +
        'PostHog team with wizard@posthog.com about this error.',
      error: new WizardError('Agent made no progress', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.NO_PROGRESS,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.INCOMPLETE_TASKS) {
    analytics.wizardCapture('agent incomplete tasks', {
      integration: config.integrationLabel,
      error_type: AgentErrorType.INCOMPLETE_TASKS,
    });
    await wizardAbort({
      message:
        'The Wizard exited without completing its planned tasks. Please contact ' +
        'the PostHog team with wizard@posthog.com about this error.',
      error: new WizardError('Agent left planned tasks incomplete', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.INCOMPLETE_TASKS,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: config.integrationLabel,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this to: wizard@posthog.com`,
      error: new WizardError(`API error: ${agentResult.message}`, {
        integration: config.integrationLabel,
        error_type: agentResult.error,
      }),
    });
  }

  // 10. Post-run hooks
  if (config.postRun) {
    await config.postRun(session, credentials);
  }

  // A composed sub-run (integration inside self-driving) skips the terminal
  // outro + analytics shutdown so the shared client survives the host's run.
  if (composed) return;

  // 11. Outro
  // Push outro data through the UI (not via direct `session.outroData = ...`
  // mutation) so the live store gets the value. agent-runner's `session`
  // parameter is captured at runAgent() invocation time, and any `setKey`
  // call between then and here (e.g. setDashboardUrl, setNotebookUrl) forks
  // the session reference — direct mutation then lands on a stale snapshot
  // that the screen never reads. UI.setOutroData() goes through the store
  // and also merges in any post-snapshot URLs from the live session.
  const outroData = config.buildOutroData
    ? config.buildOutroData(session, credentials)
    : {
        kind: OutroKind.Success,
        message: config.successMessage,
        reportFile: config.reportFile,
        docsUrl: config.docsUrl,
        continueUrl: session.signup
          ? `${host.appHost}/products?source=wizard`
          : undefined,
      };
  if (outroData) {
    getUI().setOutroData(outroData);
  }

  getUI().outro(config.successMessage);

  // 12. Analytics shutdown
  await analytics.shutdown('success');
}
