/**
 * The integration's workflows step. A runner-seeded agent designs draft
 * workflows on the events the run instrumented and writes them to the run
 * cache. The program reads and checks them before the cache is wiped, and the
 * TUI offers them to the user, who picks which to create as drafts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { createDraftWorkflow, type Credentials } from '@shared/api';
import { EVENT_PLAN_FILE } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { withUtm } from '@utils/links';
import type { ProgramSession } from '../program-session';

export const WORKFLOWS_SEED_TASK_TYPE = 'workflows';

/** Written by the workflows agent into the run cache, beside the event plan. */
export const WORKFLOW_PROPOSALS_FILE = '.posthog-workflows.json';

export const WORKFLOW_PROPOSALS_KEY = 'workflowProposals';
const MAX_PROPOSALS = 3;
const WIZARD_NAME_SUFFIX = ' (wizard)';
const EMAIL_RECIPIENT = '{{ person.properties.email }}';

/** What a workflow helps with, as the user reads it in the checklist. */
export const WORKFLOW_GOALS = {
  activation: 'Activation',
  engagement: 'Engagement',
  retention: 'Retention',
  conversion: 'Conversion',
  feedback: 'Feedback',
} as const;

export type WorkflowProposal = {
  title: string;
  /** Absent when the agent named no known goal. */
  goal?: keyof typeof WORKFLOW_GOALS;
  /** One plain sentence on how it helps; no event names or steps. */
  reason: string;
  workflow: Record<string, unknown>;
};

export type WorkflowProposals = {
  proposals: WorkflowProposal[];
  /** Proposals the agent wrote that failed the checks below. */
  rejectedCount: number;
};

export type WorkflowDraftResult =
  | { title: string; url: string }
  | { title: string; error: string };

const Duration = z.string().regex(/^\d*\.?\d+[dhms]$/);
const EventFilters = z
  .object({
    events: z.array(z.object({ id: z.string() }).passthrough()).min(1),
  })
  .passthrough();
const ActionBase = { id: z.string().min(1), name: z.string().optional() };

