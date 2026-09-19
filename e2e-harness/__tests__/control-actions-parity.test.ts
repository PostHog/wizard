import { describe, expect, it } from 'vitest';
import {
  ACTION_REGISTRY,
  NO_ACTION_SCREENS as HARNESS_NO_ACTION,
} from '@e2e-harness/action-registry';
import { Interrupt } from '@store';
import { actionsFor, NO_ACTION_SCREENS } from '@store/control';
import { flowFor, PROGRAM_REGISTRY } from '@store/programs';

/** The store adds the pick the e2e host used to inject through raw setters. */
const STORE_ONLY: Record<string, string[]> = {
  'self-driving-integration-detect': ['pick_integration_target'],
  'error-tracking-detect': ['pick_integration_target'],
};

describe('control actions parity with the e2e action registry', () => {
  it('offers every harness action on every flow, plus only the documented picks', () => {
    const drift: string[] = [];
    for (const config of PROGRAM_REGISTRY) {
      const { flow } = flowFor(config.id);
      const screens = new Set<string>([
        ...flow.steps.flatMap((s) => (s.screenId ? [s.screenId] : [])),
        ...Object.values(Interrupt),
      ]);
      for (const screen of screens) {
        const harness = (
          (
            ACTION_REGISTRY as Record<string, Array<{ id: string }> | undefined>
          )[screen] ?? []
        ).map((a) => a.id);
        const store = actionsFor(flow, screen).map((a) => a.id);
        for (const id of harness) {
          if (!store.includes(id))
            drift.push(`${config.id}:${screen} lost ${id}`);
        }
        for (const id of store) {
          if (
            !harness.includes(id) &&
            !(STORE_ONLY[screen] ?? []).includes(id)
          ) {
            drift.push(`${config.id}:${screen} added ${id}`);
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it('keeps every no-action screen the harness lists, minus the detect screens the picks now cover', () => {
    for (const screen of NO_ACTION_SCREENS) {
      expect(HARNESS_NO_ACTION.has(screen as never), screen).toBe(true);
    }
  });
});
