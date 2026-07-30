import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

// analytics writes to PostHog in tests — stub it before importing the core.
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
// logToFile writes to a debug file — stub it to a no-op.
vi.mock('@utils/debug', () => ({ logToFile: () => undefined }));

import {
  publishHandoff,
  buildNotebookContent,
  buildNotebookUrl,
  normalizeHandoffContent,
  resolveReportPath,
  buildHandoffContext,
  MAX_HANDOFF_CONTENT_CHARS,
} from '@lib/wizard-tools/handoff';
import type { Credentials } from '@lib/wizard-session';

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'handoff-test-'));
}

function creds(overrides: Partial<Credentials> = {}): Credentials {
  return {
    accessToken: 'phx_token',
    projectApiKey: 'phc_key',
    host: {
      apiHost: 'https://us.i.posthog.com',
      appHost: 'https://us.posthog.com',
      gatewayUrl: 'https://gateway.us.posthog.com',
      mcpUrl: 'https://mcp.us.posthog.com',
    },
    projectId: 42,
    ...overrides,
  } as Credentials;
}

function mockFetch(shortId: string, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ short_id: shortId }), { status })),
  ) as unknown as typeof fetch;
}

describe('normalizeHandoffContent', () => {
  it('rejects non-string and blank input', () => {
    expect(normalizeHandoffContent('')).toBeNull();
    expect(normalizeHandoffContent('   \n  ')).toBeNull();
    // @ts-expect-error — guards against the agent passing a non-string
    expect(normalizeHandoffContent({})).toBeNull();
  });

  it('caps oversize content to the backend serializer limit', () => {
    const huge = 'a'.repeat(MAX_HANDOFF_CONTENT_CHARS + 1000);
    const normalized = normalizeHandoffContent(huge);
    expect(normalized).not.toBeNull();
    expect(normalized!.length).toBe(MAX_HANDOFF_CONTENT_CHARS);
  });

  it('passes through in-bounds content unchanged', () => {
    expect(normalizeHandoffContent('# Report\n\nbody')).toBe(
      '# Report\n\nbody',
    );
  });
});

describe('buildNotebookContent', () => {
  it('wraps the report in a single ph-markdown-notebook node', () => {
    const doc = buildNotebookContent('# Report');
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('ph-markdown-notebook');
    expect(doc.content[0].attrs.markdown).toBe('# Report');
    expect(doc.content[0].attrs.nodeId).toBe('markdown-notebook-v2');
  });
});

describe('buildNotebookUrl', () => {
  it('builds the shareable URL from the app host, project id, and short id', () => {
    expect(buildNotebookUrl('https://us.posthog.com/', 42, 'AbCdEfGh')).toBe(
      'https://us.posthog.com/project/42/notebooks/AbCdEfGh',
    );
  });
});

describe('resolveReportPath', () => {
  it('resolves inside the working directory and rejects traversal', () => {
    const dir = tmpDir();
    try {
      expect(resolveReportPath(dir, 'report.md')).toBe(
        path.resolve(dir, 'report.md'),
      );
      expect(resolveReportPath(dir, 'sub/report.md')).toBe(
        path.resolve(dir, 'sub/report.md'),
      );
      expect(() => resolveReportPath(dir, '../escape.md')).toThrow(
        'Path traversal rejected',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('publishHandoff', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the report file, sets store hooks, and returns the notebook URL', async () => {
    const reportPath = path.join(dir, 'posthog-setup-report.md');
    const setHandoffText = vi.fn();
    const setNotebookUrl = vi.fn();
    const fetchImpl = mockFetch('AbCdEfGh');

    const result = await publishHandoff('# Setup report\n\nbody', 'My title', {
      reportPath,
      getCredentials: () => creds(),
      hooks: { setHandoffText, setNotebookUrl },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(reportPath, 'utf8')).toBe('# Setup report\n\nbody');
    expect(setHandoffText).toHaveBeenCalledWith('# Setup report\n\nbody');
    expect(setNotebookUrl).toHaveBeenCalledWith(
      'https://us.posthog.com/project/42/notebooks/AbCdEfGh',
    );
    expect(result.notebookUrl).toBe(
      'https://us.posthog.com/project/42/notebooks/AbCdEfGh',
    );

    // The notebook call hit the notebooks endpoint with the wrapped doc.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[0]).toBe('https://us.i.posthog.com/api/projects/42/notebooks/');
    const body = JSON.parse(call[1].body);
    expect(body.title).toBe('My title');
    expect(body.content.content[0].type).toBe('ph-markdown-notebook');
  });

  it('rejects blank content without writing anything', async () => {
    const reportPath = path.join(dir, 'posthog-setup-report.md');
    const setHandoffText = vi.fn();
    const result = await publishHandoff('   ', undefined, {
      reportPath,
      getCredentials: () => creds(),
      hooks: { setHandoffText },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blank');
    expect(existsSync(reportPath)).toBe(false);
    expect(setHandoffText).not.toHaveBeenCalled();
  });

  it('still writes the file + sets handoff_text when credentials are absent (no notebook)', async () => {
    const reportPath = path.join(dir, 'posthog-setup-report.md');
    const setHandoffText = vi.fn();
    const setNotebookUrl = vi.fn();

    const result = await publishHandoff('# Report', undefined, {
      reportPath,
      getCredentials: () => null, // pre-auth
      hooks: { setHandoffText, setNotebookUrl },
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(reportPath, 'utf8')).toBe('# Report');
    expect(setHandoffText).toHaveBeenCalledWith('# Report');
    expect(setNotebookUrl).not.toHaveBeenCalled();
    expect(result.notebookUrl).toBeNull();
  });

  it('still writes the file + sets handoff_text when the notebook upload fails', async () => {
    const reportPath = path.join(dir, 'posthog-setup-report.md');
    const setHandoffText = vi.fn();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    ) as unknown as typeof fetch;

    const result = await publishHandoff('# Report', undefined, {
      reportPath,
      getCredentials: () => creds(),
      hooks: { setHandoffText },
      fetchImpl,
    });

    // Notebook failure must not fail the publish — file + handoff_text load-bearing.
    expect(result.ok).toBe(true);
    expect(readFileSync(reportPath, 'utf8')).toBe('# Report');
    expect(setHandoffText).toHaveBeenCalledWith('# Report');
    expect(result.notebookUrl).toBeNull();
  });
});

describe('buildHandoffContext', () => {
  it('returns null when the program has no reportFile', () => {
    const store = {
      setHandoffText: vi.fn(),
      setNotebookUrl: vi.fn(),
    };
    expect(
      buildHandoffContext({
        workingDirectory: tmpDir(),
        reportFile: undefined,
        store,
        getCredentials: () => creds(),
      }),
    ).toBeNull();
  });

  it('resolves the report path and wires the store hooks', () => {
    const dir = tmpDir();
    try {
      const store = {
        setHandoffText: vi.fn(),
        setNotebookUrl: vi.fn(),
      };
      const ctx = buildHandoffContext({
        workingDirectory: dir,
        reportFile: 'posthog-setup-report.md',
        store,
        getCredentials: () => null,
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.reportPath).toBe(
        path.resolve(dir, 'posthog-setup-report.md'),
      );
      ctx!.hooks!.setHandoffText('x');
      ctx!.hooks!.setNotebookUrl('y');
      expect(store.setHandoffText).toHaveBeenCalledWith('x');
      expect(store.setNotebookUrl).toHaveBeenCalledWith('y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
