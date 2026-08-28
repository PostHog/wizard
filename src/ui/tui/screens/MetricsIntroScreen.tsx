import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';

interface MetricsIntroScreenProps {
  store: WizardStore;
}

export const MetricsIntroScreen = ({ store }: MetricsIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  // metrics picks its skill variant at run time (python, nodejs, javascript,
  // kubernetes, other), so there's no pre-seeded skillId here. Fall back to
  // the group id for the "more info" lookup.
  const skillId = session.skillId ?? 'metrics';
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
          metrics
        </Text>{' '}
        program instruments your service with PostHog application metrics —
        counters, gauges, and histograms via{' '}
        <Text color="cyan">posthog.metrics</Text> — at operational choke points:
        request middleware, background jobs, external calls, and business commit
        sites. Supports Python, Node.js, web JavaScript, Kubernetes, and any
        other language via OTLP.
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
        Let's instrument your service with PostHog application metrics.
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
