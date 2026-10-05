/** The generic skill program: the TUI for every program without an entry of its own. */
import { SkillScreenId } from './screen-ids.js';
import type { TuiProgram } from '@tui/programs/types';
import { AGENT_SKILL_STEPS } from './skill-flow.js';
import { getContentBlocks } from './skill-deck.js';
import { AgentSkillIntroScreen } from './screens/AgentSkillIntroScreen.js';

export const SKILL_PROGRAM: TuiProgram = {
  flow: AGENT_SKILL_STEPS,
  deck: getContentBlocks,
  screens: {
    [SkillScreenId.Intro]: (store) => <AgentSkillIntroScreen store={store} />,
  },
};
