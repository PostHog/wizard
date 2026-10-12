import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import type { AgentProgress } from '@agent/progress';
import type { Credentials } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import {
  configureOAuthSession,
  resetOAuthSession,
} from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { MAX_HANDOFF_TEXT_CHARS, publishHandoff } from '../handoff';

vi.mock('axios');

describe('publishHandoff', () => {
  const captured: string[] = [];
  const emit = (event: AgentProgress) => {
    if (event.kind === 'handoff') captured.push(event.text);
  };
  let temporaryDirectory: string;
  let ambientOutputPath: string | undefined;

  beforeEach(() => {
    captured.length = 0;
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'wizard-handoff-'));
    // Save the ambient value so a developer running these tests with the var
    // exported doesn't have their environment silently clobbered.
    ambientOutputPath = process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    if (ambientOutputPath === undefined) {
      delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    } else {
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = ambientOutputPath;
    }
  });

  it('publishes the content as a handoff progress event', async () => {
    const result = await publishHandoff('# Setup report\n\nAll done.', emit);
    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
  });

  it('rejects blank content instead of publishing', async () => {
    for (const bad of ['', '   \n']) {
      const result = await publishHandoff(bad, emit);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('complete report markdown');
    }
    expect(captured).toEqual([]);
  });

  it('truncates oversized content to the backend cap and says so', async () => {
    const outputPath = join(temporaryDirectory, 'handoff.md');
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;
    const oversized = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 10);
    const result = await publishHandoff(oversized, emit);

    expect(result.ok).toBe(true);
    expect(captured[0]).toHaveLength(MAX_HANDOFF_TEXT_CHARS);
    expect(readFileSync(outputPath, 'utf8')).toHaveLength(
      MAX_HANDOFF_TEXT_CHARS,
    );
    expect(result.message).toContain('truncated');
  });

  it('mirrors the published handoff to the host-provided output path', async () => {
    const outputPath = join(temporaryDirectory, 'handoff.md');
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

    const result = await publishHandoff('# Setup report\n\nAll done.', emit);

    expect(result.ok).toBe(true);
    expect(readFileSync(outputPath, 'utf8')).toBe(
      '# Setup report\n\nAll done.',
    );
  });

  it('continues publishing when the host-provided output path cannot be written', async () => {
    process.env.POSTHOG_HANDOFF_OUTPUT_PATH = temporaryDirectory;

    const result = await publishHandoff('# Setup report\n\nAll done.', emit);

    expect(result.ok).toBe(true);
    expect(captured).toEqual(['# Setup report\n\nAll done.']);
    expect(result.message).toContain('host output write failed');
  });

  describe('host output write hardening', () => {
    it('creates the file with 0o600 permissions', async () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      await publishHandoff('# Setup report\n\nAll done.', emit);

      expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    });

    it('tightens a pre-existing world-readable file to 0o600', async () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      writeFileSync(outputPath, 'stale report', { mode: 0o644 });
      chmodSync(outputPath, 0o644); // umask may already restrict; be explicit
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      await publishHandoff('# Setup report\n\nAll done.', emit);

      expect(readFileSync(outputPath, 'utf8')).toBe(
        '# Setup report\n\nAll done.',
      );
      expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    });

    it('refuses to follow a symlink planted at the output path', async () => {
      const victim = join(temporaryDirectory, 'victim.md');
      writeFileSync(victim, 'VICTIM CONTENT', 'utf8');
      const outputPath = join(temporaryDirectory, 'handoff.md');
      symlinkSync(victim, outputPath);
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      const result = await publishHandoff('# Malicious report', emit);

      // The user-facing handoff still succeeds (fail-open)…
      expect(result.ok).toBe(true);
      expect(captured).toEqual(['# Malicious report']);
      // …but the write is refused: the victim is untouched, the symlink is
      // still a symlink, the failure is surfaced, and no temp litter remains.
      expect(readFileSync(victim, 'utf8')).toBe('VICTIM CONTENT');
      expect(lstatSync(outputPath).isSymbolicLink()).toBe(true);
      expect(result.message).toContain('host output write failed');
      expect(result.message).toContain('not a regular file');
      expect(
        readdirSync(temporaryDirectory).filter((f) => f.includes('.tmp-')),
      ).toEqual([]);
    });

    it('refuses a relative output path and stays fail-open', async () => {
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = 'handoff.md';

      const result = await publishHandoff('# Setup report\n\nAll done.', emit);

      expect(result.ok).toBe(true);
      expect(captured).toEqual(['# Setup report\n\nAll done.']);
      expect(result.message).toContain('not an absolute path');
    });

    it('leaves no temp files behind after a successful write', async () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      await publishHandoff('# Setup report\n\nAll done.', emit);

      expect(readdirSync(temporaryDirectory)).toEqual(['handoff.md']);
    });

    it('overwrites a stale report from a previous run atomically', async () => {
      const outputPath = join(temporaryDirectory, 'handoff.md');
      writeFileSync(outputPath, '# Previous run\n\nStale content.', 'utf8');
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = outputPath;

      await publishHandoff('# Current run\n\nFresh content.', emit);

      expect(readFileSync(outputPath, 'utf8')).toBe(
        '# Current run\n\nFresh content.',
      );
      // Only the final file remains — the temp sibling was consumed by rename.
      expect(readdirSync(temporaryDirectory)).toEqual(['handoff.md']);
    });
  });
});

