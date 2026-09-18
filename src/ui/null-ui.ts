// Inert default: the store never constructs a renderer, the entry point does.

import type { WizardUI, SpinnerHandle } from './wizard-ui';
import type { AskAnswers } from '@lib/wizard-session';

const noop = (): void => undefined;

export class NullUI implements WizardUI {
  readonly interactive = false;

  intro = noop;
  outro = noop;
  outroError = noop;
  cancel = noop;
  note = noop;
  pushStatus = noop;
  startRun = noop;
  setCredentials = noop;
  setAccessToken = noop;
  setRoleAtOrganization = noop;
  setApiUser = noop;
  setReadinessWarnings = noop;
  setDetectedFramework = noop;
  onEnterScreen = noop;
  setLoginUrl = noop;
  setAuthorizeUrl = noop;
  showAuthError = noop;
  showSessionTimeout = noop;
  cancelTaskNotice = noop;
  cancelPendingQuestion = noop;
  syncTodos = noop;
  setEventPlan = noop;
  setDashboardUrl = noop;
  setStage = noop;
  setNotebookUrl = noop;
  setHandoffText = noop;
  addTokenUsage = noop;
  setFinalTokenCostUsd = noop;
  setOutroData = noop;
  setFrameworkContext = noop;

  log = {
    info: noop,
    warn: noop,
    error: noop,
    success: noop,
    step: noop,
  };

  spinner(): SpinnerHandle {
    return { start: noop, stop: noop, message: noop };
  }

  waitForOutroDismissed(): Promise<void> {
    return Promise.resolve();
  }

  waitForAiOptIn(): Promise<void> {
    return Promise.resolve();
  }

  waitForGate(): Promise<void> {
    return Promise.resolve();
  }

  showBlockingOutage(): Promise<void> {
    return Promise.resolve();
  }

  showPortConflict(): Promise<void> {
    return Promise.resolve();
  }

  showSettingsOverride(): Promise<void> {
    return Promise.resolve();
  }

  showTaskNotice(): Promise<boolean> {
    return Promise.resolve(false);
  }

  waitForManualAuthCode(): Promise<string> {
    // No prompt to answer it, so the OAuth race is left to the callback server.
    return new Promise<string>(() => undefined);
  }

  requestQuestion(): Promise<AskAnswers> {
    return Promise.reject(
      new Error(
        'wizard_ask is not available in CI / non-interactive mode. ' +
          'Re-run the wizard without --ci to answer interactively.',
      ),
    );
  }

  getFrameworkContext(): unknown {
    return undefined;
  }
}
