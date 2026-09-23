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

  it('masks credentials embedded in a git remote a failed clone echoes back', () => {
    const out = redactSecrets(
      "fatal: could not read from 'https://vincent:ghp_AAAAAAAAAAAAAAAAAAAA@github.com/PostHog/ai-plugin.git'",
    );
    expect(out).not.toContain('ghp_AAAAAAAAAAAAAAAAAAAA');
    expect(out).not.toContain('vincent:');
    expect(out).toContain('github.com/PostHog/ai-plugin.git');
  });

  it('masks a bare GitHub token', () => {
    expect(redactSecrets('remote: token ghp_0123456789abcdefghij denied')).toBe(
      'remote: token [redacted] denied',
    );
    expect(
      redactSecrets('using github_pat_0123456789abcdefghij_more now'),
    ).toBe('using [redacted] now');
  });

  it("masks another provider's key quoted out of the user's config", () => {
    expect(
      redactSecrets('OPENAI_API_KEY sk-proj-0123456789abcdefghij is invalid'),
    ).toBe('OPENAI_API_KEY [redacted] is invalid');
  });

  it('masks a provider key we have no shape for, keeping the variable name', () => {
    expect(
      redactSecrets(
        'invalid value for AZURE_OPENAI_API_KEY = "abc123def456ghi"',
      ),
    ).toBe('invalid value for AZURE_OPENAI_API_KEY = [redacted]');
    expect(redactSecrets('github_token: abcdef0123456789')).toBe(
      'github_token: [redacted]',
    );
  });

  it('masks a google key', () => {
    expect(redactSecrets('rejected AIzaSyA0123456789abcdefghij here')).toBe(
      'rejected [redacted] here',
    );
  });

  it('keeps the wording an expected-failure hint matches on', () => {
    // The config hint fires on `OPENAI_API_KEY`; masking the name with the
    // value would file this as an exception instead of hinting.
    expect(
      redactSecrets('Missing OPENAI_API_KEY=sk-proj-0123456789abcdefghij'),
    ).toContain('OPENAI_API_KEY');
  });

  it('leaves an ordinary URL and ordinary words alone', () => {
    expect(
      redactSecrets('cloning https://github.com/PostHog/ai-plugin.git failed'),
    ).toBe('cloning https://github.com/PostHog/ai-plugin.git failed');
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

  // Wording that means one thing during one stage can mean something else
  // during another, and a hint naming the wrong command is worse than none.
  describe('scoping a hint to the stages it makes sense on', () => {
    const scoped = [
      {
        match: /unexpected argument/i,
        stages: ['plugin install'],
        hint: 'update codex, then add the marketplace',
      },
      { match: /unexpected argument/i, hint: 'update codex' },
    ];

    it("prefers the entry scoped to the caller's stage", () => {
      expect(
        expectedFailureHint('unexpected argument', scoped, 'plugin install'),
      ).toBe('update codex, then add the marketplace');
    });

    it('skips a scoped entry on another stage', () => {
      expect(
        expectedFailureHint('unexpected argument', scoped, 'MCP add'),
      ).toBe('update codex');
    });

    // A scoped entry cannot be honoured by a caller that did not say what it
    // was doing, so it must not fire by default.
    it('ignores scoped entries when no stage is given', () => {
      expect(expectedFailureHint('unexpected argument', scoped)).toBe(
        'update codex',
      );
    });

    it('reports when only a mismatched scoped entry exists', () => {
      const onlyScoped = [scoped[0]];
      expect(
        expectedFailureHint('unexpected argument', onlyScoped, 'MCP add'),
      ).toBeUndefined();
    });
  });

  // The tell that a failure is ours, not the environment's. Silencing it would
  // retire one of our own bugs into advice nobody can act on.
  describe('disqualifying a match that is really our problem', () => {
    const guarded = [
      {
        match: /git clone .* failed/i,
        unless: /repository not found/i,
        hint: 'check your network',
      },
    ];

    it('hints when nothing disqualifies the match', () => {
      expect(
        expectedFailureHint('git clone x failed: timed out', guarded),
      ).toBe('check your network');
    });

    it('reports when the disqualifying wording is present', () => {
      expect(
        expectedFailureHint(
          'git clone x failed: repository not found',
          guarded,
        ),
      ).toBeUndefined();
    });
  });
});
