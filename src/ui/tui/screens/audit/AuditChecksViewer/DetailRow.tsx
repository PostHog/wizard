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
    <Box width={layout.detailWidth}>
      <Text dimColor italic wrap="wrap">
        {`↳ ${item.details ?? ''}`}
      </Text>
    </Box>
  </Box>
);
