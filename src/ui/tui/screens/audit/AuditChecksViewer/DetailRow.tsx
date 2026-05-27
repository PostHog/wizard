import { Box, Text } from 'ink';
import type { AuditCheck } from '@lib/programs/audit/types';
import type { ViewerLayout } from './layout.js';

interface DetailRowProps {
  item: AuditCheck;
  layout: ViewerLayout;
}

/** Format a `details` string. If it parses as a JSON object, render it as
 *  indented key: value lines (skipping huge nested arrays/objects which we
 *  truncate). Otherwise return the original text. v3000 emits structured
 *  JSON for several event-quality checks — a raw dump is unreadable. */
function formatDetails(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [raw];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [raw];
  }
  if (parsed === null || typeof parsed !== 'object') return [raw];
  const lines: string[] = [];
  const renderValue = (v: unknown): string => {
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const allPrimitive = v.every((e) => e === null || typeof e !== 'object');
      if (allPrimitive) return v.map(renderValue).join(', ');
      return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      return `{${keys.length} field${keys.length === 1 ? '' : 's'}}`;
    }
    return String(v);
  };
  for (const [key, value] of Object.entries(parsed)) {
    lines.push(`${key}: ${renderValue(value)}`);
  }
  return lines.length > 0 ? lines : [raw];
}

/** Indented under the CHECK column; wrap continuation aligns with the prefix. */
export const DetailRow = ({ item, layout }: DetailRowProps) => {
  const detailLines = item.details ? formatDetails(item.details) : [];
  return (
    <Box flexShrink={0}>
      <Box width={layout.detailIndent} />
      <Box flexDirection="column" width={layout.detailWidth}>
        {item.file && (
          <Text dimColor wrap="wrap">
            {`↳ File: ${item.file}`}
          </Text>
        )}
        {detailLines.map((line, i) => (
          <Text key={i} dimColor italic wrap="wrap">
            {i === 0 ? `${item.file ? '  ' : '↳ '}${line}` : `    ${line}`}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
