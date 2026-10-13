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
} from '@programs/warehouse-sources/registry';
import { FIXTURE_CATALOG } from './helpers/tool-catalog.no-jest';

const US = 'https://us.posthog.com/api/wizard/tool_catalog/';
const EU = 'https://eu.posthog.com/api/wizard/tool_catalog/';
const GITHUB =
  'https://raw.githubusercontent.com/PostHog/posthog/master/products/wizard/tool-catalog.generated.json';

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

  it('falls back from US to EU to GitHub in order', async () => {
    const fetchMock = serve({
      [US]: () => json({ detail: 'unavailable' }, 503),
      [GITHUB]: () => json(FIXTURE_CATALOG),
    });

    const detectors = await loadSourceDetectors();

    expect(requestedUrls(fetchMock)).toEqual([US, EU, GITHUB]);
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
    [
      'an env key pattern that does not compile',
      {
        schema_version: 1,
        tools: [
          {
            ...FIXTURE_CATALOG.tools[0],
            signals: {
              ...FIXTURE_CATALOG.tools[0].signals,
              env_key_patterns: ['^(UNCLOSED'],
            },
          },
        ],
      },
    ],
  ])('skips a source that serves %s', async (_label, body) => {
    serve({ [US]: () => json(body), [EU]: () => json(FIXTURE_CATALOG) });

    const detectors = await loadSourceDetectors();

    expect(kinds(detectors)).toEqual(kinds(FIXTURE_CATALOG.tools));
  });

  it('resolves to no detectors and reports it when every source fails', async () => {
    serve({});

    await expect(loadSourceDetectors()).resolves.toEqual([]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'tool catalog unavailable',
      {
        failures: {
          us: 'fetch failed',
          eu: 'fetch failed',
          github: 'fetch failed',
        },
      },
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
