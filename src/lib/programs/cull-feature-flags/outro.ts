import * as path from 'path';
import type { AuditCheck } from '@lib/programs/audit/types';
import { OutroKind, type OutroData } from '@lib/wizard-session';
import { CULLED_MARKER } from './seed.js';

export interface CullOutroInput {
  checks: readonly AuditCheck[];
  touchedFiles: readonly string[];
  flagIdByKey: ReadonlyMap<string, number>;
  installDir: string;
  reportFile: string;
  docsUrl: string;
}

/** Outro that carries the undo recipe: the git revert for code, the flag page for PostHog. */
export function buildCullOutro(input: CullOutroInput): OutroData {
  const culled = input.checks.filter(
    (check) =>
      check.status === 'pass' && (check.details ?? '').includes(CULLED_MARKER),
  );
  const undoItems: string[] = [];
  if (input.touchedFiles.length > 0) {
    undoItems.push(
      `Code: git checkout -- ${input.touchedFiles.join(
        ' ',
      )} (or git diff to review first)`,
    );
  }
  const disabledCount = culled.filter((check) =>
    input.flagIdByKey.has(check.id),
  ).length;
  if (disabledCount > 0) {
    undoItems.push(
      `PostHog: ${disabledCount} flag${
        disabledCount === 1 ? '' : 's'
      } disabled, one toggle each to re-enable; the report links every flag page.`,
    );
  }
  const reportPath = path.join(input.installDir, input.reportFile);
  const message =
    culled.length === 0
      ? `Nothing was changed. The report at ${reportPath} lists what you can cull by hand.`
      : `Culled ${culled.length} feature flag${
          culled.length === 1 ? '' : 's'
        }. Flags were disabled, never deleted. Report: ${reportPath}`;
  return {
    kind: OutroKind.Success,
    message,
    reportFile: input.reportFile,
    docsUrl: input.docsUrl,
    changes: culled.map((check) => check.label),
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
