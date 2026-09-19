import { expectTypeOf } from 'vitest';
import { anthropicBackend } from '../runner/harness/anthropic/index.js';
import { piBackend } from '../runner/harness/pi/index.js';
import type { AgentHarness } from '../runner/harness/types.js';
import { runAgent } from '../runner/index.js';
import { FakeAgentHarness } from '../testing/fake-harness.js';
import type { RunAgent } from '../types.js';

describe('agent contract', () => {
  it('both harnesses and the fake implement AgentHarness', () => {
    expectTypeOf(piBackend).toMatchTypeOf<AgentHarness>();
    expectTypeOf(anthropicBackend).toMatchTypeOf<AgentHarness>();
    expectTypeOf<FakeAgentHarness>().toMatchTypeOf<AgentHarness>();
    expect(piBackend.name).not.toBe(anthropicBackend.name);
  });

  it('runAgent is the surface entry the cli calls', () => {
    expectTypeOf(runAgent).toEqualTypeOf<RunAgent>();
  });

  it('the fake records one independent run per call', async () => {
    const fake = new FakeAgentHarness(piBackend.name, { error: undefined });
    const inputs = { marker: 'a' } as unknown as Parameters<
      AgentHarness['run']
    >[0];
    await fake.run(inputs);
    await fake.run(inputs);
    expect(fake.runs).toHaveLength(2);
    expect(fake.tasks).toHaveLength(0);
  });
});
