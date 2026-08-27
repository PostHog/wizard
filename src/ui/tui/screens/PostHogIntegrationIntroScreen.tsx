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
  PickerMenu,
  LoadingBox,
  type PickerOption,
} from '@ui/tui/primitives/index';
import { IntroScreenLayout, type DetectionRow } from './IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from './SkillSourceInfo.js';
import { ScanConsent } from '@lib/wizard-session';
import { Icons } from '@ui/tui/styles';
import { analytics } from '@utils/analytics';
import { PRIVACY_PANEL_LABEL } from '@ui/tui/components/PrivacyPanel';

type View = 'default' | 'more-info';

/**
 * Replaces IntroScreenLayout's DEFAULT_SUBTITLE for this screen only. The
 * shared default (".env* file contents will not leave your machine") is true
 * of values and false of variable names, which this screen reads and reports.
 * Two lines carry the fact and name the screen that holds the detail, so the
 * disclosure reaches people who never open it.
 */
const SUBTITLE = (
  <>
    <Text dimColor>
      We'll use AI to analyze your project and complete work.
    </Text>
    <Text dimColor>Review what data is shared in "{PRIVACY_PANEL_LABEL}".</Text>
    <Text dimColor>.env* values stay on your machine.</Text>
  </>
);

/**
 * Exported so a test can measure every label against the menu's column.
 * `Privacy & data` is not here: IntroScreenLayout appends it to every intro
 * menu, so no screen carries its own copy.
 */
export const CONTINUE_MENU_OPTIONS: { label: string; value: string }[] = [
  { label: 'Continue', value: 'continue' },
  { label: 'Change framework', value: 'framework' },
  { label: 'More info', value: 'more-info' },
  { label: 'Cancel', value: 'cancel' },
];

/**
 * A blank, unselectable row. Navigation skips disabled options, so this is a
 * margin the menu can hold rather than one the layout has to special-case.
 */
const MENU_SPACER: PickerOption<string> = {
  label: '',
  value: 'spacer',
  disabled: true,
};

/**
 * The sharing choice, as two explicit rows rather than one toggle. A toggle
 * label has to describe either the current state or the next action, and a
 * reader cannot tell which; two rows with the filled diamond on the live one
 * say both at once. The trailing spacer separates them from the Back that
 * IntroScreenLayout appends, since leaving the screen is a different kind of
 * act from changing something on it.
 */
export function sharingOptions(sharing: boolean): PickerOption<string>[] {
  const mark = (on: boolean) => ({
    glyph: on ? Icons.diamond : Icons.diamondOpen,
  });
  return [
    { label: 'Share tools', value: 'share', icon: mark(sharing) },
    { label: "Don't share tools", value: 'no-share', icon: mark(!sharing) },
    MENU_SPACER,
  ];
}

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
  const [view, setView] = useState<View>('default');

  const { session } = store;
  const sharing = session.scanConsent !== ScanConsent.Declined;
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;
  const { skillEntry, fetchFailed } = useSkillEntry(
    session.skillId,
    session.localMcp,
  );
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
  } else if (showContinue) {
    body = (
      <Box>
        <Text>Let's do two hours of work in eight minutes.</Text>
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

  let menuOptions: PickerOption<string>[] | null = null;

  if (view === 'more-info') {
    // No route to the panel from here: it has its own top-level menu item.
    menuOptions = [{ label: 'Back', value: 'back' }];
  } else if (showContinue) {
    menuOptions = CONTINUE_MENU_OPTIONS;
  }

  const handleSelect = (value: string) => {
    analytics.wizardCapture('intro menu selected', { value, view });
    if (value === 'cancel') {
      process.exit(0);
    } else if (value === 'framework') {
      setPickingFramework(true);
      setManuallySelected(true);
    } else if (value === 'more-info') {
      setView('more-info');
    } else if (value === 'back') {
      setView('default');
    } else if (value === 'share') {
      store.grantSharing();
    } else if (value === 'no-share') {
      store.declineSharing();
    } else if (value === 'continue') {
      // Sharing is on by default, so consent nobody touched resolves to granted
      // here. A choice already made in the panel stands.
      if (session.scanConsent === ScanConsent.Undecided) store.grantSharing();
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
      programLabel={session.programLabel}
      skillId={session.skillId}
    >
      {bodyChildren}
    </IntroScreenLayout>
  );
};
