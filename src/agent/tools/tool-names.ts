/** Tool ids programs name in allowedTools and disallowedTools. Data only. */

export const SERVER_NAME = 'wizard-tools';

/** Tool names exposed by the wizard-tools server, keyed for selective use. */
// SDK expects MCP tool names in allowedTools/disallowedTools to be the
// fully-qualified `mcp__<server>__<tool>` form (sdk.d.ts: "Fully-qualified
// MCP tool name, e.g. mcp__server__tool_name."). The colon form silently
// fails to match, which made every program's `disallowedTools` entry a no-op.
export const WIZARD_TOOL_NAMES = {
  checkEnvKeys: `mcp__${SERVER_NAME}__check_env_keys`,
  setEnvValues: `mcp__${SERVER_NAME}__set_env_values`,
  detectPackageManager: `mcp__${SERVER_NAME}__detect_package_manager`,
  loadSkillMenu: `mcp__${SERVER_NAME}__load_skill_menu`,
  installSkill: `mcp__${SERVER_NAME}__install_skill`,
  auditSeedChecks: `mcp__${SERVER_NAME}__audit_seed_checks`,
  auditAddChecks: `mcp__${SERVER_NAME}__audit_add_checks`,
  auditResolveChecks: `mcp__${SERVER_NAME}__audit_resolve_checks`,
  wizardAsk: `mcp__${SERVER_NAME}__wizard_ask`,
  publishHandoff: `mcp__${SERVER_NAME}__publish_handoff`,
  enqueueTask: `mcp__${SERVER_NAME}__enqueue_task`,
  completeTask: `mcp__${SERVER_NAME}__complete_task`,
  readHandoffs: `mcp__${SERVER_NAME}__read_handoffs`,
} as const;
