/**
 * Agent-skill learn-deck — the short three-line sequence shown while a
 * skill-based program (audit, revenue-analytics, agent-skill, etc.)
 * runs. Skill programs don't need the full PostHog onboarding narrative.
 */

import { Text } from 'ink';
import type { WizardStore } from '../../../../ui/tui/store.js';
import { TextRevealMode } from '../../../../ui/tui/primitives/TextBlock.js';
import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => {
  const skillId = store?.session.skillId ?? 'unknown';
  return [
    {
      content: 'Welcome.',
      pause: 3000,
      mode: TextRevealMode.Typewriter,
      animationInterval: 160,
    },
    { content: 'The Wizard is an agent.', pause: 4000 },
    {
      pause: 60000,
      content: (
        <Text>
          Running the <Text color="cyan">{skillId}</Text> skill...
        </Text>
      ),
    },
  ];
};
