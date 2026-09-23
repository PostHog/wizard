/** Lifecycle phase of the main program work (agent run, MCP install, etc.). */
export enum RunPhase {
  Idle = 'idle',
  Running = 'running',
  Completed = 'completed',
  Error = 'error',
}

/** Outcome of the MCP server installation program step. */
export enum McpOutcome {
  NoClients = 'no_clients',
  Skipped = 'skipped',
  Installed = 'installed',
  Failed = 'failed',
}

/** Task state shared by program progress and its TUI projection. */
export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Skipped = 'skipped',
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (Object.values(TaskStatus) as string[]).includes(value);
}
