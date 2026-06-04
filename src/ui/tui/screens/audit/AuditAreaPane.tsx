/**
 * AuditAreaPane — left-pane slide that follows whatever area the agent is
 * currently checking, plus a wrap-up state once every check is resolved
 * and the agent has moved on to writing the report.
 *
 * Three states, gated top-down on the ledger:
 *   1. firstPending defined          → render the slide for that area
 *   2. checks empty                  → blank (the seed hook fires before
 *                                       this screen mounts in practice;
 *                                       this is just defensive)
 *   3. all checks non-pending        → "writing report" wrap-up
 *
 * Pressing `O` opens the active slide's docs URL.
 */

import { Fragment } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { Colors } from '@ui/tui/styles';
import { type AuditCheck } from '@lib/programs/audit/types';
import { AUDIT_AREA_SLIDES, type AreaSlide } from './slides/index.js';

// ── Helpers ──────────────────────────────────────────────────────────

const FINDING_STATUSES: AuditCheck['status'][] = [
  'error',
  'warning',
  'suggestion',
];

const isFinding = (c: AuditCheck) => FINDING_STATUSES.includes(c.status);

const fallbackSlide = (area: string): AreaSlide => ({
  area,
  intro: [`Verifying ${area.toLowerCase()}…`],
  docsUrl: '',
});

const openLink = (url: string) => {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
};

// ── Component ────────────────────────────────────────────────────────

interface AuditAreaPaneProps {
  checks: AuditCheck[];
  reportPath: string;
  /** Slide registry to look the active area up in. Defaults to the doctor
   * (`audit` program) slides; events-audit passes its own 6-phase set. */
  slides?: AreaSlide[];
}

export const AuditAreaPane = ({
  checks,
  reportPath,
  slides = AUDIT_AREA_SLIDES,
}: AuditAreaPaneProps) => {
  const pendingChecks = checks.filter((c) => c.status === 'pending');
  const activeArea = pendingChecks[0]?.area;
  const slide = activeArea
    ? slides.find((s) => s.area === activeArea) ?? fallbackSlide(activeArea)
    : null;

  useInput((input) => {
    if (input.toLowerCase() === 'o' && slide?.docsUrl) {
      openLink(slide.docsUrl);
    }
  });

  // Active area — agent is still resolving checks for this slide's area.
  if (slide) {
    const hasFindings = checks.some(isFinding);
    return <ActiveSlide slide={slide} hasFindings={hasFindings} />;
  }

  // Ledger empty — the seed hook fires synchronously at intro `onReady`,
  // so this only happens if the seed file write failed. Render nothing
  // rather than misleading the user with a "wrapped up" message.
  if (checks.length === 0) {
    return null;
  }

  // Every check is resolved and the agent is composing the report.
  return <WritingReport reportPath={reportPath} />;
};

// ── States ───────────────────────────────────────────────────────────

const ActiveSlide = ({
  slide,
  hasFindings,
}: {
  slide: AreaSlide;
  hasFindings: boolean;
}) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      Verifying {slide.area.toLowerCase()}
    </Text>
    <Box height={1} />

    {slide.visual}
    {slide.intro.map((paragraph, i) => (
      <Fragment key={i}>
        {i > 0 && <Box height={1} />}
        <Text>{paragraph}</Text>
      </Fragment>
    ))}

    <Box marginTop={1}>
      <Text dimColor>
        {slide.docsUrl && (
          <>
            [<Text color={Colors.accent}>O</Text>] Learn more
          </>
        )}
        {hasFindings && (
          <>
            {slide.docsUrl && '  '}[<Text color={Colors.accent}>→</Text>] View
            issues
          </>
        )}
      </Text>
    </Box>
  </Box>
);

const WritingReport = ({ reportPath }: { reportPath: string }) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      We've wrapped up the review.
    </Text>
    <Box height={1} />
    <Text>
      To help you get the most out of your PostHog integration, we're preparing
      a report for you at <Text color="cyan">{reportPath}</Text>.
    </Text>
    <Box height={1} />
    <Text>
      We'll cover what we checked and suggest where we can improve the existing
      integration.
    </Text>
    <Box height={1} />
    <Text dimColor>Hang tight!</Text>
  </Box>
);
