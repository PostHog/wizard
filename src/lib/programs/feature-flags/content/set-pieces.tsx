/**
 * Shareable set pieces for the feature-flags learn-deck. Sized for the
 * LearnCard pane at 80 columns (~37 chars). Trailing padding is part of
 * the box, so line length is the full rendered row.
 *
 * Helpers return <Text> trees (not custom components) so the sequencer
 * and the deck tests see the same copy. Same shape as the integration
 * funnel and data-flow blocks.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import type { ReactNode } from 'react';

/** Inner width of the invoice box (dashes between the corners). */
const INVOICE_INNER = 28;
/** Characters after `  │ ` and before the closing `│`. */
const INVOICE_BODY = INVOICE_INNER - 1;

const invoiceRule = '─'.repeat(INVOICE_INNER);

function invoicePad(left: string, right = ''): string {
  const gap = Math.max(0, INVOICE_BODY - left.length - right.length);
  return `${left}${' '.repeat(gap)}${right}`;
}

function invoiceRow(
  left: string,
  right = '',
  accent = false,
  key?: string,
): ReactNode {
  const body = invoicePad(left, right);
  return (
    <Text key={key}>
      <Text color="gray">{'  │ '}</Text>
      {accent ? (
        <Text bold color={Colors.accent}>
          {body}
        </Text>
      ) : (
        <Text>{body}</Text>
      )}
      <Text color="gray">│</Text>
    </Text>
  );
}

function invoiceBox(
  title: string,
  rows: { left: string; right?: string; accent?: boolean }[],
): ReactNode[] {
  return [
    <Text color="gray" key="top">{`  ┌${invoiceRule}┐`}</Text>,
    invoiceRow(title, '', false, 'title'),
    ...rows.map((row, i) =>
      invoiceRow(row.left, row.right ?? '', row.accent, `r-${i}`),
    ),
    <Text color="gray" key="bot">{`  └${invoiceRule}┘`}</Text>,
  ];
}

/** What this install does instead. */
export const INVOICE_CHEAP: ContentBlock = {
  type: 'lines',
  interval: 280,
  pause: 7500,
  lines: invoiceBox('This install', [
    { left: 'evaluateFlags', right: 'once' },
    { left: 'client', right: 'already knows' },
    { left: '─'.repeat(INVOICE_BODY) },
    { left: 'first paint', right: '$0 extra', accent: true },
  ]),
};

const PAGE_INNER = 20;
const PAGE_BODY = PAGE_INNER - 1;
const pageRule = '─'.repeat(PAGE_INNER);

function pagePad(s: string): string {
  return s.padEnd(PAGE_BODY);
}

function pageRow(text: string, color?: string, key?: string): ReactNode {
  return (
    <Text key={key}>
      <Text color="gray">{'  │ '}</Text>
      <Text color={color}>{pagePad(text)}</Text>
      <Text color="gray">│</Text>
    </Text>
  );
}

function pageBox(rows: { text: string; color?: string }[]): ReactNode[] {
  return [
    <Text color="gray" key="top">{`  ┌${pageRule}┐`}</Text>,
    ...rows.map((row, i) => pageRow(row.text, row.color, `p-${i}`)),
    <Text color="gray" key="bot">{`  └${pageRule}┘`}</Text>,
  ];
}

/** The app with the flag off: today's UI, nothing extra. */
export const PAGE_OFF: ContentBlock = {
  type: 'lines',
  interval: 220,
  pause: 6500,
  lines: [
    <Text dimColor key="cap">
      {'  flag off'}
    </Text>,
    ...pageBox([
      { text: 'Your todos' },
      { text: '[ ] buy milk' },
      { text: '[ ] stretch' },
    ]),
  ],
};

/** The same app with the flag on: one additive banner. */
export const PAGE_ON: ContentBlock = {
  type: 'lines',
  interval: 220,
  pause: 7500,
  lines: [
    <Text key="cap">
      <Text dimColor>{'  flag on  ·  '}</Text>
      <Text bold color={Colors.accent}>
        100%
      </Text>
    </Text>,
    ...pageBox([
      { text: 'Welcome back', color: 'cyan' },
      { text: 'Your todos' },
      { text: '[ ] buy milk' },
      { text: '[ ] stretch' },
    ]),
  ],
};

