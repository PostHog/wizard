/**
 * LinkTextDemo — shows the LinkText primitive and OSC 8 link variants so you
 * can Cmd/Ctrl-click each and see which click through in your terminal.
 *
 * OSC 8 behaviour across a wrap boundary varies by terminal, so each variant
 * links to a distinct `?variant=`: the query param that opens tells you which
 * run your terminal honoured. Narrow boxes force the long URLs to wrap.
 */

import { Box, Text } from 'ink';
import { LinkText } from '@ui/tui/primitives/index';
import {
  osc8Hyperlink,
  truncateUrlLabel,
} from '@ui/tui/primitives/link-helpers';
import { Colors } from '@ui/tui/styles';

const BOX_WIDTH = 54;

// The nonce tail exists only to force wrapping inside a narrow box.
function url(variant: string): string {
  return `https://us.posthog.com/authorize?client_id=posthog-wizard&variant=${variant}&nonce=abcdef0123456789abcdef0123456789`;
}

const Variant = ({
  n,
  title,
  content,
  wrap,
}: {
  n: number;
  title: string;
  content: string;
  wrap: 'wrap' | 'truncate';
}) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold>
      {n}. {title}
    </Text>
    <Box width={BOX_WIDTH} borderStyle="round" paddingX={1}>
      <Text color={Colors.accent} underline wrap={wrap}>
        {content}
      </Text>
    </Box>
  </Box>
);

export const LinkTextDemo = () => {
  const truncNoId = url('truncate-no-id');
  const wrapFullNoId = url('wrap-full-no-id');
  const wrapFullId = url('wrap-full-id');

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.accent}>
        Link Text Demo
      </Text>
      <Text dimColor>
        Cmd/Ctrl-click each link, then read the ?variant= param that opens.
      </Text>
      <Box height={1} />

      <Text bold>LinkText primitive (the real thing):</Text>
      <LinkText
        text={`Authorize the integration here: ${url('linktext-primitive')}`}
      />
      <Box height={1} />

      <Variant
        n={1}
        wrap="truncate"
        title="truncate, no id (what LinkText uses)"
        content={osc8Hyperlink(truncNoId, truncateUrlLabel(truncNoId))}
      />
      <Variant
        n={2}
        wrap="wrap"
        title="wrap, full URL, no id"
        content={osc8Hyperlink(wrapFullNoId, wrapFullNoId)}
      />
      <Variant
        n={3}
        wrap="wrap"
        title="wrap, full URL, with id"
        content={osc8Hyperlink(wrapFullId, wrapFullId, '42')}
      />
    </Box>
  );
};
