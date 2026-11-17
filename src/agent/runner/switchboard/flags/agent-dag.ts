/** The agent DAG switches: one boolean flag for the orchestrator's `wizard-agent-dag` paths, and one for its repackaged skills. */
import {
  WIZARD_AGENT_DAG_FLAG_KEY,
  WIZARD_AGENT_DAG_SKILLS_FLAG_KEY,
} from '@shared/constants';
import { getContextMillVersion } from '@shared/context-mill-version';

/** Whether the run takes those paths, which a run pinned to a context-mill release never does; see the [sequence README](../../sequence/README.md#orchestrator). */
export function isAgentDagEnabled(flags: Record<string, string> = {}): boolean {
  if (getContextMillVersion()) return false;
  return flags[WIZARD_AGENT_DAG_FLAG_KEY] === 'true';
}

/** Whether tasks read the repackaged step skills, which a run pinned to a context-mill release never does. */
export function isAgentDagSkillsEnabled(
  flags: Record<string, string> = {},
): boolean {
  if (getContextMillVersion()) return false;
  return flags[WIZARD_AGENT_DAG_SKILLS_FLAG_KEY] === 'true';
}
