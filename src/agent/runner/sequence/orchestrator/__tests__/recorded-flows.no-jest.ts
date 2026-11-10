/** The agent prompts recorded from context-mill, parsed per flow. */
import fs from 'fs';
import path from 'path';
import {
  parseAgentPrompt,
  type AgentPrompt,
} from '../../../../agent-prompt-loader';

export const CONTEXT_MILL_FIXTURES = path.resolve(
  __dirname,
  '../../../../../../fixtures/context-mill',
);

type AgentMenu = { agents: { id: string; flow?: string }[] };

/** Every recorded prompt of every flow, in the agent menu's order. */
export function recordedFlows(): Map<string, AgentPrompt[]> {
  const menu = JSON.parse(
    fs.readFileSync(
      path.join(CONTEXT_MILL_FIXTURES, 'agent-menu.json'),
      'utf8',
    ),
  ) as AgentMenu;
  const flows = new Map<string, AgentPrompt[]>();
  for (const entry of menu.agents) {
    const flow = entry.flow ?? 'unscoped';
    const file = path.join(
      CONTEXT_MILL_FIXTURES,
      'agents',
      flow,
      `${entry.id}.md`,
    );
    const prompt = parseAgentPrompt(
      fs.readFileSync(file, 'utf8'),
      entry.id,
      entry.flow,
    );
    flows.set(flow, [...(flows.get(flow) ?? []), prompt]);
  }
  return flows;
}
