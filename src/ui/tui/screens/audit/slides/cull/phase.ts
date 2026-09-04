import type { AuditCheck } from '@lib/programs/audit/types';
import type { CullProgress } from '@lib/programs/cull-feature-flags/phase';
import {
  CULLED_MARKER,
  DECLINED_MARKER,
} from '@lib/programs/cull-feature-flags/seed';
import type { WrapUpCopy } from '../../AuditAreaPane.js';

export {
  INITIAL_CULL_PROGRESS,
  reduceCullProgress,
  type CullProgress,
} from '@lib/programs/cull-feature-flags/phase';

const CULL_SAFETY_COPY =
  'Code first, then a type check, then PostHog: a failed edit never leaves a disabled flag behind live code.';

export type CullPhase = 'verify' | 'pick' | 'cull' | 'report';

function hasMarker(check: AuditCheck, marker: string): boolean {
  return (check.details ?? '').includes(marker);
}

function buildCullCopy(
  checks: readonly AuditCheck[],
  progress: CullProgress,
  proposals: readonly AuditCheck[],
  culled: readonly AuditCheck[],
  failed: readonly AuditCheck[],
): WrapUpCopy {
  const titleByPass: Record<CullProgress['pass'], string> = {
    idle: 'Culling',
    edit: 'Editing code',
    verify: 'Checking the edits',
    disable: 'Disabling flags in PostHog',
  };
  const activeCheck = checks.find((check) => check.id === progress.activeKey);
  const approvedCount = proposals.length + culled.length + failed.length;
  const activeFile = progress.activeFile ?? activeCheck?.file;
  const firstParagraph = activeCheck
    ? `Culling ${activeCheck.id}${activeFile ? ` in ${activeFile}` : ''}.`
    : `Culling ${approvedCount} ${approvedCount === 1 ? 'flag' : 'flags'}.`;
  const completedCounts = [
    culled.length > 0 ? `${culled.length} culled` : null,
    failed.length > 0 ? `${failed.length} failed` : null,
  ].filter((count): count is string => count !== null);
  const paragraphs = [firstParagraph];
  if (completedCounts.length > 0) {
    paragraphs.push(`${completedCounts.join(', ')} so far.`);
  }
  paragraphs.push(CULL_SAFETY_COPY);

  return { title: titleByPass[progress.pass], paragraphs };
}

export function cullPhase(
  checks: readonly AuditCheck[],
  progress: CullProgress,
  reportPath: string,
): { phase: CullPhase; copy: WrapUpCopy | undefined } {
  if (checks.some((check) => check.status === 'pending')) {
    return { phase: 'verify', copy: undefined };
  }

  const proposals = checks.filter(
    (check) => check.status === 'warning' && check.area !== 'Many call sites',
  );
  const culled = checks.filter((check) => hasMarker(check, CULLED_MARKER));
  const declined = checks.filter((check) => hasMarker(check, DECLINED_MARKER));
  const failed = checks.filter((check) => check.status === 'error');
  const hasDecisions = culled.length + declined.length + failed.length > 0;

  if (proposals.length > 0 && progress.pass === 'idle' && !hasDecisions) {
    return {
      phase: 'pick',
      copy: {
        title: 'Waiting for your pick',
        paragraphs: [
          `Every flag is verified at its call site. ${proposals.length} look done and are up for culling; the healthy ones stay.`,
          'Nothing changes until you confirm in the prompt. Each pick gets its check removed from code and the flag disabled in PostHog, never deleted.',
        ],
      },
    };
  }

  if (proposals.length > 0) {
    return {
      phase: 'cull',
      copy: buildCullCopy(checks, progress, proposals, culled, failed),
    };
  }

  if (culled.length === 0 && declined.length > 0) {
    return {
      phase: 'report',
      copy: {
        title: 'Report only. Nothing changed.',
        paragraphs: [
          `The report at ${reportPath} lists the ${declined.length} ${
            declined.length === 1 ? 'flag' : 'flags'
          } left for you.`,
        ],
      },
    };
  }

  return {
    phase: 'report',
    copy: {
      title: 'Writing the cull report',
      paragraphs: [
        `${culled.length} culled, ${declined.length} left for you, ${failed.length} failed. The report at ${reportPath} lists all of them with the undo recipe.`,
        'Hang tight!',
      ],
    },
  };
}
