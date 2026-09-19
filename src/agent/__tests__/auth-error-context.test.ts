import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@store/shared/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));

import { buildAuthErrorContext } from '../agent-interface.js';

let home: string;
let project: string;

function write(dir: string, name: string, contents: string): void {
  const claudeDir = path.join(dir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, name), contents);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-proj-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe('buildAuthErrorContext', () => {
  it('reports no conflict and a default region when nothing overrides auth', () => {
    const ctx = buildAuthErrorContext(
      project,
      'https://ai-gateway.us.posthog.com',
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
      'https://ai-gateway.eu.posthog.com',
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
      buildAuthErrorContext(project, 'https://ai-gateway.eu.posthog.com', home)
        .region,
    ).toBe('eu');
    expect(
      buildAuthErrorContext(project, 'http://localhost:3308/wizard', home)
        .region,
    ).toBe('local');
    expect(buildAuthErrorContext(project, '', home).region).toBe('us');
  });
});
