/**
 * posthog-integration's use of a Decisions answer: the CI framework fill-in.
 * Unused until primary mode has a switch.
 */

import type { Integration } from '@shared/constants';
import { logToFile } from '@utils/debug';
import type { ProgramSession } from '@programs/program-contract';
import type { CiRunnerContext } from '@programs/program-contract';
import {
  askDecisions,
  decisionsMode,
  decisionsTransport,
  QUESTIONS,
  renderDecisionState,
  routeIntegration,
} from '@services/detection/decisions';
import { getRepoFiles } from '@services/project-discovery';

/**
 * CI only, primary mode: ask for the framework when static detection found
 * none, rather than abort. Logs in first, since the call needs the gateway key.
 * Never throws: on any failure the run aborts as it did before.
 */
export async function judgeMissingIntegration(
  session: ProgramSession,
  runner: CiRunnerContext,
): Promise<Integration | undefined> {
  try {
    return await askForMissingIntegration(session, runner);
  } catch (error) {
    // The caller's abort explains a missing framework better than this error would.
    logToFile(`[decisions] framework fill-in failed: ${String(error)}`);
    return undefined;
  }
}

async function askForMissingIntegration(
  session: ProgramSession,
  runner: CiRunnerContext,
): Promise<Integration | undefined> {
  if (decisionsMode() !== 'primary') return undefined;
  await runner.authenticate('posthog-integration');
  const transport = await decisionsTransport(session, 'posthog-integration');
  if (!transport) return undefined;
  const result = await askDecisions(
    renderDecisionState(getRepoFiles(session)),
    [QUESTIONS.framework],
    { transport },
  );
  const routed = routeIntegration(
    result.answers[QUESTIONS.framework.name],
    undefined,
  );
  logToFile(
    `[decisions] static detection found no framework; decisions=${
      routed.integration ?? 'none'
    }${result.error ? ` error=${result.error}` : ''}`,
  );
  return routed.integration;
}
