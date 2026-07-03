/**
 * Agent signal vocabulary — the marker strings the agent emits and the error
 * taxonomy the runner returns. Kept as a dependency-free leaf module so both
 * `agent-interface.ts` and `output-signals.ts` can import it without a cycle.
 */

export const AgentSignals = {
  /** Signal emitted when the agent reports progress to the user */
  STATUS: '[STATUS]',
  /** Signal emitted when the agent cannot access the PostHog MCP server */
  ERROR_MCP_MISSING: '[ERROR-MCP-MISSING]',
  /** Signal emitted when the agent cannot access the setup resource */
  ERROR_RESOURCE_MISSING: '[ERROR-RESOURCE-MISSING]',
  /**
   * Signal emitted when the agent cannot complete the program and is
   * aborting intentionally (distinct from errors). Format: "[ABORT] <reason>".
   * Programs can declare an onAbort handler to render a custom screen.
   */
  ABORT: '[ABORT]',
  /** Signal emitted when the agent provides a remark about its run */
  WIZARD_REMARK: '[WIZARD-REMARK]',
  /** Signal prefix for benchmark logging */
  BENCHMARK: '[BENCHMARK]',
  /**
   * Signal emitted when the agent has created a PostHog dashboard for the
   * user. Format: `[DASHBOARD_URL] <full https url>`. The URL is captured
   * onto `session.dashboardUrl` and surfaced by programs in their outro.
   */
  DASHBOARD_URL: '[DASHBOARD_URL]',
  /**
   * Signal emitted when the agent has uploaded a report to a PostHog
   * notebook. Format: `[NOTEBOOK_URL] <full https url>`. The URL is captured
   * onto `session.notebookUrl` and surfaced by programs in their outro.
   */
  NOTEBOOK_URL: '[NOTEBOOK_URL]',
} as const;

export type AgentSignal = (typeof AgentSignals)[keyof typeof AgentSignals];

/**
 * The end-of-run reflection ask, shared by both harnesses so the remarks they
 * produce are comparable: the anthropic path delivers it via its Stop hook,
 * the pi path as a follow-up prompt after the run completes.
 */
export const REMARK_INSTRUCTION = `Before concluding, provide a brief remark about what information or guidance would have been useful to have in the integration prompt or documentation for this run. Specifically cite anything that would have prevented tool failures, erroneous edits, or other wasted turns. Format your response exactly as: ${AgentSignals.WIZARD_REMARK} Your remark here`;

/**
 * Error types that can be returned from agent execution.
 * These correspond to the error signals that the agent emits.
 */
export enum AgentErrorType {
  /** Agent could not access the PostHog MCP server */
  MCP_MISSING = 'WIZARD_MCP_MISSING',
  /** Agent could not access the setup resource */
  RESOURCE_MISSING = 'WIZARD_RESOURCE_MISSING',
  /** API rate limit exceeded */
  RATE_LIMIT = 'WIZARD_RATE_LIMIT',
  /** Generic API error */
  API_ERROR = 'WIZARD_API_ERROR',
  /** YARA scanner detected a security violation */
  YARA_VIOLATION = 'WIZARD_YARA_VIOLATION',
  /** Agent intentionally aborted the program (emitted [ABORT] <reason>) */
  ABORT = 'WIZARD_ABORT',
}
