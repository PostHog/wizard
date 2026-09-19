/**
 * Screen taxonomy: the component keys the TUI renders. Flow resolution lives
 * in the store (`@lib/flow-resolution`); this module is a pure leaf.
 */

/** Screens that participate in linear programs. */
export enum ScreenId {
  Intro = 'intro',
  RevenueIntro = 'revenue-intro',
  WarehouseIntro = 'warehouse-intro',
  SourceMapsIntro = 'source-maps-intro',
  SourceMapsDetect = 'source-maps-detect',
  SourceMapsOutro = 'source-maps-outro',
  MigrationIntro = 'migration-intro',
  AgentSkillIntro = 'agent-skill-intro',
  AiObservabilityIntro = 'ai-observability-intro',
  MetricsIntro = 'metrics-intro',
  ErrorTrackingIntro = 'error-tracking-intro',
  ErrorTrackingDetect = 'error-tracking-detect',
  SelfDrivingIntro = 'self-driving-intro',
  SelfDrivingIntegrationCheck = 'self-driving-integration-check',
  SelfDrivingIntegrationDetect = 'self-driving-integration-detect',
  SelfDrivingHandoff = 'self-driving-handoff',
  SelfDrivingGithub = 'self-driving-github',
  AuditIntro = 'audit-intro',
  AuditRun = 'audit-run',
  AuditOutro = 'audit-outro',
  HealthCheck = 'health-check',
  DoctorIntro = 'doctor-intro',
  DoctorReport = 'doctor-report',
  Setup = 'setup',
  Auth = 'auth',
  Run = 'run',
  Mcp = 'mcp',
  McpSuggestedPrompts = 'mcp-suggested-prompts',
  SlackConnect = 'slack-connect',
  KeepSkills = 'keep-skills',
  Outro = 'outro',
  MintFailure = 'mint-failure',
  Exit = 'exit',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  AiOptIn = 'ai-opt-in',
}
