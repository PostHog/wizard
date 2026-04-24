import { Box, Text } from 'ink';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { LoadingBox, PickerMenu } from '../../primitives/index.js';
import { Colors, Icons } from '../../styles.js';
import {
  fetchHealthIssues,
  getKindMeta,
  type HealthIssue,
  type HealthIssueSeverity,
  type HealthIssueSummary,
} from '../../../../lib/workflows/posthog-doctor/index.js';
import { getUiHostFromHost } from '../../../../utils/urls.js';
import { OutroKind } from '../../../../lib/wizard-session.js';
import { ApiError } from '../../../../lib/api.js';
import { POSTHOG_DOCS_URL } from '../../../../lib/constants.js';

interface DoctorReportScreenProps {
  store: WizardStore;
}

type Report = {
  summary: HealthIssueSummary;
  grouped: Partial<Record<HealthIssueSeverity, HealthIssue[]>>;
};

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; issues: HealthIssue[]; report: Report }
  | { kind: 'error'; message: string };

const SEVERITY_ORDER: HealthIssueSeverity[] = ['critical', 'warning', 'info'];

const SEVERITY_COLOR: Record<HealthIssueSeverity, string> = {
  critical: Colors.error,
  warning: Colors.accent,
  info: Colors.primary,
};

const SEVERITY_LABEL: Record<HealthIssueSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

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
          setState({ kind: 'ready', issues, report: buildReport(issues) });
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

  const { issues, report } = state;

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
      <Box marginY={1}>
        <Text>{formatSummaryLine(report.summary, issues.length)}</Text>
      </Box>

      {SEVERITY_ORDER.map((sev) => {
        const list = report.grouped[sev];
        if (!list || list.length === 0) return null;
        return (
          <Box key={sev} flexDirection="column" marginBottom={1}>
            {list.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </Box>
        );
      })}

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

const IssueRow = ({ issue }: { issue: HealthIssue }) => {
  const meta = getKindMeta(issue.kind);
  const color = SEVERITY_COLOR[issue.severity];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color}>{Icons.squareFilled}</Text>
        <Text color={color} bold>
          {' '}
          {SEVERITY_LABEL[issue.severity]}
        </Text>
        <Text dimColor>
          {' '}
          {Icons.bullet} {issue.kind}
        </Text>
      </Box>
      <Text>{meta.title}</Text>
      <Text dimColor>{meta.description}</Text>
      <Text>
        <Text dimColor>{Icons.triangleSmallRight} </Text>
        <Text color="cyan">{meta.docsUrl}</Text>
      </Text>
    </Box>
  );
};

function buildReport(issues: HealthIssue[]): Report {
  const by_severity: Record<HealthIssueSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  const grouped: Partial<Record<HealthIssueSeverity, HealthIssue[]>> = {};
  for (const issue of issues) {
    by_severity[issue.severity] += 1;
    (grouped[issue.severity] ??= []).push(issue);
  }
  return {
    summary: { total: issues.length, by_severity },
    grouped,
  };
}

function formatSummaryLine(summary: HealthIssueSummary, total: number): string {
  const parts: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const n = summary.by_severity[sev] ?? 0;
    if (n > 0) parts.push(`${n} ${SEVERITY_LABEL[sev].toLowerCase()}`);
  }
  const suffix = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `${total} active issue${total === 1 ? '' : 's'}${suffix}`;
}
