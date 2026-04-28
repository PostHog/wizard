import { Box, Text } from 'ink';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';
import { Colors, Icons } from '../../styles.js';
import {
  getKindMeta,
  type HealthIssue,
  type HealthIssueSeverity,
} from '../../../../lib/workflows/posthog-doctor/index.js';

export const SEVERITY_ORDER: HealthIssueSeverity[] = [
  'critical',
  'warning',
  'info',
];

const SEVERITY_COLOR: Record<HealthIssueSeverity, string> = {
  critical: Colors.error,
  warning: Colors.accent,
  info: Colors.primary,
};

export const SEVERITY_LABEL: Record<HealthIssueSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const ICON_COL = 2;
const ROW_GAP = 2;
const NARROW_TERM_THRESHOLD = 90;
const MAX_DOCS_WIDTH = 50;
const MIN_DOCS_WIDTH = 20;

function computeDocsWidth(termCols: number): number {
  if (termCols < NARROW_TERM_THRESHOLD) return 0;
  const inner = termCols - 12;
  return Math.min(
    MAX_DOCS_WIDTH,
    Math.max(MIN_DOCS_WIDTH, Math.floor(inner * 0.45)),
  );
}

interface IssueTableProps {
  issues: HealthIssue[];
}

export const IssueTable = ({ issues }: IssueTableProps) => {
  const [termCols] = useStdoutDimensions();
  const docsWidth = computeDocsWidth(termCols);

  const grouped: Partial<Record<HealthIssueSeverity, HealthIssue[]>> = {};
  for (const issue of issues) {
    (grouped[issue.severity] ??= []).push(issue);
  }

  return (
    <Box flexDirection="column">
      {SEVERITY_ORDER.map((sev) => {
        const list = grouped[sev];
        if (!list || list.length === 0) return null;
        return (
          <Box key={sev} flexDirection="column" marginTop={1}>
            <Text bold color={SEVERITY_COLOR[sev]}>
              {SEVERITY_LABEL[sev]} ({list.length})
            </Text>
            {list.map((issue) => (
              <IssueRow key={issue.id} issue={issue} docsWidth={docsWidth} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
};

const IssueRow = ({
  issue,
  docsWidth,
}: {
  issue: HealthIssue;
  docsWidth: number;
}) => {
  const meta = getKindMeta(issue.kind);
  const sevColor = SEVERITY_COLOR[issue.severity];

  if (docsWidth === 0) {
    return (
      <Box flexDirection="column">
        <Box>
          <Box width={ICON_COL}>
            <Text color={sevColor}>{Icons.squareFilled}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="truncate">{meta.title}</Text>
          </Box>
        </Box>
        <Box paddingLeft={ICON_COL}>
          <Text color={Colors.primary} wrap="truncate">
            {meta.docsUrl}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box width={ICON_COL}>
        <Text color={sevColor}>{Icons.squareFilled}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" marginRight={ROW_GAP}>
        <Text wrap="truncate">{meta.title}</Text>
      </Box>
      <Box width={docsWidth} flexShrink={0}>
        <Text color={Colors.primary} wrap="truncate">
          {meta.docsUrl}
        </Text>
      </Box>
    </Box>
  );
};
