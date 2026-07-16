/**
 * The cloud pipeline. Runs a program against the hosted agent platform instead
 * of a local Claude Agent SDK subprocess.
 *
 * The inversion versus the linear pipeline is the whole point: there, the model
 * runs here and reaches out for a skill; here, the model runs server-side off a
 * frozen bundle and reaches back for the filesystem. So this arm installs no
 * skill, initializes no agent, and assembles no prompt — it opens a session,
 * lends the agent a pair of hands, and mirrors what it reports onto the ledger
 * the audit screens already render.
 *
 * That keeps the audit's behaviour — its checklist, its report format, its
 * instructions — inside a bundle we can re-freeze, instead of frozen into a
 * wizard release.
 */
import * as fs from 'fs';
import * as path from 'path';

import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { getCloudUrlFromRegion } from '@utils/urls';

import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { AUDIT_CHECKS_FILE } from '@lib/programs/audit/types';
import {
  CLOUD_AUDIT_CLIENT_TOOLS,
  execClientTool,
} from '@lib/programs/cloud-audit/client-tools';
import {
  CloudAuditSession,
  CloudSessionError,
  type SessionEvent,
} from '@lib/programs/cloud-audit/client';
import { applyResolveChecksOutput } from '@lib/programs/cloud-audit/ledger-bridge';
import {
  buildAuditTask,
  resolveAgentBaseUrl,
} from '@lib/programs/cloud-audit/config';

import type { ProgramConfig } from '@lib/programs/program-step';
import type { BootstrapResult, ProgramRun } from './shared/types';

/** The bundle-side tool whose results drive the on-screen checklist. */
const LEDGER_TOOL = 'resolve_checks';

/**
 * Run the audit on the hosted platform. Returns `'ok'` on a clean run that
 * produced a report, `'failed'` on any error, unexpected stream end, or a
 * completed run that left no report behind.
 *
 * It never aborts the process on failure — the caller (`runProgram`) decides
 * whether to fail over to the local pipeline. Analytics stays open on failure so
 * the fallback run owns the shutdown; on success this arm shuts analytics down
 * itself.
 */
export async function runCloudProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
): Promise<'ok' | 'failed'> {
  const { accessToken, projectId, host, cloudRegion } = boot;
  const ledgerPath = path.join(session.installDir, AUDIT_CHECKS_FILE);
  const reportPath = path.join(session.installDir, config.reportFile);
  const baseUrl = resolveAgentBaseUrl(cloudRegion);

  const fail = (
    reason: string,
    meta: Record<string, unknown> = {},
  ): 'failed' => {
    // Log + record, but do NOT abort or shut analytics down — the fallback run
    // continues the session and owns the terminal state.
    logToFile(`[cloud-runner] failing over: ${reason}`);
    analytics.wizardCapture('cloud audit failover', {
      integration: config.integrationLabel,
      reason,
      ...meta,
    });
    return 'failed';
  };

  getUI().startRun();
  const spinner = getUI().spinner();
  spinner.start(config.spinnerMessage);
  logToFile(`[cloud-runner] ${programConfig.id} → ${baseUrl}`);

  const onEvent = (event: SessionEvent): void => {
    // The agent's checklist tool is the progress surface: its results carry the
    // catalog and every resolution, shaped exactly like the ledger rows the
    // audit screen renders. Mirroring them here is what drives the live UI.
    if (event.kind === 'tool_result') {
      const data = event.data as {
        name?: string;
        ok?: boolean;
        output?: unknown;
      };
      if (data.name === LEDGER_TOOL && data.ok) {
        applyResolveChecksOutput(ledgerPath, data.output);
      }
      return;
    }
    if (event.kind === 'client_tool_call') {
      const data = event.data as { tool_id?: string };
      spinner.message(`${config.spinnerMessage} (${data.tool_id})`);
    }
  };

  const cloudSession = new CloudAuditSession({
    baseUrl,
    bearer: accessToken,
    task: buildAuditTask({ projectId, host, reportFile: config.reportFile }),
    supportedClientTools: CLOUD_AUDIT_CLIENT_TOOLS,
    onClientTool: (toolId, args) =>
      execClientTool(session.installDir, toolId, args),
    onEvent,
  });

  let outcome;
  try {
    ({ outcome } = await cloudSession.run());
  } catch (e) {
    spinner.stop();
    const message = e instanceof Error ? e.message : String(e);
    return fail('session_error', {
      status: e instanceof CloudSessionError ? e.status : undefined,
      error_message: message,
    });
  }

  if (outcome === 'failed' || outcome === 'no_terminal_event') {
    spinner.stop();
    return fail(outcome);
  }

  // A clean stream end still isn't success if the agent produced no report —
  // that's a silent failure worth falling over from, not shipping an empty run.
  if (!fs.existsSync(reportPath)) {
    spinner.stop();
    return fail('no_report', { outcome });
  }

  spinner.stop(config.successMessage);

  if (config.postRun) {
    await config.postRun(session, {
      accessToken,
      projectApiKey: boot.projectApiKey,
      host,
      projectId,
    });
  }

  // Push outro data through the UI rather than mutating `session` — see the
  // note in linear.ts; this `session` is a snapshot from runAgent() time.
  const outroData = config.buildOutroData
    ? config.buildOutroData(
        session,
        {
          accessToken,
          projectApiKey: boot.projectApiKey,
          host,
          projectId,
        },
        cloudRegion,
      )
    : {
        kind: OutroKind.Success,
        message: config.successMessage,
        reportFile: config.reportFile,
        docsUrl: config.docsUrl,
        continueUrl: session.signup
          ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
          : undefined,
      };
  if (outroData) {
    getUI().setOutroData(outroData);
  }

  getUI().outro(config.successMessage);
  await analytics.shutdown('success');
  return 'ok';
}
