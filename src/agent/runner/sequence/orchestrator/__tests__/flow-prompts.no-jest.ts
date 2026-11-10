/** The agent prompts recorded from context-mill and the ones the programs bundle, parsed per flow. */
import fs from 'fs';
import path from 'path';
import {
  parseAgentPrompt,
  type AgentPrompt,
} from '../../../../agent-prompt-loader';

const ROOT = path.resolve(__dirname, '../../../../../..');
const PROGRAMS = path.join(ROOT, 'src/programs');

export const CONTEXT_MILL_FIXTURES = path.join(ROOT, 'fixtures/context-mill');

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

/** Every program's `agent/` folder, parsed, keyed by the flow its prompts name. */
export function bundledFlows(): Map<string, AgentPrompt[]> {
  const flows = new Map<string, AgentPrompt[]>();
  for (const program of fs.readdirSync(PROGRAMS).sort()) {
    const dir = path.join(PROGRAMS, program, 'agent');
    if (!fs.existsSync(dir)) continue;
    const prompts = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .map((file) =>
        parseAgentPrompt(
          fs.readFileSync(path.join(dir, file), 'utf8'),
          file.replace(/\.md$/, ''),
          program,
        ),
      );
    flows.set(prompts[0]?.flow ?? program, prompts);
  }
  return flows;
}
