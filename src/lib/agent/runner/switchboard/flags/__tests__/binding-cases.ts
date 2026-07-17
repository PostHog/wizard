/**
 * The shared shape every switchboard test speaks: one case = one
 * (SwitchboardCtx in) → (full four-axis binding out) scenario, data only.
 * `runBindingCases` turns a table into `it` blocks — specs stay declarative.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_MODEL, Harness, Sequence } from '@lib/constants';
import {
  resolveBinding,
  type SwitchboardCtx,
  type SwitchboardTrace,
} from '@lib/agent/runner/switchboard';
import type { EffortLevel } from '@lib/agent/runner/switchboard/models';

/** The complete resolved binding — every axis stated, nothing implicit. */
export interface ExpectedBinding {
  sequence: Sequence;
  harness: Harness;
  model: string;
  thinkingLevel: EffortLevel | undefined;
}

export interface BindingCase {
  name: string;
  /** Run surface for this case; restored to 'local' afterwards. */
  surface?: 'cloud' | 'local';
  ctx: Omit<SwitchboardCtx, 'trace'>;
  binding: ExpectedBinding;
  /** Also pin which precedence rung decided each axis. */
  trace?: SwitchboardTrace;
}

export function runBindingCases(
  cases: readonly BindingCase[],
  setSurface?: (s: 'cloud' | 'local') => void,
): void {
  for (const c of cases) {
    it(c.name, () => {
      if (c.surface) setSurface?.(c.surface);
      try {
        const ctx: SwitchboardCtx = { ...c.ctx };
        expect(resolveBinding(ctx)).toEqual(c.binding);
        if (c.trace) expect(ctx.trace).toEqual(c.trace);
      } finally {
        if (c.surface) setSurface?.('local');
      }
    });
  }
}

// Self-check (this file lives in __tests__, so vitest collects it): the
// runner drives the real resolver and pins the whole four-axis shape.
describe('runBindingCases', () => {
  runBindingCases([
    {
      name: 'executes a case: unflagged program → complete default binding + trace',
      ctx: { program: 'posthog-integration', flags: {} },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
  ]);
});
