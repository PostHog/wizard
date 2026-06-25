import { buildRunTags } from '@lib/agent/agent-interface';

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
      skill_id: 'audit-events',
    });
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
    });
  });
});
