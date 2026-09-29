/** The AI observability TUI: the skill flow and deck behind its own intro. */
import type { TuiPrograms } from '@tui/programs/types';
import { skillFlow } from '@tui/programs/shared/skill-flow';
import { getContentBlocks } from '@tui/programs/shared/skill-deck';
import { AiObservabilityScreenId } from './screen-ids.js';
import { AiObservabilityIntroScreen } from './screens/AiObservabilityIntroScreen.js';

export { AiObservabilityScreenId } from './screen-ids.js';

export const TUI_PROGRAMS: TuiPrograms = {
  'ai-observability': {
    flow: skillFlow(AiObservabilityScreenId.Intro),
    deck: getContentBlocks,
    screens: {
      [AiObservabilityScreenId.Intro]: (store) => (
        <AiObservabilityIntroScreen store={store} />
      ),
    },
  },
};
