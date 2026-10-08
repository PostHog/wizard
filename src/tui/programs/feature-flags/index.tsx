/** The feature-flags TUI: the skill flow, deck and tips behind its own intro. */
import type { FlowStep } from '@tui/flow';
import type { TuiPrograms } from '@tui/programs/types';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';
import { getContentBlocks } from './deck/index.js';
import { getTips } from './deck/tips.js';
import { FeatureFlagsScreenId } from './screen-ids.js';
import { FeatureFlagsIntroScreen } from './screens/FeatureFlagsIntroScreen.js';

export { FeatureFlagsScreenId } from './screen-ids.js';

const FEATURE_FLAGS_FLOW: FlowStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: FeatureFlagsScreenId.Intro } : step,
);

export const TUI_PROGRAMS: TuiPrograms = {
  'feature-flags': {
    flow: FEATURE_FLAGS_FLOW,
    deck: getContentBlocks,
    tips: getTips,
    screens: {
      [FeatureFlagsScreenId.Intro]: (store) => (
        <FeatureFlagsIntroScreen store={store} />
      ),
    },
  },
};
