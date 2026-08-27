/**
 * The `E2E_RESULT_JSON` payload: what a run records about its asks, notices,
 * tasks and detected sources — and, above all, what it must never record.
 *
 * The security rail is the reason this file exists. The workbench injects known
 * credential values into a run and scans the payload for them; if one ever
 * appears, a CI artifact is leaking secrets. The rail is structural here — the
 * recorder is never handed an answers map — so these tests pin the structure.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { OutroKind, RunPhase } from '@lib/wizard-session';
import type { AskQuestion, WizardSession } from '@lib/wizard-session';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';
import { Overlay } from '@ui/tui/router';
import {
  E2eRunRecorder,
  abortReasonFrom,
  buildE2eResult,
  detectedSourcesFrom,
  readReportFile,
} from '../e2e-result';
import { DEFAULT_E2E_PROFILE, decideE2eAction } from '../e2e-profile';
import type { CiState } from '../wizard-ci-driver';

const SECRET = 'sk_live_do_not_leak_9f2b';

const question = (id: string, prompt: string): AskQuestion => ({
  id,
  prompt,
  kind: 'text',
});

function observed(over: {
  pendingQuestion?: WizardSession['pendingQuestion'];
  taskNotice?: WizardSession['taskNotice'];
}) {
  return {
    pendingQuestion: over.pendingQuestion ?? null,
    taskNotice: over.taskNotice ?? null,
  };
}

const ask = (id: string, questions: AskQuestion[]) => ({
  id,
  source: 'data-warehouse-source-setup',
  questions,
  askedAt: '2026-08-27T10:00:00.000Z',
});

const notice = (title: string, items: string[] = []) => ({
  title,
  body: ['copy'],
  items,
  confirmLabel: 'Continue',
  cancelLabel: 'Skip',
  prompt: 'Connect these during setup?',
});

describe('E2eRunRecorder — ask batches', () => {
  it('records a batch once, however many commits it survives', () => {
    const recorder = new E2eRunRecorder();
    const session = observed({
      pendingQuestion: ask('a1', [question('h', 'Host')]),
    });
    recorder.observe(session);
    recorder.observe(session);
    recorder.observe(session);
    expect(recorder.asks).toHaveLength(1);
  });

  it('captures the contract fields for the batch', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(
      observed({
        pendingQuestion: ask('a1', [
          question('host', 'Postgres host'),
          question('port', 'Port'),
        ]),
      }),
    );
    expect(recorder.asks[0]).toEqual({
      id: 'a1',
      source: 'data-warehouse-source-setup',
      subject: null,
      questionCount: 2,
      questionIds: ['host', 'port'],
      prompts: ['Postgres host', 'Port'],
      answeredIds: [],
      sentinelIds: [],
      at: '2026-08-27T10:00:00.000Z',
    });
  });

  it('records a second batch after the first closes', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(
      observed({ pendingQuestion: ask('a1', [question('h', 'Host')]) }),
    );
    recorder.observe(observed({}));
    recorder.observe(
      observed({ pendingQuestion: ask('a2', [question('p', 'Port')]) }),
    );
    expect(recorder.asks.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('records back-to-back batches with no null commit between them', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(
      observed({ pendingQuestion: ask('a1', [question('h', 'Host')]) }),
    );
    recorder.observe(
      observed({ pendingQuestion: ask('a2', [question('p', 'Port')]) }),
    );
    expect(recorder.asks.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('fills in the answered/sentinel split from the decision report', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(
      observed({
        pendingQuestion: ask('a1', [
          question('host', 'Host'),
          question('password', 'Password'),
        ]),
      }),
    );
    recorder.applyReport({
      kind: 'ask',
      id: 'a1',
      answeredIds: ['host'],
      sentinelIds: ['password'],
    });
    expect(recorder.asks[0].answeredIds).toEqual(['host']);
    expect(recorder.asks[0].sentinelIds).toEqual(['password']);
    expect(recorder.unansweredAsks).toBe(1);
  });

  it('ignores a report for a batch it never saw', () => {
    const recorder = new E2eRunRecorder();
    recorder.applyReport({
      kind: 'ask',
      id: 'ghost',
      answeredIds: [],
      sentinelIds: ['x'],
    });
    expect(recorder.asks).toEqual([]);
    expect(recorder.unansweredAsks).toBe(0);
  });

  it('sums sentinel fallbacks across every batch', () => {
    const recorder = new E2eRunRecorder();
    for (const id of ['a1', 'a2']) {
      recorder.observe(
        observed({ pendingQuestion: ask(id, [question('p', 'P')]) }),
      );
      recorder.observe(observed({}));
      recorder.applyReport({
        kind: 'ask',
        id,
        answeredIds: [],
        sentinelIds: ['p'],
      });
    }
    expect(recorder.unansweredAsks).toBe(2);
  });
});

describe('E2eRunRecorder — task notices', () => {
  it('records a notice once and takes its decision from the report', () => {
    const recorder = new E2eRunRecorder(() => '2026-08-27T11:00:00.000Z');
    const session = observed({
      taskNotice: notice('Connect your data sources', ['Postgres']),
    });
    recorder.observe(session);
    recorder.observe(session);
    recorder.applyReport({
      kind: 'notice',
      title: 'Connect your data sources',
      decision: 'keep',
    });
    expect(recorder.notices).toEqual([
      {
        title: 'Connect your data sources',
        items: ['Postgres'],
        decision: 'keep',
        at: '2026-08-27T11:00:00.000Z',
      },
    ]);
  });

  it('records a declined notice', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(observed({ taskNotice: notice('Optional step') }));
    recorder.applyReport({
      kind: 'notice',
      title: 'Optional step',
      decision: 'decline',
    });
    expect(recorder.notices[0].decision).toBe('decline');
  });

  it('leaves the decision null when nothing resolved the notice', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(observed({ taskNotice: notice('Optional step') }));
    expect(recorder.notices[0].decision).toBeNull();
  });

  it('fills the newest unresolved notice when a title repeats', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(observed({ taskNotice: notice('Optional step') }));
    recorder.applyReport({
      kind: 'notice',
      title: 'Optional step',
      decision: 'keep',
    });
    recorder.observe(observed({}));
    recorder.observe(observed({ taskNotice: notice('Optional step') }));
    recorder.applyReport({
      kind: 'notice',
      title: 'Optional step',
      decision: 'decline',
    });
    expect(recorder.notices.map((n) => n.decision)).toEqual([
      'keep',
      'decline',
    ]);
  });
});

describe('abortReasonFrom', () => {
  it('is null for a run that did not abort', () => {
    expect(abortReasonFrom({ outroData: null })).toBeNull();
  });

  it('is null for a successful outro', () => {
    expect(
      abortReasonFrom({
        outroData: { kind: OutroKind.Success, message: 'Done!' },
      }),
    ).toBeNull();
  });

  it('reads the error outro the abort path left behind', () => {
    expect(
      abortReasonFrom({
        outroData: {
          kind: OutroKind.Error,
          message: 'No data source detected',
        },
      }),
    ).toBe('No data source detected');
  });

  it('falls back to the body when the error outro has no headline', () => {
    expect(
      abortReasonFrom({ outroData: { kind: OutroKind.Error, body: 'boom' } }),
    ).toBe('boom');
  });
});

describe('detectedSourcesFrom', () => {
  it('is empty when detection wrote nothing', () => {
    expect(detectedSourcesFrom({ frameworkContext: {} })).toEqual([]);
  });

  it('reads the framework-context key detection writes', () => {
    const source = {
      kind: 'Postgres',
      label: 'PostgreSQL',
      mode: 'in-cli',
      matchedSignal: 'pg in package.json',
    };
    expect(
      detectedSourcesFrom({
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: [source] },
      }),
    ).toEqual([source]);
  });

  it('ignores a non-array value rather than throwing', () => {
    expect(
      detectedSourcesFrom({
        frameworkContext: { [DETECTED_WAREHOUSE_SOURCES_KEY]: 'nope' },
      }),
    ).toEqual([]);
  });
});

describe('readReportFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-report-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is null when the program declares no report file', () => {
    expect(readReportFile(dir, undefined)).toBeNull();
  });

  it('reports a missing file without its text', () => {
    const result = readReportFile(dir, 'posthog-warehouse-report.md');
    expect(result).toEqual({
      path: path.join(dir, 'posthog-warehouse-report.md'),
      exists: false,
    });
  });

  it('reads the text when the agent wrote the report', () => {
    fs.writeFileSync(
      path.join(dir, 'posthog-warehouse-report.md'),
      '# Report\n',
    );
    expect(readReportFile(dir, 'posthog-warehouse-report.md')).toEqual({
      path: path.join(dir, 'posthog-warehouse-report.md'),
      exists: true,
      text: '# Report\n',
    });
  });
});

describe('buildE2eResult', () => {
  const base = {
    runPhase: RunPhase.Completed,
    hasPosthogDep: true,
    newDeps: ['posthog-node'],
    envFile: '/app/.env',
    screenPath: ['warehouse-intro', 'run'],
    skillsComplete: true,
  };

  function build(recorder = new E2eRunRecorder()) {
    return buildE2eResult({
      base,
      recorder,
      session: {
        frameworkContext: {
          [DETECTED_WAREHOUSE_SOURCES_KEY]: [
            {
              kind: 'Postgres',
              label: 'PostgreSQL',
              mode: 'in-cli',
              matchedSignal: 'found DATABASE_URL',
            },
          ],
        },
        outroData: null,
      },
      tasks: [
        { label: 'Connect your data sources', status: 'completed', done: true },
      ] as never,
      reportFile: { path: '/app/posthog-warehouse-report.md', exists: false },
    });
  }

  it('carries every key the contract names', () => {
    expect(Object.keys(build()).sort()).toEqual(
      [
        'abort',
        'asks',
        'detectedSources',
        'envFile',
        'hasPosthogDep',
        'newDeps',
        'notices',
        'reportFile',
        'runPhase',
        'screenPath',
        'skillsComplete',
        'tasks',
        'unansweredAsks',
      ].sort(),
    );
  });

  it('passes the pre-existing keys through unchanged', () => {
    expect(build()).toMatchObject(base);
  });

  it('projects tasks down to label and status', () => {
    expect(build().tasks).toEqual([
      { label: 'Connect your data sources', status: 'completed' },
    ]);
  });

  it('reports the sources detection found', () => {
    expect(build().detectedSources).toEqual([
      {
        kind: 'Postgres',
        label: 'PostgreSQL',
        mode: 'in-cli',
        matchedSignal: 'found DATABASE_URL',
      },
    ]);
  });

  it('totals the sentinel fallbacks', () => {
    const recorder = new E2eRunRecorder();
    recorder.observe(
      observed({ pendingQuestion: ask('a1', [question('p', 'P')]) }),
    );
    recorder.applyReport({
      kind: 'ask',
      id: 'a1',
      answeredIds: [],
      sentinelIds: ['p'],
    });
    expect(build(recorder).unansweredAsks).toBe(1);
  });
});

describe('security rail — no answer value reaches the payload', () => {
  /**
   * Drive the real decision path with a profile that answers a credential
   * question with a known secret, record it the way the host does, and scan
   * the whole payload. Nothing about the answer may survive.
   */
  function runOneAsk() {
    const pending = ask('a1', [
      {
        id: 'stripe_api_key',
        prompt: 'Stripe API key',
        kind: 'text',
        sensitive: true,
      },
      { id: 'prefix', prompt: 'Table prefix', kind: 'text' },
    ]);
    const recorder = new E2eRunRecorder();
    recorder.observe(observed({ pendingQuestion: pending }));

    const decision = decideE2eAction(
      {
        currentScreen: Overlay.WizardAsk,
        pendingQuestion: pending,
        taskNotice: null,
        setupQuestions: [],
      } as unknown as CiState,
      {
        ...DEFAULT_E2E_PROFILE,
        askAnswers: [{ match: 'stripe', value: SECRET }],
      },
    );
    if (decision.report) recorder.applyReport(decision.report);
    return { decision, recorder };
  }

  it('does answer the question with the secret — the rail is not "never answer"', () => {
    const { decision } = runOneAsk();
    expect(
      (decision.action?.params?.answers as Record<string, string>)
        .stripe_api_key,
    ).toBe(SECRET);
  });

  it('keeps the secret out of the serialized result', () => {
    const { recorder } = runOneAsk();
    const payload = JSON.stringify(
      buildE2eResult({
        base: {
          runPhase: RunPhase.Completed,
          hasPosthogDep: false,
          newDeps: [],
          envFile: null,
          screenPath: [],
          skillsComplete: true,
        },
        recorder,
        session: { frameworkContext: {}, outroData: null },
        tasks: [],
        reportFile: null,
      }),
    );
    expect(payload).not.toContain(SECRET);
  });

  it('keeps the prompt text, so the workbench can still tell what was asked', () => {
    const { recorder } = runOneAsk();
    expect(recorder.asks[0].prompts).toEqual([
      'Stripe API key',
      'Table prefix',
    ]);
    expect(recorder.asks[0].answeredIds).toEqual(['stripe_api_key']);
    expect(recorder.asks[0].sentinelIds).toEqual(['prefix']);
  });

  it('records ids only — an ask record has no field that could hold a value', () => {
    const { recorder } = runOneAsk();
    expect(Object.keys(recorder.asks[0]).sort()).toEqual([
      'answeredIds',
      'at',
      'id',
      'prompts',
      'questionCount',
      'questionIds',
      'sentinelIds',
      'source',
      'subject',
    ]);
  });
});
