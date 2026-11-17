/** The agent DAG switch: one boolean flag for the orchestrator's repackaged skills. */
import { WIZARD_AGENT_DAG_SKILLS_FLAG_KEY } from '@shared/constants';
import { getContextMillVersion } from '@shared/context-mill-version';

/** Whether tasks read the repackaged step skills, which a run pinned to a context-mill release never does. */
export function isAgentDagSkillsEnabled(
  flags: Record<string, string> = {},
): boolean {
  if (getContextMillVersion()) return false;
  return flags[WIZARD_AGENT_DAG_SKILLS_FLAG_KEY] === 'true';
}
