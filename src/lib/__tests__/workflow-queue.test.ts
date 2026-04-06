import {
  WizardWorkflowQueue,
  createInitialWizardWorkflowQueue,
  createPostBootstrapQueue,
  parseWorkflowStepsFromSkillMd,
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

  it('createPostBootstrapQueue omits bootstrap', () => {
    const queue = createPostBootstrapQueue(BASIC_INTEGRATION_STEPS);
    const items = queue.toArray();

    expect(items[0]).toEqual({
      id: 'workflow:1.0-begin',
      kind: 'workflow',
      referenceFilename: 'basic-integration-1.0-begin.md',
    });
    expect(items[items.length - 1]).toEqual({
      id: 'env-vars',
      kind: 'env-vars',
    });
    expect(items.find((i) => i.id === 'bootstrap')).toBeUndefined();
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
      },
      {
        stepId: '1.1-edit',
        referenceFilename: 'basic-integration-1.1-edit.md',
      },
      {
        stepId: '1.2-revise',
        referenceFilename: 'basic-integration-1.2-revise.md',
      },
      {
        stepId: '1.3-conclude',
        referenceFilename: 'basic-integration-1.3-conclude.md',
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
