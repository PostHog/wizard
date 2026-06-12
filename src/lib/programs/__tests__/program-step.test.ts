import {
  createProgramSequence,
  type ProgramStep,
} from '@lib/programs/program-step';

describe('createProgramSequence', () => {
  it('filters out headless steps and keeps only screen-bearing ones', () => {
    const steps: ProgramStep[] = [
      { id: 'detect', label: 'Detecting' }, // headless
      { id: 'intro', label: 'Welcome', screenId: 'intro' },
      { id: 'check', label: 'Checking' }, // headless
      { id: 'run', label: 'Running', screenId: 'run' },
      { id: 'outro', label: 'Outro', screenId: 'outro' },
    ];

    const entries = createProgramSequence(steps);
    expect(entries.map((e) => e.id)).toEqual(['intro', 'run', 'outro', 'exit']);
  });

  it('falls back isComplete to gate, preferring explicit isComplete', () => {
    const gateFn = vi.fn();
    const isCompleteFn = vi.fn();

    const steps: ProgramStep[] = [
      { id: 'a', label: 'A', screenId: 'a', gate: gateFn },
      {
        id: 'b',
        label: 'B',
        screenId: 'b',
        isComplete: isCompleteFn,
        gate: gateFn,
      },
      { id: 'c', label: 'C', screenId: 'c' },
    ];

    const entries = createProgramSequence(steps);

    expect(entries[0].isComplete).toBe(gateFn); // fallback
    expect(entries[1].isComplete).toBe(isCompleteFn); // explicit wins
    expect(entries[2].isComplete).toBeUndefined(); // neither set
  });

  it('strips internal step fields — router only sees id/show/isComplete', () => {
    const steps: ProgramStep[] = [
      {
        id: 'intro',
        label: 'Welcome',
        screenId: 'intro',
        gate: () => true,
        onInit: vi.fn(),
        onReady: vi.fn(),
      },
    ];

    const entry = createProgramSequence(steps)[0];
    expect(entry).not.toHaveProperty('screenId');
    expect(entry).not.toHaveProperty('label');
    expect(entry).not.toHaveProperty('gate');
    expect(entry).not.toHaveProperty('onInit');
    expect(entry).not.toHaveProperty('onReady');
  });
});
