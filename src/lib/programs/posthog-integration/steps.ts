/**
 * PostHog integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { RunPhase } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { getDetectedWarehouseSources } from '@lib/programs/warehouse-source/detect';
import { detectPostHogIntegration } from './detect.js';
import { warehouseRunStep } from './warehouse-step.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

export const POSTHOG_INTEGRATION_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting framework',
    // Headless step: no screen. onReady fires after bin.ts assigns the
    // session — runs framework detection, context gathering, version
    // check, and feature discovery. Results are written to the store
    // for the IntroScreen to render.
    onReady: (ctx) => detectPostHogIntegration(ctx),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'intro',
    gate: (session) => session.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: needsSetup,
    isComplete: (session) => !needsSetup(session),
  },
  {
    // "We found Postgres and Stripe — connect them to PostHog?". Shown only
    // when detection actually found sources, so a project with nothing to
    // connect never sees it and the flow is unchanged.
    //
    // Deliberately before `auth`, not after the integration run: the answer
    // decides whether the warehouse run happens, and therefore which run is
    // the last one (the last run owns the outro — see run-wizard's
    // `hasLaterRun`). Asking afterwards would be too late to decide. Mirrors
    // how self-driving settles `integrate` up front.
    id: 'warehouse-offer',
    label: 'Data sources',
    screenId: 'warehouse-offer',
    show: (session) =>
      getDetectedWarehouseSources(session).length > 0 &&
      session.warehouseOptIn === null,
    // No `gate`: the composed walk in run-wizard blocks on `isComplete`, and
    // nothing awaits a `warehouse-offer` gate, so one would just dangle.
    isComplete: (session) => session.warehouseOptIn !== null,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Integration',
    screenId: 'run',
    // `completedRuns` first: when the warehouse run follows, it resets the
    // shared `runPhase`, and without the durable signal this step would flip
    // back to incomplete and the router would re-show the integration screen.
    isComplete: (session) =>
      session.completedRuns.includes('run') ||
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  // Connects the detected sources. Shown only when the offer was accepted;
  // otherwise it never runs and the integration run above owns the outro.
  warehouseRunStep,
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    // Always shown — the user declines via Skip/esc, never bypassed.
    isComplete: (session) => session.slackStepDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];
