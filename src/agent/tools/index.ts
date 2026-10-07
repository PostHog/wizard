/**
 * Wizard tools — `./tools` is the shared behavior core, `./mcp` the MCP
 * facade the anthropic harness mounts (pi's facade lives with its harness).
 * Re-exported together so the agent imports both from `@agent/tools`.
 */
export * from './tools';
export * from './mcp';
