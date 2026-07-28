/**
 * Agent run phases — what the wizard agent is currently doing, derived from
 * the tool it's running. The Visualizer reads `store.currentStage.stage`
 * and renders the matching ASCII visual.
 */

export enum AgentPhase {
  CodebaseScan = 'codebase-scan',
  SkillInstall = 'skill-install',
  DepInstall = 'dep-install',
  CodeEdits = 'code-edits',
  EnvSetup = 'env-setup',
  Dashboards = 'dashboards',
}

/** Maps a Claude SDK tool name to the phase that tool implies. Returns null
 *  when the tool doesn't drive the visualizer (Task*, TodoWrite, etc.). */
export function classifyToolToStage(toolName: string): AgentPhase | null {
  if (
    toolName.includes('install_skill') ||
    toolName.includes('load_skill_menu')
  ) {
    return AgentPhase.SkillInstall;
  }
  if (
    toolName.includes('set_env_values') ||
    toolName.includes('check_env_keys')
  ) {
    return AgentPhase.EnvSetup;
  }
  if (toolName.includes('mcp__posthog')) {
    return AgentPhase.Dashboards;
  }
  if (toolName === 'Bash') return AgentPhase.DepInstall;
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    return AgentPhase.CodeEdits;
  }
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    return AgentPhase.CodebaseScan;
  }
  return null;
}
