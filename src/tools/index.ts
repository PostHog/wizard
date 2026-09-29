/**
 * The tools' one entry. A tool is a command that does its job without an agent
 * run, so it never goes through `runProgram`: the CLI runs its screens through
 * the TUI's `runTuiTool`, or one of the console runners below. Every runner
 * resolves an exit code and the CLI exits with it.
 */
import { MCP_ADD, MCP_REMOVE, MCP_TUTORIAL } from './mcp';
import { SLACK } from './slack';
import { DOCTOR } from './doctor';
import type { ToolConfig, ToolId } from './types';

export type { ToolId };
/** `wizard doctor`'s config: its help line is the command's. */
export { DOCTOR };

/** The tools with screens, in no particular order: `wizard --help` places their commands. */
export const TOOL_REGISTRY: readonly ToolConfig[] = [
  MCP_ADD,
  MCP_REMOVE,
  MCP_TUTORIAL,
  SLACK,
  DOCTOR,
];

/** Typed tool names, from each config's `id`. */
export const Tool = {
  McpAdd: MCP_ADD.id,
  McpRemove: MCP_REMOVE.id,
  McpTutorial: MCP_TUTORIAL.id,
  SlackConnect: SLACK.id,
  PosthogDoctor: DOCTOR.id,
} as const;

/** The tool with this id, or undefined for a program's id. */
export function getTool(id: string): ToolConfig | undefined {
  return TOOL_REGISTRY.find((tool) => tool.id === id);
}

export { runMcpPrompt, type McpPromptChunk } from './mcp';
export { MCP_TUTORIAL_SCOPE_ADDITIONS } from './mcp/scopes';
export { addMcpServer, removeMcpServer } from './mcp/console';
export {
  fetchHealthIssues,
  getKindMeta,
  runDoctorReport,
  type HealthIssue,
  type HealthIssueSeverity,
} from './doctor';
export { runCliAdd } from './cli-steering';
export { runProvision } from './provision';
export { listSkills } from './skill-list';
