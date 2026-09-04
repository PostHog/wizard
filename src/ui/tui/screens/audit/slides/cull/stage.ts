import type { AuditCheck } from '@lib/programs/audit/types';
import type { WrapUpCopy } from '../../AuditAreaPane.js';

const APPLIED_MARKER = '; applied';
const DECLINED_MARKER = '; declined by user';

/** Left-pane copy for the cull stages after verification: consent, apply, report. */
export function cullStageCopy(
  checks: readonly AuditCheck[],
  reportPath: string,
): WrapUpCopy | undefined {
  if (checks.some((check) => check.status === 'pending')) return undefined;
  const proposed = checks.filter((check) => check.status === 'warning');
  const applied = checks.filter(
    (check) =>
      check.status === 'pass' && (check.details ?? '').includes(APPLIED_MARKER),
  );
  const declined = checks.filter(
    (check) =>
      check.status === 'pass' &&
      (check.details ?? '').includes(DECLINED_MARKER),
  );
  const failed = checks.filter((check) => check.status === 'error');
  const isDecided = applied.length + declined.length + failed.length > 0;

  if (proposed.length > 0 && !isDecided) {
    return {
      title: 'Waiting for your pick',
      paragraphs: [
        `Every flag is verified at its call site. ${proposed.length} look done and are up for culling; the healthy ones stay.`,
        'Nothing changes until you confirm in the prompt. Each pick gets its check removed from code and the flag disabled in PostHog, never deleted.',
      ],
    };
  }
  if (proposed.length > 0) {
    return {
      title: `Culling ${proposed.length} more`,
      paragraphs: [
        `${applied.length} done so far${
          failed.length > 0 ? `, ${failed.length} failed` : ''
        }. Code edit first, then the PostHog disable, one flag at a time.`,
        'Every edit is an ordinary git diff; every disabled flag is one toggle from back on.',
      ],
    };
  }
  return {
    title: 'Writing the cull report',
    paragraphs: [
      `${applied.length} culled, ${declined.length} left for you, ${failed.length} failed. The report at ${reportPath} lists all of them with the undo recipe.`,
      'Hang tight!',
    ],
  };
}
