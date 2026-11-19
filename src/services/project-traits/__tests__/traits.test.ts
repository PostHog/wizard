import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { buildSession } from '@services/session/wizard-session';
import { FRAMEWORK_REGISTRY } from '@services/frameworks/registry';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@services/warehouse-sources/detect';
import { POSTHOG_SDKS_KEY } from '@services/detection/posthog-sdks';
import {
  RUN_PROJECT,
  getProject,
  getTraits,
  toMatchKeys,
} from '@services/project-traits/traits';

const session = (overrides: Parameters<typeof buildSession>[0] = {}) =>
  buildSession({ installDir: '/repo', ...overrides });

describe('getTraits', () => {
  it('has no traits before detection settles anything', () => {
    expect(getTraits(session())).toEqual({});
  });

  it('reads the framework from the session', () => {
    const value = session();
    value.integration = Integration.django;
    expect(getTraits(value)).toEqual({ framework: Integration.django });
  });

  it.each(Object.values(Integration))(
    'has no %s variant until the framework context is gathered',
    (framework) => {
      const value = session();
      value.integration = framework;
      expect(getTraits(value).frameworkVariant).toBeUndefined();
    },
  );

  it('says a project calls an LLM API only when an LLM SDK is a dependency', () => {
    const value = session();
    value.discoveredFeatures = [DiscoveredFeature.Stripe];
    expect(getTraits(value).callsLlmApi).toBeUndefined();
    value.discoveredFeatures = [DiscoveredFeature.LLM];
    expect(getTraits(value).callsLlmApi).toBe('yes');
  });

  it('reads the MCP server candidates and the warehouse sources', () => {
    const value = session();
    value.mcpServerCandidates = ['apps/mcp'];
    value.frameworkContext = {
      [DETECTED_WAREHOUSE_SOURCES_KEY]: [
        { kind: 'Stripe', label: 'Stripe', mode: 'guided', matchedSignal: 'x' },
        {
          kind: 'Postgres',
          label: 'Postgres',
          mode: 'guided',
          matchedSignal: 'y',
        },
      ],
    };
    const traits = getTraits(value);
    expect(traits.mcpServers).toEqual(['apps/mcp']);
    expect(traits.warehouseSources).toEqual(['Stripe', 'Postgres']);
  });

  it('knows only the directory the run works in', () => {
    const value = session();
    value.integration = Integration.django;
    expect(getTraits(value, 'apps/web')).toEqual({});
    expect(getProject(value)).toEqual({
      path: RUN_PROJECT,
      traits: getTraits(value),
    });
  });
});

describe('the Nuxt variant', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-variant-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** The variant of a project whose package.json declares these dependencies. */
  const variantOf = async (dependencies: Record<string, string>) => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies }),
    );
    const value = session({ installDir: dir });
    value.integration = Integration.nuxt;
    value.frameworkContext =
      (await FRAMEWORK_REGISTRY[Integration.nuxt].metadata.gatherContext?.({
        installDir: dir,
        debug: false,
        signup: false,
        ci: false,
        benchmark: false,
        yaraReport: false,
      })) ?? {};
    return getTraits(value).frameworkVariant;
  };

  it.each([
    ['^3.12.0', '3.x'],
    ['4.1.2', '4.x'],
  ])('is the major version of nuxt %s', async (version, variant) => {
    expect(await variantOf({ nuxt: version })).toBe(variant);
  });

  it.each(['latest', 'workspace:*', 'github:nuxt/nuxt'])(
    'is absent when the version %s cannot be read',
    async (version) => {
      expect(await variantOf({ nuxt: version })).toBeUndefined();
    },
  );

  it('is absent when nuxt is not a dependency', async () => {
    expect(await variantOf({ vue: '^3.4.0' })).toBeUndefined();
  });
});

describe('toMatchKeys', () => {
  it('carries framework, frameworkVariant, and detected sdk majors while leaving non-match traits out', () => {
    const value = session();
    value.integration = Integration.nextjs;
    value.frameworkContext = {
      router: 'pages-router',
      [POSTHOG_SDKS_KEY]: [
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 5,
          constraintKind: 'range',
          rawSpec: '^5.28.1',
          source: 'package.json',
        },
      ],
    };
    value.discoveredFeatures = [DiscoveredFeature.LLM];
    value.mcpServerCandidates = ['apps/mcp'];
    expect(toMatchKeys(getTraits(value))).toEqual({
      framework: [Integration.nextjs],
      frameworkVariant: ['pages-router'],
      sdkNode: ['5'],
    });
  });

  it('collects distinct majors across multiple manifests for one SDK key', () => {
    const value = session();
    value.frameworkContext = {
      [POSTHOG_SDKS_KEY]: [
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 5,
          constraintKind: 'range',
          rawSpec: '^5.28.1',
          source: 'apps/a/package.json',
        },
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 6,
          constraintKind: 'range',
          rawSpec: '^6.0.0',
          source: 'apps/b/package.json',
        },
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 5,
          constraintKind: 'pinned',
          rawSpec: '5.10.0',
          source: 'apps/c/package.json',
        },
      ],
    };
    expect(getTraits(value).sdkNode).toEqual(['5', '6']);
    expect(toMatchKeys(getTraits(value)).sdkNode).toEqual(['5', '6']);
  });

  it('is empty when no framework or PostHog SDK is detected', () => {
    expect(toMatchKeys(getTraits(session()))).toEqual({});
  });
});
