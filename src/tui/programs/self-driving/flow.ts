/**
 * Self-driving program step list.
 *
 * detect → intro → integration-check → health-check → auth → integrate-detect →
 * integrate-run → self-driving-handoff → self-driving-github → run → outro. A deterministic check in
 * `detect` decides whether PostHog is already in the project: found → the
 * integration screens are skipped and the integrate-run phase never shows; not
 * found → integration-check reports it and the only action sets up PostHog.
 * After auth, `integrate-detect` runs the Haiku detector and has the user pick
 * which project to set PostHog up in (a monorepo can have several);
 * `integrate-run` then runs the real integration program's agent (its own task
 * list) in that project. `self-driving-handoff` then bridges to Self-driving
 * ("PostHog is installed — now set up Self-driving"), then `self-driving-github`
 * gates on the GitHub App connection the run cannot proceed without. No keep-skills step: the setup skill is transient, so postRun removes it.
 */

import type { FlowStep } from '@tui/flow';
import { RunPhase } from '@shared/run-state';
import type { WizardSession } from '@programs/types';
import { HEALTH_CHECK_STEP } from '@tui/programs/shared/health-check-step';
import { POSTHOG_PRESENT_KEY } from '@programs/self-driving';

/** True once detection found PostHog already present in the project. */
const postHogPresent = (session: WizardSession): boolean =>
  session.frameworkContext[POSTHOG_PRESENT_KEY] === true;

/** Absolute dir to integrate into: the picked sub-app (LLM output — the shared resolver clamps escapes), else the repo root. */

export const SELF_DRIVING_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'self-driving-intro',
    gate: (tui) => tui.setupConfirmed,
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
    show: (tui) => !postHogPresent(tui.session) && tui.integrate === null,
    isComplete: (tui) => postHogPresent(tui.session) || tui.integrate !== null,
    gate: (tui) => postHogPresent(tui.session) || tui.integrate !== null,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: ({ session }) => session.credentials !== null,
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
    show: (tui) => tui.integrate === true && tui.session.integration == null,
    // Complete on a picked project OR "continue with existing"
    // (integrate=false); without the latter the orchestrator's waitUntil hangs.
    isComplete: (tui) =>
      tui.session.integration != null || tui.integrate === false,
  },
  {
    // The integration agent (its prompt, tools, task list) runs composed in
    // the picked project's dir; the program's `config.runSteps` owns that run.
    // Shown only when integrating. Completion is tracked via `completedRuns`,
    // separate from the Self-driving run's `runPhase`.
    id: 'integrate-run',
    label: 'Integration',
    screenId: 'run',
    show: (tui) => tui.integrate === true,
    isComplete: (tui) => tui.completedRuns.includes('integrate-run'),
  },
  {
    // Handoff after the integration run: "PostHog is installed — now set up
    // Self-driving". Only in the integrate path; the already-has-PostHog path
    // skips it. Complete once acknowledged (the orchestrator waits on this).
    id: 'self-driving-handoff',
    label: 'Ready',
    screenId: 'self-driving-handoff',
    show: (tui) => tui.integrate === true,
    isComplete: (tui) => tui.selfDrivingHandoffConfirmed,
  },
  {
    // Hard gate before the agent starts: Self-driving cannot research findings
    // or open fixes without repo access. Asking here rather than mid-run means
    // a user who steps away isn't read as declining, and a user who won't
    // connect hasn't paid for an agent start. Complete once GitHub is
    // connected, or once the user says they can't — which hides `run` below.
    id: 'self-driving-github',
    label: 'GitHub',
    screenId: 'self-driving-github',
    isComplete: (tui) => tui.githubConnected === true || tui.githubDeclined,
    gate: (tui) => tui.githubConnected === true || tui.githubDeclined,
  },
  {
    id: 'run',
    label: 'Self-driving',
    screenId: 'run',
    show: (tui) => !tui.githubDeclined,
    isComplete: ({ session }) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (tui) => tui.outroDismissed,
  },
];
