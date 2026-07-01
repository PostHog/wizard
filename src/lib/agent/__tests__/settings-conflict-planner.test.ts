/**
 * Tests for the pure settings-conflict planner. The planner mirrors the
 * orchestration that used to live inline in `runner/shared/bootstrap.ts`:
 * given the conflicts returned by `checkAllSettingsConflicts`, it produces
 * the log lines, analytics events, and decisions the executor must perform —
 * without performing any of them itself. Issue #756.
 */

import type { SettingsConflict } from '@lib/agent/claude-settings';
import {
  planSettingsConflictActions,
  planAutoFixOutcome,
} from '@lib/agent/settings-conflict-planner';

const make = (
  source: SettingsConflict['source'],
  writable: boolean,
  keys: string[] = ['ANTHROPIC_BASE_URL'],
): SettingsConflict => ({
  source,
  path: `/tmp/.claude/${source}.json`,
  keys,
  writable,
});

describe('planSettingsConflictActions', () => {
  it('emits a single "none" log line and no other actions when there are no conflicts', () => {
    const plan = planSettingsConflictActions([]);

    expect(plan.pre).toEqual([
      { kind: 'log', message: '[agent-runner] settings conflicts: none' },
    ]);
    expect(plan.autoFix).toBeNull();
    expect(plan.failClosed).toEqual([]);
    expect(plan.autoFixCandidates).toEqual([]);
  });

  it('summarises every detected conflict in the initial log line with source(keys)', () => {
    const conflicts = [
      make('user', false, ['apiKeyHelper']),
      make('project', true, ['ANTHROPIC_BASE_URL', 'apiKeyHelper']),
    ];

    const plan = planSettingsConflictActions(conflicts);

    expect(plan.pre[0]).toEqual({
      kind: 'log',
      message:
        '[agent-runner] settings conflicts: user(apiKeyHelper); project(ANTHROPIC_BASE_URL,apiKeyHelper)',
    });
  });

  it('emits a "settings conflict detected" analytics event per conflict, remapping managed→org', () => {
    const conflicts = [
      make('managed', false, ['apiKeyHelper']),
      make('user', false, ['ANTHROPIC_BASE_URL']),
      make('project', true, ['apiKeyHelper']),
      make('project-local', false, ['ANTHROPIC_BASE_URL']),
    ];

    const detected = planSettingsConflictActions(conflicts).pre.filter(
      (a) => a.kind === 'analytics' && a.event === 'settings conflict detected',
    );

    expect(detected).toEqual([
      {
        kind: 'analytics',
        event: 'settings conflict detected',
        props: { level: 'org', keys: ['apiKeyHelper'] },
      },
      {
        kind: 'analytics',
        event: 'settings conflict detected',
        props: { level: 'user', keys: ['ANTHROPIC_BASE_URL'] },
      },
      {
        kind: 'analytics',
        event: 'settings conflict detected',
        props: { level: 'project', keys: ['apiKeyHelper'] },
      },
      {
        kind: 'analytics',
        event: 'settings conflict detected',
        props: { level: 'project-local', keys: ['ANTHROPIC_BASE_URL'] },
      },
    ]);
  });

  it('emits a neutralized log + analytics for each warn-only (user/project-local) conflict', () => {
    const userConflict = make('user', false, ['apiKeyHelper']);
    const localConflict = make('project-local', false, ['ANTHROPIC_BASE_URL']);

    const plan = planSettingsConflictActions([userConflict, localConflict]);

    const neutralized = plan.pre.filter(
      (a) =>
        (a.kind === 'log' && a.message.includes('neutralized by')) ||
        (a.kind === 'analytics' && a.event === 'settings conflict neutralized'),
    );

    expect(neutralized).toEqual([
      {
        kind: 'log',
        message:
          `[agent-runner] settings conflict in user (${userConflict.path}) ` +
          `neutralized by settingSources:['project'] — not blocking`,
      },
      {
        kind: 'analytics',
        event: 'settings conflict neutralized',
        props: { level: 'user', keys: ['apiKeyHelper'] },
      },
      {
        kind: 'log',
        message:
          `[agent-runner] settings conflict in project-local (${localConflict.path}) ` +
          `neutralized by settingSources:['project'] — not blocking`,
      },
      {
        kind: 'analytics',
        event: 'settings conflict neutralized',
        props: { level: 'project-local', keys: ['ANTHROPIC_BASE_URL'] },
      },
    ]);
  });

  it('schedules auto-fix for writable conflicts and exposes the key list for the success event', () => {
    const projA = make('project', true, ['apiKeyHelper']);
    const projB = make('project', true, ['ANTHROPIC_BASE_URL']);

    const plan = planSettingsConflictActions([projA, projB]);

    expect(plan.autoFix).toEqual({
      keys: ['apiKeyHelper', 'ANTHROPIC_BASE_URL'],
    });
    expect(plan.autoFixCandidates).toEqual([projA, projB]);
    expect(plan.failClosed).toEqual([]);
  });

  it('separates fail-closed (managed) from auto-fixable conflicts without scheduling auto-fix for managed', () => {
    const managed = make('managed', false, ['apiKeyHelper']);

    const plan = planSettingsConflictActions([managed]);

    expect(plan.autoFix).toBeNull();
    expect(plan.failClosed).toEqual([managed]);
    expect(plan.autoFixCandidates).toEqual([]);
  });
});

describe('planAutoFixOutcome', () => {
  const projA = make('project', true, ['apiKeyHelper']);
  const managed = make('managed', false, ['apiKeyHelper']);

  it('on success: emits the auto-neutralized log + analytics and leaves only fail-closed unfixable', () => {
    const plan = planSettingsConflictActions([projA, managed]);

    const outcome = planAutoFixOutcome(plan, true);

    expect(outcome.actions).toEqual([
      {
        kind: 'log',
        message: '[agent-runner] auto-neutralized writable settings conflict',
      },
      {
        kind: 'analytics',
        event: 'settings conflict auto-neutralized',
        props: { keys: ['apiKeyHelper'] },
      },
    ]);
    expect(outcome.unfixable).toEqual([managed]);
  });

  it('on failure: emits the failing-closed log and adds the auto-fix candidates to unfixable', () => {
    const plan = planSettingsConflictActions([projA, managed]);

    const outcome = planAutoFixOutcome(plan, false);

    expect(outcome.actions).toEqual([
      {
        kind: 'log',
        message:
          '[agent-runner] could not back up writable settings conflict — failing closed',
      },
    ]);
    // fail-closed first (preserves prior ordering), then auto-fix candidates.
    expect(outcome.unfixable).toEqual([managed, projA]);
  });

  it('when no auto-fix was scheduled, returns no actions and unfixable = failClosed verbatim', () => {
    const plan = planSettingsConflictActions([managed]);

    expect(planAutoFixOutcome(plan, true)).toEqual({
      actions: [],
      unfixable: [managed],
    });
    expect(planAutoFixOutcome(plan, false)).toEqual({
      actions: [],
      unfixable: [managed],
    });
  });
});
