import { Box, Text } from 'ink';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
} from '../../../../../lib/workflows/audit/types.js';
import { truncate, type ViewerLayout } from './layout.js';

interface CheckRowProps {
  item: AuditCheck;
  layout: ViewerLayout;
}

export const CheckRow = ({ item, layout }: CheckRowProps) => {
  const style = AUDIT_SEVERITY_STYLE[item.status];
  return (
    <Box flexShrink={0}>
      <Box width={layout.statusWidth + layout.colGap}>
        <Text color={style.color}>{style.glyph}</Text>
      </Box>
      <Box width={layout.areaWidth + layout.colGap}>
        <Text dimColor>{truncate(item.area, layout.areaWidth)}</Text>
      </Box>
      <Box width={layout.labelWidth + layout.colGap}>
        <Text
          bold={item.status !== 'pending'}
          dimColor={item.status === 'pending'}
        >
          {truncate(item.label, layout.labelWidth)}
        </Text>
      </Box>
      <Box width={layout.fileWidth}>
        <Text dimColor>{truncate(item.file ?? '', layout.fileWidth - 1)}</Text>
      </Box>
    </Box>
  );
};
