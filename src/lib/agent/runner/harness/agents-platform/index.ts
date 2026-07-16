/**
 * The `agents-platform` harness — the SDK adapter for the hosted PostHog agent
 * platform. Unlike `anthropic`/`pi`, the model does not run locally: the agent
 * runs server-side off a frozen bundle and reaches back for this machine's
 * filesystem through client tools. So this harness installs no skill, assembles
 * no prompt, and ignores the local-agent fields on `BackendRunInputs` — it opens
 * a platform session, lends the agent a pair of hands, and mirrors what it
 * reports onto the ledger the audit screens already render.
 *
 * It owns only the agent loop + transport. The `remote` sequence owns the shared
 * pipeline around it (seed, failover, outro), mirroring how `linear.ts` wraps the
 * `anthropic`/`pi` harnesses.
 */
import * as fs from 'fs';
import * as path from 'path';

import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

import { Harness } from '@lib/constants';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { AUDIT_CHECKS_FILE } from '@lib/programs/audit/types';

import type { AgentResult, AgentHarness, BackendRunInputs } from '../types';
import { CLOUD_AUDIT_CLIENT_TOOLS, execClientTool } from './client-tools';
import {
  CloudAuditSession,
  CloudSessionError,
  type SessionEvent,
} from './session';
import { applyResolveChecksOutput } from './ledger-bridge';
import { buildAuditTask, resolveAgentBaseUrl } from './config';

/** The bundle-side tool whose results drive the on-screen checklist. */
const LEDGER_TOOL = 'resolve_checks';

export const agentsPlatformBackend: AgentHarness = {
  name: Harness.agentsPlatform,

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const { session, config, programConfig, boot, spinner } = inputs;
    const { accessToken, projectId, host } = boot.credentials;
    const ledgerPath = path.join(session.installDir, AUDIT_CHECKS_FILE);
    const reportPath = path.join(session.installDir, config.reportFile);
    const baseUrl = resolveAgentBaseUrl(host.region);

    const fail = (
      reason: string,
      meta: Record<string, unknown> = {},
    ): AgentResult => {
      // Record the failover, but leave the terminal state to the `remote`
      // sequence — it decides whether to degrade to the local pipeline.
      logToFile(`[agents-platform] failing over: ${reason}`);
      analytics.wizardCapture('agents-platform failover', {
        integration: config.integrationLabel,
        reason,
        ...meta,
      });
      return { error: AgentErrorType.API_ERROR, message: reason };
    };

    spinner.start(config.spinnerMessage);
    logToFile(`[agents-platform] ${programConfig.id} → ${baseUrl}`);

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
      task: buildAuditTask({
        projectId,
        host: host.appHost,
        reportFile: config.reportFile,
      }),
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
    return {};
  },
};
