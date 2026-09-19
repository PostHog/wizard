import { Text } from 'ink';

export const Legend = () => (
  <Text>
    <Text color="green">✔ pass</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="red">✘ error</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="yellow">⚠ warning</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="cyan">• suggestion</Text>
  </Text>
);
