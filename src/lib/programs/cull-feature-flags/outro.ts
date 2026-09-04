import type { AuditCheck } from '@lib/programs/audit/types';
import { OutroKind, type OutroData } from '@lib/wizard-session';
import { APPLIED_MARKER } from './seed.js';

export interface CullOutroInput {
  checks: readonly AuditCheck[];
  touchedFiles: readonly string[];
  flagIdByKey: ReadonlyMap<string, number>;
  reportFile: string;
  docsUrl: string;
}

/** Outro that carries the undo recipe: the git revert for code, the flag page for PostHog. */
export function buildCullOutro(input: CullOutroInput): OutroData {
  const applied = input.checks.filter(
    (check) =>
      check.status === 'pass' && (check.details ?? '').includes(APPLIED_MARKER),
  );
  const undoItems: string[] = [];
  if (input.touchedFiles.length > 0) {
    undoItems.push(
      `Code: git checkout -- ${input.touchedFiles.join(
        ' ',
      )} (or git diff to review first)`,
    );
  }
  const disabledCount = applied.filter((check) =>
    input.flagIdByKey.has(check.id),
  ).length;
  if (disabledCount > 0) {
    undoItems.push(
      `PostHog: ${disabledCount} flag${
        disabledCount === 1 ? '' : 's'
      } disabled, one toggle each to re-enable; the report links every flag page.`,
    );
  }
  const message =
    applied.length === 0
      ? 'Nothing was changed. The report lists what you can cull by hand.'
      : `Culled ${applied.length} feature flag${
          applied.length === 1 ? '' : 's'
        }. Flags were disabled, never deleted.`;
  return {
    kind: OutroKind.Success,
    message,
    reportFile: input.reportFile,
    docsUrl: input.docsUrl,
    changes: applied.map((check) => check.label),
    ...(undoItems.length > 0
      ? {
          nextSteps: {
            heading: 'Undo, if you want it back:',
            items: undoItems,
          },
        }
      : {}),
  };
}
