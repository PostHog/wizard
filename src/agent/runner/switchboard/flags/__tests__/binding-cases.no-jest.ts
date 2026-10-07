/**
 * The shared shape every switchboard test speaks: one case = one
 * (SwitchboardCtx in) → (full four-axis binding out) scenario, data only.
 * `runBindingCases` turns a table into `it` blocks — specs stay declarative.
 */
import { it, expect } from 'vitest';
import type { Harness, Sequence } from '@shared/constants';
import {
  DEFAULT_BINDING,
  resolveBinding,
  type ProgramBinding,
  type SwitchboardCtx,
  type SwitchboardTrace,
} from '@agent/runner/switchboard';
import type { EffortLevel } from '@agent/runner/switchboard/models';

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
  /** `binding` defaults to DEFAULT_BINDING, as for a program that declares none. */
  ctx: Omit<SwitchboardCtx, 'trace' | 'binding'> & { binding?: ProgramBinding };
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
        const ctx: SwitchboardCtx = {
          ...c.ctx,
          binding: c.ctx.binding ?? DEFAULT_BINDING,
        };
        expect(resolveBinding(ctx)).toEqual(c.binding);
        if (c.trace) expect(ctx.trace).toEqual(c.trace);
      } finally {
        if (c.surface) setSurface?.('local');
      }
    });
  }
}
