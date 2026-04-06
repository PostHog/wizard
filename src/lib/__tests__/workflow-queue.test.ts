import {
  WizardWorkflowQueue,
  createInitialWizardWorkflowQueue,
  createPostBootstrapQueue,
  parseWorkflowStepsFromSkillMd,
  type WorkflowStepSeed,
} from '../workflow-queue';

const BASIC_INTEGRATION_STEPS: WorkflowStepSeed[] = [
  {
    stepId: '1.0-begin',
    referenceFilename: 'basic-integration-1.0-begin.md',
    title: 'PostHog Setup - Begin',
  },
  {
    stepId: '1.1-edit',
    referenceFilename: 'basic-integration-1.1-edit.md',
    title: 'PostHog Setup - Edit',
  },
  {
    stepId: '1.2-revise',
    referenceFilename: 'basic-integration-1.2-revise.md',
    title: 'PostHog Setup - Revise',
  },
  {
    stepId: '1.3-conclude',
    referenceFilename: 'basic-integration-1.3-conclude.md',
    title: 'PostHog Setup - Conclusion',
  },
];

describe('WizardWorkflowQueue', () => {
  it('seeds a queue from workflow steps in the expected order', () => {
    const queue = createInitialWizardWorkflowQueue(BASIC_INTEGRATION_STEPS);

    expect(queue.toArray()).toEqual([
      { id: 'bootstrap', kind: 'bootstrap', label: 'Preparing integration' },
      {
        id: 'workflow:1.0-begin',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.0-begin.md',
        label: 'PostHog Setup - Begin',
      },
      {
        id: 'workflow:1.1-edit',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.1-edit.md',
        label: 'PostHog Setup - Edit',
      },
      {
        id: 'workflow:1.2-revise',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.2-revise.md',
        label: 'PostHog Setup - Revise',
      },
      {
        id: 'workflow:1.3-conclude',
        kind: 'workflow',
        referenceFilename: 'basic-integration-1.3-conclude.md',
        label: 'PostHog Setup - Conclusion',
      },
      { id: 'env-vars', kind: 'env-vars', label: 'Environment variables' },
    ]);
  });

  it('builds a queue from arbitrary steps, not just basic-integration', () => {
    const customSteps: WorkflowStepSeed[] = [
      {
        stepId: 'setup',
        referenceFilename: 'feature-flags-setup.md',
        title: 'Setup',
      },
      {
        stepId: 'verify',
        referenceFilename: 'feature-flags-verify.md',
        title: 'Verify',
      },
    ];
    const queue = createInitialWizardWorkflowQueue(customSteps);

    expect(queue.toArray()).toEqual([
      { id: 'bootstrap', kind: 'bootstrap', label: 'Preparing integration' },
      {
        id: 'workflow:setup',
        kind: 'workflow',
        referenceFilename: 'feature-flags-setup.md',
        label: 'Setup',
      },
      {
        id: 'workflow:verify',
        kind: 'workflow',
        referenceFilename: 'feature-flags-verify.md',
        label: 'Verify',
      },
      { id: 'env-vars', kind: 'env-vars', label: 'Environment variables' },
    ]);
  });

  it('createPostBootstrapQueue omits bootstrap', () => {
    const queue = createPostBootstrapQueue(BASIC_INTEGRATION_STEPS);
    const items = queue.toArray();

    expect(items[0]).toEqual({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
      label: 'PostHog Setup - Begin',
    });
    expect(items[items.length - 1]).toEqual({
      id: 'env-vars',
      kind: 'env-vars',
      label: 'Environment variables',
    });
    expect(items.find((i) => i.id === 'bootstrap')).toBeUndefined();
  });

  it('supports enqueue and dequeue operations', () => {
    const queue = new WizardWorkflowQueue();

    queue.enqueue({ id: 'bootstrap', kind: 'bootstrap', label: 'Bootstrap' });
    queue.enqueue({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
      label: 'Begin',
    });

    expect(queue.peek()).toEqual({
      id: 'bootstrap',
      kind: 'bootstrap',
      label: 'Bootstrap',
    });
    expect(queue.dequeue()).toEqual({
      id: 'bootstrap',
      kind: 'bootstrap',
      label: 'Bootstrap',
    });
    expect(queue).toHaveLength(1);
    expect(queue.dequeue()).toEqual({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
      label: 'Begin',
    });
    expect(queue).toHaveLength(0);
  });
});

describe('parseWorkflowStepsFromSkillMd', () => {
  it('parses workflow steps from SKILL.md frontmatter', () => {
    const skillMd = `---
name: integration-nextjs-app-router
description: PostHog integration for Next.js App Router applications
metadata:
  author: PostHog
  version: dev
workflow:
  - step_id: 1.0-begin
    reference: basic-integration-1.0-begin.md
    title: PostHog Setup - Begin
    next:
      - basic-integration-1.1-edit.md
  - step_id: 1.1-edit
    reference: basic-integration-1.1-edit.md
    title: PostHog Setup - Edit
    next:
      - basic-integration-1.2-revise.md
  - step_id: 1.2-revise
    reference: basic-integration-1.2-revise.md
    title: PostHog Setup - Revise
    next:
      - basic-integration-1.3-conclude.md
  - step_id: 1.3-conclude
    reference: basic-integration-1.3-conclude.md
    title: PostHog Setup - Conclusion
    next: []
---

# PostHog integration for Next.js App Router
`;

    const steps = parseWorkflowStepsFromSkillMd(skillMd);

    expect(steps).toEqual([
      {
        stepId: '1.0-begin',
        referenceFilename: 'basic-integration-1.0-begin.md',
        title: 'PostHog Setup - Begin',
      },
      {
        stepId: '1.1-edit',
        referenceFilename: 'basic-integration-1.1-edit.md',
        title: 'PostHog Setup - Edit',
      },
      {
        stepId: '1.2-revise',
        referenceFilename: 'basic-integration-1.2-revise.md',
        title: 'PostHog Setup - Revise',
      },
      {
        stepId: '1.3-conclude',
        referenceFilename: 'basic-integration-1.3-conclude.md',
        title: 'PostHog Setup - Conclusion',
      },
    ]);
  });

  it('returns empty array when no frontmatter', () => {
    expect(parseWorkflowStepsFromSkillMd('# No frontmatter')).toEqual([]);
  });

  it('returns empty array when no workflow key', () => {
    const skillMd = `---
name: feature-flags-nextjs
description: docs only
---

# Feature flags
`;
    expect(parseWorkflowStepsFromSkillMd(skillMd)).toEqual([]);
  });
});
