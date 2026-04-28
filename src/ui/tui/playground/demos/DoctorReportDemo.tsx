import { Box, Text } from 'ink';
import { Colors, Icons } from '../../styles.js';
import { IssueTable } from '../../screens/doctor/IssueTable.js';
import type { HealthIssue } from '../../../../lib/workflows/posthog-doctor/index.js';

const NOW = '2026-04-27T15:00:00Z';

const MOCK_ISSUES: HealthIssue[] = [
  mock('1', 'ingestion_lag', 'critical'),
  mock('2', 'ingestion_warning', 'critical'),
  mock('3', 'materialized_view_failure', 'critical'),
  mock('4', 'sdk_outdated', 'warning'),
  mock('5', 'no_pageleave_events', 'warning'),
  mock('6', 'scroll_depth', 'warning'),
  mock('7', 'web_vitals', 'warning'),
  mock('8', 'reverse_proxy', 'info'),
  mock('9', 'authorized_urls', 'info'),
  mock('10', 'unrecognised_kind_with_a_long_slug_that_should_truncate', 'info'),
];

function mock(
  id: string,
  kind: string,
  severity: HealthIssue['severity'],
): HealthIssue {
  return {
    id,
    kind,
    severity,
    status: 'active',
    dismissed: false,
    created_at: NOW,
    updated_at: NOW,
  };
}

export const DoctorReportDemo = () => {
  return (
    <Box flexDirection="column">
      <Text bold color={Colors.accent}>
        PostHog Doctor Report
      </Text>
      <Text dimColor>
        Project 12345 {Icons.bullet} https://us.i.posthog.com
      </Text>
      <Box marginTop={1}>
        <Text>
          {MOCK_ISSUES.length} active issues: 3 critical, 4 warning, 3 info
        </Text>
      </Box>
      <IssueTable issues={MOCK_ISSUES} />
    </Box>
  );
};
