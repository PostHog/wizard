/**
 * DiffCascade — code-edits phase.
 *
 * + and - code lines scroll upward continuously. Occasional comment-rewrite
 * gag: a "// hmm…" line appears, gets - struck out, then a + replaces it.
 */

import { Box, Text } from 'ink';
import { useRef } from 'react';
import { useTick } from '@ui/tui/hooks/useTick';
import { MATRIX_FADE, Panel, type VisualProps } from './panel';
import { VISUALIZER_PALETTE } from './palette';

const CODE_SNIPPETS = [
  "import posthog from 'posthog-js'",
  'posthog.init(KEY, { host: HOST })',
  '<PostHogProvider client={posthog}>',
  '  {children}',
  '</PostHogProvider>',
  "posthog.capture('page_viewed')",
  "posthog.capture('signup_started')",
  'posthog.identify(user.id, { email })',
  "if (process.env.NODE_ENV !== 'test') posthog.init(KEY)",
  'export const posthog = new PostHog(KEY)',
  '// TODO: enable replay',
  'window.posthog = posthog',
];

const WHIMSY_COMMENTS = [
  '// hmm — that should be a hook',
  '// wait, refactor incoming',
  '// posthog says hi',
];

interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

export const DiffCascade = ({ width, height }: VisualProps) => {
  const tick = useTick(280);
  const linesRef = useRef<DiffLine[]>([]);

  if (linesRef.current.length === 0) {
    for (let i = 0; i < height; i++) {
      linesRef.current.push({
        sign: Math.random() < 0.75 ? '+' : '-',
        text: CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)],
      });
    }
  }
  // Scroll up by one each tick, push a new line at bottom.
  linesRef.current.shift();
  const whimsy = tick % 23 === 0;
  linesRef.current.push({
    sign: whimsy ? '-' : Math.random() < 0.78 ? '+' : '-',
    text: whimsy
      ? WHIMSY_COMMENTS[Math.floor(Math.random() * WHIMSY_COMMENTS.length)]
      : CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)],
  });

  const lines = linesRef.current;
  return (
    <Panel>
      {Array.from({ length: height }).map((_, y) => {
        // The line buffer can lag `height` for a frame after a resize; fall
        // back to a blank line rather than dereferencing `undefined`.
        const line = lines[y] ?? { sign: ' ' as const, text: '' };
        const cap = width - 2;
        const text = `${line.sign} ${line.text}`.slice(0, cap);
        const color =
          line.sign === '+'
            ? VISUALIZER_PALETTE.mid
            : line.sign === '-'
            ? VISUALIZER_PALETTE.deleteRed
            : MATRIX_FADE;
        return (
          <Box key={y}>
            <Text color={color}>{text.padEnd(cap, ' ')}</Text>
          </Box>
        );
      })}
    </Panel>
  );
};
