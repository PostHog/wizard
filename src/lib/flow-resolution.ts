/**
 * Which step key is active: interrupts first, then the first visible
 * incomplete step of the flow. Pure over (flow, session, interrupts).
 */

import { RunPhase, type WizardSession } from '@lib/wizard-session';
import type { Flow } from './flow.js';
import { isRunFailure } from './run-failure.js';

/** Step keys the resolver itself reads. Flows use the same strings. */
export const FLOW_KEY = {
  Auth: 'auth',
  Run: 'run',
  Outro: 'outro',
  Exit: 'exit',
  MintFailure: 'mint-failure',
  Mcp: 'mcp',
  SlackConnect: 'slack-connect',
  KeepSkills: 'keep-skills',
} as const;

export interface FlowEntry {
  id: string;
  show?: (session: WizardSession) => boolean;
  isComplete?: (session: WizardSession) => boolean;
}

/** Post-run steps a mint-failure handoff continues through; ends on exit. */
export const MINT_HANDOFF_SEQUENCE: FlowEntry[] = [
  { id: FLOW_KEY.Mcp, isComplete: (s) => s.mcpComplete },
  { id: FLOW_KEY.SlackConnect, isComplete: (s) => s.slackStepDismissed },
  { id: FLOW_KEY.KeepSkills, isComplete: (s) => s.skillsComplete },
  { id: FLOW_KEY.Exit },
];

const entriesByFlow = new WeakMap<Flow, FlowEntry[]>();

/**
 * The flow's steps that own a screen key, narrowed to what resolution reads.
 * Headless steps are omitted and the exit key is appended.
 */
export function flowEntries(flow: Flow): FlowEntry[] {
  const cached = entriesByFlow.get(flow);
  if (cached) return cached;
  const entries: FlowEntry[] = flow.steps
    .filter((step) => step.screenId != null)
    .map((step) => ({
      id: step.screenId!,
      show: step.show,
      isComplete: step.isComplete ?? step.gate,
    }));
  entries.push({ id: FLOW_KEY.Exit });
  entriesByFlow.set(flow, entries);
  return entries;
}

export function resolveActiveScreen(
  flow: Flow,
  session: WizardSession,
  interrupts: readonly string[],
): string {
  // A failed agent run interrupts every program until the user leaves the
  // handoff screen: exit, or continue through the post-run steps.
  const runFailed = isRunFailure(session);
  if (runFailed && session.mintHandoff === 'exit') return FLOW_KEY.Exit;
  if (runFailed && !session.mintHandoff) return FLOW_KEY.MintFailure;

  if (interrupts.length > 0) return interrupts[interrupts.length - 1];

  const sequence = runFailed ? MINT_HANDOFF_SEQUENCE : flowEntries(flow);
  for (const entry of sequence) {
    if (entry.show && !entry.show(session)) continue;
    if (entry.isComplete && entry.isComplete(session)) continue;
    // A failed login aborts the run: the auth step only completes on
    // credentials, which an aborted login never set, so route to the outro
    // where the error can be read and dismissed. Auth only.
    if (
      entry.id === FLOW_KEY.Auth &&
      session.runPhase === RunPhase.Error &&
      session.outroData
    ) {
      return FLOW_KEY.Outro;
    }
    return entry.id;
  }

  return sequence[sequence.length - 1].id;
}
