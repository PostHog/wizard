import { Box, Text } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { LoadingBox, PickerMenu } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import {
  fetchHealthIssues,
  type HealthIssue,
} from '@lib/programs/posthog-doctor/index';
import { getUiHostFromHost } from '@utils/urls';
import { OutroKind } from '@lib/wizard-session';
import { ApiError } from '@lib/api';
import { POSTHOG_DOCS_URL } from '@lib/constants';
import { IssueTable, SEVERITY_LABEL, SEVERITY_ORDER } from './IssueTable.js';

interface DoctorReportScreenProps {
  store: WizardStore;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; issues: HealthIssue[] }
  | { kind: 'error'; message: string };

export const DoctorReportScreen = ({ store }: DoctorReportScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { credentials } = store.session;
  const accessToken = credentials?.accessToken;
  const host = credentials?.host;
  const projectId = credentials?.projectId;

  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    if (!accessToken || !host || projectId == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const issues = await fetchHealthIssues(accessToken, host, projectId);
        if (!cancelled) {
          setState({ kind: 'ready', issues });
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof ApiError && err.statusCode === 401
              ? 'Your PostHog session has expired. Re-run the wizard to sign in again.'
              : err instanceof Error
              ? err.message
              : String(err);
          setState({ kind: 'error', message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, host, projectId]);

  if (!credentials) {
    return <LoadingBox message="Waiting for authentication..." />;
  }

  if (state.kind === 'loading') {
    return (
      <Box flexDirection="column">
        <Header host={credentials.host} projectId={credentials.projectId} />
        <LoadingBox message="Fetching health issues..." />
      </Box>
    );
  }

  const healthUrl = `${getUiHostFromHost(credentials.host)}/project/${
    credentials.projectId
  }/health`;

  if (state.kind === 'error') {
    return (
      <Box flexDirection="column">
        <Header host={credentials.host} projectId={credentials.projectId} />
        <Box flexDirection="column" marginY={1}>
          <Text color={Colors.error} bold>
            {Icons.squareFilled} Failed to fetch health issues
          </Text>
          <Text dimColor>{state.message}</Text>
        </Box>
        <PickerMenu
          options={[{ label: 'Continue', value: 'continue' }]}
          onSelect={() => {
            store.setOutroData({
              kind: OutroKind.Error,
              message: 'Failed to fetch health issues',
              body: state.message,
              docsUrl: POSTHOG_DOCS_URL,
            });
          }}
        />
      </Box>
    );
  }

  const { issues } = state;

  if (issues.length === 0) {
    return (
      <Box flexDirection="column">
        <Header host={credentials.host} projectId={credentials.projectId} />
        <Box marginY={1}>
          <Text color={Colors.success} bold>
            {Icons.check} No active issues — you're all set!
          </Text>
        </Box>
        <PickerMenu
          options={[{ label: 'Continue', value: 'continue' }]}
          onSelect={() => {
            store.setOutroData({
              kind: OutroKind.Success,
              message: 'No active issues — your project looks healthy.',
              docsUrl: POSTHOG_DOCS_URL,
              continueUrl: healthUrl,
            });
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header host={credentials.host} projectId={credentials.projectId} />
      <Box marginTop={1}>
        <Text>{formatSummaryLine(issues)}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <IssueTable issues={issues} />
      </Box>

      <PickerMenu
        options={[{ label: 'Continue', value: 'continue' }]}
        onSelect={() => {
          store.setOutroData({
            kind: OutroKind.Success,
            message: `Found ${issues.length} active issue${
              issues.length === 1 ? '' : 's'
            }.`,
            body: 'Open the dashboard in PostHog to dismiss or resolve issues.',
            docsUrl: POSTHOG_DOCS_URL,
            continueUrl: healthUrl,
          });
        }}
      />
    </Box>
  );
};

const Header = ({ host, projectId }: { host: string; projectId: number }) => (
  <Box flexDirection="column">
    <Text bold color={Colors.accent}>
      PostHog Doctor Report
    </Text>
    <Text dimColor>
      Project {projectId} {Icons.bullet} {host}
    </Text>
  </Box>
);

function formatSummaryLine(issues: HealthIssue[]): string {
  const parts: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const n = issues.filter((i) => i.severity === sev).length;
    if (n > 0) parts.push(`${n} ${SEVERITY_LABEL[sev].toLowerCase()}`);
  }
  const suffix = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `${issues.length} active issue${
    issues.length === 1 ? '' : 's'
  }${suffix}`;
}
