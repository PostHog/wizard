import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import { DEFAULT_AGENT_MODEL, Harness } from '@lib/constants';
import {
  PROGRAM_BINDINGS,
  DEFAULT_BINDING,
  resolveHarness,
} from '@lib/agent/runner/switchboard';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);

describe('switchboard PROGRAM_BINDINGS', () => {
  // `ProgramId` widens to `string`, so the type can't force coverage. This is
  // the real guard: add a program without a binding and this fails.
  it('declares a binding for every registered program', () => {
    const missing = PROGRAM_IDS.filter((id) => !(id in PROGRAM_BINDINGS));
    expect(missing).toEqual([]);
  });

  it('maps no binding to an unregistered program', () => {
    const stale = Object.keys(PROGRAM_BINDINGS).filter(
      (id) => !PROGRAM_IDS.includes(id),
    );
    expect(stale).toEqual([]);
  });

  it('resolves every program to a registered harness and a non-empty model', () => {
    for (const program of PROGRAM_IDS) {
      const pick = resolveHarness({ program, flags: {} });
      expect(Object.values(Harness)).toContain(pick.harness);
      expect(pick.model).toBeTruthy();
    }
  });

  // Pins today's behavior: the seam changes nothing until a binding is moved.
  it('defaults every program to anthropic + DEFAULT_AGENT_MODEL', () => {
    for (const program of PROGRAM_IDS) {
      expect(resolveHarness({ program, flags: {} })).toEqual({
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
      });
    }
  });

  it('falls back to DEFAULT_BINDING for an unmapped program', () => {
    expect(resolveHarness({ program: 'not-a-program', flags: {} })).toEqual({
      harness: DEFAULT_BINDING.harness,
      model: DEFAULT_BINDING.model,
    });
  });
});

describe('switchboard resolveHarness — CLI precedence', () => {
  it('CLI cliHarness wins over PostHog wizard-runner flag', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { 'wizard-runner': 'anthropic' },
      cliHarness: Harness.pi,
    });
    expect(pick.harness).toBe(Harness.pi);
  });

  it('PostHog wizard-runner flag overlays when no CLI is set', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { 'wizard-runner': 'pi' },
    });
    expect(pick.harness).toBe(Harness.pi);
  });

  it('unknown flag value falls back to the binding default', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { 'wizard-runner': 'banana' },
    });
    expect(pick.harness).toBe(Harness.anthropic);
  });
});
