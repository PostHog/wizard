import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AuditCheck } from '@lib/programs/audit/types';
import {
  INITIAL_CULL_PROGRESS,
  reduceCullProgress,
} from '@lib/programs/cull-feature-flags/phase';
import { SplitView } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import { AuditAreaPane } from '@ui/tui/screens/audit/AuditAreaPane';
import {
  CullFlagList,
  PhaseStepper,
} from '@ui/tui/screens/audit/cull/CullFlagList';
import { CULL_AREA_SLIDES } from '@ui/tui/screens/audit/slides/cull';
import {
  cullPhase,
  type CullPhase,
} from '@ui/tui/screens/audit/slides/cull/phase';

const REPORT_PATH = './posthog-feature-flag-cull-report.md';
const PHASES: CullPhase[] = ['verify', 'pick', 'cull', 'report'];
const MOCK_STATUS_SCRIPT = [
  'Culling legacy-banner',
  'Editing src/dashboard.tsx',
  'Culling old-pricing-test',
  'Type checking 2 files',
  'Disabling legacy-banner in PostHog',
];

const STALE_FLAGS: AuditCheck[] = [
  {
    id: 'new-checkout',
    area: 'Rolled out',
    label: 'new-checkout: keep on path, drop check, disable flag',
    status: 'pending',
    details: 'rollout 100%',
  },
  {
    id: 'beta-dashboard',
    area: 'Off for everyone',
    label: 'beta-dashboard: keep off path, drop check, disable flag',
    status: 'pending',
    details: 'rollout 0%',
  },
  {
    id: 'legacy-banner',
    area: 'Archived in PostHog',
    label: 'legacy-banner: keep off path, drop check',
    status: 'pending',
    details: 'rollout 100%, archived',
  },
  {
    id: 'old-pricing-test',
    area: 'Disabled in PostHog',
    label: 'old-pricing-test: keep off path, drop check',
    status: 'pending',
    details: 'rollout 50%, inactive',
  },
  {
    id: 'pricing-v2-experiment',
    area: 'Unreferenced',
    label: 'pricing-v2-experiment: disable flag',
    status: 'pending',
    details: 'rollout 30%',
  },
  {
    id: 'holiday-promo',
    area: 'Comment only',
    label: 'holiday-promo: disable flag, drop comment',
    status: 'pending',
    details: 'rollout 100%',
  },
  {
    id: 'legacy-theme',
    area: 'Dead code',
    label: 'legacy-theme: delete dead module, disable flag',
    status: 'pending',
    details: 'rollout 100%',
  },
  {
    id: 'server-rate-limit',
    area: 'Deleted in PostHog',
    label: 'server-rate-limit: keep off path, drop check',
    status: 'pending',
    details: 'no flag with this key in PostHog',
  },
];

const SMALL_LEDGER: AuditCheck[] = [
  ...STALE_FLAGS,
  {
    id: 'ai-assistant',
    area: 'Many call sites',
    label: 'ai-assistant: suggest one wrapper hook',
    status: 'suggestion',
    details: 'rollout 40%; also src/chat.ts:12, src/nav.ts:8',
  },
  ...Array.from(
    { length: 10 },
    (_, index): AuditCheck => ({
      id: `healthy-flag-${String(index + 1).padStart(2, '0')}`,
      area: 'Healthy',
      label: `healthy-flag-${index + 1}: keep`,
      status: 'pass',
      details: `rollout ${20 + index * 5}%`,
    }),
  ),
];

function generatedLedger(): AuditCheck[] {
  return Array.from({ length: 400 }, (_, index) => {
    const template = SMALL_LEDGER[index % SMALL_LEDGER.length];
    return {
      ...template,
      id: `${template.id}-${String(index + 1).padStart(3, '0')}`,
      label: `${template.label} ${index + 1}`,
    };
  });
}

function appendDetail(details: string | undefined, detail: string): string {
  if (!details) return detail;
  return `${details}; ${detail}`;
}

function ledgerForPhase(
  sourceChecks: readonly AuditCheck[],
  phase: CullPhase,
): AuditCheck[] {
  let staleIndex = 0;
  return sourceChecks.map((check) => {
    if (check.area === 'Healthy' || check.area === 'Many call sites') {
      return { ...check };
    }
    const currentStaleIndex = staleIndex;
    staleIndex += 1;
    if (phase === 'verify') return { ...check, status: 'pending' };
    if (phase === 'pick') {
      if (currentStaleIndex % 8 === 0) {
        return {
          ...check,
          status: 'pass',
          details: appendDetail(check.details, 'kept: rollback switch'),
        };
      }
      return { ...check, status: 'warning' };
    }
    if (phase === 'cull') {
      if (currentStaleIndex % 8 === 0) {
        return {
          ...check,
          status: 'pass',
          details: appendDetail(check.details, 'culled'),
        };
      }
      if (currentStaleIndex % 8 === 1) {
        return {
          ...check,
          status: 'pass',
          details: appendDetail(check.details, 'declined by user'),
        };
      }
      return { ...check, status: 'warning' };
    }
    if (currentStaleIndex % 8 < 5) {
      return {
        ...check,
        status: 'pass',
        details: appendDetail(check.details, 'culled'),
      };
    }
    if (currentStaleIndex % 8 === 6) {
      return {
        ...check,
        status: 'error',
        details: appendDetail(check.details, 'failed: type check failed'),
      };
    }
    return {
      ...check,
      status: 'pass',
      details: appendDetail(check.details, 'declined by user'),
    };
  });
}

export const CullRunDemo = () => {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [progress, setProgress] = useState(INITIAL_CULL_PROGRESS);
  const [statusIndex, setStatusIndex] = useState(0);
  const [isLargeLedger, setIsLargeLedger] = useState(false);
  const selectedPhase = PHASES[phaseIndex];
  const checks = useMemo(() => {
    const sourceChecks = isLargeLedger ? generatedLedger() : SMALL_LEDGER;
    return ledgerForPhase(sourceChecks, selectedPhase);
  }, [isLargeLedger, selectedPhase]);
  const { phase, copy } = cullPhase(checks, progress, REPORT_PATH);

  const resetProgress = () => {
    setProgress(INITIAL_CULL_PROGRESS);
    setStatusIndex(0);
  };

  useInput((input) => {
    if (input === 'n') {
      setPhaseIndex((current) => Math.min(PHASES.length - 1, current + 1));
      resetProgress();
      return;
    }
    if (input === 'p') {
      setPhaseIndex((current) => Math.max(0, current - 1));
      resetProgress();
      return;
    }
    if (input === 's') {
      const status = MOCK_STATUS_SCRIPT[statusIndex];
      setProgress((current) => reduceCullProgress(current, status));
      setStatusIndex((current) => (current + 1) % MOCK_STATUS_SCRIPT.length);
      return;
    }
    if (input === 'l') setIsLargeLedger((current) => !current);
  });

  const leftPane = (
    <AuditAreaPane
      checks={checks}
      reportPath={REPORT_PATH}
      slides={CULL_AREA_SLIDES}
      wrapUp={copy}
    />
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <PhaseStepper phase={phase} />
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <SplitView
          left={leftPane}
          right={
            <CullFlagList checks={checks} progress={progress} phase={phase} />
          }
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          <Text color={Colors.accent}>n/p</Text> phase ·{' '}
          <Text color={Colors.accent}>s</Text> status ·{' '}
          <Text color={Colors.accent}>l</Text> ledger ({checks.length})
        </Text>
      </Box>
    </Box>
  );
};