/** A boolean sitting at 0%. The control, not a glossary. */
export const ROLLOUT_SLIDER: ContentBlock = {
  type: 'lines',
  interval: 350,
  pause: 7000,
  lines: [
    <Text key="key">
      <Text bold color="cyan">
        {'  show-home-banner'}
      </Text>
    </Text>,
    <Text key="bar">
      <Text color="gray">{'  ['}</Text>
      <Text color={Colors.accent}>·</Text>
      <Text color="gray">{'                  ] '}</Text>
      <Text bold color={Colors.accent}>
        0%
      </Text>
    </Text>,
    <Text dimColor key="kind">
      {'  boolean  ·  on or off'}
    </Text>,
  ],
};

/**
 * Y-axis prefix for the /flags spike chart. Every row uses the same
 * box glyph (`┤`) so the curve columns line up. Mixing `┤` and `│`
 * leaves holes: those glyphs are not the same width in every font.
 * Pad the label to 5 characters so the prefix is always 7 (`'  80k ┤'`).
 */
const spikeY = (label: string): string => `${label.padStart(5, ' ')} ┤`;

/**
 * The expensive default, as a trends chart: quiet, then CI starts
 * polling /flags overnight. Same craft as the integration signup chart.
 *
 * Each ╯ sits in the same column as the ╭ on the row above. Counted
 * from the 7-char prefix: ╭ at 25 / 24 / 19 / 14, ╯ at 25 / 24 / 19 / 14.
 */
export const FLAG_SPIKE: ContentBlock = {
  type: 'lines',
  interval: 260,
  pause: 8000,
  lines: [
    <Text bold key="title">
      {'  Trends · /flags calls'}
    </Text>,
    <Text key="blank"> </Text>,
    <Text key="80k">
      <Text color="gray">{spikeY('80k')}</Text>
      {' '.repeat(18)}
      <Text color="cyan">{'╭─'}</Text>
      <Text dimColor>{' CI'}</Text>
    </Text>,
    <Text key="80b">
      <Text color="gray">{spikeY('')}</Text>
      {' '.repeat(17)}
      <Text color="cyan">{'╭╯'}</Text>
    </Text>,
    <Text key="40k">
      <Text color="gray">{spikeY('40k')}</Text>
      {' '.repeat(12)}
      <Text color="cyan">{'╭────╯'}</Text>
    </Text>,
    <Text key="40b">
      <Text color="gray">{spikeY('')}</Text>
      {' '.repeat(7)}
      <Text color="cyan">{'╭────╯'}</Text>
    </Text>,
    <Text key="0">
      <Text color="gray">{spikeY('0')}</Text>
      <Text color="cyan">{'───────╯'}</Text>
    </Text>,
    <Text color="gray" key="axis">
      {'      └┬────┬────┬────┬──'}
    </Text>,
    <Text dimColor key="days">
      {'       Mon  Wed  Fri  Sun'}
    </Text>,
  ],
};

/**
 * Why bootstrap exists: the Save button that pops in late vs the one
 * that was already there. A comic, not another box.
 */
export const FIRST_PAINT: ContentBlock = {
  type: 'lines',
  interval: 350,
  pause: 8000,
  lines: [
    <Text dimColor key="a">
      {'  client fetch'}
    </Text>,
    <Text dimColor key="b">
      {'  t=0      ·  ·  ·'}
    </Text>,
    <Text key="c">
      <Text dimColor>{'  t=200ms  '}</Text>
      <Text color="cyan">{'[ Save ]'}</Text>
      <Text dimColor>{'  pop'}</Text>
    </Text>,
    <Text key="gap"> </Text>,
    <Text dimColor key="d">
      {'  bootstrap'}
    </Text>,
    <Text key="e">
      <Text dimColor>{'  t=0      '}</Text>
      <Text color="cyan">{'[ Save ]'}</Text>
      <Text dimColor>{'  already'}</Text>
    </Text>,
  ],
};
