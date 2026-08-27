/**
 * The structured record an e2e run writes to `E2E_RESULT_JSON`.
 *
 * Split out of `scripts/tui-host.no-jest.ts` so the shape, and the security
 * rail that guards it, can be unit-tested without booting a TUI.
 *
 * Two halves:
 *   {@link E2eRunRecorder} — watches the session for `pendingQuestion` and
 *     `taskNotice` transitions and logs each one, then takes the decision
 *     function's report to fill in how it resolved.
 *   {@link buildE2eResult} — folds that log, the session and the program's
 *     report file into the payload the workbench asserts on.
 *
 * **Security rail.** Only question *prompt text* and question *ids* enter this
 * payload. No answer value ever does. The recorder is never handed an answers
 * map: {@link E2eDecisionReport} carries ids and a keep/decline verdict only,
 * so there is no path for a credential to reach the file.
 */

import fs from 'fs';
import path from 'path';
import { OutroKind, type WizardSession } from '@lib/wizard-session';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';
import type { DetectedSource } from '@lib/warehouse-sources/types';
import type { E2eDecisionReport } from './e2e-profile.js';

/** One `wizard_ask` batch the run was shown. */
export interface E2eAskRecord {
  id: string;
  source: string;
  subject: string | null;
  questionCount: number;
  questionIds: string[];
  /** Prompt text only — never an answer. */
  prompts: string[];
  answeredIds: string[];
  sentinelIds: string[];
  at: string;
}

/** One task-notice overlay the run was shown. */
export interface E2eNoticeRecord {
  title: string;
  items: string[];
  /** Null until the decision function reports how it resolved the notice. */
  decision: 'keep' | 'decline' | null;
  at: string;
}

/** The session fields the recorder watches. */
type ObservedSession = Pick<WizardSession, 'pendingQuestion' | 'taskNotice'>;

/**
 * Log every ask batch and task notice a run passes through.
 *
 * `observe` is edge-triggered: it logs when the watched field transitions into
 * a new value, so calling it on every store commit records each overlay once.
 * Call it from the store subscription *and* before each decision, so a batch
 * that opens and closes between two commits is still caught.
 */
export class E2eRunRecorder {
  readonly asks: E2eAskRecord[] = [];
  readonly notices: E2eNoticeRecord[] = [];
  private lastAskId: string | null = null;
  private lastNoticeTitle: string | null = null;

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Record any new ask batch or task notice on the session. */
  observe(session: ObservedSession): void {
    const pending = session.pendingQuestion;
    if (pending && pending.id !== this.lastAskId) {
      this.asks.push({
        id: pending.id,
        source: pending.source,
        // The wizard has no `subject` field today. Read it defensively so the
        // key stays in the payload if one is added, per the contract.
        subject: (pending as { subject?: string }).subject ?? null,
        questionCount: pending.questions.length,
        questionIds: pending.questions.map((q) => q.id),
        prompts: pending.questions.map((q) => q.prompt),
        answeredIds: [],
        sentinelIds: [],
        at: pending.askedAt ?? this.now(),
      });
    }
    this.lastAskId = pending?.id ?? null;

    const notice = session.taskNotice;
    if (notice && notice.title !== this.lastNoticeTitle) {
      this.notices.push({
        title: notice.title,
        items: [...(notice.items ?? [])],
        decision: null,
        at: this.now(),
      });
    }
    this.lastNoticeTitle = notice?.title ?? null;
  }

  /** Fill in how a decision resolved the ask batch or notice it acted on. */
  applyReport(report: E2eDecisionReport): void {
    if (report.kind === 'ask') {
      const entry = [...this.asks].reverse().find((a) => a.id === report.id);
      if (!entry) return;
      entry.answeredIds = [...report.answeredIds];
      entry.sentinelIds = [...report.sentinelIds];
      return;
    }
    const entry = [...this.notices]
      .reverse()
      .find((n) => n.title === report.title && n.decision === null);
    if (entry) entry.decision = report.decision;
  }

  /** Total sentinel fallbacks across every ask batch. */
  get unansweredAsks(): number {
    return this.asks.reduce((n, a) => n + a.sentinelIds.length, 0);
  }
}

/** The program's report file, resolved against the app directory. */
export interface E2eReportFile {
  path: string;
  exists: boolean;
  /** Present only when the file exists. */
  text?: string;
}

/** Read a program's report file, if it declares one. */
export function readReportFile(
  appDir: string,
  reportFileName: string | undefined,
): E2eReportFile | null {
  if (!reportFileName) return null;
  const full = path.join(appDir, reportFileName);
  try {
    return { path: full, exists: true, text: fs.readFileSync(full, 'utf8') };
  } catch {
    return { path: full, exists: false };
  }
}

/**
 * The abort reason for a run, or null when it did not abort.
 *
 * `wizardAbort` renders an error outro and then exits, so `outroData` is the
 * only durable trace of *why* by the time the host writes its result.
 */
export function abortReasonFrom(
  session: Pick<WizardSession, 'outroData'>,
): string | null {
  const outro = session.outroData;
  if (!outro || outro.kind !== OutroKind.Error) return null;
  return outro.message ?? outro.body ?? 'aborted';
}

/** The warehouse sources detection wrote into frameworkContext. */
export function detectedSourcesFrom(
  session: Pick<WizardSession, 'frameworkContext'>,
): DetectedSource[] {
  const raw = session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY];
  return Array.isArray(raw) ? (raw as DetectedSource[]) : [];
}

/** The keys the result payload carried before the warehouse work. */
export interface E2eResultBase {
  runPhase: string;
  hasPosthogDep: boolean;
  newDeps: string[];
  envFile: string | null;
  screenPath: string[];
  skillsComplete: boolean;
}

/**
 * Build the `E2E_RESULT_JSON` payload. Additive over {@link E2eResultBase} —
 * the pre-existing keys are copied through byte-identical.
 */
export function buildE2eResult(args: {
  base: E2eResultBase;
  recorder: E2eRunRecorder;
  session: Pick<WizardSession, 'frameworkContext' | 'outroData'>;
  tasks: Array<{ label: string; status: string }>;
  reportFile: E2eReportFile | null;
}): Record<string, unknown> {
  const { base, recorder, session, tasks, reportFile } = args;
  return {
    ...base,
    asks: recorder.asks,
    unansweredAsks: recorder.unansweredAsks,
    notices: recorder.notices,
    tasks: tasks.map((t) => ({ label: t.label, status: t.status })),
    detectedSources: detectedSourcesFrom(session).map((s) => ({
      kind: s.kind,
      label: s.label,
      mode: s.mode,
      matchedSignal: s.matchedSignal,
    })),
    reportFile,
    abort: abortReasonFrom(session),
  };
}
