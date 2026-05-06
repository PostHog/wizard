/**
 * AuditAreaPane — left-pane content that follows the agent's progress.
 *
 * Five states, gated top-down on the ledger + latest status string:
 *   1. a basic area has a pending check → render that area's slide
 *      (Installation / Identification / Event Capture)
 *   2. ledger empty                     → blank (defensive — the seed
 *                                          hook fires synchronously)
 *   3. status indicates report writing  → "wrapped up" wrap-up
 *   4. discoverable areas exist in
 *      the ledger                       → "running expert subagents in
 *                                          parallel: <list>" (variant B)
 *   5. otherwise (basic resolved, no
 *      discoverable areas yet)          → "essentials checked, dispatching
 *                                          experts" (variant A)
 *
 * The discovery / second-wave dispatch can leave the ledger fully resolved
 * for several seconds while the dispatch agent decides what comes next.
 * Variants A and B fill that window with truthful messaging until either
 * new pending checks arrive or the report-writing status fires.
 *
 * Pressing `O` opens the active basic-area slide's docs URL.
 */

import { Fragment } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { Colors } from '../../styles.js';
import { type AuditCheck } from '../../../../lib/workflows/audit/types.js';
import { AUDIT_CORE_CHECKS } from '../../../../lib/workflows/audit/seed.js';
import { AUDIT_SPECIALISTS } from '../../../../lib/workflows/audit/specialists.js';
import { AUDIT_AREA_SLIDES, type AreaSlide } from './slides/index.js';

/**
 * Areas owned by the basic / pre-seeded specialists (Installation,
 * Identification, Event Capture). Anything else is discoverable —
 * second-wave content the runner enrolls mid-run.
 */
const BASIC_AREAS: ReadonlySet<string> = new Set([
  ...AUDIT_CORE_CHECKS.map((c) => c.area),
  ...AUDIT_SPECIALISTS.map((s) => s.area),
]);

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
  /** Latest `[STATUS]` line emitted by the agent, if any. */
  latestStatus?: string;
}

/**
 * Heuristic: does the latest status line indicate the agent has reached
 * the report-writing phase? Matches the canonical `[STATUS] Writing audit
 * report` line emitted from `references/aggregation.md` (and a couple of
 * close paraphrases the model occasionally produces).
 */
function isWritingReportStatus(status: string | undefined): boolean {
  if (!status) return false;
  return /\b(writing|composing|preparing).*(audit )?report\b/i.test(status);
}

export const AuditAreaPane = ({
  checks,
  reportPath,
  latestStatus,
}: AuditAreaPaneProps) => {
  // Pending check that belongs to a basic area. While any of these are
  // pending, the active-area slide takes precedence — discoverable
  // specialists run in parallel after the basic ones finish.
  const basicPending = checks.find(
    (c) => c.status === 'pending' && BASIC_AREAS.has(c.area),
  );
  const activeArea = basicPending?.area;
  const slide = activeArea
    ? AUDIT_AREA_SLIDES.find((s) => s.area === activeArea) ??
      fallbackSlide(activeArea)
    : null;

  useInput((input) => {
    if (input.toLowerCase() === 'o' && slide?.docsUrl) {
      openLink(slide.docsUrl);
    }
  });

  if (slide) {
    const hasFindings = checks.some(isFinding);
    return <ActiveSlide slide={slide} hasFindings={hasFindings} />;
  }

  // Ledger empty — defensive only; the seed hook fires synchronously.
  if (checks.length === 0) {
    return null;
  }

  if (isWritingReportStatus(latestStatus)) {
    return <WritingReport reportPath={reportPath} />;
  }

  // Distinct discoverable areas the runner has enrolled, in first-seen
  // order. Empty until the dispatch agent picks specialists and the
  // runner calls `audit_add_checks`.
  const discoverAreas: string[] = [];
  for (const check of checks) {
    if (!BASIC_AREAS.has(check.area) && !discoverAreas.includes(check.area)) {
      discoverAreas.push(check.area);
    }
  }

  if (discoverAreas.length > 0) {
    return <RunningSubagents areas={discoverAreas} />;
  }
  return <DispatchingSubagents />;
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

const DispatchingSubagents = () => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      Essentials checked
    </Text>
    <Box height={1} />
    <Text>
      We've just checked your integration essentials. We're now going to run
      expert subagents to check your product integration in more detail.
    </Text>
  </Box>
);

const RunningSubagents = ({ areas }: { areas: string[] }) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold color={Colors.accent}>
      Running expert subagents
    </Text>
    <Box height={1} />
    <Text>
      We're running subagents to check against best practices for these products
      in parallel:
    </Text>
    <Box height={1} />
    {areas.map((area) => (
      <Text key={area}>
        <Text dimColor>{'  - '}</Text>
        {area}
      </Text>
    ))}
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
