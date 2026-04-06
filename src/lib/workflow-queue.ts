export type WizardWorkflowQueueItem =
  | {
      id: 'bootstrap';
      kind: 'bootstrap';
    }
  | {
      id: string;
      kind: 'workflow';
      referenceFilename: string;
    }
  | {
      id: 'env-vars';
      kind: 'env-vars';
    };

export class WizardWorkflowQueue {
  private items: WizardWorkflowQueueItem[];

  constructor(items: WizardWorkflowQueueItem[] = []) {
    this.items = [...items];
  }

  enqueue(item: WizardWorkflowQueueItem): void {
    this.items.push(item);
  }

  dequeue(): WizardWorkflowQueueItem | undefined {
    return this.items.shift();
  }

  peek(): WizardWorkflowQueueItem | undefined {
    return this.items[0];
  }

  toArray(): WizardWorkflowQueueItem[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * Describes a workflow step that can be seeded into the queue.
 * Eventually this comes from a context-mill manifest; for now it's
 * passed in by the caller so the queue itself stays generic.
 */
export interface WorkflowStepSeed {
  /** Unique id for the step, e.g. "1.0-begin" */
  stepId: string;
  /** Filename inside the skill's references/ dir, e.g. "basic-integration-1.0-begin.md" */
  referenceFilename: string;
}

/**
 * Build the initial queue from an ordered list of workflow steps.
 * The queue is always: bootstrap → workflow steps → env-vars.
 */
export function createInitialWizardWorkflowQueue(
  steps: WorkflowStepSeed[],
): WizardWorkflowQueue {
  const items: WizardWorkflowQueueItem[] = [
    { id: 'bootstrap', kind: 'bootstrap' },
    ...steps.map(
      (step): WizardWorkflowQueueItem => ({
        id: `workflow:${step.stepId}`,
        kind: 'workflow',
        referenceFilename: step.referenceFilename,
      }),
    ),
    { id: 'env-vars', kind: 'env-vars' },
  ];
  return new WizardWorkflowQueue(items);
}
