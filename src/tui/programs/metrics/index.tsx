/** The metrics TUI: the skill flow and deck behind its own intro. */
import type { FlowStep } from '@tui/flow';
import type { TuiPrograms } from '@tui/programs/types';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';
import { getContentBlocks } from '@tui/programs/shared/skill-deck';
import { MetricsScreenId } from './screen-ids.js';
import { MetricsIntroScreen } from './screens/MetricsIntroScreen.js';

export { MetricsScreenId } from './screen-ids.js';

const METRICS_FLOW: FlowStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: MetricsScreenId.Intro } : step,
);

export const TUI_PROGRAMS: TuiPrograms = {
  metrics: {
    flow: METRICS_FLOW,
    deck: getContentBlocks,
    screens: {
      [MetricsScreenId.Intro]: (store) => <MetricsIntroScreen store={store} />,
    },
  },
};
