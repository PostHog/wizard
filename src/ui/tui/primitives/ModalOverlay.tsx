/**
 * ModalOverlay — Reusable centered card for overlay screens.
 *
 * Shared layout for HealthCheckScreen, SettingsOverrideScreen, PortConflictScreen, etc.
 * Provides: centered card with border, title, body, optional feedback, divider, and actions.
 */

import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { Divider } from './Divider.js';

interface ModalOverlayProps {
  /** Card border color */
  borderColor: string;
  /** Title text */
  title: string;
  /** Title text color (defaults to borderColor) */
  titleColor?: string;
  /** Card width (default 68) */
  width?: number;
  /** Body content */
  children: ReactNode;
  /** Optional feedback message (shown in yellow above the divider) */
  feedback?: string | null;
  /** Footer content below the divider (typically ConfirmationInput) */
  footer?: ReactNode;
}

export const ModalOverlay = ({
  borderColor,
  title,
  titleColor,
  width = 68,
  children,
  feedback,
  footer,
}: ModalOverlayProps) => {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={borderColor}
        paddingX={3}
        paddingY={1}
        width={width}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text color={titleColor ?? borderColor} bold>
            {title}
          </Text>
        </Box>

        {children}

        {feedback && (
          <Box marginTop={1}>
            <Text color="yellow">{feedback}</Text>
          </Box>
        )}

        {footer && (
          <>
            <Box marginY={1}>
              <Divider />
            </Box>
            {footer}
          </>
        )}
      </Box>
    </Box>
  );
};
