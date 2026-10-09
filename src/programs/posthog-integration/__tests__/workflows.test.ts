/**
 * The workflows step: which runs queue it, and which agent proposals reach the
 * user. A proposal is created in the user's project on one keypress, so the
 * checks here are what stand between a model's output and a saved workflow.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { WizardSession } from '@programs/session/wizard-session';
import type { Credentials } from '@shared/api';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

const createDraftWorkflow = vi.fn();
vi.mock('@shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api')>()),
  createDraftWorkflow: (...args: unknown[]) => createDraftWorkflow(...args),
}));

import {
  config as posthogIntegration,
  createWorkflowDrafts,
} from '@programs/posthog-integration';
import { readWorkflowProposals } from '../workflows';

const EMAIL = {
  id: 'email_welcome',
  name: 'Welcome email',
  type: 'function_email',
  config: {
    template_id: 'template-email',
    inputs: {
      email: {
        value: {
          to: { email: '{{ person.properties.email }}', name: '' },
          from: { email: '', name: '' },
          subject: 'Welcome to Notely',
          text: 'Hi there',
        },
      },
    },
  },
};

function workflow(over: Record<string, unknown> = {}) {
  return {
    name: 'Welcome',
    actions: [
      {
        id: 'trigger_node',
        type: 'trigger',
        config: {
          type: 'event',
          filters: { events: [{ id: 'user_signed_up', type: 'events' }] },
        },
      },
      EMAIL,
      {
        id: 'wait_notebook',
        type: 'wait_until_condition',
        config: {
          events: [{ filters: { events: [{ id: 'notebook_created' }] } }],
          max_wait_duration: '3d',
        },
      },
      { id: 'exit_node', type: 'exit', config: {} },
    ],
    edges: [
      { from: 'trigger_node', to: 'email_welcome', type: 'continue' },
      { from: 'email_welcome', to: 'wait_notebook', type: 'continue' },
      { from: 'wait_notebook', to: 'exit_node', type: 'branch', index: 0 },
      { from: 'wait_notebook', to: 'exit_node', type: 'continue' },
    ],
    ...over,
  };
}

function withEmail(value: Record<string, unknown>) {
  return workflow({
    actions: workflow().actions.map((a) =>
      a.id === EMAIL.id
        ? {
            ...EMAIL,
            config: {
              ...EMAIL.config,
              inputs: {
                email: {
                  value: { ...EMAIL.config.inputs.email.value, ...value },
                },
              },
            },
          }
        : a,
    ),
  });
}

describe('workflow proposals', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workflows-'));
    writeFileSync(
      join(dir, '.posthog-events.json'),
      JSON.stringify([
        { event: 'user_signed_up', description: '', file: 'a.ts' },
        { event: 'notebook_created', description: '', file: 'b.ts' },
      ]),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function read(workflows: unknown[]) {
    writeFileSync(
      join(dir, '.posthog-workflows.json'),
      JSON.stringify({
        proposals: workflows.map((w, i) => ({
          title: `Proposal ${i}`,
          goal: i === 0 ? 'activation' : 'growth',
          reason: 'Because',
          workflow: w,
        })),
      }),
    );
    return readWorkflowProposals(dir);
  }

  it('keeps a valid proposal, tags its name, and keeps only a known goal', () => {
    const result = read([workflow(), workflow()]);

    expect(result?.rejectedCount).toBe(0);
    expect(result?.proposals[0].workflow.name).toBe('Welcome (wizard)');
    expect(result?.proposals[0].goal).toBe('activation');
    expect(result?.proposals[1].goal).toBeUndefined();
  });

  it.each([
    [
      'an event outside the event plan',
      workflow({
        actions: workflow().actions.map((a) =>
          a.type === 'trigger'
            ? {
                ...a,
                config: {
                  type: 'event',
                  filters: { events: [{ id: 'made_up' }] },
                },
              }
            : a,
        ),
      }),
    ],
    [
      'a sender set by the agent',
      withEmail({ from: { email: '', integrationId: 7 } }),
    ],
    [
      'a recipient other than the person',
      withEmail({ to: { email: 'a@example.com' } }),
    ],
    ['a status', workflow({ status: 'active' })],
    [
      'a wait that never resolves',
      workflow({ edges: workflow().edges.filter((e) => e.type !== 'branch') }),
    ],
    [
      'an unsupported step type',
      workflow({
        actions: [
          ...workflow().actions,
          { id: 'sms', type: 'function_sms', config: {} },
        ],
      }),
    ],
  ])('rejects a proposal with %s', (_label, raw) => {
    const result = read([raw]);

    expect(result?.proposals).toEqual([]);
    expect(result?.rejectedCount).toBe(1);
  });

  it('caps the proposals at three', () => {
    const result = read([workflow(), workflow(), workflow(), workflow()]);

    expect(result?.proposals).toHaveLength(3);
    expect(result?.rejectedCount).toBe(1);
  });

  it('reads nothing when the agent wrote no file', () => {
    expect(readWorkflowProposals(dir)).toBeUndefined();
  });
});

describe('workflows seed task', () => {
  function seed(over: Partial<WizardSession>) {
    return (
      posthogIntegration.seedTasks?.({
        installDir: '/tmp/app',
        frameworkContext: {},
        ...over,
      } as WizardSession) ?? []
    ).map((t) => t.type);
  }

  it('queues the task, with no notice, only where someone can answer after the run', () => {
    expect(seed({})).toEqual(['workflows']);
    expect(seed({ ci: true })).toEqual([]);
    expect(seed({ signup: true })).toEqual([]);
  });

  it('excludes the task unless the flag is explicitly on', () => {
    const excluded = (flags: Record<string, string>) =>
      posthogIntegration.excludedTaskTypes?.(flags) ?? [];
    expect(excluded({})).toContain('workflows');
    expect(excluded({ 'wizard-workflows-suggestion': 'false' })).toContain(
      'workflows',
    );
    expect(excluded({ 'wizard-workflows-suggestion': 'true' })).not.toContain(
      'workflows',
    );
  });
});

describe('createWorkflowDrafts', () => {
  const credentials = {
    accessToken: 'token',
    projectId: 2,
    host: {
      apiHost: 'https://us.posthog.com',
      appHost: 'https://us.posthog.com',
    },
  } as Credentials;

  it('creates each draft, and a failure does not stop the rest', async () => {
    createDraftWorkflow
      .mockRejectedValueOnce(new Error('Invalid sender'))
      .mockResolvedValueOnce({ id: 'abc' });
    const proposal = { title: 'A', reason: '', workflow: {} };

    const results = await createWorkflowDrafts(credentials, [
      proposal,
      { ...proposal, title: 'B' },
    ]);

    expect(results[0]).toEqual({ title: 'A', error: 'Invalid sender' });
    expect(results[1]).toMatchObject({ title: 'B' });
    expect('url' in results[1] && results[1].url).toContain(
      'https://us.posthog.com/project/2/workflows/abc/workflow',
    );
  });
});
