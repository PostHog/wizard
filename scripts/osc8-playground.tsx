/**
 * OSC 8 hyperlink playground.
 *
 * Renders the same link several different ways so you can Cmd/Ctrl-click each
 * one in your terminal and see which variants actually open the correct URL.
 * OSC 8 links in an Ink TUI are fragile: Ink lays out and wraps text through
 * its own tokenizer + `wrap-ansi`, and how that handles the OSC 8 envelope
 * across a wrap boundary varies by Ink version and by terminal. (Dumping the
 * non-TTY frame shows Ink 6.8 re-emitting the link open on each wrapped row,
 * but whether a given terminal then treats the wrapped run as one clickable
 * link is exactly what this playground is here to settle empirically.)
 *
 * Each variant links to a DISTINCT url (`?variant=<name>`). After clicking,
 * look at the `variant` query param in the page that opens (and whether the
 * long `nonce` tail survived) to tell exactly which run your terminal honoured.
 *
 * Run it:  pnpm osc8:playground
 * Narrower box (force more wrapping):  pnpm osc8:playground -- --width 40
 *
 * Expectations:
 *   - RAW (written straight to stdout, bypassing Ink) should always work if
 *     your terminal supports OSC 8 at all — it's the control.
 *   - TRUNCATE variants keep the label on one line and should match RAW.
 *   - WRAP-FULL variants deliberately let a long URL wrap; watch whether the
 *     click target survives, and whether the `id` variant hover-highlights the
 *     wrapped fragments as one link.
 */
import React from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import {
  osc8Hyperlink,
  truncateUrlLabel,
} from '@ui/tui/primitives/link-helpers';

// A long, obviously-truncatable URL. The nonce tail exists purely to force
// wrapping inside a narrow box and to make a truncated click target visible.
function url(variant: string): string {
  return `https://us.posthog.com/authorize?client_id=posthog-wizard&variant=${variant}&nonce=abcdef0123456789abcdef0123456789`;
}

const widthArg = process.argv.indexOf('--width');
const BOX_WIDTH =
  widthArg !== -1 ? Number(process.argv[widthArg + 1]) || 54 : 54;

// The RAW control line is written before Ink mounts so it sits in scrollback,
// untouched by Ink's layout/diff pipeline — the ground truth for "does my
// terminal do OSC 8 at all".
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
