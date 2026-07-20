/**
 * The warehouse run, composed into the default integration flow.
 *
 * `wizard warehouse` stays a standalone command; this reuses the same
 * `ProgramConfig` (prompt builder, abort cases, report file, tool policy) and
 * changes exactly one thing: the outro.
 *
 * Why the outro needs overriding — the last agent run of an invocation is the
 * non-composed one, and that run owns the outro and the analytics shutdown
 * (`runner/sequence/linear.ts`). When the user opts in, the warehouse run is
 * last, so without this it would end the wizard on "Data warehouse source
 * connected!" and drop the SDK-install confirmation, the change list, and the
 * coding-agent handoff prompt. Instead it renders the integration's outro with
 * the connected sources appended to the change list.
 *
 * Why a separate run rather than an `additionalFeatureQueue` entry: the
 * integration run sets `disallowedTools: [wizard_ask]` on purpose, and
 * warehouse setup must use `wizard_ask` to collect connection credentials. A
 * separate run gets its own tool policy.
 */

import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import { runAgent } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { warehouseSourceConfig } from '@lib/programs/warehouse-source/index';
import { getDetectedWarehouseSources } from '@lib/programs/warehouse-source/detect';
import { buildIntegrationOutroData } from './outro.js';

/** True once the user accepted the warehouse offer. */
export const warehouseOptedIn = (session: WizardSession): boolean =>
  session.warehouseOptIn === true;

/**
 * One outro change line naming what was connected — "Connected Postgres and
 * Stripe as data warehouse sources". Reads the same detected-sources key the
 * offer screen and the prompt builder use.
 */
export function describeConnectedSources(session: WizardSession): string {
  const labels = getDetectedWarehouseSources(session).map((s) => s.label);
  if (labels.length === 0) return '';

  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;

  return `Connected ${list} as ${
    labels.length === 1 ? 'a data warehouse source' : 'data warehouse sources'
  }`;
}

/**
 * `warehouseSourceConfig` with the integration's outro. Its `run` is already a
 * function returning a `ProgramRun`, so this resolves it and overrides the one
 * field — the prompt, abort cases, and report file are untouched.
 */
const embeddedWarehouseConfig: ProgramConfig = {
  ...warehouseSourceConfig,
  run: async (session: WizardSession) => {
    const { run } = warehouseSourceConfig;
    if (!run) {
      throw new Error('warehouse-source program has no run recipe');
    }
    const base = typeof run === 'function' ? await run(session) : run;
    return {
      ...base,
      buildOutroData: (sess: WizardSession, credentials) =>
        buildIntegrationOutroData(sess, credentials, [
          describeConnectedSources(sess),
        ]),
    };
  },
};

/**
 * Spliced into POSTHOG_INTEGRATION_PROGRAM just before the outro. Non-composed
 * on purpose: when it runs it is the last run, so it owns the outro. When the
 * user skips (or nothing was detected) `show` is false, this never runs, and
 * the integration run stays non-composed and owns the outro itself.
 */
export const warehouseRunStep: ProgramStep = {
  id: 'warehouse-run',
  label: 'Data warehouse',
  screenId: 'run',
  show: warehouseOptedIn,
  run: (session) => runAgent(embeddedWarehouseConfig, session),
  // Tracked via `completedRuns`, not `runPhase`: the integration run before it
  // leaves `runPhase` at Completed, so a runPhase-only predicate would read as
  // already-done and flash the outro before this run starts.
  isComplete: (session) => session.completedRuns.includes('warehouse-run'),
};
