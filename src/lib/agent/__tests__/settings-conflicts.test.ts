import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));

import {
  checkAllSettingsConflicts,
  managedSettingsPath,
  classifySettingsConflicts,
} from '@lib/agent/claude-settings';
import type { SettingsConflict } from '@lib/agent/claude-settings';
import { buildAuthErrorContext } from '@lib/agent/agent-interface';

const OVERRIDE = JSON.stringify({ apiKeyHelper: 'echo sk-x' });
const ENV_OVERRIDE = JSON.stringify({
  env: { ANTHROPIC_BASE_URL: 'https://example.com' },
});

let home: string;
let project: string;

function write(dir: string, name: string, contents: string): void {
  const claudeDir = path.join(dir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, name), contents);
}

beforeEach(() => {
  // A temp home keeps a real global ~/.claude config off the test machine
  // out of the result; pass it explicitly so detection is deterministic.
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-proj-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe('checkAllSettingsConflicts', () => {
  it('returns nothing when no settings files exist', () => {
    expect(checkAllSettingsConflicts(project, home)).toEqual([]);
  });

  it('detects a writable project settings.json override with its path', () => {
    write(project, 'settings.json', OVERRIDE);

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      source: 'project',
      writable: true,
      keys: ['apiKeyHelper'],
      path: path.join(project, '.claude', 'settings.json'),
    });
  });

  it('detects a gitignored project-local override as read-only', () => {
    write(project, 'settings.local.json', ENV_OVERRIDE);

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      source: 'project-local',
      writable: false,
      keys: ['ANTHROPIC_BASE_URL'],
      path: path.join(project, '.claude', 'settings.local.json'),
    });
  });

  it('detects the user global ~/.claude/settings.json as read-only', () => {
    write(home, 'settings.json', OVERRIDE);

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts).toContainEqual(
      expect.objectContaining({
        source: 'user',
        writable: false,
        path: path.join(home, '.claude', 'settings.json'),
      }),
    );
  });

  it('detects the user global settings.local.json', () => {
    write(home, 'settings.local.json', OVERRIDE);

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts).toContainEqual(
      expect.objectContaining({
        source: 'user',
        path: path.join(home, '.claude', 'settings.local.json'),
      }),
    );
  });

  it('detects an off-gateway provider flag in a project env block', () => {
    write(
      project,
      'settings.json',
      JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    );

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      source: 'project',
      keys: ['CLAUDE_CODE_USE_BEDROCK'],
    });
  });

  it('detects an alternate base URL variant via pattern match', () => {
    write(
      project,
      'settings.json',
      JSON.stringify({ env: { ANTHROPIC_VERTEX_BASE_URL: 'https://x' } }),
    );

    const conflicts = checkAllSettingsConflicts(project, home);

    expect(conflicts[0]?.keys).toContain('ANTHROPIC_VERTEX_BASE_URL');
    // matches both the explicit list and the pattern — must not duplicate.
    expect(conflicts[0]?.keys).toEqual(['ANTHROPIC_VERTEX_BASE_URL']);
  });

  it('reports conflicts from several sources at once', () => {
    write(home, 'settings.json', OVERRIDE);
    write(project, 'settings.json', ENV_OVERRIDE);

    const sources = checkAllSettingsConflicts(project, home).map(
      (c) => c.source,
    );

    expect(sources).toEqual(expect.arrayContaining(['user', 'project']));
  });
});

describe('managedSettingsPath', () => {
  it('resolves the org-managed path per platform', () => {
    expect(managedSettingsPath('darwin')).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    );
    // Linux/POSIX — the path that was previously unchecked.
    expect(managedSettingsPath('linux')).toBe(
      '/etc/claude-code/managed-settings.json',
    );
    expect(managedSettingsPath('win32')).toMatch(
      /ClaudeCode[\\/]managed-settings\.json$/,
    );
  });

  it('is consulted by checkAllSettingsConflicts for the active platform', () => {
    // No managed file on the test box, so no managed conflict — but the call
    // must accept the platform arg and stay side-effect free.
    expect(checkAllSettingsConflicts(project, home, 'linux')).toEqual([]);
  });
});

describe('classifySettingsConflicts', () => {
  const conflict = (
    source: SettingsConflict['source'],
    writable: boolean,
  ): SettingsConflict => ({
    source,
    path: `/x/${source}`,
    keys: ['ANTHROPIC_BASE_URL'],
    writable,
  });

  it('routes a writable project file to autoFix (neutralize)', () => {
    const { autoFix, failClosed, warnOnly } = classifySettingsConflicts([
      conflict('project', true),
    ]);
    expect(autoFix).toHaveLength(1);
    expect(failClosed).toEqual([]);
    expect(warnOnly).toEqual([]);
  });

  it('routes managed settings to failClosed (cannot neutralize)', () => {
    const { autoFix, failClosed, warnOnly } = classifySettingsConflicts([
      conflict('managed', false),
    ]);
    expect(failClosed).toHaveLength(1);
    expect(autoFix).toEqual([]);
    expect(warnOnly).toEqual([]);
  });

  it('routes user + project-local to warnOnly (already neutralized by settingSources)', () => {
    const { warnOnly, autoFix, failClosed } = classifySettingsConflicts([
      conflict('user', false),
      conflict('project-local', false),
    ]);
    expect(warnOnly).toHaveLength(2);
    expect(autoFix).toEqual([]);
    expect(failClosed).toEqual([]);
  });

  it('sorts a mixed set into the three buckets', () => {
    const { autoFix, failClosed, warnOnly } = classifySettingsConflicts([
      conflict('project', true),
      conflict('managed', false),
      conflict('user', false),
      conflict('project-local', false),
    ]);
    expect(autoFix.map((c) => c.source)).toEqual(['project']);
    expect(failClosed.map((c) => c.source)).toEqual(['managed']);
    expect(warnOnly.map((c) => c.source)).toEqual(['user', 'project-local']);
  });
});

describe('buildAuthErrorContext', () => {
  it('reports no conflict and a default region when nothing overrides auth', () => {
    const ctx = buildAuthErrorContext(
      project,
      'https://gateway.us.posthog.com/wizard',
      home,
    );

    expect(ctx.hasSettingsConflict).toBe(false);
    expect(ctx.conflicts).toEqual([]);
    expect(ctx.conflictSources).toEqual([]);
    expect(ctx.conflictKeys).toEqual([]);
    expect(ctx.region).toBe('us');
  });

  it('summarises conflicts and dedupes keys for telemetry', () => {
    write(home, 'settings.json', JSON.stringify({ apiKeyHelper: 'x' }));
    write(project, 'settings.json', JSON.stringify({ apiKeyHelper: 'y' }));

    const ctx = buildAuthErrorContext(
      project,
      'https://gateway.eu.posthog.com/wizard',
      home,
    );

    expect(ctx.hasSettingsConflict).toBe(true);
    expect(ctx.conflictSources).toEqual(
      expect.arrayContaining(['user', 'project']),
    );
    expect(ctx.conflictKeys).toEqual(['apiKeyHelper']);
    expect(ctx.region).toBe('eu');
  });

  it('derives the region from the gateway url', () => {
    expect(
      buildAuthErrorContext(
        project,
        'https://gateway.eu.posthog.com/wizard',
        home,
      ).region,
    ).toBe('eu');
    expect(
      buildAuthErrorContext(project, 'http://localhost:3308/wizard', home)
        .region,
    ).toBe('local');
    expect(buildAuthErrorContext(project, '', home).region).toBe('us');
  });
});
