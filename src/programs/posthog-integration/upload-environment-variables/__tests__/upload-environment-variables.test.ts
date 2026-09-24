import * as child_process from 'child_process';
import * as fs from 'fs';
import type { SpinnerHandle } from '@agent/types';
import { uploadEnvironmentVariablesStep } from '../index';

vi.mock('fs');
vi.mock('child_process');
vi.mock('@utils/analytics', () => ({
  analytics: { setTag: vi.fn(), wizardCapture: vi.fn() },
}));
// The program reports through its host. Reaching for the UI singleton fails.
vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('env upload reached for getUI()');
  },
}));

function linkedVercelProject(): void {
  (child_process.execSync as Mock).mockReturnValue(undefined);
  (fs.existsSync as Mock).mockReturnValue(true);
  (child_process.spawnSync as Mock).mockReturnValue({
    stdout: 'someone',
    stderr: '',
    status: 0,
  });
  (child_process.spawn as Mock).mockImplementation(() => ({
    stdin: { write: vi.fn(), end: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
    },
  }));
}

function recordingReport() {
  const lines: string[] = [];
  const spinner: SpinnerHandle = {
    start: (message?: string) => lines.push(`start ${message ?? ''}`),
    stop: (message?: string) => lines.push(`stop ${message ?? ''}`),
    message: (message?: string) => lines.push(`message ${message ?? ''}`),
  };
  return {
    lines,
    report: {
      info: (message: string) => lines.push(`info ${message}`),
      spinner: () => spinner,
    },
  };
}

describe('uploadEnvironmentVariablesStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the upload through the injected reporter and returns the uploaded keys', async () => {
    linkedVercelProject();
    const { lines, report } = recordingReport();

    const uploaded = await uploadEnvironmentVariablesStep(
      { POSTHOG_KEY: 'phc_x' },
      { integration: 'nextjs' as never, installDir: '/project', report },
    );

    expect(uploaded).toEqual(['POSTHOG_KEY']);
    expect(lines).toEqual([
      'info Uploading environment variables to Vercel...',
      'start Uploading POSTHOG_KEY to Vercel...',
      'stop ✅ Uploaded POSTHOG_KEY to Vercel',
    ]);
  });

  it('reports nothing when no hosting provider is linked', async () => {
    (child_process.execSync as Mock).mockImplementation(() => {
      throw new Error('no vercel');
    });
    const { lines, report } = recordingReport();

    const uploaded = await uploadEnvironmentVariablesStep(
      { POSTHOG_KEY: 'phc_x' },
      { integration: 'nextjs' as never, installDir: '/project', report },
    );

    expect(uploaded).toEqual([]);
    expect(lines).toEqual([]);
  });
});
