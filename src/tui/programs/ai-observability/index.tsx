/** The AI observability TUI: the skill flow and deck behind its own intro. */
import type { FlowStep } from '@tui/flow';
import type { TuiPrograms } from '@tui/programs/types';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';
import { getContentBlocks } from '@tui/programs/shared/skill-deck';
import { AiObservabilityScreenId } from './screen-ids.js';
import { AiObservabilityIntroScreen } from './screens/AiObservabilityIntroScreen.js';

export { AiObservabilityScreenId } from './screen-ids.js';

const AI_OBSERVABILITY_FLOW: FlowStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro'
    ? { ...step, screenId: AiObservabilityScreenId.Intro }
    : step,
);

export const TUI_PROGRAMS: TuiPrograms = {
  'ai-observability': {
    flow: AI_OBSERVABILITY_FLOW,
    deck: getContentBlocks,
    screens: {
      [AiObservabilityScreenId.Intro]: (store) => (
        <AiObservabilityIntroScreen store={store} />
      ),
    },
  },
};
