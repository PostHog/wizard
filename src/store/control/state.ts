import type { WizardSession } from '../session/wizard-session.js';
import type { WizardStore } from '../state/store.js';
import { actionsFor, toActionView } from './actions.js';
import type { ControlSession, ControlState } from './types.js';

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
  'runRequested',
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

const SECRET_REF = /^secret:[0-9a-f-]{16,}$/i;
const SECRET_KEY = /(key|token|secret|password|credential)/i;

/** Values a driver may read; secret refs and secret-looking keys never leave. */
export function redactContext(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SECRET_KEY.test(key)) out[key] = '[redacted]';
    else if (typeof value === 'string' && SECRET_REF.test(value))
      out[key] = '[secret-ref]';
    else out[key] = value;
  }
  return out;
}

function projectSession(s: WizardSession): ControlSession {
  const picked = Object.fromEntries(
    CONTROL_SESSION_KEYS.map((key) => [key, s[key]]),
  ) as Pick<WizardSession, (typeof CONTROL_SESSION_KEYS)[number]>;
  return {
    ...picked,
    frameworkContext: redactContext(s.frameworkContext),
    hasCredentials: s.credentials !== null,
    projectId: s.credentials?.projectId ?? null,
  };
}

/** Project the committed store for a controlling parent. */
export function projectState(store: WizardStore): ControlState {
  const s = store.session;
  const screen = store.currentScreen;
  const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
  return {
    version: store.getVersion(),
    currentScreen: screen,
    session: projectSession(s),
    tasks: [...store.tasks],
    statusMessages: [...store.statusMessages],
    eventPlan: [...store.eventPlan],
    handoffText: store.handoffText,
    setupQuestions: questions
      .filter((q) => !(q.key in s.frameworkContext))
      .map((q) => ({ key: q.key, message: q.message, options: q.options })),
    actions: actionsFor(store.flow, screen).map(toActionView),
  };
}
