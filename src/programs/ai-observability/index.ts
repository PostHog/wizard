import type { ProgramConfig, ProgramStep } from '@programs/program-step';
import { AGENT_SKILL_STEPS } from '@programs/agent-skill/index';
import { getContentBlocks } from '@ui/tui/decks/agent-skill/index';
import { headlessOption, regionOption } from '@lib/headless-mode';
import { AI_OBSERVABILITY_REPORT_FILE, AI_OBSERVABILITY_RUN } from './run.js';

const AI_OBSERVABILITY_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'ai-observability-intro' } : step,
);

/**
 * `wizard ai-observability` — wrap the project's LLM client calls so they emit
 * `$ai_generation` events into AI Observability.
 *
 * No `run.skillId`: the context-mill `ai-observability` group ships one variant
 * per (LLM provider × language) and the wizard does no provider detection —
 * the agent loads the menu, matches the manifest's vendor SDK, and installs
 * the right variant itself (see `customPrompt`). Stays flat while a single
 * "add AIO to a project" flow is the only action.
 */
export const aiObservabilityConfig: ProgramConfig = {
  command: 'ai-observability',
  description: 'Add PostHog AI Observability to your LLM calls',
  id: 'ai-observability',
  cliOptions: { ...headlessOption, ...regionOption },
  steps: AI_OBSERVABILITY_STEPS,
  reportFile: AI_OBSERVABILITY_REPORT_FILE,
  getContentBlocks,
  run: AI_OBSERVABILITY_RUN,
};
