import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  CONTEXT_MILL_LOCAL_URL,
  MCP_LOCAL_URL,
  POSTHOG_LOCAL_URL,
  checkLocalServices,
  localDevFromArgv,
  localMcpSkillsNotice,
  resolveLocalDev,
} from '@lib/local-dev';
import {
  getSkillsBaseUrl,
  REMOTE_SKILLS_BASE_URL,
  LOCAL_SKILLS_BASE_URL,
} from '@lib/constants';

describe('local dev endpoints', () => {
  it('pins each service to its own port', () => {
    expect(CONTEXT_MILL_LOCAL_URL).toBe('http://localhost:8765');
    expect(MCP_LOCAL_URL).toBe('http://localhost:8787/mcp');
    expect(POSTHOG_LOCAL_URL).toBe('http://localhost:8010');
  });
});

describe('resolveLocalDev', () => {
  it('defaults every service to remote', () => {
    expect(resolveLocalDev({})).toEqual({
      localMcp: false,
      localContextMill: false,
      localPosthog: false,
    });
  });

  it('turns on all three under the --local-dev umbrella', () => {
    expect(resolveLocalDev({ localDev: true })).toEqual({
      localMcp: true,
      localContextMill: true,
      localPosthog: true,
    });
  });

  it('lets a specific flag stand alone without the umbrella', () => {
    // What CI runs.
    expect(resolveLocalDev({ localContextMill: true })).toEqual({
      localMcp: false,
      localContextMill: true,
      localPosthog: false,
    });
  });

  // Both break silently if the specific flags ever gain `default: false`.
  describe('umbrella vs explicit negation', () => {
    it('subtracts a service when explicitly negated', () => {
      expect(resolveLocalDev({ localDev: true, localMcp: false })).toEqual({
        localMcp: false,
        localContextMill: true,
        localPosthog: true,
      });
    });

    it('inherits the umbrella when a flag is merely absent', () => {
      expect(resolveLocalDev({ localDev: true, localMcp: undefined })).toEqual({
        localMcp: true,
        localContextMill: true,
        localPosthog: true,
      });
    });
  });

  it('lets an explicit flag win over an umbrella that is off', () => {
    expect(resolveLocalDev({ localDev: false, localMcp: true })).toEqual({
      localMcp: true,
      localContextMill: false,
      localPosthog: false,
    });
  });
});

describe('localDevFromArgv', () => {
  it('reads camelCase and kebab-case spellings', () => {
    expect(localDevFromArgv({ localContextMill: true }).localContextMill).toBe(
      true,
    );
    expect(
      localDevFromArgv({ 'local-context-mill': true }).localContextMill,
    ).toBe(true);
  });

  it('resolves to all-remote when the flags are undeclared', () => {
    // What a published build sees — the options don't exist.
    expect(localDevFromArgv({ _: [], $0: 'wizard' })).toEqual({
      localMcp: false,
      localContextMill: false,
      localPosthog: false,
    });
  });

  it('applies the umbrella through argv', () => {
    expect(localDevFromArgv({ localDev: true })).toEqual({
      localMcp: true,
      localContextMill: true,
      localPosthog: true,
    });
  });

  it('ignores non-boolean values rather than coercing them', () => {
    expect(localDevFromArgv({ localMcp: 'yes' }).localMcp).toBe(false);
  });
});

describe('getSkillsBaseUrl', () => {
  // The regression this split exists to prevent.
  it('follows the context-mill flag, not the MCP flag', () => {
    const mcpOnly = resolveLocalDev({ localMcp: true });
    expect(getSkillsBaseUrl(mcpOnly.localContextMill)).toBe(
      REMOTE_SKILLS_BASE_URL,
    );

    const millOnly = resolveLocalDev({ localContextMill: true });
    expect(getSkillsBaseUrl(millOnly.localContextMill)).toBe(
      LOCAL_SKILLS_BASE_URL,
    );
  });

  it('serves local skills from the context-mill dev server', () => {
    expect(LOCAL_SKILLS_BASE_URL).toBe(CONTEXT_MILL_LOCAL_URL);
  });
});

