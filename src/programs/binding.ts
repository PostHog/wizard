import { IS_PRODUCTION_BUILD } from '@env';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
} from '@shared/constants';
import { logToFile } from '@utils/debug';
import {
  DEFAULT_AGENT_BINDING,
  harnessRunsTasks,
  resolveHarness,
} from '@agent';
import type {
  ProgramBinding,
  ResolvedBinding,
  SwitchboardCtx as HarnessCtx,
} from '@agent/types';
import type { ProgramId } from './program-registry';
import {
  isOrchestratorEnabled,
  resolveFlagRoute,
  resolveFlagSequence,
} from './experiments';

/** The agent's harness inputs plus the sequence inputs only programs read. */
type SwitchboardCtx = HarnessCtx & {
  flagSequence?: Sequence;
  orchestratorFlagOn?: boolean;
};

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
  const sequence = resolveSequence(resolution);
  const { harness, model, thinkingLevel } = resolveHarness(resolution);
  const binding = { sequence, harness, model, thinkingLevel };
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

function resolveSequence(ctx: SwitchboardCtx): Sequence {
  const [source, sequence] = pickSequence(ctx);
  if (ctx.trace) ctx.trace.sequence = source;
  logToFile(
    `[switchboard] resolved: program=${
      ctx.program ?? '?'
    } sequence=${sequence} (${source})`,
  );
  return sequence;
}

/**
 * The first rung that decides wins: the composed clamp, the dev-build CLI
 * override, the runTask capability clamp, the flag route, the experiment, then
 * the base binding. CLI sits above the capability clamp, so `--sequence
 * orchestrator` still reaches the orchestrator's hard error in dev builds.
 */
function pickSequence(
  ctx: SwitchboardCtx,
): [Required<NonNullable<SwitchboardCtx['trace']>>['sequence'], Sequence] {
  // The orchestrator owns the whole run lifecycle and cannot nest.
  if (ctx.composed) return ['composed', Sequence.linear];
  if (!IS_PRODUCTION_BUILD && ctx.cliSequence) return ['cli', ctx.cliSequence];
  const { harness } = resolveHarness(ctx);
  if (!harnessRunsTasks(harness)) {
    if (ctx.orchestratorFlagOn) {
      logToFile(
        `[switchboard] wizard-orchestrator ignored: ${harness} has no runTask, clamping to linear`,
      );
    }
    return ['runtask-clamp', Sequence.linear];
  }
  if (ctx.flagRoute?.sequence) return ['payload', ctx.flagRoute.sequence];
  if (ctx.flagSequence) return ['flag', ctx.flagSequence];
  return ['binding', (ctx.baseBinding ?? DEFAULT_AGENT_BINDING).sequence];
}
