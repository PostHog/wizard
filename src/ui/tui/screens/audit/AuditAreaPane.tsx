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

import { Fragment, useEffect, useRef, useState } from 'react';
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

// ── Deck walk ────────────────────────────────────────────────────────

/** Minimum time a card stays up before the walk may advance past it. */
export const DECK_MIN_DWELL_MS = 12_000;

/** Deck index the walk heads toward: `slides.length` = run finished,
 * `-1` = head area has no slide (caller shows a fallback card). */
export function deckTargetIndex(
  slides: AreaSlide[],
  checks: AuditCheck[],
): number {
  const headArea = checks.find((c) => c.status === 'pending')?.area;
  if (headArea === undefined) return slides.length;
  return slides.findIndex((s) => s.area === headArea);
}

/** One walk step: advance one card toward the target, snap backward. */
export function nextDeckIndex(displayed: number, target: number): number {
  if (target < 0) return displayed;
  if (target < displayed) return target;
  if (target > displayed) return displayed + 1;
  return displayed;
}

// ── Component ────────────────────────────────────────────────────────

interface AuditAreaPaneProps {
  checks: AuditCheck[];
  reportPath: string;
  /** Slide registry to look the active area up in. Defaults to the doctor
   * (`audit` program) slides; events-audit passes its own 6-phase set. */
  slides?: AreaSlide[];
  /** Dashboard URL once the agent emits `[DASHBOARD_URL]`. Shown as a sticky
   * footer so the user can grab the link while later phases still run. */
  dashboardUrl?: string | null;
  /** Notebook URL once the agent emits `[NOTEBOOK_URL]`. Same sticky-footer
   * treatment as the dashboard URL. */
  notebookUrl?: string | null;
}

export const AuditAreaPane = ({
  checks,
  reportPath,
  slides = AUDIT_AREA_SLIDES,
  dashboardUrl,
  notebookUrl,
}: AuditAreaPaneProps) => {
  const activeArea = checks.find((c) => c.status === 'pending')?.area;
  const target = deckTargetIndex(slides, checks);

  const [displayedIdx, setDisplayedIdx] = useState(0);
  const lastAdvanceRef = useRef(Date.now());

  // Snap backward immediately; walk forward one card per dwell.
  useEffect(() => {
    if (target >= 0 && target < displayedIdx) {
      lastAdvanceRef.current = Date.now();
      setDisplayedIdx(target);
      return;
    }
    if (target <= displayedIdx) return;
    const timer = setInterval(() => {
      if (Date.now() - lastAdvanceRef.current < DECK_MIN_DWELL_MS) return;
      lastAdvanceRef.current = Date.now();
      setDisplayedIdx((i) => nextDeckIndex(i, target));
    }, 1000);
    return () => clearInterval(timer);
  }, [target, displayedIdx]);

  const slide =
    target === -1 && activeArea !== undefined
      ? fallbackSlide(activeArea)
      : displayedIdx < slides.length
      ? slides[displayedIdx]
      : null;

  useInput((input) => {
    if (input.toLowerCase() === 'o' && slide?.docsUrl) {
      openLink(slide.docsUrl);
    }
  });

  const urlsFooter =
    dashboardUrl || notebookUrl ? (
      <UrlsFooter dashboardUrl={dashboardUrl} notebookUrl={notebookUrl} />
    ) : null;

  // Ledger empty — PendingChecksList owns the loading state.
  if (checks.length === 0) {
    return null;
  }

  if (slide) {
    const hasFindings = checks.some(isFinding);
    return (
      <Box flexDirection="column">
        <ActiveSlide slide={slide} hasFindings={hasFindings} />
        {urlsFooter}
      </Box>
    );
  }

  // Deck played out and every check resolved — report is being written.
  return (
    <Box flexDirection="column">
      <WritingReport reportPath={reportPath} />
      {urlsFooter}
    </Box>
  );
};

// ── States ───────────────────────────────────────────────────────────

const ActiveSlide = ({
  slide,
  hasFindings,
}: {
  slide: AreaSlide;
  hasFindings: boolean;
}) => (
  <Box flexDirection="column" paddingX={1} flexShrink={0}>
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

const UrlsFooter = ({
  dashboardUrl,
  notebookUrl,
}: {
  dashboardUrl?: string | null;
  notebookUrl?: string | null;
}) => (
  <Box flexDirection="column" paddingX={1} marginTop={1}>
    <Text dimColor>{'─'.repeat(40)}</Text>
    {dashboardUrl && (
      <Text>
        Dashboard: <Text color="cyan">{dashboardUrl}</Text>
      </Text>
    )}
    {notebookUrl && (
      <Text>
        Notebook: <Text color="cyan">{notebookUrl}</Text>
      </Text>
    )}
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
