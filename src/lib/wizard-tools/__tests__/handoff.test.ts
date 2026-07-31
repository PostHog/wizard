import fs from 'fs';
import os from 'os';
import path from 'path';

import { getUI, setUI } from '@ui';
import type { WizardUI } from '@ui/wizard-ui';
import { HostResolution } from '@lib/host-resolution';
import type { Credentials } from '@lib/wizard-session';
import {
  MAX_HANDOFF_TEXT_CHARS,
  buildHandoffContext,
  publishHandoff,
  type PublishHandoffContext,
} from '../handoff';

describe('publishHandoff', () => {
  const captured: string[] = [];
  const notebookUrls: string[] = [];
  const reportFiles: string[] = [];
  let previousUI: WizardUI;
  let tmpDir: string;

  beforeEach(() => {
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
