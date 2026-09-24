import type { ProgramConfig } from '@programs/program-step';
import { AI_OBSERVABILITY_REPORT_FILE, AI_OBSERVABILITY_RUN } from './run.js';

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
  reportFile: AI_OBSERVABILITY_REPORT_FILE,
  run: AI_OBSERVABILITY_RUN,
};
