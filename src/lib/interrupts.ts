/**
 * Interrupts take over the active screen until dismissed. The string values
 * are analytics event names, the `$screen_name` tag, and the control API's
 * `currentScreen`; they are a contract.
 */
export enum Interrupt {
  SettingsOverride = 'settings-override',
  ManagedSettings = 'managed-settings',
  PortConflict = 'port-conflict',
  ManualAuthCode = 'manual-auth-code',
  AuthError = 'auth-error',
  SessionTimeout = 'session-timeout',
  WizardAsk = 'wizard-ask',
  TaskNotice = 'task-notice',
}
