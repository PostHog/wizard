/**
 * SelfDrivingIntegrationDetectScreen — runs the Haiku detector over the repo,
 * streams progress, then renders a picker of projects. Two kinds are offered:
 * set-up-here (supported framework, no SDK yet; writes framework + path for
 * the integrate-run phase) and continue-with-existing (already has PostHog;
 * sets integrate=false and skips straight to Self-driving). On a detection
 * error, falls back to a manual framework picker.
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

  // Commit a chosen project to integrate: framework + path → session. The run
  // phase reads both (path scopes the install dir to the sub-app).
  const choose = (p: IntegrationProject) => {
    if (!p.integration) return;
    store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, p.path);
    store.setFrameworkConfig(p.integration, FRAMEWORK_REGISTRY[p.integration]);
  };

  // PostHog already installed here: integrate=false completes integrate-detect
  // and drops the integrate-run / handoff steps from the walk.
  const continueWithExisting = (p: IntegrationProject) => {
    store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, p.path);
    store.setIntegrate(false, {
      via: 'existing-integration-detected',
      path: p.path,
    });
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
  // Already has PostHog → offer "continue with existing" instead of hiding it.
  const existing = report.projects.filter((p) => p.continuable);
  const unsupported = report.projects.filter(
    (p) => !p.instrumentable && !p.continuable,
  );

  // Values are prefixed so one picker can mix new: and existing: entries.
  const NEW = 'new:';
  const EXISTING = 'existing:';
  const dispatch = (value: string | string[]) => {
    const v = Array.isArray(value) ? value[0] : value;
    if (v === CANCEL) {
      process.exit(0);
      return;
    }
    if (v.startsWith(EXISTING)) {
      const p = existing.find((x) => x.path === v.slice(EXISTING.length));
      if (p) continueWithExisting(p);
      return;
    }
    const p = instrumentable.find((x) => x.path === v.slice(NEW.length));
    if (p) choose(p);
  };

  // Nothing to instrument, nothing already installed: a genuine dead end.
  if (instrumentable.length === 0 && existing.length === 0) {
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
        <UnsupportedSummary unsupported={unsupported} />
        <Box marginTop={1}>
          <PickerMenu
            options={[{ label: 'Exit', value: CANCEL }]}
            onSelect={() => process.exit(0)}
          />
        </Box>
      </Box>
    );
  }

  // Only already-installed projects: continue straight to Self-driving.
  if (instrumentable.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={Colors.accent}>
            {Icons.check} PostHog is already set up
          </Text>
          <Text dimColor>Continue straight to Self-driving.</Text>
        </Box>
        <PickerMenu
          message={
            existing.length === 1
              ? 'Continue with your existing PostHog install?'
              : 'Which project should Self-driving use?'
          }
          options={[
            ...existing.map((p) => ({
              label: projectLabel(p),
              value: `${EXISTING}${p.path}`,
            })),
            { label: 'Exit', value: CANCEL },
          ]}
          onSelect={dispatch}
        />
        <Box marginTop={1}>
          <UnsupportedSummary unsupported={unsupported} />
        </Box>
      </Box>
    );
  }

  const single = instrumentable.length === 1;
  // Disabled rows act as section headings + spacers — navigation skips them.
  const HEAD = 'head:';
  const spacer = (id: string) => ({
    label: ' ',
    value: `${HEAD}${id}`,
    disabled: true,
  });
  const heading = (id: string, label: string) => ({
    label,
    value: `${HEAD}${id}`,
    disabled: true,
    header: true,
  });
  const options = [
    heading('new', 'New PostHog integration:'),
    ...instrumentable.map((p) => ({
      label: projectLabel(p),
      value: `${NEW}${p.path}`,
      indent: true,
    })),
    ...(existing.length > 0
      ? [
          spacer('gap1'),
          heading('existing', 'Existing integrations:'),
          ...existing.map((p) => ({
            label: projectLabel(p),
            value: `${EXISTING}${p.path}`,
            indent: true,
          })),
        ]
      : []),
    spacer('gap2'),
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
          single && existing.length === 0
            ? 'Set up PostHog here? Confirm to continue.'
            : undefined
        }
        options={options}
        onSelect={dispatch}
      />

      <Box marginTop={1}>
        <UnsupportedSummary unsupported={unsupported} />
      </Box>
    </Box>
  );
};

/**
 * Collapses unsupported-stack projects into a count line (already-has-PostHog
 * projects are real picker options, not summarised).
 */
const UnsupportedSummary = ({
  unsupported,
}: {
  unsupported: IntegrationProject[];
}) => {
  if (unsupported.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        (… {unsupported.length} project{unsupported.length === 1 ? '' : 's'} not
        supported yet)
      </Text>
    </Box>
  );
};
