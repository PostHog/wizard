import { Box, Text } from 'ink';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
} from '../../../../lib/programs/audit/types.js';
import { relativeToInstallDir } from '../../../../utils/paths.js';

interface AuditChecksOutroSectionProps {
  checks: AuditCheck[];
  installDir: string;
}

const MAX_VISIBLE = 6;

export const AuditChecksOutroSection = ({
  checks,
  installDir,
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
          {visible.map((item) => {
            const style = AUDIT_SEVERITY_STYLE[item.status];
            return (
              <Box key={item.id} flexDirection="column" marginTop={1}>
                <Text>
                  <Text color={style.color}>{style.glyph}</Text>{' '}
                  <Text bold>{item.label}</Text>{' '}
                  <Text dimColor>({item.area})</Text>
                </Text>
                {item.file && (
                  <Text dimColor>
                    {'  '}
                    {relativeToInstallDir(item.file, installDir)}
                  </Text>
                )}
              </Box>
            );
          })}
          {hidden > 0 && (
            <Text dimColor>… and {hidden} more — see the report.</Text>
          )}
        </>
      )}
    </Box>
  );
};
