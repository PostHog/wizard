import * as path from 'path';
import type { AuditCheck } from '@lib/programs/audit/types';
import { OutroKind, type OutroData } from '@lib/wizard-session';
import { DISABLING_AREAS } from './classify.js';
import { CULLED_MARKER, DECLINED_MARKER } from './seed.js';

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
  const failed = input.checks.filter((check) => check.status === 'error');
  const leftForYou = input.checks.filter((check) =>
    (check.details ?? '').includes(DECLINED_MARKER),
  ).length;
  const undoItems: string[] = [];
  if (input.touchedFiles.length > 0) {
    undoItems.push(
      `Code: git checkout -- ${input.touchedFiles.join(
        ' ',
      )} (or git diff to review first). The tree was clean when this run started, so every change git diff shows is the wizard's. Each flag was its own unit: a failed row left its flag untouched, and earlier culls stand.`,
    );
  }
  const disabledCount = culled.filter(
    (check) =>
      DISABLING_AREAS.has(check.area) && input.flagIdByKey.has(check.id),
  ).length;
  if (disabledCount > 0) {
    undoItems.push(
      `PostHog: ${disabledCount} flag${
        disabledCount === 1 ? '' : 's'
      } disabled, never deleted; one toggle each to re-enable. Disabling kept the flag's rollout conditions, variants, and payloads, so re-enabling restores exactly what was there. The report links every flag page.`,
    );
  }
  const reportPath = path.join(input.installDir, input.reportFile);
  const message =
    culled.length === 0
      ? `Nothing was changed. The report at ${reportPath} lists what you can cull by hand.`
      : `Culled ${culled.length} feature flag${
          culled.length === 1 ? '' : 's'
        }.${failed.length > 0 ? ` ${failed.length} failed.` : ''}${
          leftForYou > 0 ? ` ${leftForYou} left for you.` : ''
        } Flags were disabled, never deleted. Report: ${reportPath}`;
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
