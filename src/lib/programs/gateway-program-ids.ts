/**
 * The program ids the gateway mints tokens for.
 *
 * The backend admits only the ids in its deploy-time
 * `WIZARD_GATEWAY_PROGRAM_IDS` setting; anything else comes back as a
 * `program_unknown` refusal that ends the run. This list is the client side of
 * that contract: `__tests__/program-registry.test.ts` fails when it drifts from
 * `PROGRAM_REGISTRY`, so a new program cannot ship without a conscious update
 * here and in the backend setting.
 *
 * A leaf module with no imports, so `gateway-session` can read it without
 * importing the program registry, which imports the gateway.
 */
export const GATEWAY_PROGRAM_IDS: readonly string[] = [
  'agent-skill',
  'ai-observability',
  'audit',
  'error-tracking',
  'error-tracking-upload-source-maps',
  'events-audit',
  'mcp-add',
  'mcp-analytics',
  'mcp-remove',
  'mcp-tutorial',
  'metrics',
  'migration',
  'posthog-doctor',
  'posthog-integration',
  'replay-vision',
  'revenue-analytics-setup',
  'self-driving',
  'slack',
  'warehouse-source',
  'web-analytics-doctor',
];

const REGISTERED = new Set(GATEWAY_PROGRAM_IDS);

/** Whether the gateway will mint a token for this program id. */
export function isGatewayProgramId(id: string): boolean {
  return REGISTERED.has(id);
}
