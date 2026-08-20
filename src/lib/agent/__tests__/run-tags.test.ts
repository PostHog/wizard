import { buildRunTags } from '@lib/agent/agent-interface';
import { CallType } from '@lib/constants';

describe('buildRunTags', () => {
  it('carries the run identifiers as gateway trace tags', () => {
    expect(
      buildRunTags({
        programId: 'audit',
        integration: 'nextjs',
        runId: 'run-123',
        build: 'ci',
        skillId: 'audit-events',
      }),
    ).toEqual({
      program_id: 'audit',
      integration: 'nextjs',
      run_id: 'run-123',
      build: 'ci',
      call_type: CallType.agent,
      skill_id: 'audit-events',
    });
  });

  it('marks every run as agent work rather than leaving call_type unset', () => {
    // Scan triage overrides this to `yara-triage`. Both sides are stamped so a
    // missing `call_type` means "an old build sent none", not "agent work" —
    // the two would otherwise be indistinguishable in cost breakdowns.
    expect(
      buildRunTags({
        programId: 'posthog-integration',
        integration: 'nextjs',
        runId: 'run-123',
        build: 'prod',
      }).call_type,
    ).toBe('agent');
  });

  it("carries a headless run's build type onto gateway traces", () => {
    // A published headless run tags build='headless' in runNonInteractive;
    // that value rides through analytics.build into the gateway trace tags, so
    // the LLM gateway can tell a cloud/headless run apart from prod/dev/ci.
    expect(
      buildRunTags({
        programId: 'posthog-integration',
        integration: 'nextjs',
        runId: 'run-123',
        build: 'headless',
      }),
    ).toMatchObject({ build: 'headless' });
  });

  it('omits skill_id when the run has none', () => {
    const tags = buildRunTags({
      programId: 'posthog-integration',
      integration: 'nextjs',
      runId: 'run-123',
      build: 'prod',
    });
    expect(tags).not.toHaveProperty('skill_id');
    expect(tags).toEqual({
      program_id: 'posthog-integration',
      integration: 'nextjs',
      run_id: 'run-123',
      build: 'prod',
      call_type: CallType.agent,
    });
  });
});
