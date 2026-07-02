/**
 * Self-driving program step list.
 *
 * detect → intro → integration-check → health-check → auth → integrate-detect →
 * integrate-run → self-driving-handoff → run → outro. A deterministic check in
 * `detect` decides whether PostHog is already in the project: found → the
 * integration screens are skipped and the integrate-run phase never shows; not
 * found → integration-check reports it and the only action sets up PostHog.
 * After auth, `integrate-detect` runs the Haiku detector and has the user pick
 * which project to set PostHog up in (a monorepo can have several);
 * `integrate-run` then runs the real integration program's agent (its own task
 * list) in that project. `self-driving-handoff` then bridges to Self-driving
 * ("PostHog is installed — now set up Self-driving") before the Self-driving
 * run. No keep-skills step: the setup skill is transient, so postRun removes it.
 */

import { resolve } from 'path';
import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase, type WizardSession } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { integrationRunStep } from '@lib/programs/posthog-integration/index';
import {
  detectSelfDrivingPrerequisites,
  POSTHOG_PRESENT_KEY,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
} from './detect.js';
import { prepSelfDrivingIntegration } from './detect-agentic.js';

/** True once detection found PostHog already present in the project. */
const postHogPresent = (session: WizardSession): boolean =>
  session.frameworkContext[POSTHOG_PRESENT_KEY] === true;

/** Absolute dir to integrate into: the picked sub-app, else the repo root. */
const integrationDir = (session: WizardSession): string => {
  const rel = session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY];
  return typeof rel === 'string' && rel !== '.'
    ? resolve(session.installDir, rel)
    : session.installDir;
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
    isComplete: (session) => session.integration != null,
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
