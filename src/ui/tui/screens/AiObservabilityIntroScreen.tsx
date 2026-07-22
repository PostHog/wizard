import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';

interface AiObservabilityIntroScreenProps {
  store: WizardStore;
}

export const AiObservabilityIntroScreen = ({
  store,
}: AiObservabilityIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  // ai-observability picks its skill variant at run time (openai-python,
  // anthropic-node, langchain-python, …), so there's no pre-seeded skillId
  // here. Fall back to the group id for the "more info" lookup.
  const skillId = session.skillId ?? 'ai-observability';
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, session.localMcp);

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56}>
      <Box marginBottom={1}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
      </Box>

      <Text>
        The{' '}
        <Text color="cyan" italic>
          ai-observability
        </Text>{' '}
        program wraps your LLM SDK calls with PostHog's OpenTelemetry-based
        tracing so every prompt, completion, tool call, token count, and cost
        lands in AI Observability. Supports OpenAI, Anthropic, Google,
        LangChain, Vercel AI, and other SDKs.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Let's instrument your LLM calls with PostHog AI Observability.
      </Text>
    </Box>
  );

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') process.exit(0);
    else if (value === 'more-info') setShowingMoreInfo(true);
    else if (value === 'back') setShowingMoreInfo(false);
    else store.completeSetup();
  };

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
