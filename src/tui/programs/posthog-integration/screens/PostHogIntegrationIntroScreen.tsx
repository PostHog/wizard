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
import type { WizardStore } from '@tui/store';
import { Integration } from '@shared/constants';
import { PickerMenu, LoadingBox } from '@tui/primitives/index';
import {
  IntroScreenLayout,
  type DetectionRow,
} from '@tui/screens/IntroScreenLayout';
import { SkillSourceInfo, useSkillEntry } from '@tui/screens/SkillSourceInfo';
import { KeyMatch, useKeyBindings } from '@tui/hooks/useKeyBindings';
import { analytics } from '@utils/analytics';
import { PRIVACY_PANEL_LABEL } from '@tui/components/PrivacyPanel';
import {
  applySharingChoice,
  isSharing,
  resolveSharingOnContinue,
  sharingOptions,
} from '@tui/components/sharing-options';
import type { IntroMenuView } from '@tui/programs/posthog-integration/intro-menu';
import {
  introEntries,
  introHeadline,
  introMenuOptions,
} from '@tui/programs/posthog-integration/intro-menu';

/**
 * Replaces IntroScreenLayout's DEFAULT_SUBTITLE for this screen only. The
 * shared default (".env* file contents will not leave your machine") is true
 * of values and false of variable names, which this screen reads and reports.
 * Two lines carry the fact and name the screen that holds the detail, so the
 * disclosure reaches people who never open it.
 */
const SUBTITLE = (
  <>
    <Text dimColor>Review what data is shared in "{PRIVACY_PANEL_LABEL}."</Text>
    <Text dimColor>.env* values stay on your machine.</Text>
  </>
);

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
        void import('@programs').then(({ FRAMEWORK_REGISTRY }) => {
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
  const sharing = isSharing(store);
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

  // The only view with no menu to carry a Back row, so Esc is its way out.
  useKeyBindings(
    'posthog-integration-intro',
    view === 'commands'
      ? [
          {
            match: KeyMatch.Escape,
            label: 'esc',
            action: 'back',
            handler: () => setView('default'),
          },
        ]
      : [],
  );

  // ── Title ──────────────────────────────────────────────────────────

  const title = detecting ? 'PostHog Wizard starting up' : 'PostHog Wizard 🦔';

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
              {store.programLabel}
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
      <PickerMenu
        message="The Wizard can do more than integrate with your project:"
        options={introEntries().map((entry) => ({
          label: `${entry.command.padEnd(21)}${entry.description}`,
          value: entry.id,
        }))}
        onSelect={(value) => {
          const id = Array.isArray(value) ? value[0] : value;
          analytics.wizardCapture('intro menu selected', { value: id, view });
          store.switchProgram(id);
        }}
      />
    );
  } else if (showContinue) {
    const paragraphs = introHeadline(session.posthogSdkDetected);
    body = (
      <Box
        flexDirection="column"
        width={64}
        flexShrink={0}
        // A wrapped block reads as ragged centered; one line always centered.
        alignItems={paragraphs.length > 1 ? undefined : 'center'}
      >
        {paragraphs.map((paragraph, i) => (
          <Box key={paragraph} marginTop={i === 0 ? 0 : 1}>
            <Text>{paragraph}</Text>
          </Box>
        ))}
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
              store.requestExit(0);
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
      store.requestExit(0);
    } else if (value === 'framework') {
      setPickingFramework(true);
      setManuallySelected(true);
    } else if (value === 'more-info') {
      setView('more-info');
    } else if (value === 'commands') {
      setView('commands');
    } else if (value === 'back') {
      setView('default');
    } else if (applySharingChoice(store, value)) {
      return;
    } else if (value === 'continue') {
      resolveSharingOnContinue(store);
      store.completeSetup();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      title={title}
      showSubtitle={view === 'default'}
      subtitle={SUBTITLE}
      body={body}
      showDetection={showContinue}
      detectionRows={detectionRows}
      menuOptions={unsupported ? null : menuOptions}
      menuAlign="center"
      // The one program whose disclosure view can be acted on.
      privacyOptions={sharingOptions(sharing)}
      onSelect={handleSelect}
      programLabel={store.programLabel}
      skillId={session.skillId}
    >
      {bodyChildren}
    </IntroScreenLayout>
  );
};
