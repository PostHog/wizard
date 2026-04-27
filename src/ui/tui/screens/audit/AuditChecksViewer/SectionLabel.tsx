import { Box, Text } from 'ink';

interface SectionLabelProps {
  label: 'Up next' | 'Complete';
}

export const SectionLabel = ({ label }: SectionLabelProps) => (
  <Box flexShrink={0}>
    <Text bold color="cyan">
      {label}
    </Text>
  </Box>
);
