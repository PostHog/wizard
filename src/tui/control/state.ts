import { sanitizeErrorDetail } from '@shared/errors';
import { redactContext } from '@shared/control/redact';
import type { ControlState } from '@shared/control/types';
import { RunPhase } from '@shared/run-state';
import type { WizardSession } from '../session.js';
import type { WizardStore } from '../store.js';

/** The session fields a parent may read; everything else stays in the process. */
export const CONTROL_SESSION_KEYS = [
  'installDir',
  'integration',
  'detectedFrameworkLabel',
  'detectionComplete',
  'frameworkContext',
  'setupConfirmed',
  'integrate',
  'llmOptIn',
  'discoveredFeatures',
  'runPhase',
  'completedRuns',
  'pendingQuestion',
  'taskNotice',
  'outroData',
  'outroDismissed',
  'dashboardUrl',
  'notebookUrl',
  'mcpComplete',
  'slackStepDismissed',
  'skillsComplete',
] as const satisfies readonly (keyof WizardSession)[];

function projectSession(s: WizardSession): Record<string, unknown> {
  const picked = Object.fromEntries(
    CONTROL_SESSION_KEYS.map((key) => [key, s[key]]),
  );
  return {
    ...picked,
    frameworkContext: redactContext(s.frameworkContext),
    outroData: s.outroData
      ? {
          ...s.outroData,
          ...(s.outroData.errorDetail
            ? { errorDetail: sanitizeErrorDetail(s.outroData.errorDetail) }
            : {}),
        }
      : null,
    hasCredentials: s.credentials !== null,
    projectId: s.credentials?.projectId ?? null,
  };
}

/** Project the committed store for a controlling parent; the server adds mode, actions and writes. */
export function projectState(
  store: WizardStore,
  currentScreen: string | null,
): Omit<ControlState, 'mode' | 'actions' | 'controlWrites'> {
  const s = store.session;
  const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
  return {
    version: store.getVersion(),
    currentScreen,
    session: projectSession(s),
    tasks: store.tasks.map((t) => ({ label: t.label, status: t.status })),
    statusMessages: [...store.statusMessages],
    eventPlan: [...store.eventPlan],
    handoffText: store.handoffText,
    setupQuestions: questions
      .filter((q) => !(q.key in s.frameworkContext))
      .map((q) => ({ key: q.key, message: q.message, options: q.options })),
  };
}

/** True while an agent run is in flight in this store. */
export function runInFlight(store: WizardStore): boolean {
  return store.session.runPhase === RunPhase.Running;
}
