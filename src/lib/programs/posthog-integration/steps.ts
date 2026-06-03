/**
 * PostHog integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { McpOutcome, RunPhase } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { detectPostHogIntegration } from './detect.js';

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
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Integration',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'mcp-suggested-prompts',
    label: 'Suggested prompts',
    screenId: 'mcp-suggested-prompts',
    // Only render when MCP was actually installed — skip on user opt-out,
    // no clients detected, or install failure. The screen has no value
    // without a working MCP for the user to try the prompts against.
    show: (session) => session.mcpOutcome === McpOutcome.Installed,
    isComplete: (session) => session.mcpSuggestedPromptsDismissed,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];
