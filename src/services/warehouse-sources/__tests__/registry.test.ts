vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));
// Dev and test builds pin localhost; these tests choose the pinned host themselves.
vi.mock(import('@utils/urls'), () => ({
  resolveBaseUrl: (baseUrl?: string) => baseUrl,
}));

import { analytics } from '@utils/analytics';
import {
  loadSourceDetectors,
  resetSourceDetectors,
  toSourceDetectors,
} from '@services/warehouse-sources/registry';
import type { CatalogTool } from '@services/warehouse-sources/types';
import { FIXTURE_CATALOG } from './helpers/tool-catalog.no-jest';

const US = 'https://us.posthog.com/api/wizard/tool_catalog/';
const EU = 'https://eu.posthog.com/api/wizard/tool_catalog/';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Serves each URL's response, and fails any URL it does not list. */
function serve(responses: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const respond = responses[String(input)];
    return respond
      ? Promise.resolve(respond())
      : Promise.reject(new TypeError('fetch failed'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const requestedUrls = (fetchMock: ReturnType<typeof serve>): string[] =>
  fetchMock.mock.calls.map(([input]) => String(input));

const kinds = (detectors: readonly { kind: string }[]): string[] =>
  detectors.map((d) => d.kind);

describe('loadSourceDetectors', () => {
  beforeEach(() => {
    resetSourceDetectors();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('falls back from US to EU in order', async () => {
    const fetchMock = serve({
      [US]: () => json({ detail: 'unavailable' }, 503),
      [EU]: () => json(FIXTURE_CATALOG),
    });

    const detectors = await loadSourceDetectors();

    expect(requestedUrls(fetchMock)).toEqual([US, EU]);
    expect(kinds(detectors)).toEqual(kinds(FIXTURE_CATALOG.tools));
  });

  it('tries a pinned PostHog host before the public ones', async () => {
    const fetchMock = serve({
      'http://localhost:8010/api/wizard/tool_catalog/': () =>
        json(FIXTURE_CATALOG),
    });

    await loadSourceDetectors('http://localhost:8010/');

    expect(requestedUrls(fetchMock)).toEqual([
      'http://localhost:8010/api/wizard/tool_catalog/',
    ]);
  });

  it.each([
    ['another schema_version', { ...FIXTURE_CATALOG, schema_version: 2 }],
    ['a body without tools', { schema_version: 1 }],
    ['a body that is not an object', ['Postgres']],
  ])('skips a source that serves %s', async (_label, body) => {
    serve({ [US]: () => json(body), [EU]: () => json(FIXTURE_CATALOG) });

    const detectors = await loadSourceDetectors();

    expect(kinds(detectors)).toEqual(kinds(FIXTURE_CATALOG.tools));
  });

  it('uses a source whose catalog has one invalid tool', async () => {
    const fetchMock = serve({
      [US]: () =>
        json({
          ...FIXTURE_CATALOG,
          tools: [{ kind: 'Broken' }, ...FIXTURE_CATALOG.tools],
        }),
    });

    const detectors = await loadSourceDetectors();

    expect(requestedUrls(fetchMock)).toEqual([US]);
    expect(kinds(detectors)).toEqual(kinds(FIXTURE_CATALOG.tools));
  });

  it('resolves to no detectors and reports it when every source fails', async () => {
    const fetchMock = serve({});

    await expect(loadSourceDetectors()).resolves.toEqual([]);
    expect(requestedUrls(fetchMock)).toEqual([US, EU]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'tool catalog unavailable',
      { failures: { us: 'fetch failed', eu: 'fetch failed' } },
    );
  });

  it('downloads once when called twice', async () => {
    const fetchMock = serve({ [US]: () => json(FIXTURE_CATALOG) });

    const [first, second] = await Promise.all([
      loadSourceDetectors(),
      loadSourceDetectors(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});

describe('toSourceDetectors', () => {
  const valid = FIXTURE_CATALOG.tools[0];
  const withSignals = (
    signals: Partial<CatalogTool['signals']>,
  ): Record<string, unknown> => ({
    ...valid,
    signals: { ...valid.signals, ...signals },
  });

  it.each<[string, Record<string, unknown>]>([
    ['a kind with punctuation', { ...valid, kind: 'Post-gres' }],
    ['a label with markup', { ...valid, label: '<b>PostgreSQL</b>' }],
    [
      'a warehouse source type with a space',
      { ...valid, warehouse_source_type: 'Post gres' },
    ],
    ['a superseded_by with a slash', { ...valid, superseded_by: ['Neon/x'] }],
    ['an unknown setup mode', { ...valid, wizard_setup_mode: 'in-browser' }],
    [
      'a package name with a space',
      withSignals({ packages: { npm: ['p g'] } }),
    ],
    [
      'a script host with a path',
      withSignals({ script_hosts: ['cdn.example.com/x.js'] }),
    ],
    [
      'an env key pattern that does not compile',
      withSignals({ env_key_patterns: ['^(UNCLOSED'] }),
    ],
    [
      'an env key pattern with a nested quantifier',
      withSignals({ env_key_patterns: ['^(A+)+$'] }),
    ],
    [
      'an env key pattern with a wildcard',
      withSignals({ env_key_patterns: ['^.*_KEY$'] }),
    ],
    [
      'an unanchored env key pattern',
      withSignals({ env_key_patterns: ['STRIPE_KEY$'] }),
    ],
  ])('skips a tool with %s and keeps the rest', (_label, entry) => {
    const detectors = toSourceDetectors({
      ...FIXTURE_CATALOG,
      tools: [entry, ...FIXTURE_CATALOG.tools.slice(1)],
    });

    expect(kinds(detectors)).toEqual(kinds(FIXTURE_CATALOG.tools.slice(1)));
  });

  it('accepts optional characters and groups of alternatives in env key patterns', () => {
    const [detector] = toSourceDetectors({
      ...FIXTURE_CATALOG,
      tools: [withSignals({ env_key_patterns: ['^PG(HOST|PORT)?_?URL$'] })],
    });

    expect(detector.signals.envKeys[0].test('PG_URL')).toBe(true);
    expect(detector.signals.envKeys[0].test('PGHOSTURL')).toBe(true);
  });
});
