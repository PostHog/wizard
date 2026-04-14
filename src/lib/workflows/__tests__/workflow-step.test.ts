import { workflowToFlowEntries, type WorkflowStep } from '../workflow-step.js';

describe('workflowToFlowEntries', () => {
  it('filters out headless steps and keeps only screen-bearing ones', () => {
    const workflow: WorkflowStep[] = [
      { id: 'detect', label: 'Detecting' }, // headless
      { id: 'intro', label: 'Welcome', screen: 'intro' },
      { id: 'check', label: 'Checking' }, // headless
      { id: 'run', label: 'Running', screen: 'run' },
      { id: 'outro', label: 'Outro', screen: 'outro' },
    ];

    const entries = workflowToFlowEntries(workflow);
    expect(entries.map((e) => e.screen)).toEqual(['intro', 'run', 'outro']);
  });

  it('falls back isComplete to gate, preferring explicit isComplete', () => {
    const gateFn = jest.fn();
    const isCompleteFn = jest.fn();

    const workflow: WorkflowStep[] = [
      { id: 'a', label: 'A', screen: 'a', gate: gateFn },
      {
        id: 'b',
        label: 'B',
        screen: 'b',
        isComplete: isCompleteFn,
        gate: gateFn,
      },
      { id: 'c', label: 'C', screen: 'c' },
    ];

    const entries = workflowToFlowEntries(workflow);

    expect(entries[0].isComplete).toBe(gateFn); // fallback
    expect(entries[1].isComplete).toBe(isCompleteFn); // explicit wins
    expect(entries[2].isComplete).toBeUndefined(); // neither set
  });

  it('strips internal step fields — router only sees screen/show/isComplete', () => {
    const workflow: WorkflowStep[] = [
      {
        id: 'intro',
        label: 'Welcome',
        screen: 'intro',
        gate: () => true,
        onInit: jest.fn(),
        onReady: jest.fn(),
      },
    ];

    const entry = workflowToFlowEntries(workflow)[0];
    expect(entry).not.toHaveProperty('id');
    expect(entry).not.toHaveProperty('label');
    expect(entry).not.toHaveProperty('gate');
    expect(entry).not.toHaveProperty('onInit');
    expect(entry).not.toHaveProperty('onReady');
  });
});
