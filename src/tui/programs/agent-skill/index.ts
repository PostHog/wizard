/** The agent-skill TUI: the generic skill program, naming the launched skill on its intro. */
import type { TuiPrograms } from '@tui/programs/types';
import { SKILL_PROGRAM } from '@tui/programs/shared/skill-program';

export const TUI_PROGRAMS: TuiPrograms = {
  'agent-skill': { ...SKILL_PROGRAM, introShowsSkill: true },
};