describe('checkLocalServices', () => {
  const ALL_LOCAL = {
    localMcp: true,
    localContextMill: true,
    localPosthog: true,
  };

  // `fetch` is stubbed rather than binding real ports: 8765/8787/8010 are the
  // ports the actual dev stack uses, so a developer running it would otherwise
  // fail these tests. Stubbing also lets a single test cover both replies and
  // refusals without racing the OS to release a port.
  const stubFetch = (reachable: (url: string) => number | 'refused') => {
    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = String(input);
      const result = reachable(url);
      return result === 'refused'
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(new Response(null, { status: result }));
    });
  };

  const allRefused = () => stubFetch(() => 'refused');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says nothing when no service was requested local', async () => {
    allRefused();
    await expect(
      checkLocalServices({
        localMcp: false,
        localContextMill: false,
        localPosthog: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('probes nothing at all when no service was requested', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return 'refused';
    });
    await checkLocalServices({
      localMcp: false,
      localContextMill: false,
      localPosthog: false,
    });
    expect(seen).toEqual([]);
  });

  it('names every unreachable service, with the flag that asked for it', async () => {
    allRefused();
    const msg = await checkLocalServices(ALL_LOCAL);
    expect(msg).toContain('context-mill');
    expect(msg).toContain('--local-context-mill');
    expect(msg).toContain('MCP server');
    expect(msg).toContain('--local-mcp');
    expect(msg).toContain('PostHog');
    expect(msg).toContain('--local-posthog');
  });

  it('only reports services that were actually requested', async () => {
    allRefused();
    const msg = await checkLocalServices({
      localMcp: false,
      localContextMill: true,
      localPosthog: false,
    });
    expect(msg).toContain('context-mill');
    expect(msg).not.toContain('MCP server');
    expect(msg).not.toContain('PostHog —');
  });

  // A bound port is the whole question. The real MCP rejects a bare GET, and
  // skill-menu.json can 404 on a stale server — neither means "not running".
  it('treats any HTTP reply as reachable, including 404 and 405', async () => {
    stubFetch((url) =>
      url.includes('8787') ? 405 : url.includes('8010') ? 404 : 200,
    );
    await expect(checkLocalServices(ALL_LOCAL)).resolves.toBeUndefined();
  });

  it('isolates the one service that is down', async () => {
    stubFetch((url) => (url.includes('8787') ? 'refused' : 200));
    const msg = await checkLocalServices(ALL_LOCAL);
    expect(msg).toContain('MCP server');
    expect(msg).not.toContain('context-mill');
    expect(msg).not.toContain('PostHog —');
  });

  // The gate sits in front of fetchWithRetry, so it must be at least as
  // forgiving — otherwise a blip the real fetch would survive aborts the run.
  it('retries a failing probe before declaring a service down', async () => {
    let attempts = 0;
    stubFetch(() => (++attempts < 3 ? 'refused' : 200));
    await expect(
      checkLocalServices({
        localMcp: false,
        localContextMill: true,
        localPosthog: false,
      }),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(3);
  });

  it('probes each requested service on its own port', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return 200;
    });
    await checkLocalServices(ALL_LOCAL);
    expect(seen.some((u) => u.startsWith('http://localhost:8765/'))).toBe(true);
    expect(seen.some((u) => u.startsWith('http://localhost:8787/'))).toBe(true);
    expect(seen.some((u) => u.startsWith('http://localhost:8010'))).toBe(true);
  });
});

describe('localMcpSkillsNotice', () => {
  it('warns when --local-mcp is passed alone', () => {
    expect(localMcpSkillsNotice({ localMcp: true })).toContain(
      '--local-context-mill',
    );
  });

  it('stays quiet once the skills flag is explicit either way', () => {
    expect(
      localMcpSkillsNotice({ localMcp: true, localContextMill: true }),
    ).toBeUndefined();
    // Opting out explicitly is still informed — don't nag.
    expect(
      localMcpSkillsNotice({ localMcp: true, localContextMill: false }),
    ).toBeUndefined();
  });

  it('stays quiet under the umbrella', () => {
    expect(
      localMcpSkillsNotice({ localDev: true, localMcp: true }),
    ).toBeUndefined();
  });

  it('stays quiet when --local-mcp was not passed', () => {
    expect(localMcpSkillsNotice({})).toBeUndefined();
    expect(localMcpSkillsNotice({ localContextMill: true })).toBeUndefined();
  });
});
