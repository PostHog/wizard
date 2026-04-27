import { Box, Text } from 'ink';
import type { AuditCheck, AuditStatus } from './types.js';

interface AuditChecksOutroSectionProps {
  checks: AuditCheck[];
}

const SEVERITY_COLOR: Record<AuditStatus, string> = {
  pending: 'gray',
  pass: 'green',
  error: 'red',
  warning: 'yellow',
  suggestion: 'cyan',
};

const SEVERITY_GLYPH: Record<AuditStatus, string> = {
  pending: '◌',
  pass: '✔',
  error: '✘',
  warning: '⚠',
  suggestion: '•',
};

const MAX_VISIBLE = 6;

export const AuditChecksOutroSection = ({
  checks,
}: AuditChecksOutroSectionProps) => {
  if (checks.length === 0) return null;

  const errors = checks.filter((c) => c.status === 'error');
  const warnings = checks.filter((c) => c.status === 'warning');
  const suggestions = checks.filter((c) => c.status === 'suggestion');
  const problematic = [...errors, ...warnings, ...suggestions];

  const visible = problematic.slice(0, MAX_VISIBLE);
  const hidden = problematic.length - visible.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        Items audited:
      </Text>
      <Text dimColor>
        {checks.length} checks · {errors.length} errors · {warnings.length}{' '}
        warnings · {suggestions.length} suggestions
      </Text>
      {problematic.length === 0 ? (
        <Text color="green">{'•'} No issues found.</Text>
      ) : (
        <>
          {visible.map((item) => (
            <Box key={item.id}>
              <Text color={SEVERITY_COLOR[item.status]}>
                {SEVERITY_GLYPH[item.status]}{' '}
              </Text>
              <Text bold>{item.label}</Text>
              <Text dimColor> ({item.area})</Text>
              {item.file && <Text dimColor> {item.file}</Text>}
            </Box>
          ))}
          {hidden > 0 && (
            <Text dimColor>… and {hidden} more — see the report.</Text>
          )}
        </>
      )}
    </Box>
  );
};
