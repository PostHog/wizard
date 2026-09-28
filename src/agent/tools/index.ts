/**
 * Wizard tools — `./tools` is the shared behavior core, `./mcp` the MCP
 * facade the anthropic harness mounts (pi's facade lives with its harness).
 * Re-exported together so importers keep the `@lib/wizard-tools` path.
 */
export * from './tools';
export * from './mcp';
