import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from './IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from './SkillSourceInfo.js';

interface CullIntroScreenProps {
  store: WizardStore;
}

// The generic agent-skill intro promises nothing about edits and the audit
// intro promises none happen; culling edits on consent, so it says so up front.
export const CullIntroScreen = ({ store }: CullIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  const skillId = session.skillId ?? 'cull-feature-flags';
  const { skillEntry, fetchFailed } = useSkillEntry(skillId);

  const moreInfoBody: ReactNode = (
    <Box flexDirection="column" width={56} flexShrink={0}>
      <Box marginBottom={1}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
      </Box>
      <Text>
        The wizard scans this project for feature flag calls and compares them
        with the flags in your PostHog project, then shows you the ones that
        look done. Nothing changes until you pick which ones to cull. Flags get
        disabled in PostHog, never deleted, and code edits land as an ordinary
        git diff, so either side is a one-step undo.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  );

  const introBody: ReactNode = (
    <Box flexDirection="column" alignItems="center">
      <Text>
        We'll find feature flags that look done and show you the list.
      </Text>
      <Text dimColor>
        Nothing changes until you pick which ones to cull. Disable only, never
        delete; code edits are a git diff away from undo.
      </Text>
    </Box>
  );

  const body = showingMoreInfo ? moreInfoBody : introBody;

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') return process.exit(0);
    if (value === 'more-info') return setShowingMoreInfo(true);
    if (value === 'back') return setShowingMoreInfo(false);
    store.completeSetup();
  };

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
