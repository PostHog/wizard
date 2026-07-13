/**
 * Self-driving program step list.
 *
 * detect → intro → integration-check → health-check → auth → events-check →
 * integrate-detect → integrate-run → self-driving-handoff → run → outro. A
 * deterministic check in `detect` decides whether PostHog is already in the
 * project: found → the integration screens are skipped and the integrate-run
 * phase never shows; not found → integration-check reports it and the only
 * action sets up PostHog. On the already-present path, `events-check` probes
 * the project's event definitions after auth: only default (or no) events →
 * it proposes setting up product analytics, which routes into the same
 * integrate path. After auth, `integrate-detect` runs the Haiku detector and
 * has the user pick which project to set PostHog up in (a monorepo can have
 * several); `integrate-run` then runs the real integration program's agent
 * (its own task list) in that project. `self-driving-handoff` then bridges to
 * Self-driving ("PostHog is installed — now set up Self-driving") before the
 * Self-driving run. No keep-skills step: the setup skill is transient, so
 * postRun removes it.
 */

import { resolve, sep } from 'path';
import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase, type WizardSession } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { integrationRunStep } from '@lib/programs/posthog-integration/index';
import {
  detectSelfDrivingPrerequisites,
  POSTHOG_PRESENT_KEY,
  SELF_DRIVING_CUSTOM_EVENTS_KEY,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
} from './detect.js';
import { prepSelfDrivingIntegration } from './detect-agentic.js';

/** True once detection found PostHog already present in the project. */
const postHogPresent = (session: WizardSession): boolean =>
  session.frameworkContext[POSTHOG_PRESENT_KEY] === true;

/**
 * Absolute dir to integrate into: the picked sub-app, else the repo root.
 * The picked path originates from LLM output; if it resolves outside the
 * repo (defense-in-depth on top of the coerce-layer clamp), fall back to
 * the root rather than run the agent elsewhere.
 */
const integrationDir = (session: WizardSession): string => {
  const rel = session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY];
  if (typeof rel !== 'string' || rel === '.') return session.installDir;
  const root = resolve(session.installDir);
  const dir = resolve(root, rel);
  return dir === root || dir.startsWith(root + sep) ? dir : root;
};

export const SELF_DRIVING_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    // Headless: validates the install dir and runs the deterministic
    // PostHog-presence check (writes frameworkContext.postHogPresent).
    onReady: (ctx) =>
      detectSelfDrivingPrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'self-driving-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    // Shown only when PostHog wasn't detected and the decision is still open:
    // "Set up PostHog first?". On "yes" the integrate-run phase runs the
    // integration. When PostHog is already present (or `--integrate` pre-set
    // it), this is skipped. The gate lets run-wizard settle the decision —
    // resolved immediately when no question is needed.
    id: 'integration-check',
    label: 'Integration',
    screenId: 'self-driving-integration-check',
    show: (session) => !postHogPresent(session) && session.integrate === null,
    isComplete: (session) =>
      postHogPresent(session) || session.integrate !== null,
    gate: (session) => postHogPresent(session) || session.integrate !== null,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    // Shown only on the PostHog-already-present path: after auth, probe
    // whether the project captures any custom events. Default-only (or no)
    // events → propose setting up product analytics first; accepting sets
    // integrate=true and reuses the whole integrate path below (the standard
    // integration program IS the analytics setup). Custom events found (or
    // the probe failed — fail open, never nag) → completes silently.
    id: 'events-check',
    label: 'Events',
    screenId: 'self-driving-events-check',
    show: (session) => postHogPresent(session) && session.integrate === null,
    isComplete: (session) =>
      session.frameworkContext[SELF_DRIVING_CUSTOM_EVENTS_KEY] === true ||
      session.integrate !== null,
  },
  {
    // After auth, before the integration runs: the detector scans the repo and
    // the user picks which project to set PostHog up in — a single project or
    // the repo root is still a one-item confirm. The pick writes the framework +
    // path to the session. Shown only while integrating and undecided; complete
    // once a project is picked (the orchestrator waits on this live).
    id: 'integrate-detect',
    label: 'Detecting',
    screenId: 'self-driving-integration-detect',
    show: (session) =>
      session.integrate === true && session.integration == null,
    // Complete on a picked project OR "continue with existing"
    // (integrate=false); without the latter the orchestrator's waitUntil hangs.
    isComplete: (session) =>
      session.integration != null || session.integrate === false,
  },
  {
    // The integration's own run step, imported and composed here: it runs the
    // integration agent (its prompt, tools, task list) in the picked project's
    // dir. Shown only when integrating; prep gathers that project's framework
    // context. Completion is tracked via `completedRuns`, separate from the
    // Self-driving run's `runPhase`.
    ...integrationRunStep,
    id: 'integrate-run',
    onRunPrep: prepSelfDrivingIntegration,
    targetDir: integrationDir,
    show: (session) => session.integrate === true,
    isComplete: (session) => session.completedRuns.includes('integrate-run'),
  },
  {
    // Handoff after the integration run: "PostHog is installed — now set up
    // Self-driving". Only in the integrate path; the already-has-PostHog path
    // skips it. Complete once acknowledged (the orchestrator waits on this).
    id: 'self-driving-handoff',
    label: 'Ready',
    screenId: 'self-driving-handoff',
    show: (session) => session.integrate === true,
    isComplete: (session) => session.selfDrivingHandoffConfirmed,
  },
  {
    id: 'run',
    label: 'Self-driving',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
];
