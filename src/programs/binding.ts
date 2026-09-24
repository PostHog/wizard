import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
} from '@shared/constants';
import { DEFAULT_AGENT_BINDING, resolveBinding, resolveHarness } from '@agent';
import type {
  ProgramBinding,
  ResolvedBinding,
  SwitchboardCtx,
} from '@agent/types';
import type { ProgramId } from './program-registry';
import {
  isOrchestratorEnabled,
  resolveFlagRoute,
  resolveFlagSequence,
} from './experiments';

export interface ProgramSwitchboardCtx {
  program: ProgramId;
  composed?: boolean;
  flags: Record<string, string>;
  flagPayloads?: Record<string, unknown>;
  cliHarness?: Harness;
  cliSequence?: Sequence;
  cliModel?: string;
  trace?: SwitchboardCtx['trace'];
}

/** Program routes. The registry lockstep contract is tested at this boundary. */
export const PROGRAM_BINDINGS: Partial<Record<ProgramId, ProgramBinding>> = {
  'posthog-integration': DEFAULT_AGENT_BINDING,
  'revenue-analytics-setup': DEFAULT_AGENT_BINDING,
  'warehouse-source': DEFAULT_AGENT_BINDING,
  'error-tracking-upload-source-maps': {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: GPT5_6_SOL_MODEL,
    thinkingLevel: 'medium',
  },
  audit: DEFAULT_AGENT_BINDING,
  'events-audit': DEFAULT_AGENT_BINDING,
  'posthog-doctor': DEFAULT_AGENT_BINDING,
  'web-analytics-doctor': DEFAULT_AGENT_BINDING,
  migration: DEFAULT_AGENT_BINDING,
  'self-driving': DEFAULT_AGENT_BINDING,
  'agent-skill': DEFAULT_AGENT_BINDING,
  'mcp-add': DEFAULT_AGENT_BINDING,
  'mcp-remove': DEFAULT_AGENT_BINDING,
  'mcp-tutorial': DEFAULT_AGENT_BINDING,
  'mcp-analytics': DEFAULT_AGENT_BINDING,
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
  slack: DEFAULT_AGENT_BINDING,
};

/** Resolve product policy once; the agent receives only the resulting route. */
export function resolveProgramBinding(
  ctx: ProgramSwitchboardCtx,
): ResolvedBinding {
  ctx.trace ??= {};
  const baseBinding: ProgramBinding =
    PROGRAM_BINDINGS[ctx.program] ?? DEFAULT_AGENT_BINDING;
  const resolution = {
    program: ctx.program,
    baseBinding,
    composed: ctx.composed,
    flagRoute: resolveFlagRoute(ctx.program, ctx.flags, ctx.flagPayloads),
    flagSequence: resolveFlagSequence(ctx.program, ctx.flags),
    orchestratorFlagOn: isOrchestratorEnabled(ctx.flags),
    cliHarness: ctx.cliHarness,
    cliSequence: ctx.cliSequence,
    cliModel: ctx.cliModel,
    trace: ctx.trace,
  };
  const binding = resolveBinding(resolution);
  const roles = Object.keys(baseBinding.contextMillOverride ?? {});
  if (roles.length === 0) return binding;
  return {
    ...binding,
    roleBindings: Object.fromEntries(
      roles.map((role) => [
        role,
        resolveHarness({ ...resolution, trace: undefined }, role),
      ]),
    ),
  };
}
