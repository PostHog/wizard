import { expectTypeOf } from 'vitest';
import type { ProgramRunConfig } from '../agent-protocol/program-run.js';
import type { ProgramConfig } from '../programs/program-step.js';
import {
  getProgramConfig,
  Program,
  PROGRAM_REGISTRY,
} from '../programs/program-registry.js';
import { runConfigFor } from '../programs/run-config.js';
import type { WizardStoreApi } from '../state/store-api.js';
import type { WizardStore } from '../state/store.js';
import { createTestStore } from '../testing/index.js';
import { NullUI } from '../ui/null-ui.js';
import { StoreUI } from '../ui/store-ui.js';
import type { WizardUI } from '../ui/wizard-ui.js';

/** The fields the agent may read from a run config. */
const RUN_CONTRACT_KEYS = [
  'id',
  'run',
  'agentFlow',
  'skillId',
  'requiresAi',
  'seedTasks',
  'auditLedgerFile',
  'reportFile',
  'eventPlanFile',
  'streamWorkflowId',
  'allowedTools',
  'disallowedTools',
  'postAuthGateIds',
  'healthCheckDeclared',
] as const satisfies readonly (keyof ProgramRunConfig)[];

describe('store contract', () => {
  it('StoreUI and NullUI implement WizardUI', () => {
    expectTypeOf<StoreUI>().toMatchTypeOf<WizardUI>();
    expectTypeOf<NullUI>().toMatchTypeOf<WizardUI>();
    expect(new StoreUI(createTestStore()).interactive).toBe(true);
    expect(new NullUI().interactive).toBe(false);
  });

  it('the store satisfies the API other surfaces see', () => {
    expectTypeOf<WizardStore>().toMatchTypeOf<WizardStoreApi>();
  });

  it('every ProgramConfig is a ProgramRunConfig', () => {
    expectTypeOf<ProgramConfig>().toMatchTypeOf<ProgramRunConfig>();
  });

  it('every Program value resolves to a registry entry with that id', () => {
    for (const id of Object.values(Program)) {
      expect(getProgramConfig(id).id).toBe(id);
    }
    expect(new Set(PROGRAM_REGISTRY.map((c) => c.id)).size).toBe(
      PROGRAM_REGISTRY.length,
    );
  });

  it('runConfigFor hands the agent only the run contract', () => {
    const allowed = new Set<string>(RUN_CONTRACT_KEYS);
    for (const config of PROGRAM_REGISTRY) {
      const extra = Object.keys(runConfigFor(config)).filter(
        (k) => !allowed.has(k),
      );
      expect(extra, config.id).toEqual([]);
    }
  });
});
