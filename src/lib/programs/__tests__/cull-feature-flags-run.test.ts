import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  mockAuthenticate,
  mockFetchFeatureFlags,
  mockDetectFramework,
  mockFetchSkillMenu,
  mockWizardAbort,
  mockListUncommittedPaths,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockFetchFeatureFlags: vi.fn(),
  mockDetectFramework: vi.fn(),
  mockFetchSkillMenu: vi.fn(),
  mockWizardAbort: vi.fn(),
  mockListUncommittedPaths: vi.fn(),
}));

vi.mock('@lib/agent/runner/shared/authenticate', () => ({
  authenticate: mockAuthenticate,
}));
vi.mock('@lib/programs/cull-feature-flags/fetch', () => ({
  fetchFeatureFlags: mockFetchFeatureFlags,
}));
vi.mock('@lib/detection/index', () => ({
  detectFramework: mockDetectFramework,
}));
vi.mock('@lib/wizard-tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/wizard-tools')>()),
  fetchSkillMenu: mockFetchSkillMenu,
}));
vi.mock('@utils/wizard-abort', () => ({
  wizardAbort: mockWizardAbort,
}));
vi.mock('@lib/programs/cull-feature-flags/working-tree', () => ({
  listUncommittedPaths: mockListUncommittedPaths,
}));

import { cullFeatureFlagsConfig } from '@lib/programs/cull-feature-flags/index';
import { AUDIT_CHECKS_FILE } from '@lib/programs/audit/types';
import { ErrorCodes } from '@lib/errors';
import { buildSession, type WizardSession } from '@lib/wizard-session';
import type { ProgramRun } from '@lib/agent/agent-runner';

class AbortSignal extends Error {}

function sessionFor(installDir: string): WizardSession {
  return buildSession({ installDir, ci: true });
}

function credentialsFor(session: WizardSession): void {
  session.credentials = {
    accessToken: 'token',
    projectApiKey: 'phc_test',
    projectId: 590630,
    host: {
      apiHost: 'https://us.posthog.com',
      appHost: 'https://us.posthog.com',
    },
  } as WizardSession['credentials'];
}

async function resolveRun(session: WizardSession): Promise<ProgramRun> {
  const run = cullFeatureFlagsConfig.run;
  if (typeof run !== 'function') throw new Error('run must be deferred');
  return run(session);
}

describe('cullFeatureFlagsConfig.run', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cull-run-'));
    fs.mkdirSync(path.join(installDir, 'src/app'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, 'src/app/page.tsx'),
      'const on = useFeatureFlagEnabled("new-checkout");',
    );
    mockListUncommittedPaths.mockReturnValue([]);
    mockDetectFramework.mockResolvedValue('nextjs');
    mockFetchSkillMenu.mockResolvedValue({
      categories: {
        'cull-feature-flags': [
          {
            id: 'cull-feature-flags-nextjs',
            group: 'cull-feature-flags',
            framework: 'nextjs',
            default: true,
          },
        ],
      },
    });
    mockAuthenticate.mockImplementation((session: WizardSession) => {
      credentialsFor(session);
      return Promise.resolve();
    });
    mockFetchFeatureFlags.mockResolvedValue([
      {
        id: 42,
        key: 'new-checkout',
        active: true,
        filters: { groups: [{ rollout_percentage: 100, properties: [] }] },
      },
      { id: 43, key: 'orphan', active: true, filters: { groups: [] } },
    ]);
    mockWizardAbort.mockImplementation(() => {
      throw new AbortSignal('abort');
    });
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('authenticates before fetching, seeds the ledger, resolves the framework variant', async () => {
    const session = sessionFor(installDir);

    const run = await resolveRun(session);

    expect(mockAuthenticate.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchFeatureFlags.mock.invocationCallOrder[0],
    );
    expect(mockFetchFeatureFlags).toHaveBeenCalledWith(
      'token',
      'https://us.posthog.com',
      590630,
    );
    expect(run.skillId).toBe('cull-feature-flags-nextjs');
    const ledger = JSON.parse(
      fs.readFileSync(path.join(installDir, AUDIT_CHECKS_FILE), 'utf8'),
    ) as { id: string; area: string; status: string }[];
    expect(ledger.map((row) => [row.id, row.area, row.status])).toEqual([
      ['orphan', 'Unreferenced', 'pending'],
      ['new-checkout', 'Rolled out', 'pending'],
    ]);
    expect(run.customPrompt?.({} as never)).toContain('- Rolled out: 1');
  });

  test('aborts on a dirty working tree before touching PostHog', async () => {
    mockListUncommittedPaths.mockReturnValue(['src/app/page.tsx']);

    await expect(resolveRun(sessionFor(installDir))).rejects.toThrow(
      AbortSignal,
    );

    expect(mockWizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.DetectDirtyWorkingTree }),
    );
    expect(mockFetchFeatureFlags).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(installDir, AUDIT_CHECKS_FILE))).toBe(false);
  });

  test('aborts on an unsupported framework', async () => {
    mockDetectFramework.mockResolvedValue('django');

    await expect(resolveRun(sessionFor(installDir))).rejects.toThrow(
      AbortSignal,
    );

    expect(mockWizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.DetectUnsupportedPlatform }),
    );
  });

  test('aborts instead of seeding when the flag fetch fails', async () => {
    mockFetchFeatureFlags.mockRejectedValue(new Error('403'));

    await expect(resolveRun(sessionFor(installDir))).rejects.toThrow(
      AbortSignal,
    );

    expect(mockWizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.AuthProjectFetchFailed }),
    );
    expect(fs.existsSync(path.join(installDir, AUDIT_CHECKS_FILE))).toBe(false);
  });
});
