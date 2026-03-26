import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearAgentSessionCache,
  loadAgentSessionCache,
  saveAgentSessionCache,
} from '../agent-session-cache';
import { Integration } from '../constants';

describe('agent-session-cache', () => {
  const defaultScopeKey = 'scope:default';

  let cacheDir: string;
  let projectDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-agent-cache-'));
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-agent-project-'),
    );
    process.env.POSTHOG_WIZARD_CACHE_DIR = cacheDir;
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    delete process.env.POSTHOG_WIZARD_CACHE_DIR;
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('saves and loads a cache entry for the current project fingerprint', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'execution',
      [
        {
          content: 'Analyze project',
          status: 'in_progress',
          activeForm: 'Analyzing project',
        },
      ],
      [{ name: 'signup completed', description: 'User completes signup' }],
    );

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, defaultScopeKey),
    ).toEqual(
      expect.objectContaining({
        installDir: path.resolve(projectDir),
        integration: Integration.nextjs,
        scopeKey: defaultScopeKey,
        sessionId: 'session-123',
        runStage: 'execution',
        todos: [
          {
            content: 'Analyze project',
            status: 'in_progress',
            activeForm: 'Analyzing project',
          },
        ],
        eventPlan: [
          {
            name: 'signup completed',
            description: 'User completes signup',
          },
        ],
      }),
    );
  });

  it('invalidates the cache when the project fingerprint changes', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'discovery',
      [],
    );

    fs.writeFileSync(
      path.join(projectDir, 'src.ts'),
      'export const changed = true;\n',
      'utf-8',
    );

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, defaultScopeKey),
    ).toBeNull();
  });

  it('does not invalidate the cache for mtime-only changes', () => {
    const filePath = path.join(projectDir, 'src.ts');
    fs.writeFileSync(filePath, 'export const stable = true;\n', 'utf-8');

    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'discovery',
      [],
    );

    const before = loadAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
    );
    expect(before).not.toBeNull();

    const now = new Date();
    fs.utimesSync(filePath, now, new Date(now.getTime() + 10_000));

    const after = loadAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
    );
    expect(after).not.toBeNull();
    expect(after?.sessionId).toBe('session-123');
  });

  it('clears a cached entry', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'discovery',
      [],
    );
    clearAgentSessionCache(projectDir, Integration.nextjs);

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, defaultScopeKey),
    ).toBeNull();
  });

  it('drops stale cache entries', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'discovery',
      [],
    );

    const [cacheFile] = fs.readdirSync(cacheDir);
    const cachePath = path.join(cacheDir, cacheFile);
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Record<
      string,
      unknown
    >;

    parsed.updatedAt = new Date(
      Date.now() - 91 * 24 * 60 * 60 * 1000,
    ).toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(parsed, null, 2), 'utf-8');

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, defaultScopeKey),
    ).toBeNull();
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('invalidates the cache when the requested run scope changes', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'discovery',
      [],
    );

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, 'scope:sentry'),
    ).toBeNull();
  });

  it('can reuse a cache entry across scope changes when explicitly allowed', () => {
    saveAgentSessionCache(
      projectDir,
      Integration.nextjs,
      defaultScopeKey,
      'session-123',
      'execution',
      [],
    );

    expect(
      loadAgentSessionCache(projectDir, Integration.nextjs, 'scope:sentry', {
        allowScopeMismatch: true,
      }),
    ).toEqual(
      expect.objectContaining({
        sessionId: 'session-123',
        runStage: 'execution',
        scopeKey: defaultScopeKey,
      }),
    );
  });
});