describe('publishHandoff notebook mirror', () => {
  const REPORT = '# Setup report\n\nAll done.';
  const mirror = { handoffNotebook: true };
  const mockedAxios = axios as Mocked<typeof axios>;
  const credentials: Credentials = {
    accessToken: 'pha_first',
    refreshToken: 'phr_first',
    projectApiKey: 'phc_unused',
    projectId: 42,
    host: HostResolution.fromApiHost('https://eu.posthog.com'),
  };
  const notebookUrl = (shortId: string) =>
    `${credentials.host.appHost}/project/42/notebooks/${shortId}`;
  const httpError = (status: number) =>
    Object.assign(new Error(`HTTP ${status}`), {
      isAxiosError: true,
      response: { status },
    });
  const networkError = () =>
    Object.assign(new Error('socket hang up'), { isAxiosError: true });
  const shortIdOfCreate = () =>
    (mockedAxios.post.mock.calls[0][1] as { short_id: string }).short_id;

  let urls: string[];
  let captures: Record<string, unknown>[];
  let runCount = 0;
  const emit = (event: AgentProgress) => {
    if (event.kind === 'url' && event.which === 'notebook') {
      urls.push(event.url);
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    urls = [];
    captures = [];
    delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    resetOAuthSession();
    configureOAuthSession(credentials, {
      rotate: (held) =>
        Promise.resolve({ ...held, accessToken: 'pha_rotated' }),
    });
    // One run id per test: the notebook a run holds outlives the call.
    vi.spyOn(analytics, 'runId', 'get').mockReturnValue(
      `run-${(runCount += 1)}`,
    );
    vi.spyOn(analytics, 'wizardCapture').mockImplementation((event, props) => {
      if (event === 'handoff published') captures.push(props ?? {});
    });
    mockedAxios.isAxiosError.mockImplementation(
      (error): error is never =>
        (error as { isAxiosError?: boolean })?.isAxiosError === true,
    );
    mockedAxios.post.mockResolvedValue({ data: { version: 1 } });
    mockedAxios.patch.mockResolvedValue({ data: { version: 2 } });
    mockedAxios.get.mockRejectedValue(httpError(404));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetOAuthSession();
  });

  it('makes no request and names no notebook when the program does not mirror', async () => {
    const result = await publishHandoff(REPORT, emit, {
      programId: 'audit',
    });

    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('Notebook');
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.patch).not.toHaveBeenCalled();
    expect(urls).toEqual([]);
    expect(captures[0]).toMatchObject({ notebook_requested: false });
  });

  it('creates the notebook for a program that mirrors and returns its URL', async () => {
    const result = await publishHandoff(REPORT, emit, mirror);

    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://eu.posthog.com/api/projects/42/notebooks/');
    expect(body).toEqual({
      title: 'Setup report',
      short_id: expect.stringMatching(/^[a-z0-9]{12}$/),
      content: {
        type: 'doc',
        content: [
          {
            type: 'ph-markdown-notebook',
            attrs: { nodeId: 'markdown-notebook-v2', markdown: REPORT },
          },
        ],
      },
      text_content: REPORT,
    });
    expect(config?.headers).toMatchObject({
      Authorization: 'Bearer pha_first',
    });
    const expectedUrl = notebookUrl(shortIdOfCreate());
    expect(urls).toEqual([expectedUrl]);
    expect(result.message).toContain(
      `Notebook created: ${expectedUrl}. Do not create another notebook.`,
    );
    expect(captures[0]).toMatchObject({
      notebook_requested: true,
      notebook_outcome: 'created',
    });
  });

  it('updates the same notebook, sending the version each write returned', async () => {
    mockedAxios.patch
      .mockResolvedValueOnce({ data: { version: 2 } })
      .mockResolvedValueOnce({ data: { version: 3 } });

    await publishHandoff(REPORT, emit, mirror);
    await publishHandoff('# Second\n\nMore.', emit, mirror);
    const third = await publishHandoff('# Third\n\nMost.', emit, mirror);

    const shortId = shortIdOfCreate();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.patch.mock.calls.map((call) => call[0])).toEqual([
      `https://eu.posthog.com/api/projects/42/notebooks/${shortId}/`,
      `https://eu.posthog.com/api/projects/42/notebooks/${shortId}/`,
    ]);
    expect(
      mockedAxios.patch.mock.calls.map(
        (call) => (call[1] as { version: number }).version,
      ),
    ).toEqual([1, 2]);
    expect(third.message).toContain(
      `Notebook updated: ${notebookUrl(shortId)}`,
    );
  });

  it('gives each program in the run its own notebook', async () => {
    await publishHandoff(REPORT, emit, {
      ...mirror,
      programId: 'posthog-integration',
    });
    await publishHandoff(REPORT, emit, { ...mirror, programId: 'metrics' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.patch).not.toHaveBeenCalled();
    const [first, second] = mockedAxios.post.mock.calls.map(
      (call) => (call[1] as { short_id: string }).short_id,
    );
    expect(first).not.toBe(second);
  });

  it('keeps the handoff published when PostHog refuses the notebook', async () => {
    mockedAxios.post.mockRejectedValue(httpError(403));

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(result.ok).toBe(true);
    expect(urls).toEqual([]);
    expect(result.message).toContain('Handoff published');
    expect(result.message).toContain(
      'Notebook not created: PostHog denied access.',
    );
    expect(captures[0]).toMatchObject({
      notebook_outcome: 'skipped',
      notebook_skip_reason: 'http_403',
    });
  });

  it('says the notebook still holds the earlier report when an update fails', async () => {
    await publishHandoff(REPORT, emit, mirror);
    mockedAxios.patch.mockRejectedValue(httpError(403));

    const result = await publishHandoff('# Second\n\nMore.', emit, mirror);

    expect(result.message).toContain(
      `Notebook not updated: PostHog denied access. It still holds the earlier report: ${notebookUrl(
        shortIdOfCreate(),
      )}.`,
    );
    expect(result.message).not.toContain('not created');
    expect(urls).toHaveLength(1);
    expect(captures[1]).toMatchObject({
      notebook_outcome: 'not_updated',
      notebook_skip_reason: 'http_403',
    });
  });

  it('retries once with a rotated token after a 401', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(httpError(401))
      .mockResolvedValueOnce({ data: { version: 1 } });

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[1][2]?.headers).toMatchObject({
      Authorization: 'Bearer pha_rotated',
    });
    expect(result.message).toContain('Notebook created');
  });

  it('finds the notebook again when the create response was lost', async () => {
    mockedAxios.post.mockRejectedValue(networkError());
    mockedAxios.get.mockResolvedValue({
      data: { version: 4, text_content: REPORT },
    });

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.patch).not.toHaveBeenCalled();
    expect(result.message).toContain('Notebook created');

    // The recovered version is the one the next update sends.
    await publishHandoff('# Second\n\nMore.', emit, mirror);
    expect(mockedAxios.patch.mock.calls[0][1]).toMatchObject({ version: 4 });
  });

  it('updates a notebook that already holds other content after an id clash', async () => {
    mockedAxios.post.mockRejectedValue(httpError(409));
    mockedAxios.get.mockResolvedValue({
      data: { version: 7, text_content: '# Older' },
    });

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(mockedAxios.patch.mock.calls[0][1]).toMatchObject({
      version: 7,
      text_content: REPORT,
    });
    expect(result.message).toContain('Notebook created');
  });

  it('retries a write once after a server error', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { version: 1 } });

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(result.message).toContain('Notebook created');
  });

  it('gives up with a timeout once the deadline passes, without retrying', async () => {
    vi.useFakeTimers();
    mockedAxios.post.mockImplementation(
      (_url, _body, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener?.('abort', () =>
            reject(
              Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }),
            ),
          );
        }),
    );

    const pending = publishHandoff(REPORT, emit, mirror);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(
      'Notebook not created: PostHog did not answer in time.',
    );
    expect(captures[0]).toMatchObject({ notebook_skip_reason: 'timeout' });
  });

  it('skips without a request when the login lacks notebook:write', async () => {
    resetOAuthSession();
    configureOAuthSession(
      { ...credentials, missingScopes: ['notebook:write'] },
      { rotate: (held) => Promise.resolve(held) },
    );

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(result.ok).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(captures[0]).toMatchObject({
      notebook_skip_reason: 'missing_scope',
    });
  });

  it('skips without a request when there is no login', async () => {
    resetOAuthSession();

    const result = await publishHandoff(REPORT, emit, mirror);

    expect(result.ok).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(captures[0]).toMatchObject({ notebook_skip_reason: 'no_login' });
  });
});
