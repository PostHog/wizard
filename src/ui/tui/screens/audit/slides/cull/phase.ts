import type { AuditCheck } from '@lib/programs/audit/types';
import type { CullProgress } from '@lib/programs/cull-feature-flags/phase';
import { DISABLING_AREAS } from '@lib/programs/cull-feature-flags/classify';
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

const MARKER_PREFIXES = [
  'also ',
  'winning branch:',
  'kept:',
  'culled',
  'failed:',
  'declined by user',
];

function whyCulled(check: AuditCheck): string {
  const clauses = (check.details ?? '')
    .split(';')
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .filter(
      (clause) => !MARKER_PREFIXES.some((prefix) => clause.startsWith(prefix)),
    );
  const branch = (check.details ?? '').includes('winning branch: false')
    ? 'Keeps the off branch and drops the check.'
    : (check.details ?? '').includes('winning branch: true')
    ? 'Keeps the code that runs today and drops the check.'
    : '';
  const posthog = DISABLING_AREAS.has(check.area)
    ? 'Then the flag is disabled in PostHog, never deleted.'
    : 'PostHog is left untouched for this one.';
  return [`Why: ${check.area}, ${clauses.join(', ')}.`, branch, posthog]
    .filter((sentence) => sentence.length > 0)
    .join(' ');
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
  if (activeCheck) paragraphs.push(whyCulled(activeCheck));
  if (completedCounts.length > 0) {
    paragraphs.push(`${completedCounts.join(', ')} so far.`);
  }
  paragraphs.push(CULL_SAFETY_COPY);

  return { title: titleByPass[progress.pass], paragraphs, isWorking: true };
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
        title: 'Your pick list is on its way',
        paragraphs: [
          `Every flag is verified at its call site. ${proposals.length} look done and are up for culling; the healthy ones stay.`,
          'The agent is writing the prompt now, one question per group with the plan for each flag. It opens here when ready, usually within a minute or two.',
          'Nothing changes until you confirm in that prompt. Each pick gets its check removed from code and the flag disabled in PostHog, never deleted.',
        ],
        isWorking: true,
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
