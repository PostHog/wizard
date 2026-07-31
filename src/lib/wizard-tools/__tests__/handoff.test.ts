import type { Mock } from 'vitest';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { getUI, setUI } from '@ui';
import type { WizardUI } from '@ui/wizard-ui';
import { HostResolution } from '@lib/host-resolution';
import type { Credentials } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import {
  MAX_HANDOFF_TEXT_CHARS,
  buildHandoffContext,
  publishHandoff,
  type PublishHandoffContext,
} from '../handoff';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
  },
  sessionProperties: vi.fn(() => ({})),
}));

const wizardCaptureMock = analytics.wizardCapture as Mock;
const captureExceptionMock = analytics.captureException as Mock;

/** Properties of the one `wizard: <name>` event this call fired. */
const capturedEvent = (name: string): Record<string, unknown> | undefined =>
  wizardCaptureMock.mock.calls.find((c) => c[0] === name)?.[1] as
    | Record<string, unknown>
    | undefined;

describe('publishHandoff', () => {
  const captured: string[] = [];
  const notebookUrls: string[] = [];
  const reportFiles: string[] = [];
  let previousUI: WizardUI;
  let tmpDir: string;

  beforeEach(() => {
    wizardCaptureMock.mockClear();
    captureExceptionMock.mockClear();
    captured.length = 0;
    notebookUrls.length = 0;
    reportFiles.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
    previousUI = getUI();
    setUI({
      ...previousUI,
      setHandoffText: (text: string) => {
        captured.push(text);
      },
      setNotebookUrl: (url: string) => {
        notebookUrls.push(url);
      },
      setReportFile: (file: string) => {
        reportFiles.push(file);
      },
    } as WizardUI);
  });

  afterEach(() => {
    setUI(previousUI);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const credentials = (): Credentials => ({
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.i.posthog.com'),
    projectId: 42,
  });

  const context = (
    overrides: Partial<PublishHandoffContext> = {},
  ): PublishHandoffContext => ({
    credentials: credentials(),
    installDir: tmpDir,
    reportFile: 'posthog-setup-report.md',
    notebookTitle: 'PostHog setup (wizard) – app',
    ...overrides,
  });

  const jsonResponse = (body: object, status = 201): Response =>
    new Response(JSON.stringify(body), { status });

  it('publishes the content through the UI seam', async () => {
    const result = await publishHandoff('# Setup report\n\nAll done.');
    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
  });

  it('rejects blank content instead of publishing', async () => {
    for (const bad of ['', '   \n']) {
      const result = await publishHandoff(bad);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('complete report markdown');
    }
    expect(captured).toEqual([]);
  });

  it('truncates oversized content to the backend cap and says so', async () => {
    const oversized = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 10);
    const result = await publishHandoff(oversized);
    expect(result.ok).toBe(true);
    expect(captured[0]).toHaveLength(MAX_HANDOFF_TEXT_CHARS);
    expect(result.message).toContain('truncated');
  });

  it('creates the notebook and reports its url, writing no file', async () => {
    const result = await publishHandoff(
      '# Report',
      context({
        notebookOptions: {
          fetchImpl: () =>
            Promise.resolve(jsonResponse({ short_id: 'abc123' })),
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(notebookUrls).toEqual([
      'https://us.posthog.com/project/42/notebooks/abc123',
    ]);
    expect(result.message).toContain('abc123');
    expect(reportFiles).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, 'posthog-setup-report.md'))).toBe(
      false,
    );
  });

  it('falls back to a report file when the notebook cannot be created', async () => {
    const result = await publishHandoff(
      '# Report\n\nbody',
      context({
        notebookOptions: {
          fetchImpl: () =>
            Promise.resolve(new Response('nope', { status: 403 })),
        },
      }),
    );

    // Still ok: the handoff itself published, so a retry would only duplicate it.
    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Report\n\nbody']);
    expect(notebookUrls).toEqual([]);
    expect(reportFiles).toEqual(['posthog-setup-report.md']);
    const fallback = path.join(tmpDir, 'posthog-setup-report.md');
    expect(fs.readFileSync(fallback, 'utf8')).toBe('# Report\n\nbody');
    expect(result.message).toContain('posthog-setup-report.md');
    expect(result.message).toContain('Do not retry');
  });

  it('reports failure when neither the notebook nor the fallback file lands', async () => {
    const result = await publishHandoff(
      '# Report',
      context({
        // A directory that does not exist, so the fallback write throws.
        installDir: path.join(tmpDir, 'missing'),
        notebookOptions: {
          fetchImpl: () =>
            Promise.resolve(new Response('nope', { status: 403 })),
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('reached nobody');
    expect(reportFiles).toEqual([]);
  });

  it('skips the notebook entirely when there are no credentials', async () => {
    const result = await publishHandoff(
      '# Report',
      context({
        credentials: null,
        notebookOptions: {
          fetchImpl: () => {
            throw new Error('must not be called');
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Report']);
    expect(notebookUrls).toEqual([]);
    expect(reportFiles).toEqual([]);
  });
});

describe('buildHandoffContext', () => {
  it('keeps the program id out of the notebook title', () => {
    const ctx = buildHandoffContext({
      installDir: '/tmp/acme-shop',
      reportFile: 'posthog-setup-report.md',
      programId: 'posthog-integration',
      programLabel: 'Set up PostHog SDK integration',
    });

    expect(ctx.notebookTitle).toBe(
      'PostHog Set up PostHog SDK integration (wizard) – acme-shop',
    );
    expect(ctx.notebookTitle).not.toContain('posthog-integration');
    expect(ctx.reportFile).toBe('posthog-setup-report.md');
  });

  it('falls back to a generic title and an id-derived filename', () => {
    const ctx = buildHandoffContext({
      installDir: '/tmp/acme-shop',
      programId: 'audit',
    });

    expect(ctx.notebookTitle).toBe('PostHog setup (wizard) – acme-shop');
    expect(ctx.reportFile).toBe('posthog-audit-report.md');
  });
});

describe('publishHandoff analytics', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-analytics-'));

  const credentials = (): Credentials => ({
    accessToken: 'phx_test',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.i.posthog.com'),
    projectId: 42,
  });

  beforeEach(() => {
    wizardCaptureMock.mockClear();
    captureExceptionMock.mockClear();
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('records the call and the notebook outcome, tagged by program', async () => {
    await publishHandoff('# Report', {
      credentials: credentials(),
      installDir: tmp,
      reportFile: 'posthog-audit-report.md',
      notebookTitle: 'PostHog audit (wizard) – app',
      programId: 'audit',
      notebookOptions: {
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ short_id: 'abc123' }), {
              status: 201,
            }),
          ),
      },
    });

    expect(capturedEvent('handoff called')).toMatchObject({
      program_id: 'audit',
      handoff_chars: 8,
      handoff_truncated: false,
    });
    expect(capturedEvent('handoff published')).toMatchObject({
      program_id: 'audit',
      handoff_outcome: 'notebook',
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('records the notebook failure and the file it fell back to', async () => {
    await publishHandoff('# Report', {
      credentials: credentials(),
      installDir: tmp,
      reportFile: 'posthog-audit-report.md',
      notebookTitle: 'PostHog audit (wizard) – app',
      programId: 'audit',
      notebookOptions: {
        fetchImpl: () =>
          Promise.resolve(new Response('denied', { status: 403 })),
      },
    });

    expect(capturedEvent('handoff notebook failed')).toMatchObject({
      program_id: 'audit',
      handoff_fell_back_to_file: true,
    });
    expect(capturedEvent('handoff published')).toMatchObject({
      handoff_outcome: 'fallback_file',
    });
    // A notebook we can recover from is not worth an exception.
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('raises an exception only when the report reaches nobody', async () => {
    await publishHandoff('# Report', {
      credentials: credentials(),
      installDir: path.join(tmp, 'missing'),
      reportFile: 'posthog-audit-report.md',
      notebookTitle: 'PostHog audit (wizard) – app',
      programId: 'audit',
      notebookOptions: {
        fetchImpl: () =>
          Promise.resolve(new Response('denied', { status: 403 })),
      },
    });

    expect(capturedEvent('handoff published')).toMatchObject({
      handoff_outcome: 'undelivered',
    });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('records a blank call as rejected, with no publish', async () => {
    await publishHandoff('   ');

    expect(capturedEvent('handoff called')).toBeDefined();
    expect(capturedEvent('handoff rejected')).toMatchObject({
      handoff_reject_reason: 'blank_content',
    });
    expect(capturedEvent('handoff published')).toBeUndefined();
  });
});
