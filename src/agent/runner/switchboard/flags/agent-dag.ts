/** The agent DAG switch: one boolean flag whose on path must change nothing a run does. */
import { WIZARD_AGENT_DAG_FLAG_KEY } from '@shared/constants';

/** Whether the criteria resolver decides each orchestrator task's skills. Off, it runs in shadow beside the exact-match pick. */
export function isAgentDagEnabled(flags: Record<string, string> = {}): boolean {
  return flags[WIZARD_AGENT_DAG_FLAG_KEY] === 'true';
}
