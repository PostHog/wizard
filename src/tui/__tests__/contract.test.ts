import { expectTypeOf } from 'vitest';
import { FlowStore } from '@store';
import { flowFor, Program, PROGRAM_REGISTRY } from '@store/programs';
import type { WizardUI } from '@store/types';
import { HeadlessUI } from '../console/headless-ui.js';
import { LoggingUI } from '../console/logging-ui.js';
import { ScreenId } from '../screen-sequences.js';
import type { UiStoreApi } from '../types.js';
import { UiStore } from '../ui-store.js';

describe('tui contract', () => {
  it('console renderers implement WizardUI without interaction', () => {
    expectTypeOf<LoggingUI>().toMatchTypeOf<WizardUI>();
    expectTypeOf<HeadlessUI>().toMatchTypeOf<WizardUI>();
    expect(new LoggingUI().interactive).toBe(false);
    const store = new FlowStore(flowFor(Program.PostHogIntegration).flow);
    expect(new HeadlessUI(store).interactive).toBe(false);
  });

  it('UiStore satisfies UiStoreApi', () => {
    expectTypeOf<UiStore>().toMatchTypeOf<UiStoreApi>();
  });

  it('every flow key a program declares is a ScreenId', () => {
    const ids = new Set<string>(Object.values(ScreenId));
    for (const config of PROGRAM_REGISTRY) {
      for (const step of flowFor(config.id).flow.steps) {
        if (step.screenId) expect(ids.has(step.screenId), step.id).toBe(true);
      }
    }
  });
});
