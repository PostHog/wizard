/** Core screen ids and overlays: a leaf module, so program entries and the TUI entry name them at load time. */

/**
 * The screens the core mounts. A program's own screens are named in its
 * folder (`programs/<id>/screen-ids.ts`) and mounted through its TUI entry.
 */
export enum ScreenId {
  HealthCheck = 'health-check',
  Setup = 'setup',
  Auth = 'auth',
  Run = 'run',
  Mcp = 'mcp',
  SlackConnect = 'slack-connect',
  KeepSkills = 'keep-skills',
  Outro = 'outro',
  MintFailure = 'mint-failure',
  Exit = 'exit',
  AiOptIn = 'ai-opt-in',
}

/** Screens that interrupt programs as overlays. */
export enum Overlay {
  SettingsOverride = 'settings-override',
  ManagedSettings = 'managed-settings',
  PortConflict = 'port-conflict',
  ManualAuthCode = 'manual-auth-code',
  AuthError = 'auth-error',
  SessionTimeout = 'session-timeout',
  WizardAsk = 'wizard-ask',
  TaskNotice = 'task-notice',
}
