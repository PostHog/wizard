/**
 * Audit-3000 right pane — arcade-flavoured fork of `AuditAreaPane`.
 *
 * Mirrors the audit pane's three-state logic (active slide → empty →
 * wrap-up) but routes through the audit-3000 slide registry and uses
 * "LEVEL N: <area>" framing instead of "Verifying ...".
 */

import { Fragment, memo } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { Colors } from '@ui/tui/styles';
import { type AuditCheck } from '@lib/programs/audit/types';
import { AUDIT_3000_AREA_SLIDES, type AreaSlide } from './slides/index.js';

const FINDING_STATUSES: AuditCheck['status'][] = [
  'error',
  'warning',
  'suggestion',
];

const isFinding = (c: AuditCheck) => FINDING_STATUSES.includes(c.status);

const fallbackSlide = (area: string): AreaSlide => ({
  area,
  intro: [`Now playing: ${area.toLowerCase()}\u2026`],
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

interface Audit3000AreaPaneProps {
  checks: AuditCheck[];
  reportPath: string;
}

const Audit3000AreaPaneImpl = ({
  checks,
  reportPath,
}: Audit3000AreaPaneProps) => {
  const pendingChecks = checks.filter((c) => c.status === 'pending');
  const activeArea = pendingChecks[0]?.area;
  const slide = activeArea
    ? AUDIT_3000_AREA_SLIDES.find((s) => s.area === activeArea) ??
      fallbackSlide(activeArea)
    : null;

  const levelIndex = activeArea
    ? AUDIT_3000_AREA_SLIDES.findIndex((s) => s.area === activeArea)
    : -1;
  const level = levelIndex >= 0 ? levelIndex + 1 : null;

  useInput((input) => {
    if (input.toLowerCase() === 'o' && slide?.docsUrl) {
      openLink(slide.docsUrl);
    }
  });

  if (slide) {
    const hasFindings = checks.some(isFinding);
    // "First level, no check resolved yet" = we're at the very start of the run.
    // Show the orientation preamble above the slide content until something happens.
    const showPreamble =
      level === 1 && checks.every((c) => c.status === 'pending');
    return (
      <ActiveSlide
        slide={slide}
        level={level}
        hasFindings={hasFindings}
        showPreamble={showPreamble}
      />
    );
  }

  if (checks.length === 0) {
    return null;
  }

  return <WritingReport reportPath={reportPath} />;
};

const OrientationPreamble = () => (
  <Box
    flexDirection="column"
    borderStyle="single"
    borderColor={Colors.accent}
    paddingX={1}
    marginBottom={1}
  >
    <Text bold color={Colors.accent}>
      {'\u25B6'} What's happening
    </Text>
    <Box height={1} />
    <Text>
      We're running <Text bold>34 checks across 9 levels</Text> on your PostHog
      integration. Each level explains what it's looking at here on the left as
      it starts. The whole audit takes about <Text bold>5-7 minutes</Text>.
    </Text>
    <Box height={1} />
    <Text>
      The final output is a <Text bold>notebook inside your PostHog</Text>{' '}
      project (we'll print the direct link at the end) — nothing in your
      codebase is modified.
    </Text>
    <Box height={1} />
    <Text dimColor>
      Use <Text color={Colors.accent}>{'\u2190 \u2192'}</Text> to switch tabs:
      Hi-score Table (live report), Play (a game), HN, or Tail logs. Or just
      leave it running and come back.
    </Text>
  </Box>
);

const ActiveSlide = ({
  slide,
  level,
  hasFindings,
  showPreamble,
}: {
  slide: AreaSlide;
  level: number | null;
  hasFindings: boolean;
  showPreamble: boolean;
}) => (
  <Box flexDirection="column" paddingX={1}>
    {showPreamble && <OrientationPreamble />}
    <Text bold color={Colors.accent}>
      {level ? `LEVEL ${level}: ` : ''}
      {slide.area.toUpperCase()}
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
            {slide.docsUrl && '  '}[
            <Text color={Colors.accent}>{'\u2192'}</Text>] View issues
          </>
        )}
      </Text>
    </Box>
  </Box>
);

const WritingReport = ({ reportPath: _reportPath }: { reportPath: string }) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      STAGE CLEAR.
    </Text>
    <Box height={1} />
    <Text>
      All checks resolved. Writing your audit notebook into your PostHog project
      now.
    </Text>
    <Box height={1} />
    <Text>
      The notebook covers everything we checked, what we found, and what to do
      next. We'll print the link when it's done.
    </Text>
    <Box height={1} />
    <Text dimColor>{'Stand by\u2026'}</Text>
  </Box>
);

/**
 * Memo'd to skip re-renders when neither `checks` nor `reportPath` changed.
 * Pairs with the same memo on `Audit3000ChecksPanel` to cut flicker from
 * unrelated store updates (status messages, polling ticks). Audit-3000 only.
 */
export const Audit3000AreaPane = memo(
  Audit3000AreaPaneImpl,
  (prev, next) =>
    prev.checks === next.checks && prev.reportPath === next.reportPath,
);
