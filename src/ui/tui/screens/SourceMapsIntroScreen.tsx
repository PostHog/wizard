/**
 * SourceMapsIntroScreen — Welcome screen for the source-maps upload flow.
 *
 * Static intro: detection now runs after login (on the source-maps-detect
 * screen), so this screen no longer shows a detected platform. Continue takes
 * the user straight to authentication.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from './IntroScreenLayout.js';

type View = 'default' | 'more-info';

interface SourceMapsIntroScreenProps {
  store: WizardStore;
}

export const SourceMapsIntroScreen = ({
  store,
}: SourceMapsIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [view, setView] = useState<View>('default');

  const { session } = store;

  const body =
    view === 'more-info' ? (
      <Box flexDirection="column" width={56} flexShrink={0}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>.
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            The{' '}
            <Text italic color="cyan">
              {session.programLabel}
            </Text>{' '}
            program sets up your project to upload source maps to PostHog, so
            Error Tracking shows production stack traces in your original source
            instead of minified bundles. It will:
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1} paddingLeft={4}>
          <Text>{'•'} Detect the framework(s) in your repo</Text>
          <Text>{'•'} Download the relevant docs for your stack</Text>
          <Text>{'•'} Wire map generation + upload into your build</Text>
          <Text>{'•'} Wire CI for deploys and offer a local test run</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Maps upload to PostHog during the production build and never need to
            be served publicly.
          </Text>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" width={60}>
        <Text>
          The Wizard will run an agent to detect your project's framework(s),
          download the relevant docs, and implement source-map uploads for you.
        </Text>
        <Box marginTop={1}>
          <Text>Ready?</Text>
        </Box>
      </Box>
    );

  // No privacy row here: IntroScreenLayout appends it to every intro menu.
  const menuOptions =
    view === 'more-info'
      ? [{ label: 'Back', value: 'back' }]
      : [
          { label: 'Continue', value: 'continue' },
          { label: 'More info', value: 'more-info' },
          { label: 'Cancel', value: 'cancel' },
        ];

  const title = 'PostHog Wizard 🦔';

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      title={title}
      showSubtitle={view === 'default'}
      body={body}
      showDetection={view === 'default'}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else if (value === 'more-info') {
          setView('more-info');
        } else if (value === 'back') {
          setView('default');
        } else {
          store.completeSetup();
        }
      }}
    />
  );
};
