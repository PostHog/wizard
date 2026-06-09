/**
 * Experimental task-queue orchestrator runner.
 *
 * Branches from the linear runner when the `wizard-orchestrator` feature flag is
 * on. The shape: an orchestrator agent inspects the repo and seeds an
 * in-memory task queue, and an executor drains it one fresh agent per task.
 *
 * This is the stub. It logs, emits a start event, and returns. The queue, the
 * executor, and the seeding agent land in the following issues.
 */
import type { WizardSession } from '../../wizard-session';
import type { ProgramConfig } from '../program-step';
import type { BootstrapResult } from '../../agent/agent-runner';
import { getUI } from '../../../ui';
import { logToFile } from '../../../utils/debug';
import { analytics } from '../../../utils/analytics';

export function runOrchestrator(
  session: WizardSession,
  programConfig: ProgramConfig,
  _boot: BootstrapResult,
): Promise<void> {
  logToFile(
    `[orchestrator] START program=${programConfig.id} dir=${session.installDir}`,
  );
  analytics.wizardCapture('orchestrator started', {
    program_id: programConfig.id,
  });
  getUI().log.info(
    'Orchestrator flag is on. This runner is a stub for now; the queue and executor land in the following issues.',
  );
  return Promise.resolve();
}
