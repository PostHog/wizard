/**
 * SourceMapsDetectScreen — runs the Haiku detection agent over the repo, shows
 * streaming progress, then renders a structured map of which projects can have
 * source-map upload wired up and which cannot. The user picks one project; the
 * choice is written to frameworkContext and the run step instruments it.
 *
 * Runs after auth — the detection agent needs credentials.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
} from '@lib/programs/error-tracking-upload-source-maps/index';
import {
  detectSourceMapsProjects,
  type DetectedProject,
  type DetectionReport,
} from '@lib/programs/error-tracking-upload-source-maps/detect-agentic';

interface SourceMapsDetectScreenProps {
  store: WizardStore;
}

type DetectState =
  | { kind: 'loading' }
  | { kind: 'ready'; report: DetectionReport }
  | { kind: 'error'; message: string };

const EXIT = '__exit';
const MAX_ACTIVITY_LINES = 8;

function projectLabel(p: DetectedProject): string {
  const name = p.variant ? VARIANT_DISPLAY_NAME[p.variant] : p.framework;
  const where = p.path === '.' ? 'repo root' : p.path;
  return `${name} ${Icons.bullet} ${where}`;
}

export const SourceMapsDetectScreen = ({
  store,
}: SourceMapsDetectScreenProps) => {
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
        const report = await detectSourceMapsProjects(store.session, (line) => {
          if (!cancelled) {
            setActivity((prev) => [...prev, line].slice(-MAX_ACTIVITY_LINES));
          }
        });
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
  const blocked = report.projects.filter((p) => !p.instrumentable);

  if (instrumentable.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Nothing to instrument yet
          </Text>
          <Text dimColor>
            None of the projects found can have source-map upload set up.
          </Text>
        </Box>
        <ProjectList title="Projects found" projects={blocked} showReason />
        <Box marginTop={1}>
          <PickerMenu
            options={[{ label: 'Exit', value: EXIT }]}
            onSelect={() => process.exit(0)}
          />
        </Box>
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
        <Text dimColor>Pick the project to wire up source-map upload for.</Text>
      </Box>

      {blocked.length > 0 && (
        <ProjectList
          title="Can't instrument yet"
          projects={blocked}
          showReason
        />
      )}

      <PickerMenu
        message="Which project?"
        options={options}
        onSelect={(value) => {
          const path = Array.isArray(value) ? value[0] : value;
          if (path === EXIT) {
            process.exit(0);
            return;
          }
          const chosen = instrumentable.find((p) => p.path === path);
          if (!chosen || !chosen.variant) return;
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
            chosen.variant,
          );
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
            VARIANT_DISPLAY_NAME[chosen.variant],
          );
          store.setFrameworkContext(
            SOURCE_MAPS_CONTEXT_KEYS.selectedPath,
            chosen.path,
          );
        }}
      />
    </Box>
  );
};

const ProjectList = ({
  title,
  projects,
  showReason,
}: {
  title: string;
  projects: DetectedProject[];
  showReason?: boolean;
}) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text dimColor>{title}:</Text>
    {projects.map((p) => (
      <Text key={p.path} dimColor>
        {'  '}
        {Icons.bullet} {projectLabel(p)}
        {showReason && p.reason ? ` — ${p.reason}` : ''}
      </Text>
    ))}
  </Box>
);
