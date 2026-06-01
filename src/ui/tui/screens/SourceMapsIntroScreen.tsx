/**
 * SourceMapsIntroScreen — Welcome screen for the source-maps upload flow.
 *
 * Reads detection results from frameworkContext (written by
 * detectSourceMapsPrerequisites). On success: shows the detected platform.
 * On failure: shows the structured error with an Exit prompt.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
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

  const body = (
    <>
      <Box flexDirection="column" alignItems="center">
        <Text>Upload source maps so error stack traces de-minify.</Text>
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

  const menuOptions = [
    { label: 'Continue', value: 'continue' },
    { label: 'Cancel', value: 'cancel' },
  ];

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      body={body}
      showDetection={true}
      detectionRows={detectionRows}
      errorView={errorView}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else {
          store.completeSetup();
        }
      }}
    />
  );
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
        </>
      );

    case 'unsupported-platform':
      return (
        <>
          <Text>Source map upload isn't supported for this stack yet.</Text>
          <Text dimColor>
            Open an issue at https://github.com/PostHog/wizard/issues with
            details about your build setup — we'd like to add it.
          </Text>
        </>
      );

    case 'no-posthog-sdk': {
      const platformLabel =
        VARIANT_DISPLAY_NAME[error.platform] ?? error.platform;
      return (
        <>
          <Text>Detected {platformLabel} but no PostHog SDK is installed.</Text>
          <Box marginTop={1}>
            <Text dimColor>
              Source map upload only resolves stack traces from errors the SDK
              reports. Run <Text bold>npx @posthog/wizard</Text> first to
              install the SDK, then run this command again.
            </Text>
          </Box>
        </>
      );
    }
  }
};
