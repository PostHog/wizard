/**
 * ErrorTrackingDetectScreen — after login, runs the detection agent over the
 * repo, streams its progress, and lets the user pick the project to set error
 * tracking up in. Mirrors the legacy SourceMapsDetectScreen.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import { FRAMEWORK_REGISTRY } from '@programs/frameworks/registry';
import {
  detectErrorTrackingProjects,
  ERROR_TRACKING_PROJECT_PATH_KEY,
  type ErrorTrackingDetectionReport,
  type ErrorTrackingProject,
} from '@programs/error-tracking/detect-agentic';

interface ErrorTrackingDetectScreenProps {
  store: WizardStore;
}

type DetectState =
  | { kind: 'loading' }
  | { kind: 'ready'; report: ErrorTrackingDetectionReport }
  | { kind: 'error'; message: string };

const EXIT = '__exit';
const MAX_ACTIVITY_LINES = 8;

function projectLabel(p: ErrorTrackingProject): string {
  const where = p.path === '.' ? 'repo root' : p.path;
  return `${p.framework} ${Icons.bullet} ${where}`;
}

export const ErrorTrackingDetectScreen = ({
  store,
}: ErrorTrackingDetectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { credentials } = store.session;
  const accessToken = credentials?.accessToken;

  const [state, setState] = useState<DetectState>({ kind: 'loading' });
  const [activity, setActivity] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (!accessToken || started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const report = await detectErrorTrackingProjects(
          store.session,
          (line) => {
            if (!cancelled) {
              setActivity((prev) => [...prev, line].slice(-MAX_ACTIVITY_LINES));
            }
          },
        );
        if (!cancelled) setState({ kind: 'ready', report });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, store]);

  if (!credentials) {
    return <LoadingBox message="Waiting for authentication..." />;
  }

  if (state.kind === 'loading') {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.accent}>
          Detecting your project...
        </Text>
        <Box marginY={1}>
          <LoadingBox message="Scanning the repo for frameworks and PostHog SDKs..." />
        </Box>
        <Box flexDirection="column">
          {activity.length === 0 ? (
            <Text dimColor>{'  '}Starting up the detection agent…</Text>
          ) : (
            activity.map((line, i) => (
              <Text
                key={`${i}-${line}`}
                dimColor={i < activity.length - 1}
                color={i === activity.length - 1 ? Colors.primary : undefined}
              >
                {'  '}
                {Icons.triangleSmallRight} {line}
              </Text>
            ))
          )}
        </Box>
      </Box>
    );
  }

  if (state.kind === 'error') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginY={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Detection failed
          </Text>
          <Text dimColor>{state.message}</Text>
        </Box>
        <PickerMenu
          options={[{ label: 'Exit', value: EXIT }]}
          onSelect={() => process.exit(1)}
        />
      </Box>
    );
  }

  const { report } = state;
  const instrumentable = report.projects.filter((p) => p.instrumentable);
  const unsupported = report.projects.length - instrumentable.length;

  if (instrumentable.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Nothing to set up here
          </Text>
          <Text dimColor>
            None of the {report.projects.length} projects found uses a framework
            the wizard can set up error tracking for.
          </Text>
        </Box>
        <PickerMenu
          options={[{ label: 'Exit', value: EXIT }]}
          onSelect={() => process.exit(0)}
        />
      </Box>
    );
  }

  const options = [
    ...instrumentable.map((p) => ({
      label: projectLabel(p),
      value: p.path,
    })),
    { label: 'Cancel', value: EXIT },
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          {Icons.check} Found{' '}
          {report.repoType === 'monorepo' ? 'a monorepo' : 'your project'}
        </Text>
      </Box>

      <PickerMenu
        message="Which project would you like to set up error tracking for?"
        options={options}
        onSelect={(value) => {
          const path = Array.isArray(value) ? value[0] : value;
          if (path === EXIT) {
            process.exit(0);
            return;
          }
          const chosen = instrumentable.find((p) => p.path === path);
          if (!chosen?.integration) return;
          store.setFrameworkContext(
            ERROR_TRACKING_PROJECT_PATH_KEY,
            chosen.path,
          );
          store.setFrameworkConfig(
            chosen.integration,
            FRAMEWORK_REGISTRY[chosen.integration],
          );
        }}
      />

      {unsupported > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            (… {unsupported} other project{unsupported === 1 ? '' : 's'} not
            supported)
          </Text>
        </Box>
      )}
    </Box>
  );
};
