import {
  WizardWorkflowQueue,
  createInitialWizardWorkflowQueue,
  type WorkflowStepSeed,
} from '../workflow-queue';

const BASIC_INTEGRATION_STEPS: WorkflowStepSeed[] = [
  { stepId: '1.0-begin', referenceFilename: 'basic-integration-1.0-begin.md' },
  { stepId: '1.1-edit', referenceFilename: 'basic-integration-1.1-edit.md' },
  {
    stepId: '1.2-revise',
    referenceFilename: 'basic-integration-1.2-revise.md',
  },
  {
    stepId: '1.3-conclude',
    referenceFilename: 'basic-integration-1.3-conclude.md',
  },
];

describe('WizardWorkflowQueue', () => {
  it('seeds a queue from workflow steps in the expected order', () => {
    const queue = createInitialWizardWorkflowQueue(BASIC_INTEGRATION_STEPS);

    expect(queue.toArray()).toEqual([
      { id: 'bootstrap', kind: 'bootstrap' },
      {
        id: 'workflow:1.0-begin',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.0-begin.md',
      },
      {
        id: 'workflow:1.1-edit',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.1-edit.md',
      },
      {
        id: 'workflow:1.2-revise',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.2-revise.md',
      },
      {
        id: 'workflow:1.3-conclude',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.3-conclude.md',
      },
      { id: 'env-vars', kind: 'env-vars' },
    ]);
  });

  it('builds a queue from arbitrary steps, not just basic-integration', () => {
    const customSteps: WorkflowStepSeed[] = [
      { stepId: 'setup', referenceFilename: 'feature-flags-setup.md' },
      { stepId: 'verify', referenceFilename: 'feature-flags-verify.md' },
    ];
    const queue = createInitialWizardWorkflowQueue(customSteps);

    expect(queue.toArray()).toEqual([
      { id: 'bootstrap', kind: 'bootstrap' },
      {
        id: 'workflow:setup',
        kind: 'workflow',
        referenceFilename: 'feature-flags-setup.md',
      },
      {
        id: 'workflow:verify',
        kind: 'workflow',
        referenceFilename: 'feature-flags-verify.md',
      },
      { id: 'env-vars', kind: 'env-vars' },
    ]);
  });

  it('supports enqueue and dequeue operations', () => {
    const queue = new WizardWorkflowQueue();

    queue.enqueue({ id: 'bootstrap', kind: 'bootstrap' });
    queue.enqueue({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
    });

    expect(queue.peek()).toEqual({ id: 'bootstrap', kind: 'bootstrap' });
    expect(queue.dequeue()).toEqual({ id: 'bootstrap', kind: 'bootstrap' });
    expect(queue).toHaveLength(1);
    expect(queue.dequeue()).toEqual({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
    });
    expect(queue).toHaveLength(0);
  });
});
