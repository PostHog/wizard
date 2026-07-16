/**
 * LinkTextDemo — Cmd/Ctrl-click each link and see which click through.
 *
 * The two approaches to emitting an OSC 8 link in Ink, side by side:
 *   A. escape as <Text> content — Ink tokenizes it per cell and mangles it.
 *   B. plain label wrapped in <Transform> — the escape brackets the rendered
 *      line after layout, intact. This is how ink-link works, and what the
 *      LinkText primitive now uses.
 *
 * Each links to a distinct `?variant=`, so the query param that opens tells you
 * which approach your terminal honoured.
 */

import { Box, Text, Transform } from 'ink';
import { type ReactNode } from 'react';
import { LinkText } from '@ui/tui/primitives/index';
import {
  osc8Hyperlink,
  truncateUrlLabel,
} from '@ui/tui/primitives/link-helpers';
import { Colors } from '@ui/tui/styles';

const BOX_WIDTH = 54;

// The nonce tail exists only to make the URL long enough to be obvious.
function url(variant: string): string {
  return `https://us.posthog.com/authorize?client_id=posthog-wizard&variant=${variant}&nonce=abcdef0123456789abcdef0123456789`;
}

const Row = ({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold>
      {n}. {title}
    </Text>
    <Box width={BOX_WIDTH} borderStyle="round" paddingX={1}>
      {children}
    </Box>
  </Box>
);

export const LinkTextDemo = () => {
  const contentUrl = url('A-escape-in-content');
  const transformUrl = url('B-transform');

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.accent}>
        Link Text Demo
      </Text>
      <Text dimColor>
        Cmd/Ctrl-click each link, then read the ?variant= param that opens.
      </Text>
      <Box height={1} />

      <Row n={1} title="A — escape as Text content (broken)">
        <Text color={Colors.accent} underline wrap="truncate">
          {osc8Hyperlink(contentUrl, truncateUrlLabel(contentUrl))}
        </Text>
      </Row>

      <Row n={2} title="B — plain label wrapped in <Transform> (fix)">
        <Transform transform={(line) => osc8Hyperlink(transformUrl, line)}>
          <Text color={Colors.accent} underline wrap="truncate">
            {truncateUrlLabel(transformUrl)}
          </Text>
        </Transform>
      </Row>

      <Row n={3} title="LinkText primitive (now uses B)">
        <LinkText text={url('C-linktext-primitive')} />
      </Row>
    </Box>
  );
};
