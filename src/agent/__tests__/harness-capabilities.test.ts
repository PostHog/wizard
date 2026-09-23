import { Harness } from '@shared/constants';
import { HARNESS_OPTIONS } from '@agent/runner/switchboard/harness';
import { HARNESS_RUNS_TASKS } from '@agent/runner/switchboard/resolve-harness';

describe('harness capabilities', () => {
  it.each(Object.values(Harness))(
    'records whether the %s backend implements runTask',
    (harness) => {
      const backend = HARNESS_OPTIONS[harness];
      expect(backend).toBeDefined();
      expect(HARNESS_RUNS_TASKS[harness]).toBe(
        typeof backend?.runTask === 'function',
      );
    },
  );
});
