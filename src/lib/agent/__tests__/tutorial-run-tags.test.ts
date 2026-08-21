/**
 * Cost-attribution contract for the MCP tutorial.
 *
 * The gateway builds each `$ai_generation`'s `program_id` from the
 * `X-POSTHOG-PROPERTY-*` headers on the request. The tutorial shipped without
 * them, so every generation it produced landed in the unattributed bucket —
 * these tests pin the tags so that can't silently return.
 */

import { buildTutorialRunTags } from '@lib/agent/mcp-prompt-streaming';
import { buildAgentEnv } from '@lib/agent/agent-interface';
import { analytics } from '@utils/analytics';

describe('buildTutorialRunTags', () => {
  it('tags the run with the program its spend belongs to', () => {
    expect(buildTutorialRunTags({ programId: 'mcp-tutorial' })).toMatchObject({
      program_id: 'mcp-tutorial',
      run_id: analytics.runId,
      build: analytics.build,
    });
  });

  it('falls back to the program for integration rather than emitting an empty axis', () => {
    // The tutorial runs against a PostHog project, not a codebase, so there's
    // usually no detected framework to report.
    expect(buildTutorialRunTags({ programId: 'mcp-tutorial' })).toMatchObject({
      integration: 'mcp-tutorial',
    });
  });

  it('keeps a detected integration when the session has one', () => {
    expect(
      buildTutorialRunTags({
        programId: 'mcp-tutorial',
        integration: 'nextjs',
      }),
    ).toMatchObject({ integration: 'nextjs' });
  });

  it('returns no tags at all when the caller supplies no program', () => {
    // Explicitly tagless beats a half-populated bag that looks attributed.
    expect(buildTutorialRunTags({})).toEqual({});
  });

  it('reaches the gateway as property headers, not just an object', () => {
    // The object is only useful if buildAgentEnv actually encodes it — that
    // join is the part that was missing in production.
    const encoded = buildAgentEnv(
      buildTutorialRunTags({ programId: 'mcp-tutorial' }),
      {},
    );

    expect(encoded).toContain('X-POSTHOG-PROPERTY-program_id: mcp-tutorial');
    expect(encoded).toContain('x-posthog-use-bedrock-fallback: true');
  });

  it('sends only the bedrock header when there is no program — the pre-fix shape', () => {
    const encoded = buildAgentEnv(buildTutorialRunTags({}), {});

    expect(encoded).not.toContain('X-POSTHOG-PROPERTY');
  });
});
