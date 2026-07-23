/**
 * Pure planner for the settings-conflict step of the runner bootstrap.
 *
 * Takes the conflicts reported by {@link checkAllSettingsConflicts} and
 * returns the log lines, analytics events, and decisions the executor must
 * perform — without performing any of them. The runner's
 * `bootstrapProgram` is the imperative shell that runs side effects against
 * this plan; everything routing-related (managed→org analytics, warn-only
 * neutralization, fail-closed selection, auto-fix scheduling) is decided here
 * and unit-tested in isolation.
 *
 * Issue: https://github.com/PostHog/wizard/issues/756
 *
 * Behavior parity contract: the produced action sequence is the exact set of
 * `logToFile` / `analytics.wizardCapture` calls (in order) the inline
 * orchestration used to make, plus the auto-fix decision and the final
 * `unfixable` list. Changing this changes wizard analytics — keep it
 * behavior-preserving unless the issue asks otherwise.
 */

import {
  classifySettingsConflicts,
  type SettingsConflict,
} from './claude-settings';

/** A single side-effect the executor must perform. */
export type PlannerAction =
  | { kind: 'log'; message: string }
  | {
      kind: 'analytics';
      event: string;
      props: Record<string, unknown>;
    };

/**
 * Output of {@link planSettingsConflictActions}. The executor runs `pre`
 * unconditionally, then — if `autoFix` is non-null — performs the imperative
 * `backupAndFixClaudeSettings` call and feeds the boolean result back through
 * {@link planAutoFixOutcome} to obtain the trailing actions + final unfixable
 * list. `failClosed` and `autoFixCandidates` are exposed for the outcome
 * helper; the executor does not need to read them directly.
 */
export interface SettingsConflictPlan {
  pre: PlannerAction[];
  autoFix: { keys: string[] } | null;
  failClosed: SettingsConflict[];
  autoFixCandidates: SettingsConflict[];
}

/** Result of merging the auto-fix outcome back into the plan. */
export interface AutoFixOutcome {
  actions: PlannerAction[];
  unfixable: SettingsConflict[];
}

function describeConflict(c: SettingsConflict): string {
  return `${c.source}(${c.keys.join(',')})`;
}

function analyticsLevelFor(source: SettingsConflict['source']): string {
  // Managed settings are surfaced to analytics as "org" — they are deployed by
  // IT/MDM, and "org" reads more naturally than "managed" in dashboards.
  return source === 'managed' ? 'org' : source;
}

/**
 * Build the pure plan for the conflicts reported during bootstrap. Pure: no
 * file I/O, no analytics, no logging. Safe to call in tests without mocks.
 */
export function planSettingsConflictActions(
  conflicts: SettingsConflict[],
): SettingsConflictPlan {
  const summary =
    conflicts.length > 0 ? conflicts.map(describeConflict).join('; ') : 'none';
  const pre: PlannerAction[] = [
    { kind: 'log', message: `[agent-runner] settings conflicts: ${summary}` },
  ];

  if (conflicts.length === 0) {
    return {
      pre,
      autoFix: null,
      failClosed: [],
      autoFixCandidates: [],
    };
  }

  for (const conflict of conflicts) {
    pre.push({
      kind: 'analytics',
      event: 'settings conflict detected',
      props: {
        level: analyticsLevelFor(conflict.source),
        keys: conflict.keys,
      },
    });
  }

  const { autoFix, failClosed, warnOnly } =
    classifySettingsConflicts(conflicts);

  for (const conflict of warnOnly) {
    pre.push({
      kind: 'log',
      message:
        `[agent-runner] settings conflict in ${conflict.source} (${conflict.path}) ` +
        `neutralized by settingSources:['project'] — not blocking`,
    });
    pre.push({
      kind: 'analytics',
      event: 'settings conflict neutralized',
      props: { level: conflict.source, keys: conflict.keys },
    });
  }

  return {
    pre,
    autoFix:
      autoFix.length > 0 ? { keys: autoFix.flatMap((c) => c.keys) } : null,
    failClosed,
    autoFixCandidates: autoFix,
  };
}

/**
 * Merge the boolean result of `backupAndFixClaudeSettings` back into the plan.
 * On success the writable files are gone and only `failClosed` remains
 * unfixable; on failure the auto-fix candidates fall back to unfixable so the
 * settings-override screen names every file the user must still act on.
 *
 * When the plan never scheduled auto-fix, returns an empty action list and the
 * fail-closed conflicts verbatim — the `didFix` argument is then a no-op.
 */
export function planAutoFixOutcome(
  plan: SettingsConflictPlan,
  didFix: boolean,
): AutoFixOutcome {
  if (plan.autoFix === null) {
    return { actions: [], unfixable: plan.failClosed };
  }

  if (didFix) {
    return {
      actions: [
        {
          kind: 'log',
          message: '[agent-runner] auto-neutralized writable settings conflict',
        },
        {
          kind: 'analytics',
          event: 'settings conflict auto-neutralized',
          props: { keys: plan.autoFix.keys },
        },
      ],
      unfixable: plan.failClosed,
    };
  }

  return {
    actions: [
      {
        kind: 'log',
        message:
          '[agent-runner] could not back up writable settings conflict — failing closed',
      },
    ],
    unfixable: [...plan.failClosed, ...plan.autoFixCandidates],
  };
}
