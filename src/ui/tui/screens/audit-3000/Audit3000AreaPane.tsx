/**
 * Audit-3000 right pane — arcade-flavoured fork of `AuditAreaPane`.
 *
 * Mirrors the audit pane's three-state logic (active slide → empty →
 * wrap-up) but routes through the audit-3000 slide registry and uses
 * "LEVEL N: <area>" framing instead of "Verifying ...".
 */

import { Fragment } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { Colors } from '../../styles.js';
import { type AuditCheck } from '../../../../lib/programs/audit/types.js';
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

export const Audit3000AreaPane = ({
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
    return (
      <ActiveSlide slide={slide} level={level} hasFindings={hasFindings} />
    );
  }

  if (checks.length === 0) {
    return null;
  }

  return <WritingReport reportPath={reportPath} />;
};

const ActiveSlide = ({
  slide,
  level,
  hasFindings,
}: {
  slide: AreaSlide;
  level: number | null;
  hasFindings: boolean;
}) => (
  <Box flexDirection="column" paddingX={1}>
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

const WritingReport = ({ reportPath }: { reportPath: string }) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      STAGE CLEAR.
    </Text>
    <Box height={1} />
    <Text>
      All checks resolved. Compiling your high-score reel at{' '}
      <Text color="cyan">{reportPath}</Text>.
    </Text>
    <Box height={1} />
    <Text>
      The report covers everything we checked, what we found, and what to do
      next.
    </Text>
    <Box height={1} />
    <Text dimColor>{'Stand by\u2026'}</Text>
  </Box>
);
