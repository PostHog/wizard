import { describe, expect, it } from 'vitest';
import { getProgramCommandments } from '@programs';
import { assembleCommandments } from '@agent/runner/switchboard/commandments';
import { Harness, Sequence } from '@shared/config/constants';

describe('program commandment selection', () => {
  it('selects program text before the agent assembles the prompt', () => {
    const text = getProgramCommandments('self-driving');
    expect(text.join('\n')).toContain('custom-scout proposal');
    expect(
      assembleCommandments({
        programCommandments: text,
        sequence: Sequence.linear,
        harness: Harness.pi,
      }),
    ).toContain('custom-scout proposal');
  });

  it('does not infer program text from an opaque program label', () => {
    expect(
      assembleCommandments({
        program: 'self-driving',
        sequence: Sequence.linear,
        harness: Harness.pi,
      }),
    ).not.toContain('custom-scout proposal');
    expect(getProgramCommandments('posthog-integration')).toEqual([]);
  });
});
