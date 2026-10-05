/**
 * A tool is a command that does its job without an agent run. The ids are the
 * program ids these commands had, so analytics `program_id` tags and gateway
 * cost attribution keep their values.
 */
export type ToolId =
  | 'mcp-add'
  | 'mcp-remove'
  | 'mcp-tutorial'
  | 'slack'
  | 'posthog-doctor';

/** A tool with screens: its id, the words that run it and its help line. */
export type ToolConfig = {
  id: ToolId;
  command: string;
  /** The command it nests under, as `mcp` for `wizard mcp add`. */
  parentCommand?: string;
  description: string;
};