const EmailValue = z
  .object({
    to: z.object({ email: z.literal(EMAIL_RECIPIENT) }).passthrough(),
    // The user picks a verified sender in PostHog; a sender set here would bypass that.
    from: z
      .object({ email: z.literal(''), name: z.string().optional() })
      .strict(),
    subject: z.string().min(1),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .passthrough()
  .refine((v) => Boolean(v.text || v.html), 'email needs a body');

const Action = z.discriminatedUnion('type', [
  z
    .object({
      ...ActionBase,
      type: z.literal('trigger'),
      config: z
        .object({ type: z.literal('event'), filters: EventFilters })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({
      ...ActionBase,
      type: z.literal('delay'),
      config: z.object({ delay_duration: Duration }).passthrough(),
    })
    .passthrough(),
  z
    .object({
      ...ActionBase,
      type: z.literal('wait_until_condition'),
      config: z
        .object({
          events: z
            .array(z.object({ filters: EventFilters }).passthrough())
            .min(1),
          max_wait_duration: Duration,
        })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({
      ...ActionBase,
      type: z.literal('conditional_branch'),
      config: z
        .object({
          conditions: z
            .array(
              z
                .object({
                  filters: z
                    .object({ properties: z.array(z.unknown()).min(1) })
                    .passthrough(),
                })
                .passthrough(),
            )
            .min(1),
        })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({
      ...ActionBase,
      type: z.literal('function_email'),
      config: z
        .object({
          template_id: z.literal('template-email'),
          inputs: z.object({ email: z.object({ value: EmailValue }) }),
        })
        .passthrough(),
    })
    .passthrough(),
  z.object({ ...ActionBase, type: z.literal('exit') }).passthrough(),
]);

type WorkflowAction = z.infer<typeof Action>;

const Edge = z
  .object({
    from: z.string(),
    to: z.string(),
    type: z.enum(['continue', 'branch']),
    index: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const Workflow = z
  .object({
    name: z.string().min(1).max(400),
    description: z.string().optional(),
    exit_condition: z
      .enum([
        'exit_only_at_end',
        'exit_on_conversion',
        'exit_on_trigger_not_matched',
        'exit_on_trigger_not_matched_or_conversion',
      ])
      .optional(),
    conversion: z
      .object({
        events: z
          .array(z.object({ filters: EventFilters }).passthrough())
          .optional(),
        window: Duration.nullish(),
      })
      .passthrough()
      .nullish(),
    actions: z.array(Action).min(3),
    edges: z.array(Edge).min(2),
  })
  .passthrough();

type Workflow = z.infer<typeof Workflow>;

const ProposalsFile = z.object({
  proposals: z.array(
    z
      .object({
        title: z.string().min(1).max(80),
        goal: z.string().optional(),
        reason: z.string().min(1).max(300),
        workflow: z.unknown(),
      })
      .passthrough(),
  ),
});

const EventPlan = z.array(z.object({ event: z.string() }).passthrough());

function eventIds(filters: z.infer<typeof EventFilters>): string[] {
  return filters.events.map((e) => e.id);
}

function referencedEvents(workflow: Workflow): string[] {
  return [
    ...workflow.actions.flatMap((a) => {
      if (a.type === 'trigger') return eventIds(a.config.filters);
      if (a.type === 'wait_until_condition') {
        return a.config.events.flatMap((e) => eventIds(e.filters));
      }
      return [];
    }),
    ...(workflow.conversion?.events ?? []).flatMap((g) => eventIds(g.filters)),
  ];
}

/** Why a workflow fails the checks, or null when it passes. */
export function workflowProblem(
  raw: unknown,
  plannedEvents: ReadonlySet<string>,
): string | null {
  const parsed = Workflow.safeParse(raw);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'bad shape';
  const workflow = parsed.data;

  for (const key of ['id', 'status', 'trigger']) {
    if (key in workflow) return `sets ${key}`;
  }
  if (JSON.stringify(workflow).includes('"bytecode"')) return 'sets bytecode';

  const ids = new Set(workflow.actions.map((a) => a.id));
  if (ids.size !== workflow.actions.length) return 'duplicate action id';
  const count = (type: WorkflowAction['type']) =>
    workflow.actions.filter((a) => a.type === type).length;
  if (count('trigger') !== 1) return 'needs exactly one trigger';
  if (count('function_email') === 0) return 'sends no email';
  if (count('exit') === 0) return 'has no exit';

  const unplanned = referencedEvents(workflow).filter(
    (e) => !plannedEvents.has(e),
  );
  if (unplanned.length > 0) return 'uses an event outside the event plan';
  if (
    workflow.exit_condition?.includes('conversion') &&
    !workflow.conversion?.events?.length
  ) {
    return 'conversion exit without a goal event';
  }

  for (const edge of workflow.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return 'dangling edge';
    if (edge.type === 'branch' && edge.index === undefined) {
      return 'branch edge without index';
    }
  }
  for (const action of workflow.actions) {
    if (action.type === 'exit') continue;
    const out = workflow.edges.filter((e) => e.from === action.id);
    if (out.length === 0) return 'step with no next step';
    const branches = out.filter((e) => e.type === 'branch');
    if (action.type === 'wait_until_condition') {
      if (!branches.some((e) => e.index === 0)) return 'wait never resolves';
      if (!out.some((e) => e.type === 'continue')) return 'wait has no timeout';
    }
    if (action.type === 'conditional_branch') {
      const max = action.config.conditions.length;
      if (branches.some((e) => (e.index ?? 0) >= max)) {
        return 'branch index out of range';
      }
    } else if (action.type !== 'wait_until_condition' && branches.length > 0) {
      return 'branch edge on a sequential step';
    }
  }
  return null;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Read and check the proposals the workflows agent left in the run cache.
 * Undefined when the agent wrote no file.
 */
export function readWorkflowProposals(
  cacheDir: string,
): WorkflowProposals | undefined {
  const file = ProposalsFile.safeParse(
    readJson(join(cacheDir, WORKFLOW_PROPOSALS_FILE)),
  );
  if (!file.success) return undefined;
  const plan = EventPlan.safeParse(readJson(join(cacheDir, EVENT_PLAN_FILE)));
  const plannedEvents = new Set(
    plan.success ? plan.data.map((e) => e.event) : [],
  );

  const proposals: WorkflowProposal[] = [];
  let rejectedCount = 0;
  for (const proposal of file.data.proposals.slice(0, MAX_PROPOSALS)) {
    if (workflowProblem(proposal.workflow, plannedEvents) !== null) {
      rejectedCount += 1;
      continue;
    }
    const workflow = Workflow.parse(proposal.workflow);
    proposals.push({
      title: proposal.title,
      goal:
        proposal.goal && proposal.goal in WORKFLOW_GOALS
          ? (proposal.goal as keyof typeof WORKFLOW_GOALS)
          : undefined,
      reason: proposal.reason,
      workflow: {
        ...workflow,
        name: workflow.name.endsWith(WIZARD_NAME_SUFFIX)
          ? workflow.name
          : `${workflow.name}${WIZARD_NAME_SUFFIX}`,
      },
    });
  }
  rejectedCount += Math.max(0, file.data.proposals.length - MAX_PROPOSALS);
  return { proposals, rejectedCount };
}

/** Keeps the checked proposals on the session, where the TUI step finds them. */
export function captureWorkflowProposals(
  session: ProgramSession,
  cacheDir: string,
): void {
  const result = readWorkflowProposals(cacheDir);
  if (!result) return;
  session.frameworkContext[WORKFLOW_PROPOSALS_KEY] = result;
  analytics.wizardCapture('workflows proposals generated', {
    proposal_count: result.proposals.length,
    rejected_count: result.rejectedCount,
    step_types: result.proposals.flatMap((p) =>
      (p.workflow.actions as WorkflowAction[]).map((a) => a.type),
    ),
  });
}

export function getWorkflowProposals(
  session: Pick<ProgramSession, 'frameworkContext'>,
): WorkflowProposal[] {
  const stored = session.frameworkContext[WORKFLOW_PROPOSALS_KEY] as
    | WorkflowProposals
    | undefined;
  return stored?.proposals ?? [];
}

/** Create each proposal as a draft, one at a time; a failure does not stop the rest. */
export async function createWorkflowDrafts(
  credentials: Credentials,
  proposals: readonly WorkflowProposal[],
): Promise<WorkflowDraftResult[]> {
  const results: WorkflowDraftResult[] = [];
  for (const proposal of proposals) {
    try {
      const { id } = await createDraftWorkflow(
        credentials.accessToken,
        credentials.projectId,
        credentials.host.apiHost,
        proposal.workflow,
      );
      results.push({
        title: proposal.title,
        url: withUtm(
          `${credentials.host.appHost}/project/${credentials.projectId}/workflows/${id}/workflow`,
          'workflows-draft',
        ),
      });
    } catch (error) {
      results.push({
        title: proposal.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  analytics.wizardCapture('workflows drafts created', {
    created_count: results.filter((r) => 'url' in r).length,
    failed_count: results.filter((r) => 'error' in r).length,
  });
  return results;
}
