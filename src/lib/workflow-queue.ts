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
 * Parsed from SKILL.md frontmatter's `workflow` array.
 */
export interface WorkflowStepSeed {
  /** Unique id for the step, e.g. "1.0-begin" */
  stepId: string;
  /** Filename inside the skill's references/ dir, e.g. "basic-integration-1.0-begin.md" */
  referenceFilename: string;
}

/**
 * Parse workflow steps from SKILL.md content.
 *
 * Extracts `step_id` and `reference` from the YAML frontmatter's
 * `workflow` array. Uses simple regex — no YAML library needed
 * since we control the output format in skill-generator.
 */
export function parseWorkflowStepsFromSkillMd(
  skillMdContent: string,
): WorkflowStepSeed[] {
  const fmMatch = skillMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const frontmatter = fmMatch[1];

  const steps: WorkflowStepSeed[] = [];
  const entryRegex = /step_id:\s*(.+)\n\s*reference:\s*(.+)/g;
  let match;
  while ((match = entryRegex.exec(frontmatter)) !== null) {
    steps.push({
      stepId: match[1].trim(),
      referenceFilename: match[2].trim(),
    });
  }
  return steps;
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

/**
 * Build a queue with only workflow steps + env-vars (no bootstrap).
 * Used after bootstrap has already run and SKILL.md has been parsed.
 */
export function createPostBootstrapQueue(
  steps: WorkflowStepSeed[],
): WizardWorkflowQueue {
  const items: WizardWorkflowQueueItem[] = [
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
