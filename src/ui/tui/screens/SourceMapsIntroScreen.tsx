/**
 * SourceMapsIntroScreen — Welcome screen for the source-maps upload flow.
 *
 * Reads detection results from frameworkContext (written by
 * detectSourceMapsPrerequisites). On success: shows the detected platform.
 * On failure: shows the structured error with an Exit prompt.
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { IntroScreenLayout, type DetectionRow } from './IntroScreenLayout.js';
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  type SkillVariant,
  type SourceMapsDetectError,
} from '@lib/programs/error-tracking-upload-source-maps/index';

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

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const detectError = session.frameworkContext[
    SOURCE_MAPS_CONTEXT_KEYS.detectError
  ] as SourceMapsDetectError | undefined;
  const variant = session.frameworkContext[
    SOURCE_MAPS_CONTEXT_KEYS.skillVariant
  ] as SkillVariant | undefined;
  const displayName = session.frameworkContext[
    SOURCE_MAPS_CONTEXT_KEYS.displayName
  ] as string | undefined;
  const packagePaths =
    (session.frameworkContext[SOURCE_MAPS_CONTEXT_KEYS.packagePaths] as
      | string[]
      | undefined) ?? [];

  const detectionRows: DetectionRow[] = [];
  if (displayName) {
    detectionRows.push({ label: 'Platform', value: displayName });
  }
  if (variant) {
    detectionRows.push({
      label: 'Skill',
      value: `error-tracking-upload-source-maps-${variant}`,
    });
  }

  const body = showingMoreInfo ? (
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
        <Text>{'•'} Ask for a personal API key to authorize uploads</Text>
        <Text>{'•'} Wire map generation + upload into your build</Text>
        <Text>{'•'} Write the upload credentials to your .env</Text>
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
    <>
      <Box flexDirection="column" alignItems="center">
        <Text>Upload source maps for accurate error stack traces.</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>The agent will wire it into your build.</Text>
        </Box>
      </Box>

      {packagePaths.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Found {packagePaths.length} package.json files:</Text>
          {packagePaths.map((p) => (
            <Text key={p} dimColor>
              {'  '}
              {'•'} {p}
            </Text>
          ))}
        </Box>
      )}
    </>
  );

  const errorView = detectError ? (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>
          {'✘'} Cannot set up source map upload
        </Text>
        <Box marginTop={1} flexDirection="column">
          <DetectErrorBody error={detectError} />
        </Box>
      </Box>

      <PickerMenu
        options={[{ label: 'Exit', value: 'exit' }]}
        onSelect={() => process.exit(1)}
      />
    </>
  ) : undefined;

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      detectionRows={detectionRows}
      errorView={errorView}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else if (value === 'more-info') {
          setShowingMoreInfo(true);
        } else if (value === 'back') {
          setShowingMoreInfo(false);
        } else {
          store.completeSetup();
        }
      }}
    />
  );
};

const SOURCE_MAP_DOCS =
  'https://posthog.com/docs/error-tracking/upload-source-maps';
const ERROR_TRACKING_INSTALL_DOCS =
  'https://posthog.com/docs/error-tracking/installation';
const WIZARD_ISSUES_URL = 'https://github.com/PostHog/wizard/issues';

/**
 * Platforms PostHog Error Tracking supports with published source-map / symbol
 * upload docs, but that the wizard can't automate yet. The user (or their own
 * coding agent) can follow these docs to wire it up by hand. Anything not in
 * this map falls through to the generic "not supported yet" message — we don't
 * hardcode the full supported-platform list (it lives in the docs and changes
 * server-side), we just point there.
 */
const NATIVE_PLATFORM_DOCS: Record<string, { label: string; url: string }> = {
  ios: {
    label: 'iOS',
    url: 'https://posthog.com/docs/error-tracking/upload-source-maps/ios',
  },
  android: {
    label: 'Android',
    url: 'https://posthog.com/docs/error-tracking/upload-mappings/android',
  },
  'react-native': {
    label: 'React Native',
    url: 'https://posthog.com/docs/error-tracking/upload-source-maps/react-native',
  },
  flutter: {
    label: 'Flutter',
    url: 'https://posthog.com/docs/error-tracking/upload-source-maps/flutter',
  },
};

const DetectErrorBody = ({ error }: { error: SourceMapsDetectError }) => {
  switch (error.kind) {
    case 'bad-directory': {
      const reasonText = {
        missing: 'does not exist',
        'not-dir': 'is not a directory',
        unreadable: 'could not be accessed',
      }[error.reason];
      return (
        <>
          <Text>This path {reasonText}:</Text>
          <Text dimColor>
            {'  '}
            {error.path}
          </Text>
        </>
      );
    }

    case 'no-project-files':
      return (
        <>
          <Text>No recognizable project files were found.</Text>
          <Text dimColor>
            Source map upload needs a package.json, Xcode project, Gradle build,
            or Flutter pubspec.yaml.
          </Text>
          <Text dimColor>Run this command from your project root.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>How source map upload works:</Text>
            <Text dimColor>
              {'  '}
              {SOURCE_MAP_DOCS}
            </Text>
          </Box>
        </>
      );

    case 'unsupported-platform': {
      const native = NATIVE_PLATFORM_DOCS[error.detected];

      // Native mobile: PostHog Error Tracking supports it and we have docs —
      // the wizard just can't automate source-map upload for it yet. Hand the
      // user a path forward rather than a dead end.
      if (native) {
        return (
          <>
            <Text>
              The wizard can't set up source map upload for {native.label} yet.
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                PostHog Error Tracking does support {native.label}. You can set
                it up yourself by following the docs below — or hand them to
                your own coding agent to do it for you:
              </Text>
              <Box marginTop={1}>
                <Text dimColor>{native.url}</Text>
              </Box>
            </Box>
          </>
        );
      }

      // Everything else (e.g. Rust): source map upload doesn't apply, and the
      // stack may not be supported by Error Tracking at all. Don't promise docs
      // that don't exist — point at the supported-platform list instead.
      return (
        <>
          <Text>Source map upload isn't supported for this stack yet.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Check which platforms PostHog Error Tracking supports:
            </Text>
            <Box marginTop={1}>
              <Text dimColor>{ERROR_TRACKING_INSTALL_DOCS}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                If yours isn't listed and you'd like it added, open an issue at{' '}
                {WIZARD_ISSUES_URL} with details about your build setup.
              </Text>
            </Box>
          </Box>
        </>
      );
    }

    case 'no-posthog-sdk': {
      const platformLabel =
        VARIANT_DISPLAY_NAME[error.platform] ?? error.platform;
      return (
        <>
          <Text>Detected {platformLabel} but no PostHog SDK is installed.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Source map upload only resolves stack traces from errors the SDK
              reports. Run <Text bold>npx @posthog/wizard</Text> first to
              install the SDK, then run this command again.
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Set up source map upload for {platformLabel}:
              </Text>
              <Text dimColor>
                {'  '}
                {SOURCE_MAP_DOCS}
              </Text>
            </Box>
          </Box>
        </>
      );
    }
  }
};
