/**
 * OSC 8 hyperlink playground. Renders the same link several ways so you can
 * Cmd/Ctrl-click each and see which variants click through in your terminal —
 * OSC 8 behaviour across a wrap boundary varies by Ink version and terminal.
 *
 * Each variant uses a distinct `?variant=`, so the query param that opens tells
 * you which run your terminal honoured. RAW (written straight to stdout) is the
 * control: it works iff the terminal supports OSC 8 at all.
 *
 * Run it: `pnpm osc8:playground` (add `-- --width 40` to force more wrapping).
 */
import React from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import {
  osc8Hyperlink,
  truncateUrlLabel,
} from '@ui/tui/primitives/link-helpers';

// The nonce tail exists only to force wrapping inside a narrow box.
function url(variant: string): string {
  return `https://us.posthog.com/authorize?client_id=posthog-wizard&variant=${variant}&nonce=abcdef0123456789abcdef0123456789`;
}

const widthArg = process.argv.indexOf('--width');
const BOX_WIDTH =
  widthArg !== -1 ? Number(process.argv[widthArg + 1]) || 54 : 54;

// Written before Ink mounts so it sits in scrollback, untouched by Ink's
// layout pipeline.
const rawUrl = url('raw-stdout');
process.stdout.write(
  `\nRAW control (bypasses Ink) — click it:\n  ${osc8Hyperlink(
    rawUrl,
    truncateUrlLabel(rawUrl),
  )}\n\n`,
);

interface VariantProps {
  n: number;
  title: string;
  note: string;
  content: string;
  wrap: 'wrap' | 'truncate';
}

const Variant = ({ n, title, note, content, wrap }: VariantProps) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold>
      {n}. {title}
    </Text>
    <Text dimColor>{note}</Text>
    <Box width={BOX_WIDTH} borderStyle="round" paddingX={1}>
      <Text color="#DC9300" underline wrap={wrap}>
        {content}
      </Text>
    </Box>
  </Box>
);

const App = () => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) exit();
  });

  const truncNoId = url('ink-truncate-no-id');
  const wrapFullNoId = url('ink-wrap-full-no-id');
  const wrapFullId = url('ink-wrap-full-id');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        OSC 8 hyperlink playground (box width {BOX_WIDTH})
      </Text>
      <Text dimColor>
        Cmd/Ctrl-click each link, then read the ?variant= param that opens.
      </Text>
      <Box marginBottom={1} />

      <Variant
        n={1}
        wrap="truncate"
        title="Ink truncate, no id (recommended)"
        note="Short label, wrap='truncate' — escape never wraps. Should match RAW."
        content={osc8Hyperlink(truncNoId, truncateUrlLabel(truncNoId))}
      />
      <Variant
        n={2}
        wrap="wrap"
        title="Ink wrap, full URL, no id (current baseline)"
        note="Full URL, wrap='wrap' — expected to break where it wraps."
        content={osc8Hyperlink(wrapFullNoId, wrapFullNoId)}
      />
      <Variant
        n={3}
        wrap="wrap"
        title="Ink wrap, full URL, with id"
        note="Same as #2 but with an OSC 8 id — does grouping rescue the wrap?"
        content={osc8Hyperlink(wrapFullId, wrapFullId, '42')}
      />

      <Text dimColor>Press q or Esc to quit.</Text>
    </Box>
  );
};

render(<App />);
