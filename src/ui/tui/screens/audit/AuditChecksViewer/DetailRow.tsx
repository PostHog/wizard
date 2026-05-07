import { Box, Text } from 'ink';
import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';
import type { ViewerLayout } from './layout.js';

interface DetailRowProps {
  item: AuditCheck;
  layout: ViewerLayout;
}

/** Indented under the CHECK column; wrap continuation aligns with the prefix. */
export const DetailRow = ({ item, layout }: DetailRowProps) => (
  <Box flexShrink={0}>
    <Box width={layout.detailIndent} />
    <Box flexDirection="column" width={layout.detailWidth}>
      {item.file && (
        <Text dimColor wrap="wrap">
          {`↳ File: ${item.file}`}
        </Text>
      )}
      {item.details && (
        <Text dimColor italic wrap="wrap">
          {`${item.file ? '  ' : '↳ '}Details: ${item.details}`}
        </Text>
      )}
    </Box>
  </Box>
);
