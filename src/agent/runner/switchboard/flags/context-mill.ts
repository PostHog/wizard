/** The context-mill refactor's switches: each new path is off unless its flag says otherwise, and off is today's behavior. */
import {
  WIZARD_BUNDLED_AGENT_PROMPTS_FLAG_KEY,
  WIZARD_SKILL_RESOLVER_FLAG_KEY,
  WIZARD_TYPED_GRAPH_FLAG_KEY,
} from '@shared/constants';

/** The criteria resolver picks each task's skills; off, it only runs in shadow. */
export function isSkillResolverEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_SKILL_RESOLVER_FLAG_KEY] === 'true';
}

/** A flow's agent prompts load from the wizard's bundle; off, they are fetched from context-mill. */
export function areBundledPromptsEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_BUNDLED_AGENT_PROMPTS_FLAG_KEY] === 'true';
}

/** Whether this flow's typed graph replaces the planner's edges: the flag on, and the flow in its payload's `flows`. */
export function isTypedGraphEnabled(
  flow: string,
  flags: Record<string, string> = {},
  flagPayloads: Record<string, unknown> = {},
): boolean {
  if (flags[WIZARD_TYPED_GRAPH_FLAG_KEY] !== 'true') return false;
  let payload = flagPayloads[WIZARD_TYPED_GRAPH_FLAG_KEY];
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return false;
    }
  }
  const flows = (payload as { flows?: unknown } | null)?.flows;
  return Array.isArray(flows) && flows.includes(flow);
}
