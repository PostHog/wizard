/**
 * The `remote` sequence — remote bundle execution.
 *
 * The inversion versus `linear` is the whole point: there, the model runs here
 * and reaches out for a skill; here, the model runs server-side off a frozen
 * bundle and reaches back for the filesystem. So this sequence installs no skill
 * and assembles no prompt — it resolves the program's remote run, drives it
 * through the `agents-platform` harness, and owns the shared pipeline around that
 * call (failover to the local arm, terminal outro), exactly as `linear.ts` wraps
 * the `anthropic`/`pi` harnesses.
 *
 * A program opts in by declaring `remoteRun` on its `ProgramConfig`; the
 * switchboard binds it to this sequence (see the `wizard-cloud-audit` flag). Its
 * default `run` stays the local arm and is the fallback if the hosted arm fails.
 */
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

import { Harness } from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import type { ProgramConfig } from '@lib/programs/program-step';

import type { ProgramRun, BootstrapResult } from '../shared/types';
import { getHarness } from '../switchboard';
import { runLinearProgram } from './linear';

export async function runRemoteProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
  composed: boolean,
): Promise<void> {
  // A program bound to `remote` must declare how to run remotely. If it doesn't,
  // degrade to the local pipeline rather than crash.
  if (!programConfig.remoteRun) {
    logToFile(
      `[remote] ${programConfig.id} has no remoteRun — running locally.`,
    );
    return runLinearProgram(session, config, programConfig, boot, composed);
  }

  // Resolving the remote run seeds its own placeholder ledger as a side effect.
  const remoteRun = await programConfig.remoteRun(session);

  getUI().startRun();
  const spinner = getUI().spinner();

  const result = await getHarness(Harness.agentsPlatform).run({
    session,
    config: remoteRun,
    programConfig,
    boot,
    prompt: '',
    spinner,
    model: '',
  });

  if (result.error) {
    // The hosted arm failed — degrade to the local pipeline on the same
    // bootstrap. The classic run reseeds its own ledger; no re-auth.
    getUI().log.info('Hosted audit unavailable — running the audit locally.');
    return runLinearProgram(session, config, programConfig, boot, composed);
  }

  // Success — this sequence owns the terminal outro + shutdown, mirroring
  // linear.ts (the harness deliberately doesn't).
  const { credentials } = boot;
  const { host } = credentials;

  if (remoteRun.postRun) {
    await remoteRun.postRun(session, credentials);
  }

  // A composed sub-run skips the terminal outro + analytics shutdown so the
  // shared client survives the host's run.
  if (composed) return;

  const outroData = remoteRun.buildOutroData
    ? remoteRun.buildOutroData(session, credentials)
    : {
        kind: OutroKind.Success,
        message: remoteRun.successMessage,
        reportFile: remoteRun.reportFile,
        docsUrl: remoteRun.docsUrl,
        continueUrl: session.signup
          ? `${host.appHost}/products?source=wizard`
          : undefined,
      };
  if (outroData) {
    getUI().setOutroData(outroData);
  }

  getUI().outro(remoteRun.successMessage);
  await analytics.shutdown('success');
}
