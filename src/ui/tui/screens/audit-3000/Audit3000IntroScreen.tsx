import { Box, Text } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { IntroScreenLayout } from '../IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from '../SkillSourceInfo.js';
import { NEON_BLUE, NEON_GOLD, NEON_PINK } from './arcade-colors.js';

const AUDIT3000_SKILL_ID = 'audit-3000';

const ArcadeBanner = () => {
  // Blink the "INSERT COIN" tagline once per 600ms — classic attract-mode
  // pacing without burning Ink with rapid re-renders.
  const [blinkOn, setBlinkOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setBlinkOn((v) => !v), 600);
    return () => clearInterval(id);
  }, []);

  const top = '\u250F' + '\u2501'.repeat(32) + '\u2513';
  const bottom = '\u2517' + '\u2501'.repeat(32) + '\u251B';

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold color={NEON_PINK}>
        {top}
      </Text>
      <Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
        <Text bold color={NEON_GOLD}>
          {'   A U D I T  '}
        </Text>
        <Text bold color={NEON_BLUE}>
          {'-'}
        </Text>
        <Text bold color={NEON_GOLD}>
          {'  3 0 0 0      '}
        </Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
      </Text>
      <Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
        <Text dimColor={!blinkOn} color={NEON_BLUE}>
          {'   \u25B6 INSERT COIN TO PLAY \u25C0   '}
        </Text>
        <Text bold color={NEON_PINK}>
          {'\u2503'}
        </Text>
      </Text>
      <Text bold color={NEON_PINK}>
        {bottom}
      </Text>
    </Box>
  );
};

interface Audit3000IntroScreenProps {
  store: WizardStore;
}

export const Audit3000IntroScreen = ({ store }: Audit3000IntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  const { skillEntry, fetchFailed } = useSkillEntry(
    AUDIT3000_SKILL_ID,
    session.localMcp,
  );

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
          {AUDIT3000_SKILL_ID}
        </Text>{' '}
        program reviews your PostHog integration across 34 checks — SDK install,
        identification, event capture, event quality, stale feature flag
        hygiene, session replay (fix + optimize), and use-case expansion across
        8 PostHog products. When enrichment is available it also produces a
        company profile and use-case match. Nothing in your project is modified.
      </Text>
      <Box marginTop={1}>
        <Text>
          Results stream live to the{' '}
          <Text color="cyan" bold>
            Hi-score Table
          </Text>{' '}
          tab during the run — that&apos;s your live report. When the audit
          finishes, the same report is also exported to{' '}
          <Text color="cyan">./posthog-audit-3000-report.md</Text> in your
          project folder.
        </Text>
      </Box>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={AUDIT3000_SKILL_ID}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <ArcadeBanner />
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text bold>34 checks. 9 levels. 1 final report.</Text>
        <Text dimColor>
          High-score your PostHog integration before the boss fight.
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Live report: <Text color={NEON_GOLD}>Hi-score Table</Text> tab ·
            Export: ./posthog-audit-3000-report.md
          </Text>
        </Box>
      </Box>
    </Box>
  );

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'PRESS START', value: 'continue' },
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
