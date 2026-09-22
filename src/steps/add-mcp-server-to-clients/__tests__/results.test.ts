import {
  McpClientStatus,
  isOk,
  namesWithStatus,
  redactSecrets,
  scrubHomePaths,
  expectedFailureHint,
  summarizeFailure,
  toClientResult,
} from '@steps/add-mcp-server-to-clients/results';

describe('toClientResult', () => {
  it('maps a plain success to installed', () => {
    expect(toClientResult('Cursor', { success: true })).toEqual({
      name: 'Cursor',
      status: McpClientStatus.Changed,
    });
  });

  it('maps an already-installed success to its own status, not a silent no-op', () => {
    expect(
      toClientResult('Codex', { success: true, alreadyInstalled: true }),
    ).toEqual({ name: 'Codex', status: McpClientStatus.Unchanged });
  });

  it('keeps the failure reason so the user is told why', () => {
    expect(
      toClientResult('Zed', { success: false, reason: 'EACCES: denied' }),
    ).toEqual({
      name: 'Zed',
      status: McpClientStatus.Failed,
      detail: 'EACCES: denied',
    });
  });

  it('treats a missing result as a failure', () => {
    expect(toClientResult('Zed', undefined).status).toBe(
      McpClientStatus.Failed,
    );
  });
});

describe('isOk', () => {
  it('counts already-installed as a working install', () => {
    expect(isOk({ name: 'Codex', status: McpClientStatus.Unchanged })).toBe(
      true,
    );
    expect(isOk({ name: 'Codex', status: McpClientStatus.Changed })).toBe(true);
    expect(isOk({ name: 'Codex', status: McpClientStatus.Failed })).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('masks the bearer token the CLIs echo back in their error output', () => {
    expect(
      redactSecrets(
        'Command failed: claude "mcp" "add" "--header" "Authorization: Bearer phx_live_abc123"',
      ),
    ).not.toContain('phx_live_abc123');
  });

  it('masks a bare personal API key', () => {
    expect(redactSecrets('bad key phx_abc-123 rejected')).toBe(
      'bad key [redacted] rejected',
    );
  });
});

describe('summarizeFailure', () => {
  it('takes the first non-empty line', () => {
    expect(summarizeFailure('\n\n  boom: it broke  \nstack trace\n')).toBe(
      'boom: it broke',
    );
  });

  it('truncates a very long line', () => {
    expect(summarizeFailure('x'.repeat(200))).toHaveLength(120);
  });

  it('redacts before truncating, so a long line cannot smuggle a key through', () => {
    expect(
      summarizeFailure(`${'x'.repeat(80)} Authorization: Bearer phx_secret`),
    ).not.toContain('phx_secret');
  });

  it('returns undefined when there is nothing to say', () => {
    expect(summarizeFailure('   \n ')).toBeUndefined();
    expect(summarizeFailure(undefined)).toBeUndefined();
  });
});

describe('namesWithStatus', () => {
  it('filters by status', () => {
    const results = [
      { name: 'Cursor', status: McpClientStatus.Changed },
      { name: 'Codex', status: McpClientStatus.Unchanged },
      { name: 'Zed', status: McpClientStatus.Failed },
    ];
    expect(namesWithStatus(results, McpClientStatus.Unchanged)).toEqual([
      'Codex',
    ]);
  });
});

describe('scrubHomePaths', () => {
  it('replaces a unix home directory with ~ so one cause groups as one issue', () => {
    expect(scrubHomePaths('spawn /Users/ada/.bun/bin/codex ENOENT')).toBe(
      'spawn ~/.bun/bin/codex ENOENT',
    );
    expect(scrubHomePaths('open /home/ada/.codex/config.toml')).toBe(
      'open ~/.codex/config.toml',
    );
  });

  it('replaces a windows user directory', () => {
    expect(scrubHomePaths('C:\\Users\\Ada\\AppData\\npm')).toBe(
      '~\\AppData\\npm',
    );
  });

  it('leaves text without a home directory alone', () => {
    expect(scrubHomePaths('error: unexpected argument')).toBe(
      'error: unexpected argument',
    );
  });
});

describe('expectedFailureHint', () => {
  const table = [
    { match: /unexpected argument/i, hint: 'update your CLI' },
    { match: /ENOENT/, hint: 'reinstall the CLI' },
  ];

  it('returns the hint for the first matching pattern', () => {
    expect(
      expectedFailureHint("error: unexpected argument 'marketplace'", table),
    ).toBe('update your CLI');
  });

  it('returns undefined for a failure worth reporting', () => {
    expect(
      expectedFailureHint('something new and strange', table),
    ).toBeUndefined();
  });

  it('returns undefined for empty text rather than matching everything', () => {
    expect(expectedFailureHint('', table)).toBeUndefined();
  });
});
