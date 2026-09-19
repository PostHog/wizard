/** Public runtime API of the agent surface. */
export { detectProjectsWithAgent } from './detection/agentic.js';
export { configureGatewayFromCIEnvironment } from './gateway/gateway-session.js';
export { runMcpPromptViaSdk } from './mcp-prompt-streaming.js';
export { runAgent } from './runner/index.js';
