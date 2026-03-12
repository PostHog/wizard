/**
 * ModalDemo — Playground demo for the ModalOverlay primitive.
 *
 * Shows several modal variants: info, warning, error, and one with feedback text.
 */

import { Box, Text } from 'ink';
import { ModalOverlay } from '../../primitives/index.js';
import { Icons } from '../../styles.js';

export const ModalDemo = () => {
  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <ModalOverlay borderColor="cyan" title="Info Modal" width={60}>
        <Text>A simple informational modal with default styling.</Text>
      </ModalOverlay>

      <ModalOverlay
        borderColor="#DC9300"
        title={`${Icons.warning} Warning Modal`}
        width={60}
        feedback="Something needs your attention."
      >
        <Text>This modal includes a feedback message shown in yellow.</Text>
      </ModalOverlay>

      <ModalOverlay
        borderColor="red"
        title={`${Icons.warning} Error Modal`}
        width={60}
        footer={
          <Box marginLeft={2}>
            <Text dimColor>
              Continue [Enter] / Exit [Esc] (disabled in playground)
            </Text>
          </Box>
        }
      >
        <Text>This modal has a footer section below a divider.</Text>
      </ModalOverlay>
    </Box>
  );
};
