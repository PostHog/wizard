import type { WizardStore } from '../state/store.js';
import { actionsFor, toActionView } from './actions.js';
import type {
  ControlState,
  OutroView,
  RunResult,
  RunStatus,
  SetupQuestionView,
} from './types.js';

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

/** FNV-1a over the serialized context; a change signal, not a secret hash. */
export function contextDigest(ctx: Record<string, unknown>): string {
  const s = JSON.stringify(ctx);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function outroView(store: WizardStore): OutroView | null {
  const data = store.session.outroData;
  if (!data) return null;
  return {
    kind: data.kind,
    ...(data.errorCode ? { errorCode: data.errorCode } : {}),
    ...(data.message ? { message: data.message } : {}),
    ...(data.body ? { body: data.body } : {}),
    ...(data.docsUrl ? { docsUrl: data.docsUrl } : {}),
  };
}

/** What a finished run leaves behind, for the ledger. */
export function runResult(store: WizardStore): RunResult {
  const s = store.session;
  return {
    runPhase: s.runPhase,
    outroData: outroView(store),
    dashboardUrl: s.dashboardUrl,
    notebookUrl: s.notebookUrl,
    handoffText: store.handoffText,
  };
}

function setupQuestions(store: WizardStore): SetupQuestionView[] {
  const s = store.session;
  const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
  return questions
    .filter((q) => !(q.key in s.frameworkContext))
    .map((q) => ({
      key: q.key,
      message: q.message,
      options: q.options.map((o) => ({
        label: o.label,
        value: o.value,
        ...(o.hint ? { hint: o.hint } : {}),
      })),
    }));
}

/** Project the committed store state for a controlling parent. */
export function projectState(
  store: WizardStore,
  run: { status: RunStatus; error: string | null },
): ControlState {
  const s = store.session;
  const screen = store.currentScreen;
  return {
    version: store.getVersion(),
    currentScreen: screen,
    hasOverlay: store.hasInterrupt,
    runPhase: s.runPhase,
    run,
    session: {
      installDir: s.installDir,
      integration: s.integration,
      detectedFrameworkLabel: s.detectedFrameworkLabel,
      detectionComplete: s.detectionComplete,
      setupConfirmed: s.setupConfirmed,
      integrate: s.integrate,
      hasCredentials: s.credentials !== null,
      projectId: s.credentials?.projectId ?? null,
      mcpComplete: s.mcpComplete,
      slackStepDismissed: s.slackStepDismissed,
      skillsComplete: s.skillsComplete,
      outroDismissed: s.outroDismissed,
      llmOptIn: s.llmOptIn,
      discoveredFeatures: [...s.discoveredFeatures],
      runRequested: s.runRequested,
      completedRuns: [...s.completedRuns],
    },
    tasks: store.tasks.map((t) => ({
      label: t.label,
      status: t.status,
      ...(t.activeForm ? { activeForm: t.activeForm } : {}),
    })),
    statusMessages: [...store.statusMessages],
    eventPlan: store.eventPlan.map((e) => ({
      name: e.name,
      description: e.description,
    })),
    pendingQuestion: s.pendingQuestion ?? null,
    taskNotice: s.taskNotice
      ? {
          title: s.taskNotice.title,
          items: [...(s.taskNotice.items ?? [])],
          prompt: s.taskNotice.prompt,
        }
      : null,
    setupQuestions: setupQuestions(store),
    actions: actionsFor(store.flow, screen).map(toActionView),
    dashboardUrl: s.dashboardUrl,
    notebookUrl: s.notebookUrl,
    handoffText: store.handoffText,
    outroData: outroView(store),
    frameworkContext: {
      keys: Object.keys(s.frameworkContext).sort(),
      digest: contextDigest(s.frameworkContext),
      values: redactContext(s.frameworkContext),
    },
  };
}
