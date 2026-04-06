export type WizardWorkflowQueueItem =
  | {
      id: 'bootstrap';
      kind: 'bootstrap';
      label: string;
    }
  | {
      id: string;
      kind: 'workflow';
      referenceFilename: string;
      label: string;
    }
  | {
      id: 'env-vars';
      kind: 'env-vars';
      label: string;
    };

export class WizardWorkflowQueue {
  private items: WizardWorkflowQueueItem[];
  private onChange?: () => void;

  constructor(items: WizardWorkflowQueueItem[] = []) {
    this.items = [...items];
  }

  /** Register a listener that fires on any queue mutation. */
  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  enqueue(item: WizardWorkflowQueueItem): void {
    this.items.push(item);
    this.onChange?.();
  }

  /** Insert an item at the front of the queue (next to run). */
  enqueueNext(item: WizardWorkflowQueueItem): void {
    this.items.unshift(item);
    this.onChange?.();
  }

  dequeue(): WizardWorkflowQueueItem | undefined {
    const item = this.items.shift();
    this.onChange?.();
    return item;
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
  /** Human-readable title from SKILL.md frontmatter, e.g. "PostHog Setup - Edit" */
  title: string;
}

/**
 * Parse workflow steps from SKILL.md content.
 *
 * Extracts `step_id`, `reference`, and `title` from the YAML frontmatter's
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
  const entryRegex = /step_id:\s*(.+)\n\s*reference:\s*(.+)\n\s*title:\s*(.+)/g;
  let match;
  while ((match = entryRegex.exec(frontmatter)) !== null) {
    steps.push({
      stepId: match[1].trim(),
      referenceFilename: match[2].trim(),
      title: match[3].trim(),
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
    { id: 'bootstrap', kind: 'bootstrap', label: 'Preparing integration' },
    ...steps.map(
      (step): WizardWorkflowQueueItem => ({
        id: `workflow:${step.stepId}`,
        kind: 'workflow',
        referenceFilename: step.referenceFilename,
        label: step.title,
      }),
    ),
    { id: 'env-vars', kind: 'env-vars', label: 'Environment variables' },
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
        label: step.title,
      }),
    ),
    { id: 'env-vars', kind: 'env-vars', label: 'Environment variables' },
  ];
  return new WizardWorkflowQueue(items);
}
