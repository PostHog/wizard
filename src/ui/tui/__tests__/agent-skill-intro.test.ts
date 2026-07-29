import { describe, expect, it } from 'vitest';
import { getAgentSkillIntroTarget } from '../screens/AgentSkillIntroScreen.js';

describe('getAgentSkillIntroTarget', () => {
  it('uses the selected skill when one is known before the run', () => {
    expect(getAgentSkillIntroTarget('events-audit', 'audit')).toEqual({
      label: 'events-audit',
      noun: 'skill',
    });
  });

  it('uses the program label when the agent selects a skill at runtime', () => {
    expect(getAgentSkillIntroTarget(null, 'feature-flags')).toEqual({
      label: 'feature-flags',
      noun: 'program',
    });
  });
});
