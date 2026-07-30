import { describe, it, expect, vi, beforeEach } from 'vitest';

// analytics writes to PostHog in tests — stub it before importing the core.
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
// logToFile writes to a debug file — stub it to a no-op.
vi.mock('@utils/debug', () => ({ logToFile: () => undefined }));

const mockUi = {
  setHandoffText: vi.fn(),
  setNotebookUrl: vi.fn(),
};
vi.mock('@ui', () => ({
  getUI: () => mockUi,
}));

import {
  publishHandoff,
  buildNotebookContent,
  buildNotebookUrl,
  normalizeHandoffContent,
  MAX_HANDOFF_CONTENT_CHARS,
  DEFAULT_NOTEBOOK_TITLE,
} from '@lib/wizard-tools/handoff';
import type { Credentials } from '@lib/wizard-session';

function creds(): Credentials {
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
  } as Credentials;
}

function mockFetch(shortId: string): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ short_id: shortId }), { status: 201 }),
    ),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  mockUi.setHandoffText.mockClear();
  mockUi.setNotebookUrl.mockClear();
});

describe('normalizeHandoffContent', () => {
  it('rejects non-string and blank input', () => {
    expect(normalizeHandoffContent('')).toBeNull();
    expect(normalizeHandoffContent('   \n  ')).toBeNull();
    expect(normalizeHandoffContent({})).toBeNull();
  });

  it('caps oversize content to the backend serializer limit', () => {
    const huge = 'a'.repeat(MAX_HANDOFF_CONTENT_CHARS + 1000);
    const normalized = normalizeHandoffContent(huge);
    expect(normalized).not.toBeNull();
    expect(normalized?.length).toBe(MAX_HANDOFF_CONTENT_CHARS);
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

describe('publishHandoff', () => {
  it('creates the notebook and, when opted in, sets handoff text on the UI', async () => {
    const fetchImpl = mockFetch('AbCdEfGh');

    const result = await publishHandoff('# Setup report\n\nbody', 'My title', {
      getCredentials: () => creds(),
      uploadToPostHog: true,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      notebookUrl: 'https://us.posthog.com/project/42/notebooks/AbCdEfGh',
    });
    expect(mockUi.setHandoffText).toHaveBeenCalledWith(
      '# Setup report\n\nbody',
    );
    expect(mockUi.setNotebookUrl).toHaveBeenCalledWith(
      'https://us.posthog.com/project/42/notebooks/AbCdEfGh',
    );

    // The notebook call hit the notebooks endpoint with the wrapped doc.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { body: string }];
    expect(call[0]).toBe('https://us.i.posthog.com/api/projects/42/notebooks/');
    const body = JSON.parse(call[1].body) as {
      title: string;
      content: { content: Array<{ type: string }> };
    };
    expect(body.title).toBe('My title');
    expect(body.content.content[0].type).toBe('ph-markdown-notebook');
  });

  it('defaults the notebook title when omitted', async () => {
    const fetchImpl = mockFetch('AbCdEfGh');
    await publishHandoff('# Report', undefined, {
      getCredentials: () => creds(),
      fetchImpl,
    });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, { body: string }];
    expect((JSON.parse(call[1].body) as { title: string }).title).toBe(
      DEFAULT_NOTEBOOK_TITLE,
    );
  });

  it('does not set handoff text when uploadToPostHog is off (the default)', async () => {
    const result = await publishHandoff('# Report', undefined, {
      getCredentials: () => creds(),
      fetchImpl: mockFetch('AbCdEfGh'),
    });
    expect(result.ok).toBe(true);
    expect(mockUi.setHandoffText).not.toHaveBeenCalled();
    expect(mockUi.setNotebookUrl).toHaveBeenCalled();
  });

  it('rejects blank content without publishing anything', async () => {
    const result = await publishHandoff('   ', undefined, {
      getCredentials: () => creds(),
      uploadToPostHog: true,
      fetchImpl: mockFetch('AbCdEfGh'),
    });
    expect(result.ok).toBe(false);
    expect(mockUi.setHandoffText).not.toHaveBeenCalled();
    expect(mockUi.setNotebookUrl).not.toHaveBeenCalled();
  });

  it('still publishes handoff text when credentials are absent (no notebook)', async () => {
    const result = await publishHandoff('# Report', undefined, {
      getCredentials: () => null, // pre-auth
      uploadToPostHog: true,
    });
    expect(result).toEqual({ ok: true, notebookUrl: null });
    expect(mockUi.setHandoffText).toHaveBeenCalledWith('# Report');
    expect(mockUi.setNotebookUrl).not.toHaveBeenCalled();
  });

  it('still publishes handoff text when the notebook upload fails', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    ) as unknown as typeof fetch;

    const result = await publishHandoff('# Report', undefined, {
      getCredentials: () => creds(),
      uploadToPostHog: true,
      fetchImpl,
    });

    // Notebook failure must not fail the publish — handoff_text is load-bearing.
    expect(result).toEqual({ ok: true, notebookUrl: null });
    expect(mockUi.setHandoffText).toHaveBeenCalledWith('# Report');
    expect(mockUi.setNotebookUrl).not.toHaveBeenCalled();
  });
});
