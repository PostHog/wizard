import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { IntroScreenLayout } from '../IntroScreenLayout.js';

interface AuditIntroScreenProps {
  store: WizardStore;
}

export const AuditIntroScreen = ({ store }: AuditIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56}>
      <Text>
        The audit reviews your project's PostHog integration against best
        practices to help you capture high-quality events and writes a report
        for suggested actions. Nothing in your project will be modified.
      </Text>
      <Box marginTop={1}></Box>
      <Text>
        Source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          Skill:{' '}
          <Text italic color="cyan">
            audit
          </Text>
        </Text>
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="flex-start">
      <Text dimColor>
        Read-only review of your existing PostHog integration against best
        practices.
      </Text>
      <Text>Nothing in your project will be modified.</Text>
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
      title="PostHog Audit 🔍"
      showSubtitle={false}
      body={body}
      showDetection={!showingMoreInfo}
      workflowLabel={session.workflowLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
