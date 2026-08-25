/**
 * PostHogIntegrationIntroScreen — Intro screen for the core PostHog integration.
 *
 * Composes IntroScreenLayout with framework-detection-specific state:
 *   1. Detecting: spinner while detection runs
 *   2. Detection failed: framework picker
 *   3. Unsupported version: upgrade prompt
 *   4. Detection succeeded: continue/change-framework/cancel
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { Integration } from '@lib/constants';
import {
  getSubcommandPrograms,
  getCommandPath,
} from '@lib/programs/program-registry';
import { PickerMenu, LoadingBox } from '@ui/tui/primitives/index';
import { IntroScreenLayout, type DetectionRow } from './IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from './SkillSourceInfo.js';
import { PrivacyPanel } from '@ui/tui/components/PrivacyPanel';
import { analytics } from '@utils/analytics';
import type { IntroMenuView } from '@ui/tui/posthog-integration-intro';
import {
  introHeadline,
  introMenuOptions,
} from '@ui/tui/posthog-integration-intro';

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({
  store,
  onComplete,
}: {
  store: WizardStore;
  onComplete?: () => void;
}) => {
  const options = Object.values(Integration).map((value) => ({
    label: value,
    value,
  }));

  return (
    <PickerMenu<Integration>
      centered
      columns={2}
      message="Select your framework"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
        void import('@lib/registry').then(({ FRAMEWORK_REGISTRY }) => {
          const config = FRAMEWORK_REGISTRY[integration];
          store.setFrameworkConfig(integration, config);
          store.setDetectedFramework(config.metadata.name);
          onComplete?.();
        });
      }}
    />
  );
};

interface PostHogIntegrationIntroScreenProps {
  store: WizardStore;
}

export const PostHogIntegrationIntroScreen = ({
  store,
}: PostHogIntegrationIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);
  const [view, setView] = useState<IntroMenuView>('default');

  const { session } = store;
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;
  const { skillEntry, fetchFailed } = useSkillEntry(session.skillId);
  const detecting = !session.detectionComplete;
  const needsFrameworkPick =
    session.detectionComplete && !session.frameworkConfig;
  const unsupported = session.unsupportedVersion;
  const showContinue =
    session.frameworkConfig !== null &&
    !detecting &&
    !pickingFramework &&
    view === 'default' &&
    !unsupported;

  // ── Title ──────────────────────────────────────────────────────────

  const title =
    view === 'privacy'
      ? 'Wizard privacy & usage'
      : detecting
      ? 'PostHog Wizard starting up'
      : 'PostHog Wizard 🦔';

  // ── Description ────────────────────────────────────────────────────

  let body: ReactNode = null;

  if (detecting) {
    body = (
      <Box marginY={1}>
        <LoadingBox message="Detecting project framework..." />
      </Box>
    );
  } else if (needsFrameworkPick && !pickingFramework) {
    body = (
      <>
        <Box marginY={1}>
          <Text dimColor>Could not auto-detect your framework.</Text>
        </Box>
        <FrameworkPicker
          store={store}
          onComplete={() => setPickingFramework(false)}
        />
      </>
    );
  } else if (pickingFramework) {
    body = (
      <FrameworkPicker
        store={store}
        onComplete={() => setPickingFramework(false)}
      />
    );
  } else if (view === 'more-info') {
    body = (
      <Box flexDirection="column" width={64} flexShrink={0}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            The{' '}
            <Text italic color="cyan">
              {session.programLabel}
            </Text>{' '}
            program installs the PostHog SDKs, instruments event tracking, and
            integrates the following dev tools for your application:
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1} paddingLeft={4}>
          <Text>{`•`} Product Analytics</Text>
          <Text>{`•`} Web Analytics</Text>
          <Text>{`•`} Session Replay</Text>
          <Text>{`•`} Error Tracking</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text>If you prefer your own AI setup, download the skill:</Text>
          <Box marginTop={1}>
            <SkillSourceInfo
              skillId={session.skillId}
              skillEntry={skillEntry}
              fetchFailed={fetchFailed}
            />
          </Box>
        </Box>
      </Box>
    );
  } else if (view === 'commands') {
    body = (
      <Box flexDirection="column" width={64} flexShrink={0}>
        <Text>The wizard can do more than integrate with your project:</Text>
        <Box flexDirection="column" marginTop={1}>
          {getSubcommandPrograms().map((program) => (
            <Box key={getCommandPath(program)}>
              <Box width={22} flexShrink={0}>
                <Text color="cyan">{getCommandPath(program)}</Text>
              </Box>
              <Text dimColor>{program.description}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Run any of these later: npx @posthog/wizard {'<command>'}
          </Text>
        </Box>
      </Box>
    );
  } else if (view === 'privacy') {
    body = <PrivacyPanel />;
  } else if (showContinue) {
    body = (
      <Box>
        <Text>{introHeadline(session.posthogSdkDetected)}</Text>
      </Box>
    );
  }

  // ── Detection rows ─────────────────────────────────────────────────

  const detectionRows: DetectionRow[] = [];
  if (frameworkLabel) {
    const suffixParts: string[] = [];
    if (!manuallySelected) suffixParts.push('(detected)');
    // Dead path today — every framework went GA. Kept for re-activation
    // when the next beta framework lands (set `beta: true` on its config).
    if (config?.metadata.beta) suffixParts.push('[BETA]');

    detectionRows.push({
      label: 'Framework',
      value: frameworkLabel,
      suffix: suffixParts.join(' ') || undefined,
    });
  }

  if (session.posthogSdkDetected) {
    detectionRows.push({
      label: 'PostHog',
      value: 'detected in package.json',
    });
  }

  // ── Children (between rows and menu) ───────────────────────────────

  let bodyChildren: ReactNode = null;

  if (config?.metadata.preRunNotice) {
    bodyChildren = <Text color="yellow">{config.metadata.preRunNotice}</Text>;
  }

  if (unsupported) {
    bodyChildren = (
      <Box flexDirection="column" marginTop={1}>
        <Text color="#DC9300">
          Version {unsupported.current} is not supported by the wizard. Please
          upgrade to {unsupported.minimum} or later.
        </Text>
        <Text dimColor>Manual setup guide: {unsupported.docsUrl}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Did we get this wrong? You can also select another framework.
          </Text>
        </Box>
        <PickerMenu
          options={[
            { label: 'Select another framework', value: 'framework' },
            { label: 'Exit', value: 'exit' },
          ]}
          onSelect={(value) => {
            const choice = Array.isArray(value) ? value[0] : value;
            if (choice === 'framework') {
              setPickingFramework(true);
              setManuallySelected(true);
            } else {
              process.exit(0);
            }
          }}
        />
      </Box>
    );
  }

  // ── Menu ───────────────────────────────────────────────────────────

  const menuOptions = introMenuOptions({
    view,
    showContinue,
    posthogSdkDetected: session.posthogSdkDetected,
  });

  const handleSelect = (value: string) => {
    analytics.wizardCapture('intro menu selected', { value, view });
    if (value === 'cancel') {
      process.exit(0);
    } else if (value === 'framework') {
      setPickingFramework(true);
      setManuallySelected(true);
    } else if (value === 'more-info') {
      setView('more-info');
    } else if (value === 'commands') {
      setView('commands');
    } else if (value === 'privacy') {
      setView('privacy');
    } else if (value === 'back') {
      setView(view === 'privacy' ? 'more-info' : 'default');
    } else {
      store.completeSetup();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      title={title}
      showSubtitle={view === 'default'}
      body={body}
      showDetection={showContinue}
      detectionRows={detectionRows}
      menuOptions={unsupported ? null : menuOptions}
      menuAlign="center"
      onSelect={handleSelect}
      programLabel={session.programLabel}
      skillId={session.skillId}
    >
      {bodyChildren}
    </IntroScreenLayout>
  );
};
