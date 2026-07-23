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
   * Signal emitted when `install_skill` failed and the agent is continuing
   * the integration WITHOUT the skill (best-effort from its own knowledge).
   * Format: "[SKILL-INSTALL-FAILED] <skill id — reason>". Non-fatal by
   * design: a freestyled integration beats an outright failure, but the run
   * must be measurable — the runner captures it as an analytics event.
   */
  SKILL_INSTALL_FAILED: '[SKILL-INSTALL-FAILED]',
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
 * End-of-run reflection ask, shared by both harnesses so remarks are
 * comparable. The format clause comes FIRST and nothing trails the marker —
 * literal models (gpt-5-mini) echo whatever text follows it. The parser also
 * drops remarks that quote this instruction (see AgentOutputSignals.remark).
 */
export const REMARK_INSTRUCTION = `Reply with a single line that starts with ${AgentSignals.WIZARD_REMARK} and no other lines. In that line, state briefly what information or guidance would have been useful to have in the integration prompt or documentation for this run — specifically anything that would have prevented tool failures, erroneous edits, or other wasted turns.`;

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
  /**
   * The LLM gateway refused the requested model for this org's plan (403). The
   * model a task was routed to (e.g. opus) is not included in the org's plan —
   * distinct from an auth failure (401). The anthropic harness retries on the
   * default model; this only reaches the user when that fallback also fails.
   */
  MODEL_PLAN_GATED = 'WIZARD_MODEL_PLAN_GATED',
  /** Generic API error */
  API_ERROR = 'WIZARD_API_ERROR',
  /** YARA scanner detected a security violation */
  YARA_VIOLATION = 'WIZARD_YARA_VIOLATION',
  /** Agent intentionally aborted the program (emitted [ABORT] <reason>) */
  ABORT = 'WIZARD_ABORT',
  /** Agent ended without making a single tool call — a no-op run that did no work */
  NO_PROGRESS = 'WIZARD_NO_PROGRESS',
  /** Agent acted but stopped short — planned tasks left open and/or no skill installed */
  INCOMPLETE_TASKS = 'WIZARD_INCOMPLETE_TASKS',
}
