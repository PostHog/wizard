/**
 * Per-program routing: which sequence, harness and model run each program.
 *
 * Kept in lockstep with `PROGRAM_REGISTRY` by the switchboard test. Anything
 * absent falls back to the agent's `DEFAULT_BINDING`. The agent never reads
 * this table: `run-agent-legacy.ts` looks a program up here and hands the
 * binding to the switchboard as `SwitchboardCtx.binding`.
 */

import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
} from '@lib/constants';
import {
  DEFAULT_BINDING,
  type ProgramBinding,
} from '@lib/agent/runner/switchboard';
import type { ProgramId } from './program-registry';

export const PROGRAM_BINDINGS: Partial<Record<ProgramId, ProgramBinding>> = {
  'posthog-integration': DEFAULT_BINDING,
  'revenue-analytics-setup': DEFAULT_BINDING,
  'warehouse-source': DEFAULT_BINDING,
  'error-tracking-upload-source-maps': {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: GPT5_6_SOL_MODEL,
    thinkingLevel: 'medium',
  },
  audit: DEFAULT_BINDING,
  'events-audit': DEFAULT_BINDING,
  'posthog-doctor': DEFAULT_BINDING,
  'web-analytics-doctor': DEFAULT_BINDING,
  migration: DEFAULT_BINDING,
  'self-driving': DEFAULT_BINDING,
  'agent-skill': DEFAULT_BINDING,
  'mcp-add': DEFAULT_BINDING,
  'mcp-remove': DEFAULT_BINDING,
  'mcp-tutorial': DEFAULT_BINDING,
  'mcp-analytics': DEFAULT_BINDING,
  // Orchestrator on pi. The binding routes only; every stage's model and
  // effort are pinned context-mill side in the flow's frontmatter
  // (`model_pi`/`effort_pi`: terra seed, sol tasks, luna report).
  metrics: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  'replay-vision': {
    sequence: Sequence.orchestrator,
    harness: Harness.anthropic,
    model: DEFAULT_AGENT_MODEL,
  },
  // Orchestrator on pi, like metrics. The binding routes only; every stage's
  // model and effort are pinned context-mill side in the flow's frontmatter
  // (`model_pi`/`effort_pi`: terra seed, install and init, sol tasks, luna report).
  'error-tracking': {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  'ai-observability': {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: GPT5_6_TERRA_MODEL,
    thinkingLevel: 'high',
  },
  slack: DEFAULT_BINDING,
};

/** The binding for a program, or the agent default when none is declared. */
export function bindingFor(programId: string): ProgramBinding {
  return PROGRAM_BINDINGS[programId] ?? DEFAULT_BINDING;
}
