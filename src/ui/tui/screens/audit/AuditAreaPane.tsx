/**
 * AuditAreaPane — left-pane slide for whatever area the agent is currently
 * checking. Active area = the area of the first pending check.
 */

import { Fragment } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { Colors } from '../../styles.js';
import { type AuditCheck } from '../../../../lib/workflows/audit/types.js';
import { AUDIT_AREA_SLIDES, type AreaSlide } from './slides/index.js';

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

interface AuditAreaPaneProps {
  checks: AuditCheck[];
  reportPath: string;
}

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

export const AuditAreaPane = ({ checks, reportPath }: AuditAreaPaneProps) => {
  const firstPending = checks.find((c) => c.status === 'pending');
  const activeArea = firstPending?.area;
  const slide = activeArea
    ? AUDIT_AREA_SLIDES.find((s) => s.area === activeArea) ??
      fallbackSlide(activeArea)
    : null;

  useInput((input) => {
    if (input.toLowerCase() === 'o' && slide?.docsUrl) {
      openLink(slide.docsUrl);
    }
  });

  if (!slide) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={Colors.accent}>
          We've wrapped up the review.
        </Text>
        <Box height={1} />
        <Text>
          To help you get the most out of your PostHog integration, we're
          preparing a report for you at <Text color="cyan">{reportPath}</Text>.
        </Text>
        <Box height={1} />
        <Text>
          We'll cover what we checked and suggest where we can improve the
          existing integration.
        </Text>
        <Box height={1} />
        <Text dimColor>Hang tight!</Text>
      </Box>
    );
  }

  const hasFindings = checks.some(isFinding);

  return (
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
};
