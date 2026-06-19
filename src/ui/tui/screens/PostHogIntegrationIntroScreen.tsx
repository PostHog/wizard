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
import { spawnSync } from 'node:child_process';
import type { ReactNode } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { Integration, WIZARD_TOOLS_MENU_FLAG_KEY } from '@lib/constants';
import { PickerMenu, LoadingBox } from '@ui/tui/primitives/index';
import { IntroScreenLayout, type DetectionRow } from './IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from './SkillSourceInfo.js';
import { PrivacyPanel } from '@ui/tui/components/PrivacyPanel';
import { releaseTerminal } from '@ui/tui/start-tui';
import { analytics } from '@utils/analytics';

const TOOLS = [
  { label: 'Troubleshoot Integration', command: 'doctor' },
] as const;

type View = 'default' | 'more-info' | 'privacy' | 'tools';

function launchTool(command: string, installDir: string): never {
  releaseTerminal();
  const result = spawnSync(
    process.execPath,
    [process.argv[1], command, `--install-dir=${installDir}`],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 0);
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
  const [toolsEnabled, setToolsEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void analytics.getAllFlagsForWizard().then((flags) => {
      const value = flags[WIZARD_TOOLS_MENU_FLAG_KEY];
      if (!cancelled && value && value !== 'false') setToolsEnabled(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { session } = store;
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
  } else if (view === 'privacy') {
    body = <PrivacyPanel />;
  } else if (showContinue) {
    body = (
      <>
        <Box>
          <Text>Let's do two hours of work in eight minutes.</Text>
        </Box>
      </>
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

  let menuOptions: { label: string; value: string }[] | null = null;

  if (view === 'tools') {
    menuOptions = [
      ...TOOLS.map((t) => ({ label: t.label, value: t.command })),
      { label: 'Back', value: 'back' },
    ];
  } else if (view === 'more-info') {
    menuOptions = [
      { label: 'Back', value: 'back' },
      { label: 'Privacy & data usage', value: 'privacy' },
    ];
  } else if (view === 'privacy') {
    menuOptions = [{ label: 'Back', value: 'back' }];
  } else if (showContinue) {
    menuOptions = [
      { label: 'Continue', value: 'continue' },
      { label: 'Change framework', value: 'framework' },
      ...(toolsEnabled ? [{ label: 'Tools', value: 'tools' }] : []),
      { label: 'More info', value: 'more-info' },
      { label: 'Cancel', value: 'cancel' },
    ];
  }

  const handleSelect = (value: string) => {
    analytics.wizardCapture('intro menu selected', { value, view });
    if (view === 'tools') {
      if (value === 'back') setView('default');
      else launchTool(value, session.installDir);
      return;
    }
    if (value === 'cancel') {
      process.exit(0);
    } else if (value === 'framework') {
      setPickingFramework(true);
      setManuallySelected(true);
    } else if (value === 'more-info') {
      setView('more-info');
    } else if (value === 'privacy') {
      setView('privacy');
    } else if (value === 'tools') {
      setView('tools');
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
