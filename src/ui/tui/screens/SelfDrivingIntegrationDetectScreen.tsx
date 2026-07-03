/**
 * SelfDrivingIntegrationDetectScreen — runs the Haiku detector over the repo,
 * streams progress, then renders a picker of the projects PostHog can be set up
 * in (a supported framework, no SDK yet). The user picks one — a single project
 * or the repo root is still shown as a one-item menu to confirm — and the choice
 * (framework + path) is written to the session; the integrate-run phase sets
 * PostHog up there. On a detection error, falls back to a manual framework
 * picker so the run can still proceed.
 *
 * Runs after auth — the detector needs credentials.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@lib/programs/self-driving/detect';
import {
  detectSelfDrivingIntegrationProjects,
  type IntegrationProject,
  type IntegrationDetectionReport,
} from '@lib/programs/self-driving/detect-agentic';
import { analytics } from '@utils/analytics';

interface SelfDrivingIntegrationDetectScreenProps {
  store: WizardStore;
}

type DetectState =
  | { kind: 'loading' }
  | { kind: 'ready'; report: IntegrationDetectionReport }
  | { kind: 'error'; message: string };

const CANCEL = '__cancel';
const MAX_ACTIVITY_LINES = 8;

function projectLabel(p: IntegrationProject): string {
  const where = p.path === '.' ? 'repo root' : p.path;
  return `${p.framework} ${Icons.bullet} ${where}`;
}

export const SelfDrivingIntegrationDetectScreen = ({
  store,
}: SelfDrivingIntegrationDetectScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { credentials } = store.session;
  const accessToken = credentials?.accessToken;

  const [state, setState] = useState<DetectState>({ kind: 'loading' });
  const [activity, setActivity] = useState<string[]>([]);
  const started = useRef(false);

  // Commit a chosen project: framework + path → session. The run phase reads
  // both (path scopes the install dir to the sub-app).
  const choose = (p: IntegrationProject) => {
    if (!p.integration) return;
    store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, p.path);
    store.setFrameworkConfig(p.integration, FRAMEWORK_REGISTRY[p.integration]);
  };

  // Run the detector once, after auth.
  useEffect(() => {
    if (!accessToken || started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const report = await detectSelfDrivingIntegrationProjects(
          store.session,
          (line) => {
            if (!cancelled) {
              setActivity((prev) => [...prev, line].slice(-MAX_ACTIVITY_LINES));
            }
          },
        );
        if (!cancelled) setState({ kind: 'ready', report });
      } catch (err) {
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'self_driving_integration_detect_screen' },
        );
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

  if (state.kind === 'error') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Detection failed
          </Text>
          <Text dimColor>{state.message}</Text>
          <Text dimColor>
            Pick your framework and we&apos;ll set PostHog up here.
          </Text>
        </Box>
        <PickerMenu<Integration>
          centered
          columns={2}
          message="Select your framework"
          options={Object.values(Integration).map((v) => ({
            label: v,
            value: v,
          }))}
          onSelect={(value) => {
            const integration = Array.isArray(value) ? value[0] : value;
            store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
            store.setFrameworkConfig(
              integration,
              FRAMEWORK_REGISTRY[integration],
            );
          }}
        />
      </Box>
    );
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

  const { report } = state;
  const instrumentable = report.projects.filter((p) => p.instrumentable);
  const blocked = report.projects.filter((p) => !p.instrumentable);

  if (instrumentable.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Nothing to set up here
          </Text>
          <Text dimColor>
            None of the {report.projects.length} projects found can have PostHog
            set up.
          </Text>
        </Box>
        <BlockedSummary blocked={blocked} />
        <Box marginTop={1}>
          <PickerMenu
            options={[{ label: 'Exit', value: CANCEL }]}
            onSelect={() => process.exit(0)}
          />
        </Box>
      </Box>
    );
  }

  const single = instrumentable.length === 1;
  const options = [
    ...instrumentable.map((p) => ({ label: projectLabel(p), value: p.path })),
    { label: 'Cancel', value: CANCEL },
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
        message={
          single
            ? 'Set up PostHog here? Confirm to continue.'
            : 'Which project should we set up PostHog in?'
        }
        options={options}
        onSelect={(value) => {
          const path = Array.isArray(value) ? value[0] : value;
          if (path === CANCEL) {
            process.exit(0);
            return;
          }
          const chosen = instrumentable.find((p) => p.path === path);
          if (chosen) choose(chosen);
        }}
      />

      <Box marginTop={1}>
        <BlockedSummary blocked={blocked} />
      </Box>
    </Box>
  );
};

/**
 * Collapses the projects we didn't offer into short count lines — already has
 * PostHog, or an unsupported stack. A monorepo can have many, so we summarise.
 */
const BlockedSummary = ({ blocked }: { blocked: IntegrationProject[] }) => {
  const alreadyIntegrated = blocked.filter((p) => p.hasPostHog).length;
  const unsupported = blocked.length - alreadyIntegrated;
  if (blocked.length === 0) return null;
  return (
    <Box flexDirection="column">
      {alreadyIntegrated > 0 && (
        <Text dimColor>
          (… {alreadyIntegrated} project{alreadyIntegrated === 1 ? '' : 's'}{' '}
          already {alreadyIntegrated === 1 ? 'has' : 'have'} PostHog)
        </Text>
      )}
      {unsupported > 0 && (
        <Text dimColor>
          (… {unsupported} project{unsupported === 1 ? '' : 's'} not supported
          yet)
        </Text>
      )}
    </Box>
  );
};
