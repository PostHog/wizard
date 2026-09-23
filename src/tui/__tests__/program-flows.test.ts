import { PROGRAM_REGISTRY } from '@programs';
import { PROGRAM_FLOWS, rawProgramFlow } from '../flows/index';

describe('program flows', () => {
  it('has exactly one flow per registered program', () => {
    expect(Object.keys(PROGRAM_FLOWS).sort()).toEqual(
      PROGRAM_REGISTRY.map((c) => c.id).sort(),
    );
  });

  it.each(PROGRAM_REGISTRY.filter((c) => c.runSteps).map((c) => [c.id, c]))(
    '%s composes runs only on its run screens',
    (_id, config) => {
      const flow = rawProgramFlow(config.id);
      for (const stepId of Object.keys(config.runSteps ?? {})) {
        expect(flow.find((s) => s.id === stepId)?.screenId).toBe('run');
      }
    },
  );
});
